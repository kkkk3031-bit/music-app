// Real-browser E2E for the web player (headless Chromium via Playwright).
// Run: npm run test:e2e   — boots an isolated server, drives two users through
// upload → play → queue → playlist (incl. drag reorder) → like → search →
// listen-together room with sync + chat. Fails on any page/console error.
// Screenshots land in $E2E_SHOTS (default: os tmpdir).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer, makeWav, api } from '../helpers.js';

const shots = process.env.E2E_SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'cadence-shots-'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cadence-wav-'));
const files = ['Sunrise', 'Midnight Drive', 'Ocean Floor'].map((title, i) => {
  const f = path.join(tmp, `${title}.wav`);
  fs.writeFileSync(f, makeWav({ title, artist: i < 2 ? 'The Testers' : 'Deep Blue', album: i < 2 ? 'First Light' : 'Abyss', seconds: 40 }));
  return f;
});

const s = await startServer();
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [];
let step = 'start';

async function newUserPage(name, viewport = { width: 1400, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(`[${name}] console: ${m.text()}`));
  page.on('response', (r) => r.status() >= 500 && errors.push(`[${name}] HTTP ${r.status()} ${r.url()}`));
  await page.goto(s.base);
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.locator('input[name=username]').fill(name);
  await page.locator('input[name=password]').fill('secret123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('#shell:not([hidden])').waitFor();
  return page;
}

const audioState = (page) => page.evaluate(() => {
  const a = document.getElementById('audio');
  return { paused: a.paused, t: a.currentTime, src: a.getAttribute('src') || '' };
});
const nowTitle = (page) => page.locator('.player .p-now .t-title').textContent();

try {
  step = 'register alice';
  const alice = await newUserPage('alice');
  await alice.getByText('Your library is empty').waitFor();

  step = 'upload';
  await alice.locator('.nav').getByRole('link', { name: 'Import' }).click();
  await alice.locator('input[type=file]').setInputFiles(files);
  await alice.getByText('Added 3 song(s).').waitFor({ timeout: 15000 });

  step = 'duplicate upload is detected';
  await alice.locator('input[type=file]').setInputFiles([files[0]]);
  await alice.getByText('1 already in the library: Sunrise.wav').waitFor({ timeout: 15000 });

  step = 'library songs';
  await alice.goto(`${s.base}/#/library/songs`);
  await alice.locator('.track').nth(2).waitFor();
  assert.equal(await alice.locator('.track').count(), 3);

  step = 'play';
  const firstRow = alice.locator('.track').first();
  const firstTitle = await firstRow.locator('.t-title').textContent();
  await firstRow.hover();
  await firstRow.locator('.hover-play').click();
  await alice.waitForFunction(() => document.getElementById('audio').currentTime > 0.5, null, { timeout: 10000 });
  assert.equal(await nowTitle(alice), firstTitle);
  assert.equal((await audioState(alice)).paused, false);
  await alice.locator('.track.playing', { hasText: firstTitle }).waitFor();

  step = 'pause/resume via space + button';
  await alice.locator('.p-play').click();
  await alice.waitForFunction(() => document.getElementById('audio').paused);
  await alice.keyboard.press('Space');
  await alice.waitForFunction(() => !document.getElementById('audio').paused);

  step = 'seek';
  await alice.evaluate(() => {
    const r = document.querySelector('.p-seek input');
    r.value = '20';
    r.dispatchEvent(new Event('input'));
    r.dispatchEvent(new Event('change'));
  });
  await alice.waitForFunction(() => document.getElementById('audio').currentTime >= 19.5);

  step = 'next / queue panel';
  const before = await nowTitle(alice);
  await alice.getByRole('button', { name: 'Next', exact: true }).first().click();
  await alice.waitForFunction((b) => document.querySelector('.player .t-title').textContent !== b, before);
  await alice.getByRole('button', { name: 'Queue' }).click();
  await alice.locator('#queue-panel .label', { hasText: 'Now playing' }).waitFor();
  await alice.screenshot({ path: path.join(shots, 'desktop-library-queue.png') });
  await alice.getByRole('button', { name: 'Close queue' }).click();

  step = 'shuffle + repeat toggles';
  await alice.getByRole('button', { name: 'Shuffle', exact: true }).first().click();
  assert.ok(await alice.locator('.p-controls .icon-btn.on').count() >= 1);
  await alice.getByRole('button', { name: /Repeat/ }).first().click();

  step = 'create playlist';
  await alice.locator('#new-playlist').click();
  await alice.locator('.modal input').fill('Road Trip');
  await alice.locator('.modal').getByRole('button', { name: 'Create', exact: true }).click();
  await alice.locator('.hero h1', { hasText: 'Road Trip' }).waitFor();

  step = 'add songs to playlist via menu';
  for (const title of ['Sunrise', 'Midnight Drive', 'Ocean Floor']) {
    await alice.goto(`${s.base}/#/library/songs`);
    const row = alice.locator('.track', { hasText: title });
    await row.hover();
    await row.getByRole('button', { name: 'More options' }).click();
    await alice.locator('.menu').getByText('Add to playlist…').click();
    await alice.locator('.menu').getByText('Road Trip').click();
    await alice.getByText('Added to Road Trip').first().waitFor();
  }
  const pl = (await api(s.base, 'GET', '/api/playlists', { token: await alice.evaluate(() => localStorage.getItem('cadence.token')) })).json[0];
  await alice.goto(`${s.base}/#/playlist/${pl.id}`);
  await alice.locator('.track').nth(2).waitFor();
  const order = () => alice.locator('.track .t-title').allTextContents();
  assert.deepEqual(await order(), ['Sunrise', 'Midnight Drive', 'Ocean Floor']);

  step = 'drag reorder';
  const handle = alice.locator('.track').nth(2).locator('.drag-handle');
  const target = alice.locator('.track').nth(0);
  const hb = await handle.boundingBox();
  const tb = await target.boundingBox();
  await alice.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await alice.mouse.down();
  await alice.mouse.move(hb.x + 5, tb.y + 8, { steps: 8 });
  await alice.mouse.up();
  await alice.waitForFunction(() => document.querySelector('.track .t-title')?.textContent === 'Ocean Floor');
  assert.deepEqual(await order(), ['Ocean Floor', 'Sunrise', 'Midnight Drive']);

  step = 'rename playlist';
  await alice.locator('.hero h1').click();
  await alice.locator('.modal input').fill('Road Trip 2026');
  await alice.locator('.modal').getByRole('button', { name: 'Save', exact: true }).click();
  await alice.locator('.hero h1', { hasText: 'Road Trip 2026' }).waitFor();
  await alice.locator('.sidebar .side-pl', { hasText: 'Road Trip 2026' }).waitFor();

  step = 'like + liked songs';
  const likeBtn = alice.locator('.track', { hasText: 'Sunrise' }).getByRole('button', { name: /Liked Songs/ });
  await likeBtn.click();
  await alice.getByText('Added to Liked Songs').first().waitFor();
  await alice.goto(`${s.base}/#/liked`);
  await alice.locator('.track', { hasText: 'Sunrise' }).waitFor();

  step = 'search local';
  await alice.goto(`${s.base}/#/search`);
  await alice.locator('.search-box input').fill('ocean');
  await alice.locator('h2', { hasText: 'Songs in your library' }).waitFor({ timeout: 20000 });
  await alice.locator('.track', { hasText: 'Ocean Floor' }).first().waitFor();

  step = 'albums / artists';
  await alice.goto(`${s.base}/#/library/albums`);
  await alice.locator('.card', { hasText: 'First Light' }).click();
  await alice.locator('.hero h1', { hasText: 'First Light' }).waitFor();
  assert.equal(await alice.locator('.track').count(), 2);
  await alice.locator('.hero a', { hasText: 'The Testers' }).click();
  await alice.locator('.hero .kind', { hasText: 'Artist' }).waitFor();

  step = 'now playing overlay';
  await alice.locator('.player .p-now .cover').click();
  await alice.locator('#now-playing:not([hidden]) .np-info .t-title').waitFor();
  await alice.waitForTimeout(400); // let the open animation finish
  await alice.screenshot({ path: path.join(shots, 'desktop-now-playing.png') });

  step = 'lyrics: add synced lyrics, line follows playback';
  await alice.getByRole('button', { name: 'Lyrics' }).click();
  await alice.getByText('No lyrics for this song yet.').waitFor();
  await alice.getByRole('button', { name: 'Add lyrics' }).click();
  const lrc = Array.from({ length: 40 }, (_, i) => `[00:${String(i).padStart(2, '0')}.00]Line ${i}`).join('\n');
  await alice.locator('textarea.lyrics-edit').fill(lrc);
  await alice.locator('.modal').getByRole('button', { name: 'Save' }).click();
  await alice.locator('.np-lyrics .lrc p.on').waitFor({ timeout: 10000 });
  const lineA = await alice.locator('.np-lyrics .lrc p.on').textContent();
  await alice.locator('.np-lyrics .lrc p', { hasText: /^Line 30$/ }).click();
  await alice.waitForFunction(() => document.querySelector('.np-lyrics .lrc p.on')?.textContent.match(/^Line (3\d)$/));
  assert.notEqual(lineA, await alice.locator('.np-lyrics .lrc p.on').textContent());
  await alice.screenshot({ path: path.join(shots, 'desktop-lyrics.png') });
  const shift = await alice.evaluate(() => { const el = document.getElementById('now-playing'); return el.scrollTop + el.scrollLeft; });
  assert.equal(shift, 0, 'lyrics scrolling must not shift the overlay');
  await alice.keyboard.press('Escape');

  step = 'home';
  await alice.goto(`${s.base}/#/home`);
  await alice.locator('h2', { hasText: 'Recently played' }).waitFor();
  await alice.screenshot({ path: path.join(shots, 'desktop-home.png') });

  step = 'room: create';
  await alice.goto(`${s.base}/#/rooms`);
  await alice.locator('input[aria-label="Room name"]').fill('Friday Night');
  await alice.getByRole('button', { name: 'Create room' }).click();
  await alice.locator('.room-code').waitFor();
  const code = (await alice.locator('.room-code').textContent()).trim();
  assert.match(code, /^[A-Z0-9]{6}$/);

  step = 'room: bob joins';
  const bob = await newUserPage('bob', { width: 390, height: 844 });
  await bob.goto(`${s.base}/#/rooms`);
  await bob.locator('input[aria-label="Room code"]').fill(code.toLowerCase());
  await bob.getByRole('button', { name: 'Join' }).click();
  await bob.locator('.member', { hasText: 'alice' }).waitFor();
  await alice.locator('.member', { hasText: 'bob' }).waitFor();

  step = 'room: host plays, member follows';
  await alice.locator('input[aria-label="Search songs for the room"]').fill('midnight');
  const pick = alice.locator('.track', { hasText: 'Midnight Drive' }).first();
  await pick.waitFor({ timeout: 20000 });
  await pick.hover();
  await pick.locator('.hover-play').click();
  await bob.waitForFunction(() => document.querySelector('.player .t-title')?.textContent === 'Midnight Drive', null, { timeout: 10000 });
  await bob.waitForFunction(() => document.getElementById('audio').currentTime > 1, null, { timeout: 15000 });
  const [a1, b1] = await Promise.all([audioState(alice), audioState(bob)]);
  assert.equal(a1.paused, false, 'host playing');
  assert.equal(b1.paused, false, 'member playing');
  assert.ok(Math.abs(a1.t - b1.t) < 1.5, `in sync (host ${a1.t.toFixed(2)} vs member ${b1.t.toFixed(2)})`);

  step = 'room: host seeks, member follows';
  await alice.evaluate(() => {
    const r = document.querySelector('.p-seek input');
    r.value = '30';
    r.dispatchEvent(new Event('input'));
    r.dispatchEvent(new Event('change'));
  });
  await bob.waitForFunction(() => document.getElementById('audio').currentTime >= 29, null, { timeout: 10000 });

  step = 'room: host pauses, member pauses';
  await alice.locator('.room-now').getByRole('button', { name: 'Pause' }).click();
  await bob.waitForFunction(() => document.getElementById('audio').paused, null, { timeout: 10000 });

  step = 'room: member cannot control, can queue';
  await bob.locator('input[aria-label="Search songs for the room"]').fill('sunrise');
  const bpick = bob.locator('.track', { hasText: 'Sunrise' }).first();
  await bpick.waitFor({ timeout: 20000 });
  await bpick.getByRole('button', { name: 'More options' }).click();
  await bob.locator('.menu').getByText('Add to room queue').click();
  await alice.locator('.q-item', { hasText: 'added by bob' }).waitFor();

  step = 'room: chat';
  await bob.locator('input[aria-label="Chat message"]').fill('this slaps 🔥 <b>not bold</b>');
  await bob.locator('input[aria-label="Chat message"]').press('Enter');
  await alice.locator('.chat-msg .body', { hasText: 'this slaps' }).waitFor();
  assert.equal(await alice.locator('.chat-msg .body b').count(), 0, 'chat is not rendered as HTML');
  await bob.screenshot({ path: path.join(shots, 'mobile-room.png') });
  await alice.screenshot({ path: path.join(shots, 'desktop-room.png') });

  step = 'room: skip plays queued song for both';
  await alice.locator('.room-now').getByRole('button', { name: 'Skip' }).click();
  await bob.waitForFunction(() => document.querySelector('.player .t-title')?.textContent === 'Sunrise', null, { timeout: 10000 });

  step = 'room: host leaves → bob becomes host';
  await alice.getByRole('button', { name: 'Leave' }).click();
  await bob.locator('.member', { hasText: 'HOST' }).filter({ hasText: 'bob' }).waitFor({ timeout: 10000 });

  step = 'mobile layout';
  await bob.goto(`${s.base}/#/home`);
  await bob.locator('.bottom-nav a', { hasText: 'Search' }).waitFor();
  assert.equal(await bob.locator('.sidebar').isVisible(), false);
  await bob.screenshot({ path: path.join(shots, 'mobile-home.png') });

  step = 'playlist share link';
  await alice.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await alice.goto(`${s.base}/#/library/playlists`);
  await alice.locator('.card', { hasText: 'Road Trip 2026' }).click();
  await alice.locator('.hero .kind', { hasText: 'Playlist' }).waitFor();
  await alice.getByRole('button', { name: 'Copy link' }).click();
  await alice.getByText('Link copied').waitFor();
  const link = await alice.evaluate(() => navigator.clipboard.readText());
  assert.match(link, /\/#\/playlist\/[\w-]+$/);
  await bob.goto(link);
  await bob.locator('.hero .kind', { hasText: 'Playlist' }).waitFor();
  assert.equal(await bob.locator('.action-bar').getByRole('button', { name: 'More options' }).count(), 0, 'non-owner gets read-only view');

  step = 'uploads: bob browses alice\'s uploads';
  await bob.goto(`${s.base}/#/library/uploads`);
  await bob.getByText('You haven\'t uploaded any music yet.').waitFor();
  await bob.locator('.card', { hasText: 'alice' }).filter({ hasText: '3 uploads' }).click();
  await bob.locator('.ig-head h1', { hasText: 'alice' }).waitFor();
  assert.equal(await bob.locator('.ig-tile').count(), 3);

  step = 'follow from profile';
  await bob.locator('.ig-actions').getByRole('button', { name: 'Follow', exact: true }).click();
  await bob.locator('.ig-actions').getByRole('button', { name: 'Following' }).waitFor();
  assert.equal(await bob.locator('.ig-stat', { hasText: 'followers' }).locator('b').innerText(), '1');
  await bob.screenshot({ path: path.join(shots, 'mobile-user-uploads.png') });
  await bob.goto(`${s.base}/#/home`);
  await bob.locator('.shelf-head h2', { hasText: 'From people you follow' }).waitFor();
  await bob.screenshot({ path: path.join(shots, 'mobile-home-following.png') });

  step = 'direct messages';
  await alice.goto(`${s.base}/#/home`);
  await bob.goto(`${s.base}/#/user/alice`);
  await bob.locator('.ig-actions').getByRole('link', { name: 'Message' }).click();
  await bob.locator('.dm-head', { hasText: 'alice' }).waitFor();
  await bob.locator('.dm-input').fill('hey alice, love your songs');
  await bob.locator('.dm-input').press('Enter');
  await bob.locator('.bubble.mine', { hasText: 'love your songs' }).waitFor();
  await alice.getByText('bob: hey alice, love your songs').waitFor();
  assert.equal(await alice.locator('#dm-btn .badge').innerText(), '1');
  await alice.locator('#dm-btn').click();
  await alice.locator('.convo.unread', { hasText: 'bob' }).click();
  await alice.locator('.bubble.theirs', { hasText: 'love your songs' }).waitFor();
  await alice.locator('#dm-btn .badge').waitFor({ state: 'hidden' });
  await alice.locator('.dm-input').fill('thanks bob!');
  await alice.getByRole('button', { name: 'Send' }).click();
  await bob.locator('.bubble.theirs', { hasText: 'thanks bob!' }).waitFor();
  await alice.screenshot({ path: path.join(shots, 'desktop-dm.png') });
  await bob.screenshot({ path: path.join(shots, 'mobile-dm.png') });

  step = 'edit bio';
  await alice.goto(`${s.base}/#/user/alice`);
  await alice.getByRole('button', { name: 'Edit profile' }).click();
  await alice.locator('.bio-input').fill('Testing tones since 2026');
  await alice.locator('.modal').getByRole('button', { name: 'Save' }).click();
  await alice.locator('.ig-bio', { hasText: 'Testing tones since 2026' }).waitFor();
  assert.equal(await alice.locator('.ig-stat', { hasText: 'followers' }).locator('b').innerText(), '1');
  await alice.screenshot({ path: path.join(shots, 'desktop-profile.png') });

  await alice.goto(`${s.base}/#/library/uploads`);
  await alice.getByText('Your uploads · 3').waitFor();
  assert.equal(await alice.locator('.track').count(), 3);

  step = 'change password';
  await alice.goto(`${s.base}/#/profile`);
  await alice.locator('input[aria-label="Current password"]').fill('secret123');
  await alice.locator('input[aria-label="New password"]').fill('better456');
  await alice.locator('input[aria-label="Repeat new password"]').fill('better456');
  await alice.getByRole('button', { name: 'Update password' }).click();
  await alice.getByText('Password changed').waitFor();
  s.store.flush();
  assert.equal((await api(s.base, 'POST', '/api/auth/login', { body: { username: 'alice', password: 'better456' } })).status, 200);

  step = 'logout';
  await alice.locator('#user-chip').click();
  await alice.locator('.menu').getByText('Log out').click();
  await alice.getByRole('button', { name: 'Log in' }).waitFor();

  assert.deepEqual(errors, [], `browser errors:\n${errors.join('\n')}`);
  console.log(`E2E web: all steps passed. Screenshots: ${shots}`);
} catch (err) {
  console.error(`E2E web FAILED at step "${step}":`, err.message);
  if (errors.length) console.error('Browser errors:\n' + errors.join('\n'));
  for (const [i, ctx] of browser.contexts().entries()) {
    for (const [j, pg] of ctx.pages().entries()) await pg.screenshot({ path: path.join(shots, `fail-${i}-${j}.png`) }).catch(() => {});
  }
  console.error(`Failure screenshots: ${shots}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await s.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
}
