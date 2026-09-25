# Design: Chapter narration with VieNeu-TTS (local model)

Date: 2026-09-25
Status: Implemented (branch feat/chapter-narration); §9 lists where the build differs from the plan

## 1. Objectives

1. **Generate**: turn a Vietnamese chapter's text into speech with
   [VieNeu-TTS](https://huggingface.co/pnnbao-ump/VieNeu-TTS) running on the owner's
   machine — no cloud API, nothing leaves the machine (PRODUCT.md).
2. **Export audio**: one chapter → `.mp3`; a whole story (or a selection) → a `.zip`
   of numbered `.mp3` files, one per chapter.
3. **Embed in EPUB**: an export option "Include narration" puts each chapter's
   `.mp3` at the top of that chapter as an `<audio>` tag, reusing `packMedia`.
4. **One-click setup**: the app installs and runs VieNeu itself (Python env + model
   under `DATA_DIR/tts/`), started and stopped by the server. The app bundle does
   not grow.

Decisions made with the owner:

- Engine: VieNeu-TTS v3, CPU / ONNX Runtime (torch-free) build.
- The app installs and manages the Python side itself (not a server the user runs).
- **Vietnamese only.** Narration is offered for stories whose language is `vi`.
- Output: file export + EPUB embedding. **No in-reader playback** in this round.
- Default variant: **v3 Turbo fp32** (best quality, 25 voices incl. storytelling
  voices). **v3 Nano, 8 steps** is the "Fast" option. Turbo int8 is not offered
  (upstream warns it distorts on CPUs without VNNI, which includes Apple Silicon).

Non-goals:

- No in-app player, no highlighting while listening.
- No English narration, no second engine.
- No `.m4b` (needs ffmpeg); no voice cloning UI (Turbo supports it — later).
- No GPU path. Kindle does not play EPUB audio; the embedded narration is for
  Apple Books / Thorium, and the UI says so next to the option.

## 2. Current Context

- Chapter text is stored as `ContentBlock[]` (`src/types.ts`): `heading` /
  `paragraph` carry HTML-safe `text`; `image`/`audio`/`video` carry `src`.
- `epubBuilder.ts` already embeds `<audio>` (`embedMedia` takes `http(s):` or
  `data:` sources, `packMedia` patches the zip, `MAX_MEDIA_BYTES` = 50 MB per file,
  `MAX_EPUB_BYTES` = 180 MB per part; bigger books split into parts).
- Export flow: `POST /api/stories/:id/export` streams NDJSON progress, then
  `GET /api/exports/:exportId` (buffer in RAM, 5 min TTL).
- Each `Library` has its own `dataDir` (`DATA_DIR` or `DATA_DIR/private/`);
  crawl jobs and SSE channels are per library, in-memory (`routes/library.ts`).
- App settings: `settingsStore.ts`, one set per install.
- Packaging: Electron arm64 DMG (server runs in the main process) and a Docker
  image on `node:22-bookworm-slim` (no Python).

## 3. Spike results (Apple M2, 8 cores, sample passage ≈ 30 s of audio)

| variant | model download | rate | RTF | 20-min chapter | 150 chapters |
|---|---|---|---|---|---|
| Turbo fp32 (default) | 494 MB | 48 kHz | 0.75–0.78 | ~15 min | ~38 h |
| Nano, 8 steps ("Fast") | 269 MB | 24 kHz | 0.41 | ~8 min | ~20 h |

- Python env (`uv sync`, core deps incl. gradio) ≈ 770 MB. Total on disk with one
  model ≈ 1–1.3 GB.
- Warm model load: Turbo ≈ 9 s, Nano ≈ 3 s → keep the process alive between chapters.
- `soundfile` (libsndfile 1.2.2) writes MP3 directly → no JS encoder.
- Watermarking is off unless `resemble-perth` is installed — we don't install it.
- API used: `Vieneu(mode="v3turbo"|"v3nano")`, `.list_preset_voices()` →
  `[(label, id)]`, `.infer(text, voice=id[, steps=8])` → `np.ndarray`,
  `.sample_rate`.

Consequence: narrating a whole story takes about a day. Background jobs, a
per-chapter cache and resume-after-restart are required, not nice-to-haves.

## 4. Design

### 4.1 Python side — `tts/vieneu_worker.py` (committed in the repo)

A small long-lived worker speaking JSON lines over stdin/stdout (no HTTP port, no
FastAPI):

- `{"cmd":"load","variant":"turbo"|"nano"}` → loads the model (downloads on first use
  via `huggingface_hub`, progress lines forwarded) → `{"ok":true,"voices":[…]}`.
- `{"cmd":"synth","id":…,"parts":["…","…"],"voice":"…","out":"/abs/x.mp3"}` →
  infers each part, joins with short silences, writes MP3 (mono, 64 kbps VBR) →
  `{"id":…,"ok":true,"seconds":…}`; a `{"id":…,"progress":i,"total":n}` line per part.
- Errors → `{"id":…,"ok":false,"message":…}`; the worker keeps running.
- `HF_HOME` points to `DATA_DIR/tts/hf` so models stay in the app's data dir.

### 4.2 Server — `src/services/tts/`

- `runtime.ts` — install + lifecycle:
  - **Install** (`POST /api/tts/install`, progress over NDJSON): download the
    standalone `uv` binary for the platform from astral-sh/uv GitHub releases into
    `DATA_DIR/tts/bin/`, `uv venv --python 3.12 DATA_DIR/tts/venv` (uv fetches a
    standalone CPython — works in Docker too), `uv pip install vieneu==<pinned>`,
    then `load` once to fetch the model. Version is pinned in
    `src/config/tts.ts`; bumping it is a code change, not automatic.
  - **Status**: `not-installed | installing | installed | running | error`, plus
    disk size. **Uninstall** removes `DATA_DIR/tts/` (keeps generated audio).
  - **Process**: spawn the worker lazily on the first job, kill it after 10 min
    idle and on server shutdown (Electron `before-quit`, like the Playwright
    browser). One worker, one request at a time — it is CPU-bound and would
    otherwise fight the crawler for cores.
- `chapterText.ts` — `ContentBlock[]` → utterance list: strip tags/entities, title
  first, headings + paragraphs, skip images/media, split paragraphs > ~250 chars at
  sentence ends (VieNeu chunks at 256 chars internally; splitting ourselves gives
  per-part progress and a clean cancel point).
- `audioCache.ts` — `<library.dataDir>/audio/<storyId>/<order>.mp3` + sidecar
  `<order>.json` `{ key, seconds }` with `key = sha1(text + variant + voice +
  vieneuVersion)`. A chapter is regenerated only when its text or voice changed.
  Private-mode audio stays under `private/`. Deleting a story deletes its folder.

### 4.3 Narration jobs

- `POST /api/stories/:id/narrate` `{ orders?: number[] }` → `202`. Rejected (400,
  clear message) when the story language isn't `vi` or TTS isn't installed.
- Chapters run sequentially; cached-and-fresh chapters are skipped, so restarting
  after an app quit simply continues.
- Progress on the existing live channel (`/api/stories/live`, tagged `storyId`):
  `narrate-progress { order, part, parts, done, total }`, `narrate-chapter-done`,
  `narrate-done`, `narrate-error`. `DELETE /api/stories/:id/narrate` cancels after
  the current part.
- Job map in memory per `Library`, like `runningCrawls`. Jobs from both libraries
  queue on the single worker.

### 4.4 Export

- `GET /api/stories/:id/chapters/:order/audio` → cached `.mp3` (409 + message if
  missing or stale).
- `POST /api/stories/:id/export-audio` `{ orders }` → NDJSON progress, then an
  `exportId` for a `.zip` of `001 - <title>.mp3`, … (reuses `stashExport`; stored
  uncompressed with `fflate`). Only fresh cached chapters are included; the done
  event lists the missing ones. Large stories can exceed RAM-friendly sizes
  (~1.5 GB for 150 chapters), so the zip is streamed to a temp file and served
  from disk rather than held in `pendingExports` memory.
- EPUB: `POST /api/stories/:id/export` gains `includeNarration: boolean`. Each
  chapter with fresh audio gets `<audio src="file://…/<order>.mp3">Narration</audio>`
  prepended; `embedMedia` learns to read local `file://` paths inside the audio
  cache dir only. Existing size-based splitting applies — audio makes a long story
  several parts. `MAX_MEDIA_BYTES` (50 MB) ≈ 100 min at 64 kbps per chapter.

### 4.5 Frontend

- **Settings → Narration** (`SettingsOverlay.tsx`): Install / Uninstall with
  progress and disk size; variant (Quality = Turbo / Fast = Nano); voice picker
  (list from the worker) with a "Preview" that narrates one fixed sentence.
  Stored in `settingsStore`: `ttsVariant`, `ttsVoice`.
- **StoryDetail** (vi stories only): "Narrate" (all / selected), progress in the
  job strip with an ETA from measured RTF; per-chapter "audio ready" badge and
  download on `ChapterCard`; "Export audio (.zip)" beside "Export EPUB".
- **Export EPUB**: checkbox "Include narration (not played on Kindle)".
- All strings through `t()` / `lang.ts`.

## 5. Packaging

- Nothing Python is bundled. Electron: the worker script ships in
  `dist/`-adjacent `tts/` (add to `build.files`); spawning a child process from
  the packaged app needs no signing changes (uv/python live in userData).
- Docker: `uv` + CPython download at install time into the `/app/data` volume;
  check glibc/arch (bookworm amd64 + arm64) in the manual test.
- The server must never spawn anything from a path the client sent.

## 6. Testing

- Unit (hermetic): `chapterText` splitting; cache key/invalidation; worker
  protocol client against a fake worker (a tiny Node script speaking the same
  JSON lines); job lifecycle incl. cancel and skip-cached; zip naming; `embedMedia`
  with `file://` restricted to the cache dir; install steps with mocked
  download/spawn.
- Python worker: one smoke test script run manually (needs the model).
- No E2E for synthesis; E2E may cover the Settings UI with TTS status stubbed.
- Manual: install from a clean `DATA_DIR`, narrate 2 chapters, export zip + EPUB,
  play in Apple Books; repeat once in Docker.

## 7. Trade-offs / open questions

- **Speed**: ~1 day per 150-chapter story on an M2. Accepted; mitigated by cache,
  resume and the Fast option.
- **Footprint**: ~1–1.3 GB, mostly the Python env (gradio is a core dep of the
  `vieneu` package). Could shrink later with `--no-deps` + an explicit list.
- **Upstream churn**: pinned version; the worker only uses `Vieneu`, `infer`,
  `list_preset_voices`, `sample_rate`.
- **Mixed text** (English names, numbers, symbols): VieNeu's own normalizer
  handles it; no extra processing on our side.
- **Disk for audio**: ~10 MB/chapter; Settings shows audio size per story with
  "Delete audio".

## 8. Build order

1. ~~Spike~~ — done (§3).
2. `tts/vieneu_worker.py` + `chapterText` + `audioCache` + worker client (fake-worker tests).
3. `runtime.ts` install/status/uninstall + Settings → Narration.
4. Narration job + live progress + StoryDetail UI.
5. Per-chapter download + audio ZIP export.
6. EPUB "Include narration".
7. Packaging (Electron files, shutdown hook), Docker check, AGENTS.md notes.

## 9. As built — differences from the plan

- **Own live channel.** Narration events go to `/api/narration/live` (snapshot of
  running jobs on connect, events tagged `storyId`), not the crawl channel: the
  crawl channel's frontend listener treats every tagged event other than
  `idle`/`done` as crawl progress, so narration there would mark the story as
  crawling. `DELETE /narrate` became `POST /stories/:id/narrate/stop`, matching
  `/crawl/stop`.
- **Status endpoint.** `GET /stories/:id/narration` → `{ narratable, chapters:
  { order: "ready" | "missing" }, bytes, running }`; the story page refetches it
  whenever `story.updatedAt` changes, so an edited chapter shows as missing.
- **ETA** counts only chapters actually synthesized (cached chapters are skipped in
  milliseconds and would make it absurdly short).
- **Worker cancel** is per part: the worker reads stdin on its own thread, so
  `{"cmd":"cancel"}` lands while a synth is running.
- **ZIP export** is written to a temp file with backpressure and served once from
  `GET /exports/audio/:id` (30 min TTL). In the packaged app the renderer never
  holds it: `electronExport.saveUrl` streams it from `http://127.0.0.1:<port>/api/exports/audio/`
  (the only URLs it accepts) into the chosen folder.
- **EPUB**: `embedMedia` reads `file://` sources only inside `localMediaRoots` (the
  story's audio folder); the route adds the audio only for chapters whose saved
  text still matches — unsaved editor changes are not narrated.
- **Settings**: `ttsVariant` / `ttsVoice` in `settingsStore`; switching model resets
  the voice (voice ids belong to one model).

