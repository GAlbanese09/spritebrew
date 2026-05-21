/**
 * Extract unique pixel colors from an ImageData, skipping transparent pixels.
 * Returns up to maxColors hex strings (with # prefix), in order of first
 * appearance.
 *
 * Pulled out of PixelEditor.tsx during Phase 1 of the v2 editor refactor so
 * the same logic can seed:
 *   - PixelEditorBody (on frame load, working palette)
 *   - EditorLanding (on image upload, palette preview — future use)
 *
 * Pure function — no React, no DOM, safe to call from any context that has
 * an ImageData in hand.
 */
export function extractPaletteFromImageData(
  imageData: ImageData,
  maxColors = 16
): string[] {
  const colors = new Set<string>();
  for (let i = 0; i < imageData.data.length; i += 4) {
    if (imageData.data[i + 3] < 10) continue;
    const r = imageData.data[i];
    const g = imageData.data[i + 1];
    const b = imageData.data[i + 2];
    colors.add(
      `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
    );
    if (colors.size >= maxColors) break;
  }
  return Array.from(colors).slice(0, maxColors);
}
