# 🧪 SpriteBrew

**AI-powered pixel art sprite sheet generator.** Generate characters from text → animate → slice → preview → export game-ready sheets for Unity, Godot, GameMaker, RPG Maker.

> **Status:** Live in production · Active development · Real customers brewing daily

🌐 **[spritebrew.com](https://spritebrew.com)** — Try it now (free account = 5 generation tokens to start)

---

## What is SpriteBrew?

SpriteBrew is a web-based tool for indie game developers that combines traditional sprite sheet workflows with AI-powered generation. Create new characters from text descriptions across 21 visual styles, animate existing pixel art, preview animations with full keyboard controls, and export to every major game engine — all in one place.

**Free tools (no account needed):** Upload & Slice, Animation Preview, Multi-Engine Export, Pixel Editor, Pixel-Perfect Resizer.

**AI features (free account, token-based):** Text-to-Sprite Generation across 21 styles, Animate My Character. Free signup bonus + daily login rewards. Token packs start at $4.99 for users who want more.

---

## Features

### 🎨 AI Sprite Generation
Describe a character in plain text and pick from 21 visual styles across 5 categories: characters (Pro Fantasy, Sci-fi, Horror, Painterly, Simple, Default, Top Down, Platformer), tiles (Isometric, Hexagonal, Spritesheet, Dungeon Map), UI elements (Typography, FPS Weapon, Skill / Spell Icon, UI Panel, Inventory Items), and animation styles (4-Angle Walking, Walking & Idle, Small Sprites, VFX Effects, Custom Animation, 8-Direction Rotation). Each style has its own tier (Fast / Plus / Pro / Animation) with token cost scaled to model complexity. Powered by Retro Diffusion's pixel art models via direct API.

### 🖼️ Per-Style Example Lightbox
Tap the ⤢ icon on any style card to open a carousel showing what each style actually produces — 2-5 curated examples per style. Pick what you actually want, not what you think a style means by name. "Use this style →" in the lightbox toolbar selects + closes in one click.

### 🌅 Persistent Background Toggle
The "Remove background" control sits on the sticky generate bar — always visible during the entire generation flow. Defaults intelligently per style category (on for characters, off for tiles). Toggle off to keep environmental detail in your generations.

### 🏃 Animate My Character
Upload your existing pixel art character and generate animation frames from it. Walk cycles, idle loops, attacks, jumps, crouches, subtle motion, and custom actions — the AI preserves your character's appearance while creating smooth motion. Smart animation padding ensures weapons and motion aren't clipped.

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

### 🪙 Token Economy
Free users get 5 tokens at signup, +3 tokens every daily login, and a +6 bonus on every 7th consecutive day. Subscribe to the newsletter for +5 more. Token packs start at $4.99 for users who want to brew more. Generation costs: Fast 3 / Plus 10 / Pro 40 / Anim-short 15 / Anim-long 50 tokens.

### 📐 Pixel-Perfect Image Resizer
Built-in nearest-neighbor resizing for preparing pixel art for animation. Upload a high-res character, resize to 64×64 with crisp pixel-perfect scaling — no blurry bilinear interpolation.

### 🔐 Authentication
Sign in with Google or email via Clerk. Free tools work without an account. AI generation requires a free login. Production SSO, bot-signup protection enabled.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (React 19) |
| Styling | Tailwind CSS v4 |
| State | Zustand |
| Animation | PixiJS 8 |
| Auth | Clerk (`@clerk/react`) |
| AI Backend | Retro Diffusion direct API |
| Async Queue | Cloudflare Queues (producer + consumer Worker) |
| Storage | Cloudflare KV |
| Payments | Stripe (live) |
| Transactional Email | Purelymail SMTP |
| Audience Email | Resend |
| Image Carousel | yet-another-react-lightbox |
| Export | JSZip |
| Hosting | Cloudflare Pages (Workers Paid plan) |
| License | AGPL-3.0 |

---

## Architecture Highlights

- **Queue-and-poll architecture** for long-running AI generations. Producer enqueues to Cloudflare Queues, consumer Worker calls Retro Diffusion out-of-band, browser polls `/api/generation-status/{jobId}` every ~2-3 seconds. Sidesteps Cloudflare's 120-second proxy timeout entirely. Tokens auto-refund on generation failure.
- **Token economy backed by Cloudflare KV** with server-side debiting and idempotency-keyed refunds.
- **Server-side free-tier caps** (10 Pro / 30 Fast lifetime per non-paying account) — paid accounts uncapped.
- **Stripe webhooks for payment processing** with signature verification and replay protection.
- **Contour-based sprite detection** using connected component labeling for non-grid sprite sheets.
- **Recon-first development methodology** — when wiring up a new API, library, or feature, read existing code paths and verify assumptions before implementation. Caught at least one architectural misconception per major feature so far.

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
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
CLERK_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
RETRO_DIFFUSION_API_KEY=rdp_...
RESEND_API_KEY=re_...
RESEND_AUDIENCE_ID=...
APP_ENV=dev
QUEUE_KICKOFF_ENABLED=true
```

```bash
# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

**Note on local dev:** The full app stack (queue-and-poll, Stripe webhooks, KV bindings) requires a Cloudflare Pages preview deployment to fully exercise. Local `npm run dev` is best for UI iteration; for end-to-end testing, push to a dev branch and let Cloudflare deploy a preview.

The consumer Worker that processes the queue lives in a sibling repo: [spritebrew-rd-consumer](https://github.com/GAlbanese09/spritebrew-rd-consumer).

---

## The Story

SpriteBrew exists because a friend was building a pixel art game and needed sprite sheets. Making them by hand is brutally slow — every frame, every direction, every animation state, hand-drawn. There had to be a better way.

What started as a weekend project to help one friend turned into a production tool used by indie game developers worldwide. Pricing kept honest at token-based packs starting at $4.99 (no subscriptions). Real customers, real generations, real games getting made.

Built by [George Albanese](https://github.com/GAlbanese09) — an endpoint automation engineer by day, solo indie developer by night. Built with Claude as architect, research partner, and rubber duck through every session.

---

## Roadmap

**Done:**
- [x] Phase 1: Web shell, sprite slicer, multi-engine export (6 formats)
- [x] Phase 2: AI integration via Retro Diffusion direct API (21 styles across 5 categories)
- [x] Phase 3: Production launch — Clerk auth, Stripe payments, token economy
- [x] Queue-and-poll architecture (replaces SSE streaming)
- [x] Per-style example lightbox previews
- [x] Persistent background toggle on sticky bar

**In progress / on the roadmap:**
- [ ] Animation style example previews (animated WebP)
- [ ] Client-side download upscaler (1× / 2× / 4× nearest-neighbor)
- [ ] DIY status page surfacing SpriteBrew + Retro Diffusion upstream health
- [ ] KV-backed feature kill switch (sub-60-second rollback path)
- [ ] Privacy Policy / Terms of Service / Refund Policy
- [ ] Public sprite gallery on landing page
- [ ] Subscription plans (Pixel Pass)
- [ ] OpenNext migration (replace deprecated `@cloudflare/next-on-pages`)
- [ ] Isometric sprite tooling beyond the existing isometric style
- [ ] Tauri desktop app

---

## Acknowledgments

- **[Retro Diffusion](https://retrodiffusion.ai)** — the AI models that make SpriteBrew's pixel art generation possible. Built by pixel artists, for pixel artists.
- **[Clerk](https://clerk.com)** — authentication without the pain
- **[Stripe](https://stripe.com)** — payments and customer management
- **[Cloudflare](https://cloudflare.com)** — Pages, Queues, KV, and the infrastructure that keeps this running on a hobby budget
- **[PixiJS](https://pixijs.com)** — the rendering engine behind the animation preview
- **[Purelymail](https://purelymail.com)** — transactional email at indie-budget pricing
- **[Resend](https://resend.com)** — audience and newsletter delivery
- **Claude (Anthropic)** — architect, research partner, prompt writer, rubber duck
- **George's friend [@mohammadsalim](https://github.com/mohammadsalim)** — the reason this exists in the first place

---

## License

[AGPL-3.0](LICENSE) — Open source with SaaS protection. You can use, modify, and distribute SpriteBrew, but if you deploy a modified version as a service, you must release your changes under the same license.

---

## Contributing

SpriteBrew is live in production and actively developed. If you're interested in contributing, please open an issue first to discuss what you'd like to work on. A Contributor License Agreement (CLA) will be required before merging PRs.

Bug reports, feature suggestions, and feedback are welcome via [GitHub Issues](https://github.com/GAlbanese09/spritebrew/issues) or [the in-app feedback form](https://tally.so/r/Y5oGp6).

---

Built with ☕ and Claude · [spritebrew.com](https://spritebrew.com) · [@spritebrew](https://x.com/spritebrew)
