# Contributing

Thanks for helping. This is a local-first tool with a deliberately narrow trust boundary, so a
few rules matter more here than usual.

## Ways to help

- **Report a broken site or a bad extraction** — use the issue templates. Include the story URL,
  the failing chapter URL and the error text.
- **Add a site** — one folder under `src/sites/`, see [`src/sites/README.md`](src/sites/README.md).
  This is the most useful and most self-contained contribution.
- **Improve extraction** — `src/services/extractor.ts`; attach the page (or a fixture capture)
  to the issue so a test can cover it.
- **Documentation and translations** — the UI is Vietnamese and everything user-facing goes
  through `t()`; a new language is one file under `frontend/src/i18n/locales/` plus one registry
  entry (the locales test keeps key sets and placeholders in sync).

## Setup

Requirements: Node.js ≥ 22.5 (the app uses `node:sqlite`) and npm.

```bash
npm install                        # backend + frontend (npm workspaces)
npx playwright install chromium    # only needed to actually crawl/render

npm run dev                        # backend: tsc --watch + nodemon
npm run dev:frontend               # frontend: Vite dev server, proxies /api -> :3100
npm run build                      # tsc -> dist/ + vite build -> public/ (required before npm start)
```

Never edit `public/` or `dist/`; they are generated.

## Tests and typechecks

```bash
npm test                      # vitest, hermetic (network + Chromium mocked), ~2s
npx tsc -p frontend --noEmit  # frontend typecheck (vite build does not typecheck)
npx tsc -p e2e --noEmit
npm run test:e2e              # Playwright E2E; builds first, needs Chromium, serial
```

CI runs exactly this on every PR and every push to `main`
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

Add tests next to the code (`*.test.ts`, fixtures in `__fixtures__/`) — backend under `src/`,
frontend under `frontend/src/`. Tests must stay hermetic: mock the network and Chromium. E2E
specs are `e2e/tests/*.e2e.ts` (the suffix keeps vitest from picking them up) and use the local
fixture site.

## Product rules a review will enforce

- **Never bypass login, paywall or DRM.** Content the user cannot open in their own browser is
  out of scope, always. Locked content must fail with a clear error instead of saving something
  partial.
- **The allowlist is the trust boundary.** Crawlable sites go in a manifest's `supported` rows;
  book-file sources that are imported rather than crawled go in `imports`. Never both.
- **Pages come from the web and files come from the client** — treat both as untrusted. Code that
  reads `file://`, unzips archives, parses imported books or runs generated JavaScript must keep
  the existing guards (see [`SECURITY.md`](SECURITY.md)).
- **Local-first:** no accounts, no telemetry, nothing leaves the machine (requests to the story's
  own site excepted).

## Conventions

- TypeScript everywhere; tests are colocated. There is no lint/format tooling — match the
  surrounding style.
- UI strings go through `t()`; server-side wording lives in `src/services/lang.ts` (Vietnamese
  wording, English keys). A missing key renders English.
- Frontend is React 18 + Vite + Tailwind 4. Style with Tailwind utilities and the `@theme` tokens
  (`bg-raised`, `text-ink-2`, …) at the call site; do not add component classes to `styles.css`.
  API calls live in `frontend/src/lib/api/<domain>.ts`.
- The architecture and its gotchas are in [`AGENTS.md`](AGENTS.md) — read it before touching the
  crawl pipeline, narration or the agent crawler.

## Commits and pull requests

- Conventional commit prefixes (`fix(chapter): …`, `feat(site): …`); Vietnamese or English both
  fine.
- Keep PRs focused — one concern per PR — and say what you tested.
- When you add a site, update the README's supported-sites table and
  [`docs/supported-sites.md`](docs/supported-sites.md).
- AI-assisted contributions are welcome; you are responsible for them, and they must follow the
  rules above and pass CI.
- A gitleaks pre-commit hook scans staged changes. Install `gitleaks` and `pre-commit` for your
  OS, then run `pre-commit install` once per clone.

## Security

Do not open a public issue for a vulnerability — see [`SECURITY.md`](SECURITY.md).

## License

By contributing you agree your work is licensed under the
[Apache License 2.0](LICENSE).
