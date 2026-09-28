# Design: Publish narrated stories to YouTube (first of several platforms)

Date: 2026-09-28
Status: Draft — waiting for owner review; implementation not started

## 1. Objectives

1. **One story = one YouTube playlist, one narrated chapter = one video** in it,
   in chapter order.
2. **Manual trigger**: a "Publish to YouTube" button on the story page queues
   every chapter that has audio and is not on YouTube yet; the playlist is
   created on the first run and reused afterwards.
3. **The user's own Google account and OAuth client**: Settings → Publishing
   takes a client ID/secret from the user's Google Cloud project, then signs in
   through Google in the browser. The app never sees a password.
4. **Multi-platform later**: the code is split into a platform-neutral job +
   store and a per-platform adapter (`src/services/publish/<platform>.ts`), the
   same shape as `toc/` and `chapters/`. YouTube is the only adapter in this round.

Decisions made with the owner:

- One chapter per video (not several chapters per video).
- OAuth client supplied by the user (not bundled with the app).
- Manual button only — no auto-upload when a chapter finishes narrating.
- Default visibility **public** (a per-run choice: public / unlisted / private).

Non-goals:

- No auto-publish, no scheduling, no thumbnails other than the cover.
- No re-uploading a chapter whose audio was regenerated (YouTube cannot replace
  a video's file; delete + re-upload loses views and the link). The chapter
  gets an "audio changed since upload" badge only.
- No deleting videos/playlists from the app.
- No other platform yet.

## 2. External constraints (checked 2026-09-28)

- YouTube only accepts **video**. Each chapter MP3 is turned into an MP4: the
  story cover as a still frame + the chapter audio. The app has no ffmpeg today
  (`tts/mix_story.py` mixes with numpy/soundfile), so this adds one.
- **Quota** (per Google Cloud project, default): `videos.insert` has its own
  bucket of **100 uploads/day** (since 2026-06-01); everything else
  (`playlists.insert` 50, `playlistItems.insert` 50, `playlistItems.list` 1)
  shares 10,000 units/day. A 150-chapter story takes 2 days. Quotas reset at
  midnight Pacific time.
- **Unverified API projects**: videos uploaded through a project that has not
  passed YouTube's API audit are **locked to private** whatever the request
  says. "Public" only takes effect after the user's project is audited. The app
  detects this (the returned `status.privacyStatus` differs from the requested
  one) and says so once instead of failing.
- An OAuth app left in "Testing" publishing status gets refresh tokens that
  expire after **7 days** → the account shows "sign in again".
- Titles ≤ 100 chars, descriptions ≤ 5000 bytes, `<` and `>` are rejected in
  both; playlist titles ≤ 150 chars.

Licensing and content (surfaced to the owner, not enforced by code): crawled
stories are usually someone else's work, and public uploads risk Content ID
claims / strikes on the channel; OmniVoice weights are CC BY-NC, so its audio
must not go on a monetized channel. The Settings page carries one line saying so.

## 3. Current Context

- Chapter audio: `<library dataDir>/audio/<storyId>/<order>.mp3` +
  `<order>.json` (`AudioMeta`, `services/tts/audioCache.ts`, `readChapterAudio`).
- Covers: `coverStore` keeps `<dataDir>/covers/<id>.<ext>`.
- Background music mix per chapter: `mixStoryAudio({ chapters, outs, music,
  musicVolume })` (`services/tts/storyMix.ts`) with an engine's Python; the
  track is looked up via `musicChoice` in `routes/audioExports.ts`.
- Long jobs: in-memory per `Library` (`runningNarrations`), stopped through
  `abort`, own SSE channel (`/api/narration/live`). Same pattern here.
- Install-wide credentials on disk: `DATA_DIR/sessions/<host>.json`
  (`services/siteSession.ts`). Install-wide settings: `settingsStore`.
- Every route picks its library with `libraryFor(req, res)`.

## 4. Design

### 4.1 Adapter interface (`src/services/publish/types.ts`)

```ts
export type Visibility = "public" | "unlisted" | "private";

export interface PublishItem {
  order: number;
  title: string;          // already trimmed/sanitized by the adapter's rules
  description: string;
  videoPath: string;      // prepared media file (MP4 for YouTube)
  visibility: Visibility;
}

export interface Publisher {
  platform: "youtube";
  account(): Promise<{ name: string; channelUrl: string } | undefined>;
  // Create the story's collection (playlist) or confirm the saved one still exists.
  ensureCollection(story: { title: string; description: string; visibility: Visibility },
                   savedId?: string): Promise<{ id: string; url: string }>;
  publish(collectionId: string, item: PublishItem, position: number, signal: AbortSignal,
          onProgress: (sent: number, total: number) => void):
    Promise<{ id: string; url: string; visibility: Visibility }>;
}
```

Errors the job reacts to are typed: `QuotaExceededError` (pause until reset),
`AuthError` (stop, "sign in again"), anything else = chapter fails, job goes on.

### 4.2 YouTube adapter (`src/services/publish/youtube.ts`)

- Plain `fetch`, no `googleapis` package (~100 MB for four endpoints).
- **OAuth**: installed-app loopback flow with PKCE. Scope
  `https://www.googleapis.com/auth/youtube` (covers upload + playlists).
  Redirect URI `http://127.0.0.1:<server port>/api/publish/youtube/callback`
  (Desktop-type clients accept any loopback port, so the Electron app's port works).
  `state` is a random one-time value kept in memory.
- **Upload**: resumable upload (`uploadType=resumable`), 8 MB chunks, resumes
  a broken chunk from the `Range` the server reports, 3 retries on 5xx/network.
- Playlist: `playlists.insert` (title = story title, description = author +
  source URL); `playlistItems.insert` with `snippet.position` = number of this
  story's chapters already published with a lower order, so a gap filled later
  lands in its place.
- Video title: `<story> – <Chương N>: <chapter title>`, cut to 100 chars;
  description: story, author, chapter, source URL, "Narrated with <engine>".
  `<`/`>` replaced. `categoryId` 22 (People & Blogs).
  `status.selfDeclaredMadeForKids = false`,
  `status.containsSyntheticMedia = true` (the voice is AI-generated — YouTube
  requires the disclosure).
- `quotaExceeded` / `uploadLimitExceeded` / `rateLimitExceeded` →
  `QuotaExceededError`; `invalid_grant` / 401 after refresh → `AuthError`.

### 4.3 Video rendering (`src/services/publish/video.ts`)

- `ffmpeg-static` (npm, binary per platform; `asarUnpack` in the Electron build
  like `tts/**`).
- Command: cover looped at 1 fps, scaled/padded to 1280×720 on a dark
  background, `libx264 -tune stillimage -pix_fmt yuv420p`, audio AAC 160 k,
  `-shortest`. About one second of CPU per minute of audio.
- No cover → a plain dark frame (ffmpeg `drawtext` is not in every static
  build; the title is in the video metadata anyway).
- With background music chosen in the dialog: the chapter is first mixed by
  `mixStoryAudio` (same as the zip export), then rendered.
- Output goes to `<dataDir>/publish-tmp/<storyId>/<order>.mp4`, deleted after a
  successful upload; the folder is cleared when the job ends.

### 4.4 Storage

- **Account (install-wide)**: `DATA_DIR/publish/youtube.json` =
  `{ clientId, clientSecret, refreshToken?, channel? }`, mode 0600. Not per
  library, like site sessions. Access tokens stay in memory.
- **What was published (per library)**, two tables in the library's `stories.db`:

```sql
CREATE TABLE IF NOT EXISTS publications (
  story_id TEXT NOT NULL, platform TEXT NOT NULL,
  remote_id TEXT NOT NULL, url TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (story_id, platform));
CREATE TABLE IF NOT EXISTS published_chapters (
  story_id TEXT NOT NULL, platform TEXT NOT NULL, chapter_order INTEGER NOT NULL,
  remote_id TEXT NOT NULL, url TEXT NOT NULL, visibility TEXT NOT NULL,
  audio_hash TEXT NOT NULL, published_at TEXT NOT NULL,
  PRIMARY KEY (story_id, platform, chapter_order));
```

  `audio_hash` = the `AudioMeta` fingerprint at upload time, compared on read
  for the "audio changed since upload" badge. Removing a story removes its rows
  (not the YouTube videos).
- A playlist deleted on YouTube (`ensureCollection` gets 404) → a new one is
  created and the old chapter rows for that story are dropped, so they upload again.

### 4.5 Job and routes (`src/routes/publish.ts`)

- `Library.runningPublishes: Map<storyId, PublishRun>` + `publishSubscribers`,
  SSE `/api/publish/live` (own channel, same reason as narration).
- `POST /api/stories/:id/publish/youtube` `{ visibility, musicId?, musicVolume? }`
  → 202; 409 if already running; 400 if not connected or no chapter has audio.
  Chapters taken in order: audio present and not in `published_chapters`.
  Per chapter: render → upload → add to playlist → insert row → delete MP4.
- Quota error → run state `waiting` with `resumeAt` (next midnight
  America/Los_Angeles); a timer resumes it. Survives only while the app is
  running: after a restart the user presses the button again and done chapters
  are skipped.
- `POST /api/stories/:id/publish/youtube/stop` (abort between chapters, and
  aborts the in-flight upload).
- `GET /api/stories/:id/publish` → `{ youtube: { playlistUrl?, chapters:
  [{ order, url, visibility, audioChanged }] , run? } }`.
- Account: `GET/PUT/DELETE /api/publish/youtube/account` (client ID/secret,
  status, sign out = revoke + drop refresh token), `GET .../connect` (returns
  the Google URL), `GET .../callback` (exchanges the code, closes with a small
  "you can close this tab" page).
- **Private mode**: the publish routes answer 403 for the private library —
  publishing a hidden story to a public channel defeats the point of hiding it.
  *(Open question for the owner.)*

### 4.6 UI

- Settings → **Publishing** section: step-by-step instructions to create the
  Google Cloud project / enable YouTube Data API v3 / create a "Desktop app"
  OAuth client / add yourself as test user; fields for client ID and secret;
  "Connect YouTube" → opens Google in the browser (`shell.openExternal` in
  Electron); shows the connected channel, "Sign out"; the quota, "private until
  audited", 7-day and licensing notes.
- Story page (Vietnamese stories with narration only): "Publish to YouTube"
  button → dialog (visibility, background music as in the player, count of
  chapters to upload, quota estimate "about N days"). Progress line like
  narration (chapter, % sent, waiting-for-quota time). Playlist link once it
  exists; per-chapter YouTube icon/link and the "audio changed" badge in the
  chapter list.
- All strings through `t()`, `en.ts` + `vi.ts`.

## 5. Testing

- `publish/youtube.test.ts`: `fetch` mocked — token refresh, resumable upload
  incl. a resumed chunk, playlist create/404 recreate, position calc, error
  mapping (quota, invalid_grant), title/description sanitizing, locked-private
  detection.
- `publish/video.test.ts`: `__fixtures__/fakeFfmpeg.js` (like `fakeMixer.js`)
  checks the arguments and writes a file.
- `routes/publish.test.ts`: fake `Publisher`; skip done chapters, 409, quota
  pause + resume timer (fake timers), stop, private library 403, OAuth
  callback `state` check.
- No E2E (needs a real Google account).

## 6. Open questions

1. Block publishing from private mode (proposed) or allow it?
2. Video frame: cover only (proposed) or cover + story/chapter title text
   (needs an ffmpeg build with `drawtext`/fonts)?
3. Default visibility is public as decided — but on an unaudited project it
   will always end up private; keep "public" as default anyway?
