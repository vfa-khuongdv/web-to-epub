# Security policy

## Supported versions

Only the latest release is supported. Fixes land in a new release; there are no backports.

## Reporting a vulnerability

Use GitHub's private reporting: **Security → Report a vulnerability**
(<https://github.com/vfa-khuongdv/web-to-epub/security/advisories/new>).

Please include the version (or commit), how you run the app (macOS app / Docker / source), steps
to reproduce, and the impact you think it has. This is a personal project with no bug bounty:
disclosure is best-effort, and you will be credited unless you ask otherwise.

## Threat model — what counts as a vulnerability

The app runs on your machine, with no accounts by default and no authentication. The interesting
boundaries are:

- **The HTTP API is unauthenticated.** Any client that can reach the port can read and modify the
  normal library. The app is meant to run on localhost; publishing the Docker port or running it
  on an untrusted network exposes the library. "Port 3100 has no login" is known and by design —
  but a bug that makes the app reachable *beyond* what the operator configured is in scope.
- **Private mode is a lock, not encryption.** `data/private/stories.db` is a plain SQLite file;
  the code only gates the app's own routes. Reading the files on disk is out of scope.
- **The agent crawler executes model-written JavaScript** (off by default). It runs in a child
  process with Node's permission model and stripped globals, but its own design notes call it
  *not a hard boundary*. Sandbox escapes — reaching the network or filesystem beyond the
  documented `ctx` helpers — or prompt injection from crawled page content that achieves one, are
  in scope.
- **Site sessions are credentials.** Files under `DATA_DIR/sessions/` hold your browser cookies
  (owner-only permissions). Anything that leaks them into logs, exports, error messages or the
  frontend is in scope.
- **Untrusted input paths:** imported EPUB/PDF/archive files, crawled pages, and chapter HTML sent
  by the client. Keep the existing guards — archive expansion caps, DOM sanitization,
  `localMediaRoots` for `file://` media, no script execution — and report bypasses.
- **The site allowlist is the trust boundary**, enforced server-side. Crawling a host that is not
  in it, or making the server fetch an arbitrary URL or local file, is in scope.

## Out of scope

- Bypassing a third-party site's login, paywall or bot check — the app refuses these by design.
- Denial of service against the app, or against sites you choose to crawl.
- Vulnerabilities in upstream dependencies (report them upstream; a heads-up is welcome).
- Anything that requires an attacker who already has code execution or file access on the machine.
