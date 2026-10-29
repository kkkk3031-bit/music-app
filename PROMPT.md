# Build prompt: music-app (Spotify-style music app)

Copy everything below the line into Claude Code, running from `/home/dev`.

---

Build a Spotify-style music app in `/home/dev/music-app`. It should have a Node.js backend with a web player, plus a native Android client. Read `/home/dev/CLAUDE.md` first and follow its sandbox constraints. Use an original name and logo. Do not use Spotify's name, logo, or assets.

## Structure
- `music-app/server/`: Node 22 with Express, Socket.IO, and multer. Use pure JS with no native dependencies; follow `talk-app` as a reference. Store data in JSON files or SQLite through a pure-JS driver. It serves the REST API, the WebSocket rooms, and the web player from `public/`.
- `music-app/android/`: Kotlin with Jetpack Compose and Media3 ExoPlayer. Run the Gradle wrapper with `local.properties` pointing at `/home/dev/android-sdk`, and set compileSdk to 36. Use `kdl-app` / `backup-app` as references.
- Port **3020**. Add a `music-app` entry to `/home/dev/ecosystem.config.js` matching the existing entries. Do not touch or print the secret in that file.

## Features
1. **Accounts**: register and log in using bcryptjs and JWT. Each user has a profile with an avatar.
2. **Library / local player**: upload audio (mp3, m4a, ogg, flac, wav) and read ID3 tags and cover art with `music-metadata`. Stream with HTTP Range support so seeking works. The library covers songs, albums, artists, and liked songs.
3. **Player**: play/pause, seek, next/prev, shuffle, repeat (off/all/one), volume, and a queue you can reorder. The web version uses a persistent bottom player bar. Android plays in the background through a Media3 MediaSessionService, with lock-screen and notification controls.
4. **Playlists**: create, rename, delete, add and remove songs, reorder by drag, and set a cover.
5. **Search & streaming**: one search across the local library and **legal free sources**: Internet Archive audio (no key) and Jamendo (client id in `.env`, so make that source optional). Online results stream through the server proxy and can be added to playlists.
6. **Downloader**: paste a direct audio URL, an Internet Archive URL, or a Jamendo URL, and the file is saved into the user's library. Show a queue with progress over Socket.IO. Optionally use `/home/dev/bin/yt-dlp` for user-supplied links. YouTube is IP-blocked from this sandbox, so fail gracefully with a clear message.
7. **Listen-together rooms**: a host creates a room and others join with a code. Playback (track, position, play/pause) stays synced over Socket.IO and corrects drift. Rooms have live chat and a shared queue.
8. **Home screen**: recently played, the user's playlists, "jump back in", and new uploads.

## UI (web + Android)
- Dark theme with an accent color, a left sidebar (Home / Search / Library / Rooms) on web, and a bottom nav on Android.
- Album-art grid cards, a now-playing full screen with a large cover, and a responsive mobile web layout.

## Quality bar
- Validate inputs, enforce upload size and MIME limits, and never send files outside the media dir (no path traversal). Rate-limit auth.
- Write a `README.md` covering setup, `.env.example`, the API list, and how to run.
- Add server tests with `node --test` covering auth, upload, Range streaming, playlists, and the room sync logic.

## Verify before finishing
1. `cd server && npm install && npm test` passes.
2. Start the server with PM2 or the Bash tool's `run_in_background`, not nohup. Then curl `/api/health`, upload a sample file, and confirm a Range request returns 206.
3. `cd android && ./gradlew assembleDebug` succeeds, and the APK has the right package and permissions according to `aapt dump badging`. There is no emulator (no KVM), so don't try to launch one.
4. Report honestly what works, what you skipped, and what's untested.

Build it in stages (server core → web player → search/downloader → rooms → Android) and confirm each stage works before moving on.
