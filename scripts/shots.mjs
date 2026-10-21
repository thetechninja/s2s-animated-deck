#!/usr/bin/env node
/* shots.mjs — render PNGs of the generated deck for visual review.
   Captures each mood deck at slide 1 and slide 2 via CDP.
   Usage: node scripts/shots.mjs
   Output: dist/shots/<mood>-slide<N>.png
   ============================================================================ */
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MOODS = ['calm', 'high-energy', 'editorial'];
const SHOTS = resolve('dist/shots');
mkdirSync(SHOTS, { recursive: true });

async function main() {
  const port = 9600 + Math.floor(Math.random() * 200);
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=1.5',
    `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/s2s-shots-${process.pid}`, 'about:blank',
  ], { stdio: 'ignore' });

  try {
    let wsUrl;
    for (let i = 0; i < 60 && !wsUrl; i++) {
      try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); wsUrl = l.find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch {}
      if (!wsUrl) await sleep(100);
    }
    const ws = new WebSocket(wsUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    let id = 0; const pending = new Map(); const events = [];
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } else events.push(m); };
    const send = (method, params = {}) => new Promise((r) => { const mid = ++id; pending.set(mid, r); ws.send(JSON.stringify({ id: mid, method, params })); });
    await send('Runtime.enable'); await send('Page.enable');

    for (const mood of MOODS) {
      await send('Page.navigate', { url: pathToFileURL(resolve(`dist/${mood}/index.html`)).href });
      await sleep(700); // boot + entry anims fresh

      const snap = (label) => send('Page.captureScreenshot', { format: 'png' });
      const s1 = await snap();
      writeFileSync(`${SHOTS}/${mood}-slide1.png`, Buffer.from(s1.data, 'base64'));
      // advance to slide 2
      await send('Runtime.evaluate', { expression: 'window.__s2sGo(1)' });
      await sleep(1000); // past whoosh; entry anim on slide 2
      const s2 = await snap();
      writeFileSync(`${SHOTS}/${mood}-slide2.png`, Buffer.from(s2.data, 'base64'));
      console.log(`saved ${mood}-slide1.png, ${mood}-slide2.png`);
    }
    chrome.kill(); ws.close();
  } catch (e) { console.error('SHOTS ERROR:', e.message); chrome.kill(); process.exit(2); }
}
main();