# SpriteBrew (Pages app): working rules for Claude Code

SpriteBrew is a solo-founded AI pixel-art sprite sheet generator on Cloudflare Pages (Next.js via `@cloudflare/next-on-pages`), with a separate queue consumer Worker in the sibling repo `../spritebrew-rd-consumer`. Generation runs against the Retro Diffusion API. Tokens are the in-app currency; the ledger is Workers KV.

## How work arrives

George runs a hub chat (`00 HQ | SpriteBrew`) that dispatches tasks. Tasks arrive as thread files in `room/` (protocol: `room/README.md`). When George names a file or says "check the room," read it first.

**Reply in the thread file, not in chat.** Append an entry to the same file; the hub reads that file directly and George only rings the bell. Questions, rulings you need, dev results, blockers: all of it goes in the file. Answering in chat costs George a copy and paste and the hub may never see it.

## Non-negotiables

- Show George every diff and wait for approval before committing. Then commit and push yourself; George no longer commits by hand (his decision, Sep 18, 2026).
- Commit messages end with a two-line trailer. Name **the model actually running your session**, not a hardcoded one, since the model changes between sessions:
  ```
  Co-Authored-By: Claude <model name> <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_017uVQBGESYpmbrKMuvqFaAm
  ```
- Never write, print, or commit a secret. `ADMIN_TOKEN`, `RETRO_DIFFUSION_API_KEY`, Clerk and Stripe keys are Cloudflare secrets, not files.
- No em dashes in anything you write, code comments included.
- Before stating a deploy state, run `npx wrangler deployments list --env production` in the consumer, or read the Pages deployments list. Never assume.
- Local dev cannot exercise `/api/generate` (Cloudflare bindings are missing locally). Real testing is on the dev URL `dev.spritebrew.pages.dev` (Cloudflare Access, one-time PIN) and, for the consumer, `npm run deploy:dev` then `npm run tail:dev`.

## Repo facts that bite

- The Pages app deploys on push to `main` (production branch `main`, build `npx @cloudflare/next-on-pages@latest`). `dev` is a branch here; in the consumer, "dev" and "prod" are wrangler environments (`preview`, `production`) on a single `main` branch.
- The checkout lives inside OneDrive; expect CRLF warnings from git. Do not "fix" line endings in files you did not otherwise change.
- KV ledger keys: `token_tx:{userId}:{ts}:{uid}`, 90-day TTL, written in `src/lib/tokenBalance.ts`, `src/lib/tokenDebit.ts`, and the consumer's `src/refund.ts`. A Worker invocation is capped at 1000 subrequests and every `kv.get` is one; never fan out gets per key.
- The canonical knowledge base is Confluence (Master Index page `71106568`); the hub owns it. Do not create documentation files in this repo beyond what a change needs.
