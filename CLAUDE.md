# Leavs — working context

Living record of what exists, what was decided, and what is deliberately not
built. **Update it whenever something lands.** If this file and the code
disagree, the code is right and this file needs fixing.

There is no spec and no README. The commit history (79 commits) is the only
other record, and most of it is titled `fix:` — read it before assuming a piece
of awkward-looking code is accidental.

---

## What it is

An offline-first **reading and listening PWA**. Tagline in the manifest:
*"Read and listen. One book. Zero friction."*

Import a book (PDF, EPUB, DOCX, PPTX, TXT), or pull one from a public library, or
grab audio off YouTube. Read it with karaoke word-highlighting, listen to it with
Microsoft Edge neural voices, highlight passages, tap a word for a definition,
save vocabulary, track a streak.

**Everything belongs to the browser.** All book text, audio, highlights and
progress live in IndexedDB on the device. There are no accounts, no login, no
server-side user data, and nothing syncs between devices. The server exists only
to do the handful of things a browser is not allowed to do: cross-origin scraping,
TTS synthesis, YouTube extraction, image generation.

---

## Stack

| Layer | Choice |
|---|---|
| Frontend | React 18, Vite 5, React Router 6 |
| Storage | Dexie 3 over IndexedDB (`leavs` database) |
| Offline | `vite-plugin-pwa` / Workbox, `registerType: 'autoUpdate'` |
| Parsing | `pdfjs-dist` 6, JSZip + DOMParser (EPUB/DOCX/PPTX), `tesseract.js` 7 (OCR) |
| Speech | `edge-tts-universal` — Microsoft Edge neural voices, no API key |
| Backend | Express 4, only for local dev (see below) |
| Hosting | Vercel |
| Styling | Hand-written CSS, tokens in `client/src/styles/tokens.css`. No framework. |

npm workspaces: `client` and `server`. Root `npm run dev` runs both via
`concurrently`; `start.bat` does the same in two terminals and opens the browser.

---

## The API is written once and mounted twice

`client/api/**/*.js` are **Vercel serverless handlers**, file-routed by the
platform. `server/src/index.js` walks that same directory at boot and mounts
every handler at its equivalent Express route. So localhost and production run
identical code, and there is exactly one implementation of each endpoint.

The handlers therefore only use APIs both runtimes share: `req.query`,
`req.body`, `res.status().json()`, `res.setHeader`, `stream.pipe`. Adding an
Express-only or Vercel-only call to a handler breaks the other environment
silently. Files starting with `_` (`api/_lib/`) are skipped — they are helpers,
not routes.

| Route | maxDuration | Does |
|---|---|---|
| `POST /api/tts/chunk` | 60s | Edge TTS → base64 MP3 + word boundaries. Voice is allowlisted. |
| `GET /api/youtube/audio` | 300s | ytdl → audio-only stream. `&info=1` returns metadata only. |
| `GET /api/anna/search` | 45s | Scrapes Anna's Archive mirrors, regex-parses cards. |
| `GET /api/libgen/search` | 45s | libgen.li `/index.php?req=`, parses the nine-column table. |
| `GET /api/libgen/fetch` | 300s | md5 → `get.php` → CDN, streamed. Allowlist re-checked at every redirect hop. |
| `GET /api/standard-ebooks/search` | 20s | Fetches the whole OPDS catalogue and filters it. |
| `GET /api/gutenberg/proxy` | 30s | Host-allowlisted file proxy (Gutenberg, archive.org, Standard Ebooks). |
| `POST /api/covers/image` | 60s | HF FLUX.1-schnell. **503 when `HF_TOKEN` is unset**, by design. |
| `GET /api/health` | — | Dev server only. |

`api/_lib/proxy.js` is the shared scraper: direct fetch with a full browser
header set (4s) → ScraperAPI residential proxy if `SCRAPER_API_KEY` is set (20s)
→ `allorigins.win` (6s). `scrapeWithMirrors` races all mirrors in parallel on the
fast path first. `isBlocked()` sniffs Cloudflare and DDoS-Guard interstitials,
because those return HTTP 200.

---

## Layout

```
client/
  index.html            fonts, PWA meta, inline SVG leaf favicon
  vite.config.js        PWA manifest, __BUILD_COMMIT__/__BUILD_TIME__, /api proxy
  api/                  serverless handlers (see above)
  src/
    App.jsx             router, offline banner, install prompt, SW registration
    db/db.js            the entire Dexie schema
    lib/ingest.js       every file format → { title, author, cover, chapters }
    lib/audioPlayer.js  stored-audio playback (<audio> + blob URL)
    lib/edgeTtsPlayer.js streaming TTS playback (chunked, prefetching)
    screens/            Library, BookDetail, Reader, CoverPicker, Discover, Stats, Profile
    components/common/  BottomNav, FAB, LeafProgress
    utils/settings.js   localStorage prefs + a pub/sub hook
    utils/theme.js      applies data-theme; light is the bare :root palette
    utils/install.js    beforeinstallprompt, as a subscribable store
    utils/playback.js   is-playing flag the SW update check reads
    utils/filetype.js   magic-byte sniffing for downloaded books
    utils/activity.js   daily activity log for the streak
    styles/             tokens.css · typography.css · global.css (2500 lines)
server/src/index.js     dev-only Express host for client/api
```

**Routes** — `/library` (default) · `/book/:id` · `/book/:id/read?chapter=N` ·
`/book/:id/cover` · `/discover` · `/stats` · `/profile`. `BottomNav` hides itself
on `/read` and `/cover`; the reader has its own nav.

---

## Data model

One Dexie database, `leavs`, still at `version(1)`:

| Table | Key | Notes |
|---|---|---|
| `books` | `++id` | title, author, cover (data URL), coverStyle (gradient), progress 0–1, mode, voice, addedAt, lastOpenedAt, listenedSeconds, readSeconds |
| `chapters` | `++id`, `[bookId+index]` | text, title, audioStatus `none`/`generating`/`ready` |
| `audioChunks` | `++id` | data (ArrayBuffer), mime, duration, wordBoundaries |
| `highlights` | `++id` | selectedText, colour, startOffset, endOffset, note |
| `bookmarks` | `++id` | charOffset, audioTimestamp |
| `vocabulary` | `++id` | word, bookId, chapterId |
| `progress` | `bookId` | one row per book: chapterId, charOffset, audioPosition |

**`chapterId` means two different things and this has bitten before.**
In `highlights`, `bookmarks`, `vocabulary` and `progress` it holds the chapter's
**index** (0, 1, 2…). In `audioChunks` it holds the chapter row's **`++id`**.
Queries reflect this: `db.highlights.where('chapterId').equals(chapterIndex)`
versus `db.audioChunks.where('chapterId').equals(chapter.id)`. Do not "fix" one
to match the other without migrating the stored rows.

The comments in `db.js` have drifted from reality — `voice`, `coverStyle`,
`listenedSeconds`, `readSeconds`, `mime` and `wordBoundaries` are all written by
the app and named in no schema. That is legal in Dexie for unindexed fields, but
it means the declared schema is not a description of what is stored.

---

## The two audio engines

This is the core complexity of the app. Listen mode uses **one of two players**,
and almost every control in `ReaderScreen` branches on which:

```js
const usePregenAudio = isListenMode && !!audioChunk?.data
```

**`AudioPlayer`** — a stored ArrayBuffer played through an `<audio>` element fed
by a blob URL. Works offline. Used whenever an `audioChunks` row exists, whether
it came from "Generate audio" or a YouTube import.

**`EdgeTtsPlayer`** — streams synthesis from `/api/tts/chunk` in ~1400-character
pieces, prefetching 3 ahead, and tolerates 2 consecutive chunk failures before
giving up. Needs the network. Used in listen mode when nothing is stored.

**Web Audio is deliberately not used for playback.** Mobile browsers suspend an
`AudioContext` when the screen locks, and `decodeAudioData` expands a file to raw
PCM (about 1.3 GB per hour). An `<audio>` element survives a locked screen, works
with lock-screen Media Session controls, and decodes incrementally. Web Audio
appears in exactly two places, both narrow: decoding files under 6 MB to draw the
waveform, and measuring per-chunk duration while merging generated audio so word
boundaries stay aligned.

**`AudioPlayer` runs two clocks, and the distinction is load-bearing.**
`requestAnimationFrame` stops the instant the document is hidden, but the audio
keeps playing — that is the whole point of the `<audio>` element. So rAF drives
only the karaoke highlight, which nobody can see with the screen off, while the
native `timeupdate` event (~4Hz, fires while hidden) keeps `player.lastTime`
fresh and is what saved progress reads. Sampling position from rAF meant a
listener who locked their phone and got killed by the OS lost the entire
session. Anything that must stay true in the background belongs on the
`timeupdate` clock, never on rAF.

`AudioPlayer.duration` prefers the duration measured at generation time over the
element's own guess, because generated chapters are concatenated MP3 frames with
no valid duration header.

**Position means different units in each engine.** Stored audio positions are
**seconds**; streaming TTS positions are **character offsets**. The player clock
converts the latter at a flat `12 * speed` characters per second, which is why
the displayed duration of a streamed chapter is an estimate. `progress.audioPosition`
is seconds, `progress.charOffset` is characters, and they are saved independently.

---

## Decisions worth not re-litigating

- **Refs shadow reactive values on purpose.** `ReaderScreen` keeps
  `isListenModeRef`, `usePregenRef`, `chapterIndexRef`, `chapterCountRef`,
  `chaptersRef`, `paraTokensRef`, `audioReadyRef`, `lastAudioPosRef`,
  `audioDurRef`. Native `addEventListener` closures and Media Session handlers
  are registered once and would otherwise capture stale state. Collapsing these
  back into plain state reintroduces bugs that took several commits to kill.
- **Progress is never overwritten with a zero.** If audio is still loading,
  `saveProgress` reads the existing `audioPosition` back out of the DB and writes
  it unchanged. A destroyed `<audio>` element reporting `currentTime === 0` used
  to restart books on reopen.
- **Text selection is hand-built.** A 480ms long-press anchors, dragging extends,
  and a confirm bar commits — over `[data-wi]` word spans, with native iOS
  selection suppressed. Four commits went into this. A quick tap means *seek here*
  in listen mode and *define this word* in read mode.
- **Ingest errors carry a `Step[...]` prefix.** `Step[epub-unzip]`, `Step[pdf-open]`,
  `Step[db-chapter-3]`. There is no remote logging, so the message on the phone
  screen is the only diagnostic. Keep adding them.
- **OCR renders page by page in a rolling queue**, three workers, never more than
  one canvas alive per worker, capped at 200 pages. Rendering every page up front
  needs gigabytes and crashes mobile tabs.
- **`FileReader` instead of `file.arrayBuffer()`/`file.text()`.** Those landed in
  Safari 14.1. FileReader goes back to iOS 5.
- **YouTube import prefers `audio/mp4`** over the smaller WebM/Opus, because
  Safari cannot decode Opus.
- **Covers degrade rather than fail.** HF FLUX via our function → Pollinations
  (free, keyless) → flat gradients. Prompts are built from the book's actual text
  (beginning, middle, end), with a hard style lock and negative prompt, because
  unconstrained prompts produced watercolour faces.
- **PDF Drive and OceanPDF were removed** as Discover sources: their download
  pages need JavaScript rendering, which a serverless function cannot do.
- **The leaf is the progress metaphor**, filling from stem to tip. It appears as
  `LeafProgress`, `ShelfLeaf` and `ChapterLeaf`, and as the favicon.

---

## Extraction must preserve block structure (2026-08-20)

Every parser used to end with `.replace(/s+/g, ' ')`, and EPUB additionally
took `body.textContent`. Both destroy block boundaries. **The reader splits
paragraphs on `

`**, so the result was an entire book rendered as one
paragraph — a single `<p>` containing tens of thousands of word spans.

Measured on a real *Pride and Prejudice* EPUB:

| | before | after |
|---|---|---|
| characters | 733,163 | 757,264 |
| newlines | **0** | 4,344 |
| paragraph breaks | **0** | 2,172 |
| chapters | 15, titled with image captions | 36, titled `CHAPTER IV.` … |

Three rules follow, and all three have tests:

- **Extract per block, never from a container.** `blocksToText()` selects leaf
  blocks only (`p`, headings, `li`, `blockquote`…). Selecting wrappers as well
  emits every paragraph twice. It falls back to `div` when the leaf blocks
  account for under half the document's text, because some EPUBs use no `<p>`
  at all.
- **Never apply a minimum length to a section.** 80 characters discarded
  one-page chapters; 20 still discarded `"For my mother."` Skip only genuinely
  empty text.
- **A spine item is not a chapter.** Gutenberg packs many chapters into one, so
  `splitChapters` runs *inside* each spine item — which only became possible
  once the text kept its line structure.

For PDF, `pageToText()` replaces `items.map(i => i.str).join(' ')`: it honours
pdf.js's `hasEOL` for line ends and measures the **median** vertical drop
between items, treating anything beyond 1.6× that as a paragraph break. Font
sizes vary per document, so the threshold has to be measured, not assumed.

---

## Traps already hit here

- **Never put a test file under `client/api/`.** The dev server imports every
  `.js` there as a route, so `describe()` runs outside a test runner and takes
  the whole server down — and Vercel deploys anything under `api/` as a public
  endpoint, so a `.test.js` there ships as a live URL. Tests for handlers live
  in `client/test/`. `collectHandlers` now skips `.test.js`/`.spec.js` as a
  backstop, but the rule is: keep them out.

- **The SPA rewrite must exclude `/api`.** `client/vercel.json` does
  (`/((?!api/).*)`). The root `vercel.json` does not.
- **Vercel per-deployment hostnames freeze an installed PWA forever.** A PWA
  installed from `leavs-client-<hash>-<team>.vercel.app` is pinned to that
  immutable build and can never find an update, because its origin never changes.
  The canonical host is `leavs-client.vercel.app`.
- **Do not add a `controllerchange` listener.** `useRegisterSW` in `autoUpdate`
  mode already handles skipWaiting and reload; a second listener causes
  double-reloads that read as crashes. Two commits removed one.
- **iOS requires `audio.play()` inside a user gesture.** Because the fetch → play
  chain is async, `EdgeTtsPlayer.play()` synchronously plays a silent 44-byte WAV
  first to unlock audio for the session.
- **`AbortSignal.timeout()` is iOS 16+.** `CoverPickerScreen` uses an explicit
  `AbortController` plus `setTimeout`.
- **`export const config = { maxDuration }` is per handler**, and scraping
  handlers genuinely need 30–45s. Dropping one causes 504s that look like the
  source is down.
- **The scrapers parse HTML with regex** against Cloudflare-protected mirrors.
  They break when a mirror changes markup, not when the code changes. Roughly a
  quarter of the commit history is repairing them. Both log an HTML snippet on a
  zero-result parse — that is the intended first debugging step.

---

## Design system

All colour and spacing lives in `client/src/styles/tokens.css`. Palette:
parchment / moss / soil / vein / ink, plus four translucent highlight colours.
Type: **Playfair Display** for reader body and headings, **DM Sans** for UI,
**DM Mono** for numbers and timestamps. Reader font size is a CSS variable driven
by the user preference.

`global.css` is 2500 lines organised by section comment, one block per screen.
It contains **no `@media` queries at all** — the layout is fixed mobile-first, and
there is no `prefers-reduced-motion` handling and no `:focus-visible` styling.

---

## What is stale or dead

- **Dark and sepia themes do not work.** `tokens.css` defines full
  `[data-theme="dark"]` and `[data-theme="sepia"]` palettes, and nothing anywhere
  sets that attribute. The tokens are ready; the switch was never built.
- **`window.__leavsInstall` is a plain global** set by an effect in `App.jsx` and
  read during `ProfileScreen`'s render. Setting it triggers no re-render, so the
  Install row appears only if something else happens to re-render Profile. It
  should be state or context.
- No README, no license. There *are* tests and a linter now — see below.

*Cleared 2026-08-20:* the root `vercel.json` and root `dist/` (both confirmed
dead — `client/vercel.json` is what Vercel actually serves, proven by the API
answering with its own JSON rather than `index.html`), the unused
`components/library/BookCard.jsx`, the unused `@google/genai` and `multer`
server dependencies, and `GEMINI_API_KEY`.

---

## Production status

Measured 2026-08-20 against `leavs-client.vercel.app`. **Four of six network
features are down**, and none of it is our code failing — it is upstreams
changing under us, which is the standing cost of the scraped sources.

| Endpoint | State |
|---|---|
| `/api/tts/chunk` | ✅ 200 in ~10s |
| `/api/gutenberg/proxy` | ✅ 200, but ~55s for 3.5 MB — close to the limit |
| `/api/standard-ebooks/search` | ❌ upstream returns **401** |
| `/api/libgen/search` | ✅ **fixed 2026-08-20** — new mirrors + rewritten parser, verified live |
| `/api/anna/search` | ❌ needs `SCRAPER_API_KEY`; now says so instead of returning an empty shelf |
| `/api/youtube/audio` | ❌ 500 "Failed to find any playable formats" |

Gutendex and Open Library are called straight from the browser and were not
reachable from the test environment, so they remain unverified.

The two that work are the two the core loop needs: narration and Gutenberg
downloads. Reading and listening are intact; discovery mostly is not.

---

## Running it

```bash
npm install                     # root — workspaces install both
cp server/.env.example server/.env
npm run dev                     # client :5173 + server :3001
# or: start.bat  (two terminals + opens the browser)
```

Vite proxies `/api` to `localhost:3001`. Without the server running, TTS,
Discover's scraped sources, YouTube import and AI covers all fail; local file
import and reading still work, because those never leave the browser.

**Testing** — `npm test` (Vitest, jsdom, 58 tests in 7 files, all passing).
Tests live beside the code as `*.test.js`. The suite is weighted deliberately:
most of it pins bugs that were actually shipped, so they cannot come back.

- `lib/audioPlayer.test.js` — the two-clock contract. One test advances **only**
  `timeupdate` and asserts position still tracks, with `onTimeUpdate` wired to a
  flag that must stay false. That is the locked-screen bug, frozen.
- `lib/edgeTtsPlayer.test.js` — chunk splitting, and that a finished chunk is
  dropped from the cache and revoked *together*, so seeking back refetches
  rather than replaying a dead URL.
- `lib/ingest.test.js` — builds real DOCX and EPUB zips with JSZip in-memory and
  runs them through `ingestFile` against a mocked Dexie. The DOCX test asserts
  three chapters from a chapter-headed document; before the `<w:p>` fix it
  produced one.
- `utils/filetype.test.js` — magic bytes beat a lying Content-Type.
- Plus `settings`, `activity`, `playback`.

Note `setVoice` clears the cache and then, if it was playing, immediately
re-prefetches — so the cache is *not* empty afterwards. The test asserts the
refill went out under the new voice, which is the thing that matters.

**Not covered**, and not coverable this way: anything needing a real browser or
device. PDF parsing and OCR (needs pdf.js worker + tesseract), React components,
the custom touch-selection gesture, service-worker behaviour, and whether audio
genuinely survives a locked screen on real hardware. That last one is the only
true test of the fix above — the unit test pins the mechanism, not the platform.

**API integration** — with the dev server up, all 8 handlers were exercised for
input validation, method guards and env-gated degradation, plus five SSRF probes
against `gutenberg/proxy` (evil.com, the AWS metadata IP, localhost, the
lookalike `evil-archive.org`, and `gutenberg.org.evil.com`). All correctly 403.
Worth re-running by hand after touching `_lib/proxy.js` or the allowlist.

**Linting** — `npm run lint`, currently clean. It exists for one rule:
`react-hooks/exhaustive-deps`. This codebase leans hard on refs that shadow
reactive values, and every one of those effects carries an
`eslint-disable-next-line` with a reason attached. That is the point — the
intentional cases are annotated so a genuinely new stale-closure bug shows up
as the only warning instead of drowning in a permanent list of nineteen.
Everything is a warning; nothing blocks a build.

**Environment**

| Var | Where | Effect if missing |
|---|---|---|
| `PORT`, `CLIENT_ORIGIN` | `server/.env` | Defaults to 3001 / `http://localhost:5173` |
| `SCRAPER_API_KEY` | Vercel env | Scrapers fall back to the free proxy tier; Cloudflare-protected mirrors mostly fail |
| `HF_TOKEN` | Vercel env | `/api/covers/image` returns 503 and the client uses Pollinations. Fine. |
| `GEMINI_API_KEY` | `.env.example` | Nothing. Unused. |

The build stamps `__BUILD_COMMIT__` and `__BUILD_TIME__` into the bundle; both
are shown on the Profile screen's About card, which is how you tell which build a
phone is actually running.

---

## The Library Genesis rewrite (2026-08-20)

Search had returned zero results for weeks. Two independent breakages, both
invisible because the endpoint reported them as "no results":

1. **Every hardcoded mirror was dead.** `libgen.rs`, `.is`, `.st`, `.gs` and
   `library.lol` no longer resolve at all. The surviving family is
   **libgen.li / .la / .bz / .lc**.
2. **The URL and the markup both changed.** Those dead mirrors used
   `/search.php?req=`, which now **404s**; libgen.li serves `/index.php?req=`.
   Its results table is different too — nine `<td>`s, no `valign="top"`, no
   `id="href"` title anchor, and the md5 only in the mirror links. The old
   parser matched **zero** rows.

Three things worth knowing about the parser:

- **Strip `title="…"` attributes first.** The tooltips contain `<br>` and prose,
  so any `[^>]` attribute scan breaks out of the attribute and captures raw
  markup into the book title.
- **The title is the longest `edition.php` anchor that is not all digits.** A row
  carries several: series, an italic date, the title, and an ISBN in a green
  font. "Longest wins" alone yields titles like `0553897837; 9780553897838`.
- **md5 appears as `get.php?md5=<hash>` or `/md5/<hash>`** (the Anna's badge).
  Match both, or you lose most rows.

`client/test/fixtures/libgen-li-results.html` is a trimmed real capture, and
`libgenSearch.test.js` runs the parser against it. **When this rots again, diff a
fresh capture against that fixture** — it is far faster than re-deriving the above.

**Downloads.** `get.php?md5=` 307-redirects straight to `cdn<N>.booksdl.lc`, so
no page scraping is needed on the happy path. Two consequences:

- `booksdl.lc` **must** be on the download allowlist or every real download is
  blocked by our own SSRF guard.
- **That CDN is throttled to roughly 10–15 KB/s.** A 582 KB EPUB took 44 seconds.
  The handler therefore streams rather than buffering, bounds only the wait for
  response *headers* (never the body), and declares `maxDuration: 300`. Large
  files — a 26 MB comic, say — are simply not retrievable inside any function
  timeout, and no amount of code will change that.

---

## Open work

1. **The four broken upstreams** in *Production status*. Standard Ebooks 401s,
   LibGen and Anna's parse to zero, `ytdl-core` finds no playable format. Our
   side of this is now honest — a parse failure returns `degraded` and the UI
   raises it as an error instead of reporting an empty shelf — but the causes
   are upstream and need either a live debugging session or a decision to drop
   the dead sources from the UI.
2. **Dark mode is reachable but has never been looked at.** The switch works and
   the palette resolves; plenty of components still hardcode colours
   (`rgba(255,255,255,…)`, `#C0392B`, the gradient tables) and were only ever
   composed against parchment. Expect rough edges until someone views it.
3. **A Dexie `version(2)`** before any of the undeclared fields needs an index.
4. **PDF and OCR have no tests** — they need the pdf.js worker and tesseract,
   which do not run under jsdom. Highest-value gap in the suite.
5. **React components are untested.** No `@testing-library/react` yet, so the
   reader's gesture handling and the two audio-engine branches are verified only
   through their underlying classes.
6. **The vocab lookup has no offline story** — `api.dictionaryapi.dev` is not in
   the service worker's runtime cache, so definitions fail silently offline.

*Closed 2026-08-20:* locked-screen position loss, the TTS blob-cache seek bug,
the 60fps reader re-render, DOCX single-chapter imports, magic-byte sniffing,
stored duration, SW reload during playback, wall-clock timers, ingest content
loss and partial imports, the `libgen/fetch` open proxy, the TTS payload cap,
`window.__leavsInstall`, pinch zoom, focus visibility, reduced motion, keyboard
activation, non-deterministic SVG ids, and the dark-mode switch.
