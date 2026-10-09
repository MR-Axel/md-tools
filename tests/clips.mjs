// What the landing page shows next to its text: short looping clips and still frames of the real app, over made-up content.
// Each one shows exactly what the section beside it says, and nothing else as the main thing. If the text of a section
// changes, its clip changes with it: the table at the bottom says which section each one belongs to.
//
// Usage:  FFMPEG=/path/to/ffmpeg node clips.mjs [name name ...]
//   FFMPEG       an ffmpeg with libx264 and libvpx-vp9 (`npm install ffmpeg-static` in a folder outside the repository)
//   VIDEO_TMP    scratch folder (default: the system temp folder)
//   CLIPS_REVIEW a folder that gets a few frames of every clip, to look at them before committing
//
// It records the way video-kit.mjs does (the DevTools screencast, so small text stays sharp), with the dark theme and the
// interface in English. Clips come out as MP4 (H.264, the one Safari plays) and WebM (VP9) with a JPG poster; stills as JPG.
// tests/smoke.mjs holds the weight limits: under 500 KB per clip and under 4 MB for all of them. Not part of `npm test`.
import { R, stage, clip, folderAt, editing, settle, endOf, put, mcp, sleep, TMP, PLAN, DAY, ZONES } from './video-kit.mjs';
import { root } from './rig.mjs';
import { spawnSync } from 'child_process';
import fs from 'fs'; import path from 'path';

const FFMPEG = process.env.FFMPEG;
const OUT = path.join(root, 'docs', 'clips'); fs.mkdirSync(OUT, { recursive: true });
const REVIEW = process.env.CLIPS_REVIEW || ''; if (REVIEW) fs.mkdirSync(REVIEW, { recursive: true });
const want = process.argv.slice(2).filter((a) => !a.startsWith('--'));
// The size the clips are shown at, recorded at one and a half times that so the text is drawn with more pixels.
const GEO = { w: 880, h: 550, dsf: 1.5, x: 0, y: 0, outW: 880, outH: 550 };
const run = (a) => { const r = spawnSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...a], { encoding: 'utf8' }); if (r.status !== 0) throw new Error('ffmpeg: ' + (r.stderr || r.error)); };
const kb = (f) => Math.round(fs.statSync(path.join(OUT, f)).size / 1024);
const DISK = '.lmd-xroot[data-root=disk]'; const CLOUD = '.lmd-xroot[data-root=cloud]';
const hideSide = async (p) => { await p.click('[data-act=sidebar]'); await p.waitForSelector('.lmd-side-hidden'); await sleep(300); };
const article = (p, re) => p.waitForFunction((r) => new RegExp(r).test(document.querySelector('.lmd-article').textContent), re, { timeout: 30000 });
const used = {};
const account = (name) => { used[name] = (used[name] || 0) + 1; return R.signup(name + (used[name] > 1 ? '.' + used[name] : '') + '@ejemplo.test', true); };
const token = async (who, body) => (await R.api('POST', '/tokens', Object.assign({ name: 'AI' }, body || {}), who.s)).json.token;
const cloudNote = async (T, who, name) => { const p = T.page; await p.goto(R.noteUrl(name)); await p.waitForSelector('.lmd-article h1'); await p.waitForFunction(() => !!LMD.sync.account()); await settle(p); };
// A wait the viewer should not sit through (the app noticing a change made from outside) is cut out of the take.
const skip = (T, from, to) => { const w = T.windows[T.windows.length - 1]; if (to - from > 500) { T.windows.push({ from: to - 300, to: w.to }); w.to = from; } };

// Turns a take into the three files of a clip.
async function film(name, takes) {
  const mid = await clip('clip-' + name, takes, GEO, null);
  const vf = 'fps=24';
  run(['-i', mid.file, '-an', '-vf', vf, '-c:v', 'libx264', '-preset', 'veryslow', '-crf', '26', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-movflags', '+faststart', '-g', '240', path.join(OUT, name + '.mp4')]);
  run(['-i', mid.file, '-an', '-vf', vf, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '36', '-deadline', 'good', '-cpu-used', '1', '-row-mt', '1', '-g', '240', path.join(OUT, name + '.webm')]);
  run(['-i', mid.file, '-frames:v', '1', '-q:v', '5', path.join(OUT, name + '.jpg')]);
  if (REVIEW) { fs.readdirSync(REVIEW).filter((f) => f.startsWith(name + '-')).forEach((f) => fs.rmSync(path.join(REVIEW, f))); run(['-i', mid.file, '-vf', 'fps=1/1.5', '-q:v', '4', path.join(REVIEW, name + '-%02d.jpg')]); }
  console.log(name + ': ' + mid.secs.toFixed(1) + ' s · mp4 ' + kb(name + '.mp4') + ' KB · webm ' + kb(name + '.webm') + ' KB · poster ' + kb(name + '.jpg') + ' KB');
}
// A still: what the window shows right now, at the size of the clips.
async function still(name, T) {
  await sleep(350); await T.page.evaluate(() => { const c = document.getElementById('vid-pointer'); if (c) c.style.display = 'none'; });
  const raw = path.join(TMP, name + '.png'); await T.page.screenshot({ path: raw }); await T.close();
  run(['-i', raw, '-vf', 'scale=1100:-2:flags=lanczos', '-q:v', '4', path.join(OUT, name + '.jpg')]);
  if (REVIEW) fs.copyFileSync(path.join(OUT, name + '.jpg'), path.join(REVIEW, name + '.jpg'));
  console.log(name + ': still · ' + kb(name + '.jpg') + ' KB');
}

const HERO = `# Launch plan

What is left before the online store opens.

- [x] Photos of the twelve products
- [x] Shipping prices by zone
- [ ] Test a purchase with a real card
`;
const COMMENTED = `# Launch plan

We go live on Monday the 19th, with the checkout open from the phone.

The reminder goes out by email the day before.

| Task | Owner |
|---|---|
| Checkout | Tomas |
| Newsletter | Lia |
`;
const INDEX = `# Shop

The online store, and what was decided along the way. Read this first.

## Notes

- [Decisions](decisions.md): what was chosen, and why
- [Work log](log.md): what changed, by date
- [Checkout](checkout.md): the three steps and what each one needs

## Conventions

- Prices are stored without tax
- Every change to the checkout gets a line in the work log
`;
const DECISIONS = '# Decisions\n\n| Date | Decision | Why |\n|---|---|---|\n| Oct 2 | One page checkout | Fewer people leave halfway |\n| Oct 5 | Shipping price shown in the cart | Asked for in three of five calls |\n';
const LOG = '# Work log\n\n- Oct 6: checkout moved to one page\n- Oct 7: shipping price added to the cart\n';

// name: [the section of the landing page it sits next to, what it shows]
const SCENES = {
  // Top of the page: you type on the formatted page, and what an AI wrote arrives in the same note.
  async hero(S) {
    const who = await account('nora'); await put(who, 'launch-plan.md', HERO); const tk = await token(who);
    const T = await S.take(who); const p = T.page;
    await cloudNote(T, who, 'launch-plan.md'); await hideSide(p); await editing(p); await T.move(700, 470, 0); await sleep(400);
    await T.roll(); await T.wait(350);
    const para = p.locator('.lmd-article p', { hasText: 'What is left' });
    const d = await T.click(para, { pos: await endOf(para) }); await p.keyboard.press('Control+End'); await T.move(d.x + 70, d.y + 50, 200);
    await T.type(' We go live on **Monday**.', 42); await T.wait(900);
    const typed = Date.now();
    // Off camera: the note is saved and the AI, over MCP, adds its part.
    await p.keyboard.press('Control+s'); await sleep(900); await p.click('[data-act=mode-read]'); await sleep(900);
    await mcp(tk, 'append_note', { path: 'launch-plan.md', text: '\n## Status, written by your AI\n\nThe checkout passes with the test card. One thing is left: the shipping price does not show in the cart.\n' });
    await article(p, 'written by your AI'); const seen = Date.now();
    await T.move(640, 430, 500); await T.wait(2200);
    await T.hold(); skip(T, typed, seen);
    await film('hero', [T]);
  },
  // "Diagrams with the drawing next to the code": a step added with a button shows up in the drawing.
  async diagram(S) {
    const T = await S.take(null); const p = T.page;
    await folderAt(T, 'order-flow.md'); await p.waitForSelector('.lmd-diagram svg'); await hideSide(p); await editing(p); await T.move(700, 470, 0); await sleep(300);
    await T.roll(); await T.wait(300);
    await T.click(p.locator('.lmd-diagram').first(), { ms: 420 }); await p.waitForSelector('.lmd-dgm-svg svg'); await T.wait(700);
    await T.click(p.locator('.lmd-dgm-add [data-piece="0"]'), { ms: 420 }); await T.wait(250);
    await T.type('Thank-you email', 45);
    await p.waitForFunction(() => /Thank-you email/.test(document.querySelector('.lmd-dgm-svg').textContent), null, { timeout: 8000 });
    await T.wait(2000);
    await T.hold(); await film('diagram', [T]);
  },
  // "The whole folder, searchable": a folder from the disk in the sidebar, with its note counts, and a search across every file.
  async folder(S) {
    const T = await S.take(null); const p = T.page;
    await folderAt(T, 'launch-plan.md'); await T.move(620, 460, 0); await sleep(500);
    await T.roll(); await T.wait(400);
    await T.click(p.locator(DISK + ' .lmd-node', { hasText: 'notes' }).first(), { pos: { x: 70, y: 14 }, ms: 500 }); await T.wait(900);
    await T.click(p.locator(DISK + ' .lmd-node', { hasText: 'suppliers' }).first(), { pos: { x: 80, y: 14 }, ms: 400 }); await T.wait(900);
    await T.click(p.locator('.lmd-search input'), { ms: 450 }); await T.wait(200);
    await T.type('shipping', 70); await p.waitForSelector('.lmd-results-sum'); await T.wait(900);
    await T.move(150, 330, 500); await T.wait(1700);
    await T.hold(); await film('folder', [T]);
  },
  // "Comments it resolves": a comment on a paragraph asks for a change, the AI makes it and closes the comment.
  async ai(S) {
    const who = await account('lia'); await put(who, 'launch-plan.md', COMMENTED); const tk = await token(who);
    const T = await S.take(who); const p = T.page;
    await cloudNote(T, who, 'launch-plan.md'); await hideSide(p); await p.waitForFunction(() => LMD.comments.mode() === 'on'); await T.move(700, 470, 0); await sleep(400);
    await T.roll(); await T.wait(350);
    const para = p.locator('.lmd-article > p', { hasText: 'We go live' });
    const d = await T.over(para, { x: 210, y: 12 }, 450); await p.mouse.click(d.x, d.y, { button: 'right' }); await p.waitForSelector('.lmd-menu [data-read=comment]'); await T.wait(450);
    await T.click(p.locator('.lmd-menu [data-read=comment]'), { ms: 320 }); await p.waitForSelector('.lmd-cm-pop textarea'); await T.wait(300);
    await T.type('Move it to Tuesday the 20th.', 40); await T.wait(350);
    await T.click(p.locator('.lmd-cm-pop [data-cm=send]'), { ms: 320 }); await p.waitForSelector('.lmd-cm-mark'); await T.move(640, 420, 400); await T.wait(900);
    const sent = Date.now();
    // Off camera: the AI reads the comment over MCP, makes the change and closes it.
    const open = JSON.parse((await mcp(tk, 'list_comments', { path: 'launch-plan.md' })).content[0].text);
    await mcp(tk, 'write_note', { path: 'launch-plan.md', text: COMMENTED.replace('Monday the 19th', 'Tuesday the 20th') });
    await mcp(tk, 'resolve_comment', { id: open[0].id, reply: 'Done: the launch moved to Tuesday the 20th.' });
    await article(p, 'Tuesday the 20th'); const seen = Date.now();
    await T.wait(2400);
    await T.hold(); skip(T, sent, seen);
    await film('ai', [T]);
  },
  // "Live sessions by link": two people in the same note, each one on a block.
  async live(S) {
    const who = await account('ines'); await put(who, 'opening-day.md', DAY);
    const T = await S.take(who); const p = T.page;
    await cloudNote(T, who, 'opening-day.md');
    await p.click('[data-act=sync]'); await p.click('.lmd-menu [data-s=live]'); await p.waitForSelector('.lmd-live-card [data-lv=name]');
    await p.fill('[data-lv=name]', 'Ines'); await p.click('[data-lv=start]'); await p.waitForSelector('.lmd-live-link input');
    const link = await p.inputValue('.lmd-live-link input'); await p.click('.lmd-live-card [data-lv=close]');
    const g = await R.open(null, { viewport: { width: 1024, height: 576 } });
    await g.page.goto(link); await g.page.waitForSelector('.lmd-live-card input'); await g.page.fill('.lmd-live-card input', 'Tomas'); await g.page.click('.lmd-live-card [data-lv=join]');
    await g.page.waitForSelector('.lmd-live-bar'); await g.page.waitForSelector('.lmd-article .lmd-editable');
    if (!(await p.locator('.lmd-editing').count())) await editing(p);
    await p.waitForFunction(() => /Tomas/.test(document.querySelector('.lmd-live-chip').title)); await hideSide(p);
    await g.page.locator('.lmd-article li', { hasText: 'Tomas:' }).click(); await g.page.keyboard.press('End');
    await T.move(700, 460, 0); await sleep(700);
    await T.roll(); await T.wait(300);
    const q = p.locator('.lmd-article p', { hasText: 'Do we ship' });
    const d = await T.click(q, { pos: await endOf(q), ms: 420 }); await p.keyboard.press('Control+End'); await T.move(d.x + 70, d.y + 56, 200);
    await Promise.all([
      g.page.keyboard.type(' checkout passes with the test card', { delay: 65 }),
      (async () => { await sleep(450); await p.keyboard.type(' Only until noon.', { delay: 75 }); })(),
    ]);
    await article(p, 'test card'); await T.wait(1800);
    await T.hold(); await g.ctx.close(); await film('live', [T]);
  },

  // ---------- Stills ----------
  // "The same notes on every device": the start screen asking for the code that was sent by email.
  async signin(S) {
    const T = await S.take(null); const p = T.page;
    await p.goto(R.home); await p.waitForSelector('.lmd-home-cloud:not([hidden]) [data-cloud=ask]');
    await p.click('[data-cloud=ask]'); await p.waitForSelector('.lmd-home-card .lmd-login [data-field=email]');
    await p.fill('[data-field=email]', 'nora@ejemplo.test'); await p.click('[data-cloud=start]'); await p.waitForSelector('[data-field=code]');
    await p.locator('[data-field=code]').pressSequentially('4812'); await settle(p);
    await still('signin', T);
  },
  // "Share a note or a folder": the sharing box with a person invited and a public link with a password.
  async share(S) {
    const who = await account('ana'); await put(who, 'launch-plan.md', PLAN); await R.signup('beto@ejemplo.test', true);
    const T = await S.take(who); const p = T.page;
    await cloudNote(T, who, 'launch-plan.md');
    await p.click('.lmd-sync'); await p.click('.lmd-menu [data-s=share]'); await p.waitForSelector('.lmd-share');
    await p.fill('[data-sh=email]', 'beto@ejemplo.test'); await p.click('[data-sh=invite]'); await p.waitForSelector('[data-sh=people] li');
    await p.fill('[data-sh=pass]', 'apple-42'); await p.click('[data-sh=link]'); await p.waitForSelector('[data-sh=links] li input');
    await p.evaluate(() => { const a = document.activeElement; if (a && a.blur) a.blur(); }); await settle(p);
    await still('share', T);
  },
  // "Protected folders": the folder with its lock in the sidebar, and the box that asks for the password.
  async vault(S) {
    const who = await account('marta'); await put(who, 'journal/monday.md', '# Monday\n\nNotes only for me.\n'); await put(who, 'journal/tuesday.md', '# Tuesday\n\nMore of the same.\n'); await put(who, 'shop/launch-plan.md', PLAN); await put(who, 'shop/shipping-zones.md', ZONES);
    const T = await S.take(who); const p = T.page;
    await cloudNote(T, who, 'shop/launch-plan.md'); await p.waitForSelector(CLOUD + ' .lmd-node');
    await p.locator(CLOUD + ' .lmd-node', { hasText: 'journal' }).first().click({ button: 'right' }); await p.click('.lmd-menu [data-f=v-protect]'); await p.waitForSelector('.lmd-vault-card');
    await p.fill('[data-v=p1]', 'a long made-up passphrase 42'); await p.fill('[data-v=p2]', 'a long made-up passphrase 42'); await p.keyboard.press('Enter'); await p.waitForSelector('.lmd-vault-key');
    const [download] = await Promise.all([p.waitForEvent('download'), p.click('[data-v=down]')]); await download.cancel().catch(() => {});
    await p.click('[data-v=ok]'); await p.waitForSelector('.lmd-vault-card', { state: 'detached', timeout: 30000 });
    // A new visit finds the folder locked.
    await sleep(800); await cloudNote(T, who, 'shop/launch-plan.md'); await p.waitForSelector(CLOUD + ' .lmd-vault-shut');
    await p.locator(CLOUD + ' .lmd-node-dir', { hasText: 'journal' }).first().click(); await p.waitForSelector('.lmd-vault-card [data-v=p]'); await settle(p);
    await still('vault', T);
  },
  // "Trash for 30 days": the trash of the cloud with a deleted note and its Restore button.
  async trash(S) {
    const who = await account('tomas'); await put(who, 'launch-plan.md', PLAN); await put(who, 'old-prices.md', '# Old prices\n\nBefore the change of courier.\n'); await put(who, 'draft-newsletter.md', '# Newsletter\n\nFirst draft.\n');
    await R.api('DELETE', '/notes/' + encodeURIComponent('old-prices.md'), undefined, who.s); await R.api('DELETE', '/notes/' + encodeURIComponent('draft-newsletter.md'), undefined, who.s);
    const T = await S.take(who); const p = T.page;
    await cloudNote(T, who, 'launch-plan.md'); await p.waitForSelector(CLOUD + ' > .lmd-trash-link');
    await p.click(CLOUD + ' > .lmd-trash-link'); await p.waitForSelector('.lmd-trash li'); await settle(p);
    await still('trash', T);
  },
  // "A token for one folder": Settings > AI with a token limited to a folder next to one that reaches every note.
  async token(S) {
    const who = await account('sofia'); await put(who, 'shop/README.md', INDEX); await put(who, 'shop/decisions.md', DECISIONS); await put(who, 'personal/ideas.md', '# Ideas\n\nNot for the AI.\n');
    await token(who);
    const T = await S.take(who); const p = T.page;
    await cloudNote(T, who, 'shop/README.md');
    await p.click('[data-act=settings]'); await p.waitForSelector('.lmd-panel-card'); await p.click('[data-ptab=ai]'); await p.waitForSelector('[data-acct=ai] [data-c=token]');
    await p.click('[data-acct=ai] [data-c=token]'); await p.selectOption('[data-c=folder]', 'shop'); await p.click('[data-acct=ai] [data-c=token-ok]'); await p.waitForSelector('.lmd-ai-new');
    // The new token is shown once: the still is taken after that, with the list of tokens and the folder picker.
    await p.click('[data-act=close-panel]'); await p.click('[data-act=settings]'); await p.waitForSelector('.lmd-panel-card'); await p.click('[data-ptab=ai]'); await p.waitForSelector('[data-acct=ai] [data-c=token]');
    await p.click('[data-acct=ai] [data-c=token]'); await p.selectOption('[data-c=folder]', 'shop'); await settle(p);
    await still('token', T);
  },
  // "The notes are the memory of the project": a project folder with the index note the AI keeps, and the notes it links.
  async memory(S) {
    const who = await account('pablo'); const tk = await token(who);
    await mcp(tk, 'write_note', { path: 'shop/README.md', text: INDEX }); await mcp(tk, 'write_note', { path: 'shop/decisions.md', text: DECISIONS });
    await mcp(tk, 'write_note', { path: 'shop/log.md', text: LOG }); await mcp(tk, 'write_note', { path: 'shop/checkout.md', text: '# Checkout\n\nCart, address, payment.\n' });
    const T = await S.take(who); const p = T.page;
    await cloudNote(T, who, 'shop/README.md'); await p.waitForSelector(CLOUD + ' a.lmd-node.lmd-active'); await settle(p);
    await still('memory', T);
  },
};

let failed = null;
try {
  const S = await stage(GEO, false);
  for (const name of Object.keys(SCENES)) {
    if (want.length && !want.includes(name)) continue;
    try { await SCENES[name](S); } catch (e) { if (S.last) await S.last.page.screenshot({ path: path.join(TMP, 'fail-' + name + '.png') }).catch(() => {}); throw new Error(name + ': ' + String(e.message).split('\n')[0]); }
  }
  if (R.errors.length) console.log('page errors:', R.errors);
  console.log(R.outside.length ? 'requests cut off on their way to sharpmd.app: ' + [...new Set(R.outside)].join(', ') : 'no request left for sharpmd.app');
} catch (e) { failed = e; console.error(e); }
await R.close();
const videos = fs.readdirSync(OUT).filter((f) => /\.(webm|mp4)$/.test(f)).reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0);
console.log('docs/clips: ' + Math.round(videos / 1024) + ' KB of video');
process.exit(failed ? 1 : 0);
