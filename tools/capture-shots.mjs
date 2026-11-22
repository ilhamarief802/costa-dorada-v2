// Screenshot rig for COSTA DORADA: the four frames the entry hands in.
//
// Each frame is the game's own render, staged by game/src/shots.js and frozen behind
// `?shot=<name>&seed=1&capture=1`. The page sets window.__SHOT_READY once the frozen frame has
// settled, so this script waits for that flag rather than for a wall clock.
//
// Frames are captured at 1280x720 and written as JPEG. The gate refuses a screenshot over
// 256 KiB, so the encoder walks quality down from 0.92 in steps until the file fits.
//
//   node serve.ts --port 8080 &
//   node tools/capture-shots.mjs [--base http://localhost:8080] [--out screenshots]

import { mkdirSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '/home/ilham/.hermes/hermes-agent/node_modules/playwright-core/index.mjs';

const executablePath = '/home/ilham/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
}

const base = arg('base', process.env.PROBE_BASE ?? 'http://localhost:8080');
const outDir = arg('out', 'screenshots');

/** The four frames, in the order the entry names them: the cover first. */
const SHOTS = [
  { name: 'cover', file: '1-cover.jpg' },
  { name: 'chase', file: '2-chase.jpg' },
  { name: 'mission', file: '3-mission.jpg' },
  { name: 'night', file: '4-night.jpg' },
];

const LIMIT = 262144; // 256 KiB, the gate's per-screenshot cap
const START_QUALITY = 92;
const FLOOR_QUALITY = 40;
const STEP = 6;

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});

const page = await browser.newPage({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
});

const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

mkdirSync(outDir, { recursive: true });

const written = [];

for (const shot of SHOTS) {
  const url = `${base}/?shot=${shot.name}&seed=1&capture=1`;
  process.stdout.write(`capturing ${shot.name} ... `);
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__SHOT_READY === true, null, { timeout: 180000 });
  // The rig sets the flag on the frame it wants frozen; hold the canvas at exactly one
  // presented frame so the JPEG is the render, not a half-drawn swap.
  await page.waitForTimeout(120);

  // Screenshot the canvas element itself so the capture is the render at 1280x720 with no
  // page chrome, whatever the window's own decorations do.
  const canvas = page.locator('#game');
  const target = join(outDir, shot.file);

  let quality = START_QUALITY;
  let buffer;
  for (;;) {
    buffer = await canvas.screenshot({ type: 'jpeg', quality });
    if (buffer.byteLength < LIMIT || quality <= FLOOR_QUALITY) break;
    quality -= STEP;
  }
  await writeFile(target, buffer);

  const bytes = statSync(target).size;
  written.push({ ...shot, bytes, quality });
  process.stdout.write(`${bytes} bytes @ q${quality}\n`);
}

await browser.close();

console.log('');
console.log('screenshot sizes:');
for (const w of written) {
  const kib = (w.bytes / 1024).toFixed(1);
  const ok = w.bytes < LIMIT ? 'ok' : 'OVER 256 KiB';
  console.log(`  ${w.file.padEnd(14)} ${String(w.bytes).padStart(7)} B  ${kib.padStart(7)} KiB  q${w.quality}  ${ok}`);
}

if (errors.length) {
  console.log('');
  console.log('console errors during capture:');
  for (const e of errors) console.log(`  ${e}`);
  process.exitCode = 1;
}
