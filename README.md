# Cadence

A self-hosted, Spotify-style music app: a Node.js server with a web player, and a native Android client.

- **Library and player:** every listener can upload MP3, M4A, AAC, OGG, Opus, FLAC or WAV files (web or Android). Tags, cover art and embedded lyrics are read automatically, and byte-identical files are detected so the library has no duplicates. The player has a queue, shuffle, repeat, range-based streaming so seeking is instant, and preloads the next song before the current one ends.
- **Uploads per listener:** Library → Uploads shows your own uploads and a page for every other listener who has uploaded music.
- **Lyrics:** plain or synced (LRC `[mm:ss.xx]`). Synced lyrics highlight the current line and tap-to-seek. The uploader can add or edit them from the now-playing screen.
- **Playlists:** create, rename, add a cover, drag to reorder (web), remove songs, copy a share link (others get a read-only view). Liked Songs and recently played are included.
- **Search and streaming:** one search covers your library, the [Internet Archive](https://archive.org) (no key needed) and [Jamendo](https://www.jamendo.com) (needs a free key). Online results stream through the server and can be saved to playlists.
- **Downloader:** paste an archive.org item, a Jamendo track, or a direct audio link, and it's imported into the library. Progress updates live, and downloads can be canceled or retried. Other links fall back to `yt-dlp` if it's installed.
- **Listen together:** the host creates a room and friends join with a 6-letter code. Everyone hears the same moment, with drift correction. The host controls playback, anyone can queue songs, and there's live chat. If the host leaves, host passes to the longest-present listener.

Only free and legal sources are built in. Cadence isn't affiliated with Spotify.

```
server/   Node 22 · Express 5 · Socket.IO · pure JS (no native deps), JSON-file storage
  src/    app.js (REST), sockets.js, rooms.js, downloader.js, sources.js, net.js (SSRF guard), media.js
  public/ web player: vanilla ES modules, no build step
  test/   node --test unit/integration tests + Playwright browser E2E
android/  Kotlin · Jetpack Compose · Media3 (ExoPlayer + MediaSessionService) · socket.io-client
```

## Run the server

```bash
cd server
npm install
cp .env.example .env      # optional
npm start                 # http://localhost:3030
```

Open the URL, create an account, and upload music or search. Data is stored in `server/data/` (it's in `.gitignore`).

On this machine it runs under PM2 as `music-app`. Start it with `pm2 start ecosystem.config.js --only music-app`.

## Tests

```bash
cd server
npm test              # 22 API/socket tests: auth, password change, rate limits, uploads + dedupe,
                      # lyrics, per-user uploads, Range 206, path traversal, SSRF, playlists,
                      # download cancel/retry, room state machine, live two-client room sync
npm run test:e2e      # real headless Chromium: two users go through upload (+ duplicate) → play →
                      # lyrics → queue → playlist (drag reorder) → like → search → room sync, seek,
                      # pause, chat, host hand-off → uploads pages → share link → password change
```

The first E2E run needs `npx playwright install chromium-headless-shell`.

## Android app

```bash
cd android
./gradlew assembleDebug   # → app/build/outputs/apk/debug/app-debug.apk
```

`local.properties` must point `sdk.dir` at the Android SDK. On the login screen, enter the server URL. The default is `http://10.0.2.2:3030`, which is the host machine as seen from the emulator. Playback runs in a Media3 `MediaSessionService`, so it continues in the background with notification and lock-screen controls.

Verified on the API 28 emulator: login, home, playlist, background playback (media session PLAYING), and joining a room created from the web. In that test the phone tracked the host's position to within about 1 s.

## API overview

All endpoints are under `/api`. Auth uses `Authorization: Bearer <token>`, or `?t=<token>` for `<audio>` and `<img>` URLs.

| Method | Path | |
|---|---|---|
| POST | `/auth/register`, `/auth/login` | `{username, password}` → `{token, user}` (rate-limited) |
| GET | `/me`, `/home`, `/me/likes` | profile, home feed, liked songs |
| POST | `/me/avatar`, `/me/played` | avatar image, record a play |
| POST | `/me/password` | `{currentPassword, newPassword}` (rate-limited) |
| GET | `/users` | listeners who uploaded music, with `uploadCount` |
| GET | `/users/:username` | `{user, uploads, playlists}` for one listener |
| GET/POST | `/tracks` | list (`?sort=recent\|title\|artist`), multipart upload (`files`) → `{tracks, errors, duplicates}` |
| POST | `/tracks/remote` | save an online search result as a playable track |
| GET | `/tracks/:id/stream` | audio, supports Range |
| PUT/DELETE | `/tracks/:id/like` | like / unlike |
| DELETE | `/tracks/:id` | uploader only |
| GET/PUT | `/tracks/:id/lyrics` | `{lyrics, synced}`; PUT `{lyrics}` is uploader only |
| GET | `/albums[/:key]`, `/artists[/:name]` | grouped library |
| GET/POST | `/playlists` | mine (`?scope=all` for everyone's) / create |
| GET/PATCH/DELETE | `/playlists/:id` | view / rename / delete |
| POST/PUT | `/playlists/:id/tracks` | add / reorder (permutation) |
| DELETE | `/playlists/:id/tracks/:index` | remove one entry |
| POST | `/playlists/:id/cover` | cover image |
| GET | `/search?q=` | `{local, playlists, archive, jamendo, errors}` |
| GET/POST | `/downloads` | jobs / enqueue `{url}` |
| POST | `/downloads/:id/cancel`, `/downloads/:id/retry` | stop a queued/running job, re-queue a failed/canceled one |
| GET | `/health` | status and enabled features |

Room events go over Socket.IO, with an ack on each: `room:create`, `room:join`, `room:leave`, `room:play`, `room:pause`, `room:resume`, `room:seek`, `room:next`, `room:queue:add`, `room:queue:remove`, `room:chat`, and `time` for clock sync. The server pushes `room:state`, `room:chat` and `download:update`.

## Security notes

- Passwords are hashed with bcrypt. JWTs last 30 days. Auth endpoints are rate-limited per IP.
- Uploads are limited by size and count. Audio is rejected unless it actually decodes, and images are checked by their magic bytes. Media is served from fixed directories, so there's no path traversal.
- Outbound fetches are guarded against SSRF. The streaming proxy only talks to an allowlist (`archive.org`, `jamendo.com`). User download links must resolve to public IPs, and every redirect hop is re-checked.
- Chat and all user text are rendered with `textContent`, never `innerHTML`.

## Known limitations

- YouTube blocks downloads from datacenter IPs, so YouTube links usually fail with a clear message.
- Jamendo needs `JAMENDO_CLIENT_ID`. Without it, that source is skipped.
- Storage is a single JSON file, which suits a personal or friends server. It isn't built for thousands of users.
- On Android, reordering a playlist is done with Move up / Move down menu items. The web player has drag-and-drop.
- The Android release build is signed with the debug key. Add a real keystore before distributing it.
