// Capturas de 1280x800 para la página de presentación y la ficha de la tienda.
// Uso: node shots.mjs   (deja los PNG en docs/store)
import { chromium } from 'playwright-core';
import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'docs', 'store'); fs.mkdirSync(out, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mdtools-'));
const ctx = await chromium.launchPersistentContext(profile, { headless: false, executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 1280, height: 800 }, locale: 'en-US', colorScheme: 'dark', ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--headless=new', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--lang=en-US', '--hide-scrollbars'] });
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker'); const id = new URL(sw.url()).host;
const app = await ctx.newPage();
const shot = (name) => app.screenshot({ path: path.join(out, name + '.png') });

const LAUNCH = `---
project: Booking app
status: in progress
---

# Booking app launch

What is left before we ship on **Monday the 19th**. Checked items are already in production.

## In this release

- [x] Book an appointment from the phone
- [x] WhatsApp reminder the day before
- [ ] Pay the deposit by card
- [ ] Waiting list when a slot opens up

## Who does what

| Task | Owner | Due | Status |
|---|---|---|---|
| Deposit payment | Sofia | Thursday 15 | In testing |
| Waiting list | Martin | Friday 16 | Started |
| Store copy | Ana | Wednesday 14 | Done |
| Test with five customers | Sofia and Ana | Saturday 17 | Not started |

## How a booking flows

\`\`\`mermaid
graph LR
  A[Customer picks a slot] --> B{Deposit paid?}
  B -- Yes --> C[Booking confirmed]
  B -- No --> D[Slot held for 10 minutes]
  D --> B
  C --> E[Reminder the day before]
\`\`\`

## Risks

> [!WARNING]
> The payment gateway takes up to 48 hours to approve the account. We need to request it today.

## After launch

We track three numbers in the first week: bookings per day, cancellations and late arrivals. See [[roadmap]] for what comes next.
`;

await app.goto(`chrome-extension://${id}/src/app.html`); await app.waitForSelector('.lmd-home');
await app.evaluate(async (launch) => {
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('booking-app', { create: true });
  const write = async (d, name, data) => { const h = await d.getFileHandle(name, { create: true }); const s = await h.createWritable(); await s.write(data); await s.close(); };
  await write(dir, 'launch.md', launch);
  await write(dir, 'roadmap.md', '# Roadmap\n\n## Next quarter\n\n- Waiting list for every branch\n- Deposit refunds from the app\n- Reminder by email as well as WhatsApp\n');
  await write(dir, 'pricing.md', '# Pricing\n\nThe deposit is 20% of the service. A reminder costs nothing to the customer.\n');
  const notes = await dir.getDirectoryHandle('notes', { create: true });
  await write(notes, 'kickoff.md', '# Kickoff\n\nWe agreed the deposit is the riskiest piece, so it goes first.\n');
  await write(notes, 'customers.md', '# Customer calls\n\nThree of five asked for a reminder the same morning, not only the day before.\n');
  window.showDirectoryPicker = async () => dir;
}, LAUNCH);
// sin nota abierta: el estado vacío en el centro y, a la izquierda, el explorador con lo reciente
await app.click('[data-home=dir]'); await app.waitForSelector('.lmd-diagram svg');
const docUrl = app.url();
await app.goto(`chrome-extension://${id}/src/app.html`); await app.waitForSelector('.lmd-home [data-home=new]'); await app.waitForSelector('.lmd-sidebar .lmd-node'); await app.waitForTimeout(400);
await shot('5-start');

await app.goto(docUrl); await app.waitForSelector('.lmd-diagram svg'); await app.waitForTimeout(800);
await shot('1-reader');

// edición: una celda de la tabla con el cursor
await app.click('[data-act=mode-edit]'); await app.waitForTimeout(400);
await app.locator('td.lmd-cell', { hasText: 'In testing' }).click(); await app.keyboard.press('End'); await app.keyboard.type(', one bug left'); await app.waitForTimeout(300);
await shot('2-editing');
await app.keyboard.press('Escape'); await app.waitForTimeout(300);

// menú de bloques
await app.locator('.lmd-article h2', { hasText: 'Who does what' }).scrollIntoViewIfNeeded(); await app.evaluate(() => window.scrollBy(0, -120)); await app.waitForTimeout(500);
await app.locator('.lmd-article h2', { hasText: 'Who does what' }).click({ button: 'right', position: { x: 300, y: 10 } }); await app.waitForSelector('.lmd-menu'); await app.waitForTimeout(200);
await shot('3-blocks');
await app.keyboard.press('Escape');

// editor de diagramas
await app.locator('.lmd-diagram').scrollIntoViewIfNeeded(); await app.click('.lmd-diagram'); await app.waitForSelector('.lmd-dgm-svg svg'); await app.waitForTimeout(600);
await shot('4-diagram');
await app.keyboard.press('Escape'); await app.click('[data-act=mode-read]'); await app.waitForTimeout(400);

// búsqueda en la carpeta
await app.evaluate(() => window.scrollTo(0, 0));
await app.waitForSelector('.lmd-sidebar .lmd-node');
await app.fill('.lmd-search input', 'reminder'); await app.waitForSelector('.lmd-res-file'); await app.waitForTimeout(500);
await shot('6-search');

await ctx.close(); fs.rmSync(profile, { recursive: true, force: true });
console.log('capturas en', out, fs.readdirSync(out).join(', '));
process.exit(0);
