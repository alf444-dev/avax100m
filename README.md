# avax100m.xyz

Live countdown to Avalanche C-Chain block 100,000,000, plus a read-only wallet
history and realized-P&L checker. No connect, no signature required to look
anything up.

## Layout

- `index.html` — the whole front page (countdown, checker, faq). Vanilla JS, no build step.
- `netlify/functions/*.mjs` — serverless functions, plain ES modules. Each one
  declares its own route via `export const config = { path: ... }`:
  - `wallet.mjs` → `/w/*` server-rendered profile pages
  - `pnl.mjs` → `/api/pnl` on-demand P&L engine (Zerion FIFO on Avalanche,
    Moralis fallback/balances, Routescan + DeFiLlama/CoinGecko story enrichment)
  - `token.mjs` → `/api/token` claimed-page, per-token dossier lookup
  - `claim.mjs` → `/api/claim` page claiming via plain-text signature (no approvals, no transactions)
  - `card.mjs` → `/card/*` shareable PNG cards
  - `badges.mjs`, `census.mjs`, `sitemap.mjs` — what they say
  - `resolve.mjs` → `/api/resolve` .avax name resolution. **Prebuilt bundle — do not edit.**
    It vendors circomlibjs; the Poseidon output must stay byte-identical to stored hashes.
- Dependencies are in `package.json`; Netlify bundles functions with esbuild at deploy.

## Contributing

PRs welcome. Run `npm test`, keep the brutalist voice, and note that P&L/dossier
cache keys (`v25/`, `tok9/`, `w4/`, `cand/v4/`, `peak4/`, `px/`) must be bumped in
lockstep across `pnl.mjs` and `token.mjs` whenever cached shapes change. Token
prices come from DeFiLlama (on-chain, keyless) with CoinGecko as automatic
fallback; the shared first-tx cache lives in the `firsttx` blob store.

`ZERION_API_KEY` enables the documented Avalanche P&L fast path. It supplies
FIFO realized/unrealized P&L, fees, external flows, and asset breakdowns.
`MORALIS_KEY` remains useful for current balances and is the labeled fallback
when Zerion fails outside its first-request bootstrap. If Zerion returns a cold
wallet `503`, the API returns `202` + `Retry-After`; the profile retries without
doing a speculative fallback calculation.

Wallet P&L is computed only after a lookup and persisted as a versioned Netlify
Blob snapshot. Fresh snapshots cannot be bypassed with public `refresh=1`;
incomplete ledgers and missing balance/story coverage remain explicit quality
states. Only complete authoritative ledger rows enter the public record board.
`debug=1` and both maintenance backfills require `x-admin-key: $ADMIN_KEY`.

Token metadata work is capped to the 100 most financially relevant assets per
wallet and cached for 30 days; accounting totals still include every valid row.
Best-effort per-wallet leases use strong-consistency reads to reduce concurrent
cold P&L and token-dossier work. Only complete, authoritative Zerion FIFO
results can update `records-v25`.

Token dossiers explicitly paginate Routescan and reconcile their terminal
balance with Avalanche RPC. Known transfer-distributed tokens are indexed for
symbol lookup even when the P&L provider omits them. In that case the dossier
shows P&L as unavailable instead of promoting a transfer-value estimate into
wallet totals or public records.

Deploys happen on push to `main` via Netlify. Never deploy with Netlify Drop or
the CLI — it resets Blob storage.
