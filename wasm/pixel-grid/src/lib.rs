// Pixel grid fix for the /editor page: Retro Diffusion's pixel-art-fixer as
// WebAssembly. The fixer is MIT licensed, copyright Astropulse, LLC:
// https://github.com/Retro-Diffusion/pixel-art-fixer (the pinned revision is in
// Cargo.toml; the license text is LICENSE-pixel-art-fixer beside this crate).
// This file started as the w3-fixer-spike crate and does the same work as the
// fixer's "process <image> <out.png> full" command, with the same input limits.
//
// Plain C ABI around the fixer for wasm32-unknown-unknown.
//   alloc(len) -> ptr, dealloc(ptr, len)
//   fix(ptr, len) -> pointer to [u32 little-endian output length][PNG bytes],
//   or 0 on error. Free the result with dealloc(ptr, 4 + output length).
//   error_ptr() and error_len() give the last error text. A panic traps (wasm32
//   aborts on panic), but its text is stored first, so the host can still read
//   it. The host must then throw that instance away.
use image::{DynamicImage, ImageFormat, RgbaImage};
use std::alloc::{alloc as raw_alloc, dealloc as raw_dealloc, Layout};
use std::io::Cursor;
use std::sync::{Mutex, Once};

static LAST_ERROR: Mutex<String> = Mutex::new(String::new());
static HOOK: Once = Once::new();

fn set_error(msg: String) {
    if let Ok(mut e) = LAST_ERROR.lock() {
        *e = msg;
    }
}

#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    if len == 0 {
        return std::ptr::null_mut();
    }
    unsafe { raw_alloc(Layout::from_size_align(len, 1).unwrap()) }
}

/// # Safety
/// ptr and len must come from alloc or from fix's result.
#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    if !ptr.is_null() && len != 0 {
        raw_dealloc(ptr, Layout::from_size_align(len, 1).unwrap());
    }
}

#[no_mangle]
pub extern "C" fn error_ptr() -> *const u8 {
    LAST_ERROR.lock().map(|e| e.as_ptr()).unwrap_or(std::ptr::null())
}

#[no_mangle]
pub extern "C" fn error_len() -> usize {
    LAST_ERROR.lock().map(|e| e.len()).unwrap_or(0)
}

// Same work and same input limits as main's "process <image> <out.png> full".
const MIN_SIDE: usize = 16;
const MAX_PIXELS: usize = 4_000_000;

fn run(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let img = image::load_from_memory(bytes)
        .map_err(|e| format!("cannot open image: {}", e))?
        .to_rgba8();
    let (w, h) = (img.width() as usize, img.height() as usize);
    if w.min(h) < MIN_SIDE {
        return Err("image too small (min side 16px)".into());
    }
    if w * h > MAX_PIXELS {
        return Err(format!(
            "image too large ({:.1}MP > 4MP limit)",
            (w * h) as f64 / 1e6
        ));
    }
    let d = pixelfixer::core::detect_full(img.as_raw(), w, h);
    let r = pixelfixer::reconstruct::two_stage_pack(
        img.as_raw(),
        w,
        h,
        d.cols as usize,
        d.rows as usize,
        0,
    );
    let buf = RgbaImage::from_raw(r.cols as u32, r.rows as u32, r.rgba)
        .ok_or("internal: reconstruction buffer size mismatch")?;
    let mut png = Vec::new();
    DynamicImage::ImageRgba8(buf)
        .write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
        .map_err(|e| format!("cannot write output: {}", e))?;
    Ok(png)
}

/// # Safety
/// ptr must point to len readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fix(ptr: *const u8, len: usize) -> *mut u8 {
    HOOK.call_once(|| {
        std::panic::set_hook(Box::new(|info| set_error(format!("panic: {}", info))));
    });
    let input = std::slice::from_raw_parts(ptr, len);
    match run(input) {
        Ok(png) => {
            let out = alloc(png.len() + 4);
            if out.is_null() {
                set_error("out of memory".into());
                return std::ptr::null_mut();
            }
            std::ptr::copy_nonoverlapping((png.len() as u32).to_le_bytes().as_ptr(), out, 4);
            std::ptr::copy_nonoverlapping(png.as_ptr(), out.add(4), png.len());
            out
        }
        Err(e) => {
            set_error(e);
            std::ptr::null_mut()
        }
    }
}
