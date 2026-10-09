// The scenes of the two product videos and the run that records and cuts them. How it is recorded is in video-kit.mjs.
// Usage:  FFMPEG=/path/to/ffmpeg node video.mjs [desktop] [android] [--only=scene,scene] [--keep]
import { R, stage, clip, finish, cardScene, card, deskOverlay, phoneOverlay, folderAt, editing, settle, endOf, put, mcp, say, fakeRecognizer, fakeSynth, sleep, TMP, ONLY, KEEP, want, DESK, PHONE, FULL,
  PLAN, DAY, RESEARCH, VOICE, ZONES, PHONE_PLAN, PHONE_FLOW } from './video-kit.mjs';
import fs from 'fs';

const DISK = '.lmd-xroot[data-root=disk]'; const CLOUD = '.lmd-xroot[data-root=cloud]';
const hideSide = async (p) => { await p.click('[data-act=sidebar]'); await p.waitForSelector('.lmd-side-hidden'); await sleep(300); };
const article = (p, re) => p.waitForFunction((r) => new RegExp(r).test(document.querySelector('.lmd-article').textContent), re, { timeout: 30000 });
// A made-up account on the paid plan. A scene recorded twice gets a fresh one.
const used = {};
const account = (name) => { used[name] = (used[name] || 0) + 1; return R.signup(name + (used[name] > 1 ? '.' + used[name] : '') + '@ejemplo.test', true); };

// ---------- Desktop ----------
const DESKTOP = {
  // Typing on the formatted page: a paragraph, a task, a table cell.
  async edit(S) {
    const T = await S.take(null); const p = T.page;
    await folderAt(T, 'launch-plan.md'); await hideSide(p); await editing(p); await T.move(800, 480, 0); await sleep(300);
    await T.roll(); await T.wait(350);
    const para = p.locator('.lmd-article p', { hasText: 'What is left' });
    const d = await T.click(para, { pos: await endOf(para) }); await p.keyboard.press('Control+End'); await T.move(d.x + 60, d.y + 46, 200);
    await T.type(' We go live on Monday.', 38); await T.wait(300);
    await T.click(p.locator('.lmd-article li', { hasText: 'Test a purchase' }).locator('input.lmd-task')); await T.wait(500);
    const cell = p.locator('.lmd-article td', { hasText: 'In testing' });
    const c = await T.click(cell, { pos: await endOf(cell) }); await p.keyboard.press('End'); await T.move(c.x + 90, c.y + 44, 200);
    await T.type(', one bug left', 40); await T.wait(900);
    await T.hold(); await T.snap('d-edit');
    return [T];
  },
  // The diagram editor adds a step with a button; the formula has an editor of its own.
  async diagram(S) {
    const T = await S.take(null); const p = T.page;
    await folderAt(T, 'order-flow.md'); await p.waitForSelector('.lmd-diagram svg'); await p.waitForSelector('.lmd-math-block .katex'); await hideSide(p); await editing(p); await T.move(800, 480, 0); await sleep(300);
    await T.snap('d-diagram-0');
    await T.roll(); await T.wait(250);
    await T.click(p.locator('.lmd-diagram').first(), { ms: 380 }); await p.waitForSelector('.lmd-dgm-svg svg'); await T.wait(450);
    await T.snap('d-diagram-1');
    await T.click(p.locator('.lmd-dgm-add [data-piece="0"]'), { ms: 380 }); await T.wait(250);
    await T.type('Thank-you email', 30);
    await p.waitForFunction(() => /Thank-you email/.test(document.querySelector('.lmd-dgm-svg').textContent), null, { timeout: 8000 });
    await T.wait(600); await T.snap('d-diagram-2');
    await T.click(p.locator('[data-dgm=ok]'), { ms: 400 }); await p.waitForSelector('.lmd-dgm-card', { state: 'detached' }); await T.wait(350);
    await T.click(p.locator('.lmd-math-block').first(), { ms: 380 }); await p.waitForSelector('.lmd-fx .lmd-fx-keys .katex'); await T.wait(400);
    await T.over(p.locator('.lmd-fx [data-fx="0:1"]'), null, 400); await T.wait(800);
    await T.hold(); await T.snap('d-diagram-3');
    return [T];
  },
  // The folder in the explorer, with how many notes each one holds, and a file dragged into the note.
  async disk(S) {
    const T = await S.take(null); const p = T.page;
    await folderAt(T, 'checkout.md'); await editing(p); await T.move(760, 470, 0); await sleep(600);
    await T.snap('d-disk-0');
    await T.roll(); await T.wait(350);
    await T.over(p.locator(DISK + ' .lmd-node', { hasText: 'notes' }).first(), { x: 90, y: 14 }, 500); await T.wait(600);
    const file = p.locator(DISK + ' a.lmd-node', { hasText: 'shipping-zones.md' });
    await T.over(file, { x: 80, y: 14 }, 350); await T.wait(250); await p.mouse.down();
    const para = p.locator('.lmd-article p', { hasText: 'Prices by zone' }); const b = await para.boundingBox();
    // Between two blocks the drop mark is a line: the link lands in a paragraph of its own.
    await T.move(b.x + 140, b.y + b.height + 7, 900); await p.mouse.move(b.x + 142, b.y + b.height + 7, { steps: 2 }); T.cur.x += 2; await T.wait(450);
    await p.mouse.up(); await T.wait(350);
    await T.move(b.x + 420, b.y + 120, 400); await T.wait(1200);
    await T.hold(); await T.snap('d-disk-1');
    return [T];
  },
  // A note goes to the cloud with one click; then two people write in it at once.
  async cloud(S) {
    const who = await account('nora'); await put(who, 'welcome.md', '# Welcome\n\nYour notes in the cloud.\n');
    const T = await S.take(who); const p = T.page;
    await folderAt(T, 'launch-plan.md'); await p.waitForSelector('.lmd-sync.lmd-sync-off'); await T.move(760, 440, 0); await sleep(500);
    await T.snap('d-cloud-0');
    await T.roll(); await T.wait(250);
    await T.click(p.locator('.lmd-sync'), { ms: 380 }); await p.waitForSelector('[data-dlg=alt]'); await T.wait(500); await T.snap('d-cloud-1');
    await T.click(p.locator('[data-dlg=alt]'), { ms: 380 }); await p.waitForFunction(() => /f=cloud/.test(location.href), null, { timeout: 15000 });
    await p.waitForSelector(CLOUD + ' a.lmd-node.lmd-active'); await T.over(p.locator(CLOUD + ' a.lmd-node.lmd-active'), { x: 150, y: 14 }, 380); await T.wait(600);
    await T.hold(); await T.snap('d-cloud-2');
    // Off camera: the live session opens and a guest joins from another browser.
    await p.click('[data-act=sync]'); await p.click('.lmd-menu [data-s=live]'); await p.waitForSelector('.lmd-live-card [data-lv=name]');
    await p.fill('[data-lv=name]', 'Nora'); await p.click('[data-lv=start]'); await p.waitForSelector('.lmd-live-link input');
    const link = await p.inputValue('.lmd-live-link input'); await p.click('.lmd-live-card [data-lv=close]');
    const g = await R.open(null, { viewport: { width: 1024, height: 576 } });
    await g.page.goto(link); await g.page.waitForSelector('.lmd-live-card input'); await g.page.fill('.lmd-live-card input', 'Tomas'); await g.page.click('.lmd-live-card [data-lv=join]');
    await g.page.waitForSelector('.lmd-live-bar'); await g.page.waitForSelector('.lmd-article .lmd-editable');
    if (!(await p.locator('.lmd-editing').count())) await editing(p);
    await p.waitForFunction(() => /Tomas/.test(document.querySelector('.lmd-live-chip').title)); await hideSide(p);
    await g.page.locator('.lmd-article li', { hasText: 'Write the welcome email' }).click(); await g.page.keyboard.press('End');
    await T.move(800, 450, 0); await sleep(700);
    await T.roll(); await T.wait(200);
    const para = p.locator('.lmd-article p', { hasText: 'What is left' });
    const d = await T.click(para, { pos: await endOf(para), ms: 380 }); await p.keyboard.press('Control+End'); await T.move(d.x + 60, d.y + 46, 200);
    await Promise.all([
      g.page.keyboard.type(', with a discount code', { delay: 60 }),
      (async () => { await sleep(350); await p.keyboard.type(' Opening is on Monday.', { delay: 50 }); })(),
    ]);
    await article(p, 'discount code'); await T.wait(800);
    await T.hold(); await T.snap('d-cloud-3'); await g.ctx.close();
    return [T];
  },
  // Settings > AI gives the instructions to paste into an assistant; what the assistant writes shows up in the open note.
  async ai(S) {
    const who = await account('lia'); await put(who, 'customer-research.md', RESEARCH); await put(who, 'launch-plan.md', PLAN);
    const T = await S.take(who); const p = T.page;
    await p.goto(R.noteUrl('customer-research.md')); await p.waitForSelector('.lmd-article h1'); await p.waitForFunction(() => !!LMD.sync.account()); await settle(p); await T.move(760, 440, 0);
    await T.roll(); await T.wait(250);
    await T.click(p.locator('[data-act=settings]'), { ms: 380 }); await p.waitForSelector('.lmd-panel-card'); await T.wait(150);
    await T.click(p.locator('[data-ptab=ai]'), { ms: 360 }); await p.waitForSelector('[data-acct=ai] [data-c=token]'); await T.wait(350);
    // The token belongs to the throwaway local server and dies with it.
    await T.click(p.locator('[data-acct=ai] [data-c=token]'), { ms: 380 }); await T.wait(250);
    await T.click(p.locator('[data-acct=ai] [data-c=token-ok]'), { ms: 320 }); await p.waitForSelector('.lmd-ai-new'); await T.wait(450); await T.snap('d-ai-1');
    const token = await p.evaluate(() => [...document.querySelectorAll('[data-acct=ai] .lmd-field')].find((f) => f.querySelector('span').textContent === 'Token').querySelector('input').value);
    await T.click(p.locator('[data-acct=ai] [data-c=brief]'), { ms: 380 }); await T.wait(900); await T.snap('d-ai-2');
    const closed = Date.now();
    await p.click('[data-act=close-panel]'); await T.move(760, 330, 0);
    await mcp(token, 'append_note', { path: 'customer-research.md', text: '\n## Summary by your assistant\n\nShipping cost is the main doubt before buying. Show it on the product page and send a message when the order ships.\n' });
    await article(p, 'Summary by your assistant'); const seen = Date.now();
    await T.move(700, 420, 500); await T.wait(1300);
    await T.hold(); await T.snap('d-ai-3');
    // The wait for the note to refresh is cut out.
    const w = T.windows[T.windows.length - 1]; T.windows.push({ from: seen - 350, to: w.to }); w.to = closed;
    return [T];
  },
  // Settings > Tools turns on read aloud and dictation; dictating a flowchart draws it while you speak.
  async voice(S) {
    const T = await S.take(null, { init: [[fakeRecognizer], [fakeSynth]], storage: { 'mdtools:dictation': { consent: 1 } } }); const p = T.page;
    await p.goto(R.home); await p.waitForSelector('.lmd-home, .lmd-article');
    await p.evaluate((t) => LMD.store.notePut('returns.md', t), VOICE);
    await p.goto(R.home + '?f=' + encodeURIComponent('local/returns.md') + '&edit=1'); await p.waitForSelector('.lmd-editing .lmd-article'); await settle(p); await hideSide(p).catch(() => {}); await T.move(760, 440, 0);
    await p.click('[data-act=settings]'); await p.click('[data-ptab=tools]'); await p.waitForSelector('.lmd-tl-card'); await T.move(560, 330, 0); await sleep(400);
    await T.roll(); await T.wait(300);
    await T.click(p.locator('.lmd-tl-card[data-tool=speak] .lmd-switch'), { ms: 400 }); await T.wait(300);
    await T.click(p.locator('.lmd-tl-card[data-tool=dictate] .lmd-switch'), { ms: 320 }); await T.wait(750); await T.snap('d-voice-0');
    await T.hold();
    await p.waitForFunction(() => !!LMD.dictate && !!LMD.voice); await p.click('[data-act=close-panel]'); await sleep(300);
    const para = p.locator('.lmd-article .lmd-editable', { hasText: 'How a return' }).first();
    await para.click(); await p.keyboard.press('Control+End'); await p.keyboard.press('Enter'); await T.move(700, 420, 0); await sleep(300); await T.snap('d-voice-1');
    await T.roll(); await T.wait(150);
    await T.click(p.locator('.lmd-dct-mic')); await p.waitForFunction(() => !!document.querySelector('.lmd-dct-bar') && LMD.dictate.state().active); await T.wait(300);
    const nodes = (n) => p.waitForFunction((k) => document.querySelectorAll('.lmd-dct-view svg .node').length >= k, n, { timeout: 20000 });
    await say(p, 'flowchart start return requested'); await say(p, 'horizontal'); await nodes(1); await T.wait(400);
    await say(p, 'then check the item'); await nodes(2); await T.wait(400);
    await say(p, 'if it is unopened then refund the card else offer store credit'); await nodes(5); await T.wait(500); await T.snap('d-voice-2');
    await say(p, 'end diagram'); await p.waitForSelector('.lmd-article .lmd-diagram svg', { timeout: 15000 }); await T.move(720, 500, 450); await T.wait(1100); await T.snap('d-voice-3');
    await T.hold();
    return [T];
  },
};

// ---------- Phone ----------
// The app as it runs inside the Android app: ?src=android, which keeps purchase links out, on a phone-sized touch screen.
const PHONE_NOTES = { 'launch-plan.md': PHONE_PLAN, 'order-flow.md': PHONE_FLOW, 'opening-day.md': DAY, 'customer-research.md': RESEARCH };
async function phoneAt(S, who, url, o) {
  const T = await S.take(who, o); const p = T.page;
  await p.goto(R.home + '?src=android'); await p.waitForSelector('.lmd-home, .lmd-article');
  await p.evaluate((notes) => Promise.all(Object.keys(notes).map((n) => LMD.store.notePut(n, notes[n]))), PHONE_NOTES);
  await p.goto(url); await p.waitForSelector('.lmd-article h1'); await settle(p);
  return T;
}
const IDEAS = '# Ideas\n\nThings to try after the launch.\n\n## Soon\n\n- [x] Gift cards for the holidays\n- [ ] A page for wholesale orders\n- [ ] Free shipping over a minimum\n\n## Later\n\nA loyalty card with a stamp for every order.\n';
const local = (name, edit) => R.home + '?f=' + encodeURIComponent('local/' + name) + (edit ? '&edit=1' : '');
// Edit mode the way a person gets there, with the pencil. Leaves nothing open and waits for the hint in the footer to go.
async function phoneEdit(p) {
  await p.tap('[data-act=mode-edit]'); await p.waitForSelector('.lmd-article .lmd-editable'); await sleep(700);
  if (await p.locator('.lmd-menu').count()) { await p.keyboard.press('Escape'); await sleep(300); }
  await p.evaluate(() => { const a = document.activeElement; if (a && a.blur) a.blur(); });
  await p.waitForFunction(() => !document.querySelector('.lmd-foot .lmd-status').textContent.trim(), null, { timeout: 9000 }).catch(() => {});
  await sleep(300);
}
// A finger dragging the page up, with the ring following it.
async function swipeUp(T, by, ms) {
  const p = T.page; const x = 230; const y0 = 560; const t0 = Date.now();
  await T.ring(x, y0);
  const from = await p.evaluate(() => window.scrollY);
  for (;;) { const k = Math.min(1, (Date.now() - t0) / ms); const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; await p.evaluate((y) => window.scrollTo(0, y), from + by * e); if (k >= 1) break; await sleep(12); }
}
const ANDROID = {
  // A tap on a paragraph puts the cursor in it; a tap on a task ticks it.
  async edit(S) {
    const T = await phoneAt(S, null, local('launch-plan.md')); const p = T.page;
    await phoneEdit(p); await T.snap('a-edit-0');
    await T.roll(); await T.wait(450);
    const para = p.locator('.lmd-article p', { hasText: 'Next review' });
    await T.tap(para, await endOf(para)); await p.keyboard.press('Control+End'); await T.wait(350);
    await T.type(' Bring the numbers.', 50); await T.wait(450);
    await T.tap(p.locator('.lmd-article li', { hasText: 'Test a purchase' }).locator('input.lmd-task')); await T.wait(1200);
    await T.hold(); await T.snap('a-edit-1');
    return [T];
  },
  // The side panel lists the notes; a tap opens another one.
  async notes(S) {
    const T = await phoneAt(S, null, local('launch-plan.md')); const p = T.page;
    await T.snap('a-notes-0');
    await T.roll(); await T.wait(400);
    await T.tap(p.locator('[data-act=sidebar]')); await p.waitForSelector('.lmd-side-open'); await T.wait(1300); await T.snap('a-notes-1');
    await T.tap(p.locator('.lmd-sidebar .lmd-node', { hasText: 'customer-research.md' }).first()); await article(p, 'What we heard'); await T.wait(1500);
    await T.hold(); await T.snap('a-notes-2');
    return [T];
  },
  // A diagram and a table fit the small screen.
  async blocks(S) {
    const T = await phoneAt(S, null, local('order-flow.md')); const p = T.page;
    await p.waitForSelector('.lmd-diagram svg'); await phoneEdit(p); await T.snap('a-blocks-0');
    await T.roll(); await T.wait(1300);
    const table = await p.locator('.lmd-article table').boundingBox();
    await swipeUp(T, Math.max(120, table.y + table.height - 520), 800); await T.wait(450);
    const cell = p.locator('.lmd-article td', { hasText: 'Region' }).locator('xpath=following-sibling::td[1]');
    await T.tap(cell); await p.keyboard.press('Control+A'); await T.wait(350); await T.type('8', 60); await T.wait(1300);
    await T.hold(); await T.snap('a-blocks-1');
    return [T];
  },
  // Without a network the app says so and the note keeps taking text.
  async offline(S) {
    // A cloud note, so the footer says what happens to what is typed.
    const who = await account('lia'); await put(who, 'opening-day.md', DAY);
    const T = await phoneAt(S, who, R.noteUrl('opening-day.md')); const p = T.page;
    await p.waitForFunction(() => !!LMD.sync.account()); await phoneEdit(p); await sleep(400);
    await T.roll(); await T.wait(450);
    await T.ctx.setOffline(true); await T.wait(1000); await T.snap('a-offline-0');
    const item = p.locator('.lmd-article li', { hasText: 'Tomas:' });
    await T.tap(item, await endOf(item)); await p.keyboard.press('End'); await T.wait(300);
    await T.type(' card reader works', 55); await T.wait(500);
    // The save has to fail before the footer says so: that wait is cut out.
    const typed = Date.now();
    await p.waitForFunction(() => /Offline/.test(document.querySelector('.lmd-foot').textContent), null, { timeout: 30000 }); const seen = Date.now();
    await T.wait(1700);
    await T.hold(); await T.snap('a-offline-1'); await T.ctx.setOffline(false);
    const w = T.windows[T.windows.length - 1]; if (seen - typed > 500) { T.windows.push({ from: seen - 250, to: w.to }); w.to = typed; }
    return [T];
  },
  // Signed in, the cloud notes are in the same list.
  async sync(S) {
    const who = await account('ines'); await put(who, 'shop/launch-plan.md', PHONE_PLAN); await put(who, 'shop/shipping-zones.md', ZONES); await put(who, 'ideas.md', IDEAS);
    const T = await phoneAt(S, who, local('launch-plan.md')); const p = T.page;
    await p.waitForFunction(() => !!LMD.sync.account()); await sleep(400);
    await T.roll(); await T.wait(400);
    await T.tap(p.locator('[data-act=sidebar]')); await p.waitForSelector('.lmd-side-open'); await T.wait(1500); await T.snap('a-sync-0');
    await T.tap(p.locator('.lmd-xroot[data-root=cloud] a.lmd-node', { hasText: 'ideas.md' })); await article(p, 'Gift cards'); await T.wait(1500);
    await T.hold(); await T.snap('a-sync-1');
    return [T];
  },
};

// ---------- The run ----------
const VIDEOS = [
  { name: 'desktop', file: 'sharpmd-desktop', geo: DESK, overlay: deskOverlay, set: DESKTOP, crf: 18, poster: 8.4,
    open: card('<h1>Edit Markdown <b>without writing Markdown.</b></h1>'), close: card('<h1>sharpmd.app</h1><p><b>Free and open source</b></p>'),
    scenes: [['edit', 'Click and type'], ['diagram', 'Diagrams and math, with their own editors'], ['disk', 'Your files stay on your disk'], ['cloud', 'Cloud when you want it'], ['ai', 'Your AI on the same notes'], ['voice', 'Read aloud and dictation']] },
  { name: 'android', file: 'sharpmd-android', geo: PHONE, overlay: phoneOverlay, set: ANDROID, crf: 18, poster: 6.4,
    open: card('<h1>Edit Markdown <b>without writing Markdown.</b></h1>'), close: card('<h1>SharpMD</h1><p>Your notes, <b>formatted as you write</b></p>'),
    scenes: [['edit', 'Edit on the formatted page'], ['notes', 'Your notes, on the phone'], ['blocks', 'Diagrams and tables'], ['offline', 'Works without a connection'], ['sync', 'Sync when you sign in']] },
];

let failed = null;
try {
  const cards = await stage(FULL, false);
  for (const V of VIDEOS) {
    if (!want(V.name)) continue;
    console.log(V.name);
    const S = await stage(V.geo, V.geo === PHONE); const clips = [];
    const pick = (id) => !ONLY.length || ONLY.includes(id);
    if (pick('open')) clips.push(await clip(V.name + '-0-open', await cardScene(cards, V.open, 2900), FULL, null));
    let i = 0;
    for (const [id, label] of V.scenes) {
      i++; if (!pick(id)) continue;
      let takes = null;
      // A scene that trips on timing gets a second try before giving up.
      for (let tryN = 1; !takes; tryN++) { try { takes = await V.set[id](S); } catch (e) { if (S.last) await S.last.snap('fail-' + id); console.log('  ' + id + ' failed (try ' + tryN + '): ' + String(e.message).split('\n')[0]); if (tryN >= (ONLY.length ? 1 : 2)) throw e; } }
      clips.push(await clip(V.name + '-' + i + '-' + id, takes, V.geo, V.overlay(label)));
    }
    if (pick('close')) clips.push(await clip(V.name + '-9-close', await cardScene(cards, V.close, 3000), FULL, null));
    if (!ONLY.length) finish(clips, V.file, V.crf, V.poster);
  }
  if (R.errors.length) console.log('page errors:', R.errors);
  console.log(R.outside.length ? 'requests cut off on their way to sharpmd.app: ' + [...new Set(R.outside)].join(', ') : 'no request left for sharpmd.app');
} catch (e) { failed = e; console.error(e); }
await R.close();
if (!KEEP && !ONLY.length && !failed) fs.rmSync(TMP, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
