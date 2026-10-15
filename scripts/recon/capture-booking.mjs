// Repair of the interrupted Claude capture. Targets observed widget rows and
// the selected-time cart control; a verified cart response gates completion.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findAvailableSlotRows, findBookingCartButton, getSuccessfulCartCapture } from './booking-dom.mjs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
let PORT;
const TARGET_URL = 'https://yogababble.myshopify.com/products/glo-meditation-30-minutes';
const OUT_DIR = fileURLToPath(new URL('../../docs/recon/', import.meta.url));
mkdirSync(OUT_DIR, { recursive: true });
let activeChrome = null;
let activeWs = null;
const watchdog = setTimeout(() => {
  activeWs?.close();
  activeChrome?.kill();
  console.error('FATAL: capture exceeded 120 seconds; no completion is claimed');
  process.exit(1);
}, 120000);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForEndpoint(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {}
    await sleep(200);
  }
  throw new Error('endpoint not ready: ' + url);
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const l of this.listeners) l(msg.method, msg.params);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('CDP call timed out: ' + method));
        }
      }, 15000);
    });
  }
  on(fn) { this.listeners.push(fn); }
}

function walkFind(node, predicate, results = []) {
  if (!node) return results;
  if (predicate(node)) results.push(node);
  if (node.children) for (const c of node.children) walkFind(c, predicate, results);
  if (node.shadowRoots) for (const sr of node.shadowRoots) walkFind(sr, predicate, results);
  if (node.contentDocument) walkFind(node.contentDocument, predicate, results);
  if (node.pseudoElements) for (const p of node.pseudoElements) walkFind(p, predicate, results);
  return results;
}

function textOf(node) {
  let s = '';
  if (node.nodeType === 3 && node.nodeValue) s += node.nodeValue;
  if (node.children) for (const c of node.children) s += textOf(c);
  return s;
}

function attr(node, name) {
  if (!node.attributes) return null;
  const i = node.attributes.indexOf(name);
  return i === -1 ? null : node.attributes[i + 1];
}

async function main() {
  const profileDir = mkdtempSync(path.join(tmpdir(), 'cdp-profile-'));
  console.log('launching chrome, profile:', profileDir);
  const chrome = activeChrome = spawn(CHROME, [
    '--remote-debugging-port=0',
    '--headless=new',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore', detached: false, windowsHide: true });

  const requests = new Map();
  let cdp = null;
  try {
    const endpointStart = Date.now();
    while (!PORT && Date.now() - endpointStart < 10000) {
      try { PORT = Number(readFileSync(path.join(profileDir, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch {}
      if (!PORT) await sleep(200);
    }
    if (!PORT) throw new Error('Isolated Chrome did not expose a debugging endpoint');
    const version = await waitForEndpoint(`http://127.0.0.1:${PORT}/json/version`, 10000);
    console.log('chrome ready:', version.Browser);

    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const pageTarget = targets.find(t => t.type === 'page');
    if (!pageTarget) throw new Error('no page target found');
    console.log('attaching to:', pageTarget.webSocketDebuggerUrl);

    const ws = activeWs = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', reject);
    });
    cdp = new CDP(ws);


    cdp.on((method, params) => {
      if (method === 'Network.requestWillBeSent') {
        requests.set(params.requestId, {
          url: params.request.url,
          method: params.request.method,
          postData: params.request.postData || null,
          hasPostData: !!params.request.hasPostData,
          resourceType: params.type,
        });
      } else if (method === 'Network.responseReceived') {
        const r = requests.get(params.requestId);
        if (r) { r.status = params.response.status; r.mimeType = params.response.mimeType; }
      } else if (method === 'Network.loadingFinished') {
        const r = requests.get(params.requestId);
        if (r) r.finished = true;
      }
    });

    await cdp.send('Network.enable');
    await cdp.send('Page.enable');
    await cdp.send('DOM.enable');
    await cdp.send('Runtime.enable');

    console.log('navigating to', TARGET_URL);
    await cdp.send('Page.navigate', { url: TARGET_URL });
    await sleep(3500);

    async function getFlatTree() {
      const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
      return root;
    }
    async function waitForTree(predicate, { timeoutMs = 15000, intervalMs = 700, label = '' } = {}) {
      const start = Date.now();
      let lastRoot = null;
      while (Date.now() - start < timeoutMs) {
        lastRoot = await getFlatTree();
        const found = predicate(lastRoot);
        if (found) return { root: lastRoot, found };
        await sleep(intervalMs);
      }
      console.log(`WARNING: waitForTree timed out after ${timeoutMs}ms waiting for: ${label}`);
      return { root: lastRoot, found: null };
    }
    async function clickByBackendNodeId(backendNodeId) {
      const { object } = await cdp.send('DOM.resolveNode', { backendNodeId });
      const res = await cdp.send('Runtime.callFunctionOn', {
        objectId: object.objectId,
        functionDeclaration: 'function(){ this.scrollIntoView({block:"center"}); this.click(); return this.tagName; }',
      });
      if (res.exceptionDetails) {
        throw new Error('DOM click failed: ' + (res.exceptionDetails.text || 'exception'));
      }
      await cdp.send('Runtime.releaseObject', { objectId: object.objectId }).catch(()=>{});
    }
    async function findButtonByText(matchFn) {
      const root = await getFlatTree();
      const buttons = walkFind(root, n => n.nodeName === 'BUTTON');
      for (const b of buttons) {
        const t = textOf(b).trim();
        if (matchFn(t, b)) return b;
      }
      return null;
    }
    // Step 1: dismiss the "Easy Appointment Booking" marketing notice (top document, aria-label=Close)
    let { root, found: closeBtn } = await waitForTree(
      r => walkFind(r, n => n.nodeName === 'BUTTON' && attr(n, 'aria-label') === 'Close')[0] || null,
      { label: 'notice close button' });
    console.log('notice close button found:', !!closeBtn);
    if (closeBtn) {
      await clickByBackendNodeId(closeBtn.backendNodeId);
      console.log('dismissed notice modal');
    }

    // Step 2: click "Select a time" (top document button, known class servicify-select-a-time-button)
    const sel2 = await waitForTree(
      r => walkFind(r, n => n.nodeName === 'BUTTON' && (attr(n, 'class') || '').includes('servicify-select-a-time-button'))[0]
        || walkFind(r, n => n.nodeName === 'BUTTON' && textOf(n).trim() === 'Select a time')[0]
        || null,
      { label: 'Select a time button' });
    if (!sel2.found) throw new Error('could not find Select a time button');
    await clickByBackendNodeId(sel2.found.backendNodeId);
    console.log('clicked Select a time');
    await sleep(1500);

    // Step 3: dismiss the "Got it" tour coachmark if present (also top document per earlier capture)
    const gotIt = await findButtonByText(t => t === 'Got it');
    if (gotIt) {
      await clickByBackendNodeId(gotIt.backendNodeId);
      console.log('dismissed Got it coachmark');
      await sleep(600);
    } else {
      console.log('no Got it coachmark found (may not have appeared this run)');
    }

    // Step 4: find only rows inside the observed slot container.
    const slotWait = await waitForTree(
      r => findAvailableSlotRows(r)[0] || null,
      { label: 'real available time-slot row', timeoutMs: 12000 });
    root = slotWait.root;
    if (!slotWait.found) throw new Error('No available time-slot row found; confirmation was not attempted');
    writeFileSync(path.join(OUT_DIR, 'retry-popup-dom.json'), JSON.stringify(root));
    const slotBtn = slotWait.found;
    console.log('clicking actual time row:', textOf(slotBtn).trim());
    await clickByBackendNodeId(slotBtn.backendNodeId);

    const selection = await waitForTree(
      r => findBookingCartButton(r),
      { label: 'selected-time widget Add to Cart button', timeoutMs: 8000 });
    if (!selection.found) throw new Error('Slot selection did not change the UI; confirmation was not attempted');

    // Step 5: require the widget confirmation button in its own current container.
    root = selection.root;
    writeFileSync(path.join(OUT_DIR, 'retry-selected-dom.json'), JSON.stringify(root));
    const bookBtn = findBookingCartButton(root);
    if (!bookBtn) throw new Error('Enabled widget Add to Cart button not found; floating and native theme buttons were not clicked');
    await clickByBackendNodeId(bookBtn.backendNodeId);
    const cartWaitStart = Date.now();
    while (Date.now() - cartWaitStart < 15000) {
      const cart = [...requests.values()].find(r => r.method === 'POST'
        && /^https:\/\/yogababble\.myshopify\.com\/(?:[^?#]*\/)?cart\/add\.js(?:[?#]|$)/.test(r.url)
        && r.finished);
      if (cart) break;
      await sleep(250);
    }

    // Fetch response bodies for requests to the app's own backend / Shopify
    // cart endpoints (skip static assets/images/fonts/analytics noise).
    const interesting = Array.from(requests.entries()).filter(([id, r]) =>
      r.finished && /herokuapp\.com|\/cart\/|\/api\/|checkout/i.test(r.url) &&
      !/\.(png|jpg|jpeg|gif|svg|woff2?|css)(\?|$)/i.test(r.url));
    console.log('interesting finished requests:', interesting.length);
    for (const [id, r] of interesting) {
      try {
        const body = await cdp.send('Network.getResponseBody', { requestId: id });
        r.responseBody = body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body;
      } catch (e) {
        r.responseBodyError = String(e.message || e);
      }
    }

    // Dump ALL captured network requests (metadata + inline postData + bodies for interesting ones)
    const reqArr = Array.from(requests.entries()).map(([id, r]) => ({ id, ...r }));
    writeFileSync(path.join(OUT_DIR, 'retry-network-requests.json'), JSON.stringify(reqArr, null, 2));
    console.log('total network requests captured:', reqArr.length);

    const cartCapture = getSuccessfulCartCapture(reqArr);
    if (!cartCapture) throw new Error('No verified successful booking cart request/response was captured');
    writeFileSync(path.join(OUT_DIR, 'booking-cart-capture.json'), JSON.stringify(cartCapture, null, 2));
    console.log('VERIFIED: booking cart request and matching response captured; checkout was not submitted');
  } catch (error) {
    writeFileSync(path.join(OUT_DIR, 'retry-network-requests.json'), JSON.stringify([...requests.entries()].map(([id, r]) => ({ id, ...r })), null, 2));
    writeFileSync(path.join(OUT_DIR, 'retry-failure.json'), JSON.stringify({ complete: false, error: String(error.message || error) }, null, 2));
    throw error;
  } finally {
    if (cdp) await cdp.send('Browser.close').catch(() => {});
    activeWs?.close();
    chrome.kill();
    clearTimeout(watchdog);
    await sleep(500);
  }
}

main().then(() => { console.log('DONE'); process.exit(0); }).catch(e => { console.error('FATAL', e); process.exit(1); });
