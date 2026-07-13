# avax100m.xyz

Live countdown to Avalanche C-Chain block 100,000,000, plus a read-only wallet
history and realized-P&L checker. No connect, no signature required to look
anything up.

## Layout

- `index.html` — the whole front page (countdown, checker, faq). Vanilla JS, no build step.
- `netlify/functions/*.mjs` — serverless functions, plain ES modules. Each one
  declares its own route via `export const config = { path: ... }`:
  - `wallet.mjs` → `/w/*` server-rendered profile pages
  - `pnl.mjs` → `/api/pnl` realized P&L engine (Moralis + Routescan + CoinGecko)
  - `token.mjs` → `/api/token` per-token dossier lookup + discovery feedback
  - `claim.mjs` → `/api/claim` page claiming via plain-text signature (no approvals, no transactions)
  - `card.mjs` → `/card/*` shareable PNG cards
  - `badges.mjs`, `census.mjs`, `sitemap.mjs` — what they say
  - `resolve.mjs` → `/api/resolve` .avax name resolution. **Prebuilt bundle — do not edit.**
    It vendors circomlibjs; the Poseidon output must stay byte-identical to stored hashes.
- Dependencies are in `package.json`; Netlify bundles functions with esbuild at deploy.

## Contributing

PRs welcome. Run any function locally with mocked `fetch` (see git history for
test patterns), keep the brutalist voice, and note that P&L/dossier cache keys
(`v24/`, `tok7/`, `cand/v3/`, `peak2/`, `cg2/`) must be bumped in lockstep across
`pnl.mjs` and `token.mjs` whenever cached shapes change.

Deploys happen on push to `main` via Netlify. Never deploy with Netlify Drop or
the CLI — it resets Blob storage.
