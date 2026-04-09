# 🧪 SpriteBrew

**AI-powered pixel art sprite sheet generator.** Upload or generate characters → animate → slice → preview → export game-ready sheets for Unity, Godot, GameMaker, RPG Maker.

> **Status:** Pre-launch · Active development · [Join the waitlist](https://spritebrew.com)

🌐 **[spritebrew.com](https://spritebrew.com)** — Try it now (free account required for AI generation)

<!-- TODO: Add hero screenshot of the landing page with the animated wizard -->

---

## What is SpriteBrew?

SpriteBrew is a web-based tool for game developers and pixel artists that combines traditional sprite sheet workflows with AI-powered generation. Create new characters from text descriptions, animate existing pixel art, preview animations with keyboard controls, and export to every major game engine — all in one place.

**Free tools (no account needed):** Upload & Slice, Animation Preview, Multi-Engine Export, Pixel Editor, Pixel-Perfect Resizer

**AI features (free account, 5 generations/day):** Text-to-Sprite Generation, Animate My Character

---

## Features

### 🎨 AI Sprite Generation
Describe a character in plain text and get a complete animated sprite sheet. Choose from multiple animation styles including 4-angle walking, walking & idle, small sprites, and VFX. Powered by Retro Diffusion's pixel art models.

<!-- TODO: Add animated GIF of the generation flow -->

### 🏃 Animate My Character
Upload your existing pixel art character and generate animation frames from it. Walk cycles, idle loops, attacks, jumps, crouches, and destruction animations — the AI preserves your character's appearance while creating smooth motion. Smart animation padding ensures weapons and motion aren't clipped.

### 🧙 Auto-Prep Character Pipeline
Drop any character image and SpriteBrew handles the rest: contour-based sprite detection, smart cropping, background removal with adjustable tolerance, and pixel-perfect resize to 64×64. Before/after preview with one-click approval. Edit the prepped image in the built-in pixel editor if auto-detection missed something.

### ✂️ Upload & Slice
Drop any sprite sheet PNG, configure frame dimensions (auto-detect or manual), and slice it into individual frames. Grid overlay preview, multi-select frames, contour-based detection for non-grid layouts, and smart auto-assignment of animation groups with directional detection.

### 🎮 Animation Preview
PixiJS-powered interactive demo area with full keyboard controls. Walk your character around with arrow keys, trigger attacks with spacebar, and test animations in real-time. Supports 4-directional movement for top-down RPG sprites. Multiple tiled backgrounds (grid, grass, dungeon, stone).

### 📦 Multi-Engine Export
Export to six formats in one click:
- **TexturePacker** JSON Hash (Unity, Godot, general)
- **Aseprite** JSON (pixel art workflow)
- **GameMaker** horizontal strips
- **RPG Maker** MV/MZ 3×4 grid
- **Godot** SpriteFrames .tres
- **Raw Frames** ZIP (individual PNGs)

### 🖌️ Pixel Editor
Click any frame to open a zoomed pixel editor. Fix AI artifacts, touch up details, or make manual adjustments. Pencil, eraser, eyedropper, color palette, undo/redo (50 states, Ctrl+Z). Edit at 8-16× zoom with pixel grid overlay and 1× preview alongside.

### 📸 Generation Gallery
Browse all past generations with filtering (Created vs Animated). Download PNGs, send to slicer, or delete. Per-user history — each account sees only their own generations.

### 🔐 Authentication
Sign in with GitHub or email. Free tools work without an account. AI generation requires a free login (5 generations/day). Powered by Clerk with production SSO.

### 📐 Pixel-Perfect Image Resizer
Built-in nearest-neighbor resizing for preparing pixel art for animation. Upload a high-res character, resize to 64×64 with crisp pixel-perfect scaling — no blurry bilinear interpolation.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (React 19) |
| Styling | Tailwind CSS v4 |
| State | Zustand |
| Animation | PixiJS 8 |
| Auth | Clerk (`@clerk/react`) |
| AI Backend | Retro Diffusion (direct API + Replicate hosting) |
| Storage | Cloudflare KV |
| Export | JSZip |
| Hosting | Cloudflare Pages |
| License | AGPL-3.0 |

---

## Architecture Highlights

- **SSE streaming** with 15-second heartbeats to work around Cloudflare Pages' 120-second proxy timeout during long AI generations
- **Base64 image pipeline** — no URL expiration issues, images cached per-user in generation gallery
- **Per-user daily limits** via localStorage with admin bypass for development
- **Waitlist system** backed by Cloudflare KV for Pro tier signups
- **Contour-based sprite detection** using connected component labeling for non-grid sprite sheets
- **Calibration-driven development** — when AI APIs are undocumented, we write targeted calibration scripts to get ground truth

---

## Getting Started (Development)
```bash
# Clone the repo
git clone https://github.com/GAlbanese09/spritebrew.git
cd spritebrew

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
```

Add your API keys to `.env.local`:
```
REPLICATE_API_TOKEN=your_replicate_token
RETRO_DIFFUSION_API_KEY=your_retrodiffusion_key
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
CLERK_SECRET_KEY=your_clerk_secret_key
```
```bash
# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

**Note:** The waitlist feature requires a Cloudflare KV binding (`SPRITEBREW_KV`) to work in production. Local development works without it (falls back to in-memory storage).

---

## The Story

SpriteBrew exists because a friend is building a pixel art game and needed sprite sheets. Making them by hand is brutally slow — every frame, every direction, every animation state, hand-drawn. There had to be a better way.

Built by [George Albanese](https://github.com/GAlbanese09) — an endpoint automation engineer by day, solo indie developer by night. Zero prior web dev experience before March 2026. Built with Claude as architect and co-pilot, session by session, from empty repo to production tool.

If you're curious about the journey, the full build diary lives in the project's internal Confluence (not public — but the commit history tells the story too).

---

## Roadmap

- [x] Phase 1: Web shell, sprite slicer, export engine (6 formats)
- [x] Phase 2: AI integration (Retro Diffusion)
- [x] Landing page and waitlist
- [x] Clerk production auth
- [ ] Visual style picker with live previews
- [ ] Full Retro Diffusion direct API migration (unlocks 40+ styles)
- [ ] Credit system with Stripe integration
- [ ] OpenNext migration (replace deprecated `@cloudflare/next-on-pages`)
- [ ] Self-hosted AI pipeline (ComfyUI on RunPod)
- [ ] Isometric sprite support
- [ ] Tauri desktop app (Phase 4)

---

## Acknowledgments

- **[Retro Diffusion](https://retrodiffusion.ai)** — the AI models that make SpriteBrew's pixel art generation possible. Built by pixel artists, for pixel artists.
- **[Clerk](https://clerk.com)** — authentication without the pain
- **[Cloudflare](https://cloudflare.com)** — Pages, KV, and the infrastructure that keeps this running on a hobby budget
- **[PixiJS](https://pixijs.com)** — the rendering engine behind the animation preview
- **Claude (Anthropic)** — architect, research partner, prompt writer, rubber duck
- **George's friend** — the reason this exists in the first place

---

## License

[AGPL-3.0](LICENSE) — Open source with SaaS protection. You can use, modify, and distribute SpriteBrew, but if you deploy a modified version as a service, you must release your changes under the same license.

---

## Contributing

SpriteBrew is in early development and pre-launch. If you're interested in contributing, please open an issue first to discuss what you'd like to work on. A Contributor License Agreement (CLA) will be required before merging PRs.

Bug reports, feature suggestions, and feedback are welcome via [GitHub Issues](https://github.com/GAlbanese09/spritebrew/issues).

---

Built with ☕ and Claude · [spritebrew.com](https://spritebrew.com)