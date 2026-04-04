# 🧪 SpriteBrew

**AI-powered pixel art sprite sheet generator.** Upload or generate characters → animate → slice → preview → export game-ready sheets for Unity, Godot, GameMaker, RPG Maker.

🌐 **[spritebrew.com](https://spritebrew.com)** — Try it now (free account required for AI generation)

---

## What is SpriteBrew?

SpriteBrew is a web-based tool for game developers and pixel artists that combines traditional sprite sheet workflows with AI-powered generation. Create new characters from text descriptions, animate existing pixel art, preview animations with keyboard controls, and export to every major game engine — all in one place.

**Free tools (no account needed):** Upload & Slice, Animation Preview, Multi-Engine Export, Pixel Editor

**AI features (free account, 5 generations/day):** Text-to-Sprite Generation, Animate My Character

---

## Features

### 🎨 AI Sprite Generation
Describe a character in plain text and get a complete animated sprite sheet. Choose from multiple animation styles including 4-angle walking, walking & idle, and custom animations. Powered by Retro Diffusion.

### 🏃 Animate My Character
Upload your existing pixel art character and generate animation frames from it. Walk cycles, idle loops, attacks, jumps — the AI preserves your character's appearance while creating smooth animation. Supports 64×64 sprites with built-in pixel-perfect resizing.

### ✂️ Upload & Slice
Drop any sprite sheet PNG, configure frame dimensions (auto-detect or manual), and slice it into individual frames. Grid overlay preview, multi-select frames, and smart auto-assignment of animation groups with directional detection.

### 🎮 Animation Preview
PixiJS-powered interactive demo area with full keyboard controls. Walk your character around with arrow keys, trigger attacks with spacebar, and test animations in real-time. Supports 4-directional movement for top-down RPG sprites. Multiple tiled backgrounds (grid, grass, dungeon, etc.).

### 📦 Multi-Engine Export
Export to six formats in one click:
- **TexturePacker** JSON Hash (Unity, Godot, general)
- **Aseprite** JSON (pixel art workflow)
- **GameMaker** horizontal strips
- **RPG Maker** MV/MZ 3×4 grid
- **Godot** SpriteFrames .tres
- **Raw Frames** ZIP (individual PNGs)

### 🖌️ Pixel Editor
Click any frame to open a zoomed pixel editor. Fix AI artifacts, touch up details, or make manual adjustments. Pencil, eraser, eyedropper, color palette, undo/redo (Ctrl+Z). Edit at 8-16× zoom with pixel grid overlay and 1× preview alongside.

### 📸 Generation Gallery
Browse all past generations with filtering (Created vs Animated). Download PNGs, send to slicer, or delete. Per-user history — each account sees only their own generations.

### 🔐 Authentication
Sign in with Google, GitHub, or email. Free tools work without an account. AI generation requires a free login (5 generations/day). Powered by Clerk.

### 📐 Pixel-Perfect Image Resizer
Built-in nearest-neighbor resizing for preparing pixel art for animation. Upload a high-res character, resize to 64×64 with crisp pixel-perfect scaling — no blurry bilinear interpolation.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16.2 (React 19) |
| Styling | Tailwind CSS v4 |
| State | Zustand |
| Animation | PixiJS 8 |
| Auth | Clerk |
| AI (Create New) | Retro Diffusion via Replicate |
| AI (Animate) | Retro Diffusion Direct API |
| Export | JSZip |
| Hosting | Cloudflare Pages |
| Domain | spritebrew.com |

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
# Add your API keys to .env.local:
# REPLICATE_API_TOKEN=your_replicate_token
# RETRO_DIFFUSION_API_KEY=your_retrodiffusion_key
# NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
# CLERK_SECRET_KEY=your_clerk_secret_key

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

---
## The Reason

The motivation: a friend is building a pixel art game and needs sprite sheets. Making them by hand is brutally slow. SpriteBrew exists to make that process 10× faster — generate characters with AI, animate existing art, preview in-browser, and export to any game engine.


---

## Roadmap

- [ ] Credit system with Stripe integration
- [ ] PixelLab skeleton-based animation (pending ToS approval)
- [ ] Self-hosted AI pipeline (ComfyUI on RunPod)
- [ ] Landing page with examples and pricing
- [ ] OpenNext migration (replace deprecated @cloudflare/next-on-pages)
- [ ] Isometric sprite support
- [ ] Tauri desktop app

---

## License

[AGPL-3.0](LICENSE) — Open source with SaaS protection. You can use, modify, and distribute SpriteBrew, but if you deploy a modified version as a service, you must release your changes under the same license.

---

## Contributing

SpriteBrew is in early development. If you're interested in contributing, please open an issue first to discuss what you'd like to work on. A Contributor License Agreement (CLA) will be required before merging PRs.

---

Built with ☕ and Claude · [spritebrew.com](https://spritebrew.com)