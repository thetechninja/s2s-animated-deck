#!/usr/bin/env node
/* ============================================================================
   verify-player.mjs — drive the REAL generated deck in headless Chrome via
   the DevTools Protocol and assert the custom player lifecycle.

   Checks:
     1. player.js boots with ZERO JS errors (Runtime.exceptionThrown / console.error).
     2. slide 1 lands `.is-active` and its `data-anim` elements carry `anim-*`.
     3. On programmatic next (`__s2sGo(1)`), the outgoing slide gets
        `.is-exit-left` (whoosh out); after --t-out, `.is-active` moves to slide 2
        and exit classes are cleared.
     4. A real ArrowLeft keydown round-trips back to slide 1.
     5. `window.__s2sGo` (the programmatic choke-point) is exposed.

   Usage: node scripts/verify-player.mjs [path/to/index.html]
   Exit 0 iff all checks pass.
   ============================================================================ */
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DECK = process.argv[2] ? resolve(process.argv[2]) : resolve('dist/calm/index.html');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

async function openCdp(port) {
  // Connect to a PAGE target (supports Runtime.evaluate / Page.*), not the
  // browser-level endpoint (/json/version).
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* retry */ }
    await sleep(100);
  }
  throw new Error('No page DevTools target came up');
}

async function main() {
  const port = 9300 + Math.floor(Math.random() * 200);
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=/tmp/s2s-verify-${process.pid}`,
    'about:blank',
  ], { stdio: 'ignore' });

  const jsErrors = [];
  try {
    const ws = new WebSocket(await openCdp(port));
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

    let id = 0;
    const pending = new Map();
    const events = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const res = pending.get(msg.id);
        pending.delete(msg.id);
        res(msg.error ?? msg.result);
        return;
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        jsErrors.push(msg.params.exceptionDetails?.text || 'exception');
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        jsErrors.push(`console.error: ${msg.params.args?.[0]?.value || ''}`);
      }
      events.push(msg);
    };
    const send = (method, params = {}) => new Promise((res) => {
      const mid = ++id; pending.set(mid, res);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
    const evalJS = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r?.error) throw new Error('CDP error: ' + JSON.stringify(r.error));
      if (r?.exceptionDetails) throw new Error('eval threw: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      return r?.result?.value;
    };

    await send('Runtime.enable');
    await send('Page.enable');

    // navigate and wait for load
    const navDone = new Promise((res) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (events.some((m) => m.method === 'Page.loadEventFired')) { clearInterval(iv); res(); }
        else if (Date.now() - t0 > 15000) { clearInterval(iv); res(); } // timeout, don't hang
      }, 50);
    });
    await send('Page.navigate', { url: pathToFileURL(DECK).href });
    await navDone;
    await sleep(400); // entry anims (calm T-in=1000ms) are actively applied here

    // ---- 1 & 2: boot, active slide, entry anims, choke-point ----
    check('boots with no JS errors', jsErrors.length === 0, jsErrors.join(' | ') || 'clean');
    const boot = await evalJS(`(function(){
      const slides=[...document.querySelectorAll('.slide')];
      const activeIdx = slides.findIndex(s=>s.classList.contains('is-active'));
      const animCount = slides[0].querySelectorAll('.anim-fade-up,.anim-rise-in,.anim-fade-down').length;
      return { total: slides.length, activeIdx, animCount, hasGo: typeof window.__s2sGo==='function' };
    })()`);
    check('slide 1 is .is-active on boot', boot.activeIdx === 0, `activeIdx=${boot.activeIdx}`);
    check('player exposes __s2sGo choke-point', boot.hasGo === true);
    check('entry anim-* classes on slide 1', boot.animCount > 0, `count=${boot.animCount}`);
    check('deck has 5 slides', boot.total === 5, `total=${boot.total}`);

    // ---- 3: next -> whoosh out then active swap ----
    await evalJS(`window.__s2sGo(1);`);
    await sleep(120);
    const mid = await evalJS(`[...document.querySelectorAll('.slide')][0].classList.contains('is-exit-left')`);
    check('whoosh-out (.is-exit-left) fires on outgoing slide', mid === true);

    await sleep(1300); // calm T-out = 900ms -> active swapped; entry anim freshly on slide 2
    const after = await evalJS(`(function(){
      const slides=[...document.querySelectorAll('.slide')];
      const s2anims=[...slides[1].querySelectorAll('[data-anim]')].map(e=>e.className+' | data-anim='+e.getAttribute('data-anim'));
      return { activeIdx: slides.findIndex(s=>s.classList.contains('is-active')),
               exitCleared: slides.every(s=>!s.classList.contains('is-exit-left')&&!s.classList.contains('is-exit-right')),
               animRetrigger: slides[1].querySelectorAll('.anim-fade-up,.anim-rise-in,.anim-fade-down').length,
               s2anims,
               bar: document.getElementById('bar-fill').style.transform };
    })()`);
    check('.is-active moves to slide 2', after.activeIdx === 1, `activeIdx=${after.activeIdx}`);
    check('exit classes cleared after T_OUT', after.exitCleared === true);
    check('entry anim retriggered on slide 2', after.animRetrigger > 0, `count=${after.animRetrigger} s2anims=${JSON.stringify(after.s2anims)}`);
    check('progress bar advances', /scaleY/.test(after.bar), after.bar);

    // ---- 4: back via real keydown (the actual clicker path) ----
    await evalJS(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}))`);
    await sleep(1300);
    const back = await evalJS(`[...document.querySelectorAll('.slide')].findIndex(s=>s.classList.contains('is-active'))`);
    check('ArrowLeft keydown round-trips to slide 1', back === 0, `activeIdx=${back}`);

    check('no JS errors across full navigation', jsErrors.length === 0, jsErrors.join(' | ') || 'clean');

    chrome.kill(); ws.close();
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n== ${results.length - failed}/${results.length} checks passed ==`);
    process.exit(failed ? 1 : 0);
  } catch (e) {
    console.error('HARNESS ERROR:', e.message);
    chrome.kill();
    process.exit(2);
  }
}

main();