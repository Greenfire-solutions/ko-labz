// Ko-Labz Persistence Hub: the HUD, the console and the panels.
// The server owns the hub; every change goes through /api/action and comes back
// to every open window over /api/events.
import { createScene } from './scene.js';
import { sfx, setSound, soundOn, startDrone, stopDrone, droneOn } from './audio.js';
import { pointsFor, rankFor, BADGES, METHOD_LABEL, projectProgress, PALETTE, MAX_NEEDS_PER_RING, MAX_PLAYERS } from '/shared/rules.mjs';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const linkHtml = (href) => href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(href.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a>` : '';

// ---------- per-device preferences ----------
const prefs = (() => {
  let p = {};
  try { p = JSON.parse(localStorage.getItem('kolabz.prefs') || '{}'); } catch {}
  return new Proxy(p, { set(t, k, v) { t[k] = v; try { localStorage.setItem('kolabz.prefs', JSON.stringify(t)); } catch {} return true; } });
})();
prefs.sound ??= true; prefs.quality ??= 'high'; prefs.drone ??= false; prefs.showArchived ??= false;
setSound(prefs.sound);

// ---------- state ----------
let hub = null;
let templates = [];
let lan = [];
let dataDir = '';
const ui = { view: 'galaxy', projectId: null, focusId: null, sel: null, action: null };
window.__kolabzUi = ui; // read-only view state for the browser tests
let drawerState = null;
const lastScores = new Map();

const scene = createScene($('stage'), $('labels'), {
  onView(view, projectId) {
    ui.view = view; ui.projectId = projectId; ui.sel = null; ui.action = null;
    if (view === 'galaxy') ui.focusId = null;
    render();
  },
  onPickProject(id) {
    if (!id) { if (ui.focusId) { ui.focusId = null; sfx.back(); render(); } return; }
    if (ui.focusId === id) return enterProject(id);
    ui.focusId = id; scene.focusProject(id); render();
  },
  onSelect(sel) {
    if (!sel && !ui.sel) return;
    if (sel && ui.sel && sel.kind === ui.sel.kind && sel.id === ui.sel.id) return;
    ui.sel = sel; ui.action = null;
    scene.select(sel);
    sel ? sfx.select() : sfx.back();
    render();
  },
  onSound(kind) { sfx[kind]?.(); },
  onSlow() {
    if (prefs.quality !== 'high' || prefs.autoLowered) return;
    prefs.autoLowered = true; prefs.quality = 'low'; scene.setQuality('low');
    toast('Graphics set to Low so the map stays smooth. Change it in Systems.', 'info', 'PERFORMANCE');
  }
});
scene.setQuality(prefs.quality);

// ---------- server link ----------
async function act(type, payload = {}) {
  const me = actor();
  try {
    const res = await fetch('/api/action', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type, actorId: me?.id, ...payload })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast(data.error || 'That did not work.', 'error'); sfx.error(); return null; }
    applyHub(data.hub, data.events);
    return data;
  } catch {
    toast('Lost contact with the hub. Is Ko-Labz still running?', 'error', 'UPLINK');
    sfx.error();
    return null;
  }
}

function applyHub(next, events = []) {
  if (!next || (hub && next.version <= hub.version)) return;
  const first = !hub;
  hub = next;
  scene.setHub(hub, events);
  if (ui.view === 'system' && !hub.projects.some(p => p.id === ui.projectId)) { ui.view = 'galaxy'; ui.projectId = null; }
  if (ui.focusId && !hub.projects.some(p => p.id === ui.focusId)) ui.focusId = null;
  if (ui.sel?.kind === 'need' && !currentProject()?.needs.some(n => n.id === ui.sel.id)) { ui.sel = null; ui.action = null; }
  if (ui.action && currentNeed()?.status === 'fulfilled') { ui.action = null; toast('That need was just fulfilled.', 'info', 'UPDATE'); }
  if (!first) handleEvents(events);
  render();
  // Never re-render over someone typing; refresh the moment they leave the field.
  if (drawerState) { if (isTyping($('drawer'))) drawerStale = true; else renderDrawer(); }
  if (!hub.players.length && $('briefing').hidden) openBriefing();
}

function handleEvents(events) {
  for (const ev of events || []) {
    const who = hub.players.find(p => p.id === ev.playerId);
    if (ev.kind === 'fulfilled') { sfx.success(); if (ev.points) toast(`<b style="color:${esc(who?.color)}">${esc(who?.name)}</b> +${ev.points} points`, 'info', 'ASSIST ACCEPTED'); }
    else if (ev.kind === 'offer') sfx.offer();
    else if (ev.kind === 'ring') { sfx.ring(); toast(`${ev.ring === 'minor' ? 'Minor' : 'Major'} ring complete on ${esc(hub.projects.find(p => p.id === ev.projectId)?.title)}`, 'info', 'RING SEALED'); }
    else if (ev.kind === 'complete') { sfx.complete(); showBanner(hub.projects.find(p => p.id === ev.projectId)); }
    else if (ev.kind === 'badge') { sfx.badge(); toast(`<b>${esc(who?.name)}</b> earned <b>${esc(BADGES[ev.badge]?.name)}</b>. ${esc(BADGES[ev.badge]?.desc)}`, 'badge', 'BADGE UNLOCKED'); }
    else if (ev.kind === 'turn') { sfx.turn(); ui.sel = null; ui.action = null; scene.select(null); }
    else if (ev.kind === 'declined') sfx.back();
    else if (ev.kind === 'import') toast('Hub imported.', 'info', 'DATA');
  }
}

async function boot() {
  const lines = ['ESTABLISHING UPLINK', 'SYNCING ORBITAL ARRAY', 'CALIBRATING RINGS'];
  let i = 0; const t = setInterval(() => { $('boot-line').textContent = lines[++i % lines.length]; }, 420);
  try {
    const res = await fetch('/api/state');
    const data = await res.json();
    templates = data.templates || []; lan = data.lan || []; dataDir = data.dataDir || '';
    applyHub(data.hub);
  } catch {
    $('boot-line').textContent = 'HUB OFFLINE. START KO-LABZ AND RELOAD.';
    clearInterval(t); return;
  }
  setTimeout(() => { clearInterval(t); $('boot').classList.add('done'); }, 900);
  connectLive();
}

function connectLive() {
  const es = new EventSource('/api/events');
  es.addEventListener('hub', (e) => { const d = JSON.parse(e.data); applyHub(d.hub, d.events); });
  es.onopen = () => $('live-dot').classList.add('on');
  es.onerror = () => $('live-dot').classList.remove('on');
}

// ---------- helpers ----------
function actor() {
  if (!hub?.players.length) return null;
  if (hub.settings.mode === 'turns') return hub.players[hub.turn.index] || hub.players[0];
  return hub.players.find(p => p.id === prefs.me) || hub.players[0];
}
const player = (id) => hub.players.find(p => p.id === id);
const currentProject = () => hub?.projects.find(p => p.id === ui.projectId) || null;
const currentNeed = () => ui.sel?.kind === 'need' ? currentProject()?.needs.find(n => n.id === ui.sel.id) : null;
const ago = (t) => {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

function enterProject(id) {
  ui.focusId = null;
  scene.enterSystem(id);
}
function toGalaxy() { if (ui.view !== 'galaxy') scene.enterGalaxy(); }

function payloadHtml(c) {
  const p = c.payload || {};
  const parts = [];
  if (p.link) parts.push(`<span class="k">proof</span>${linkHtml(p.link)}`);
  if (p.contactName) parts.push(`<span class="k">contact</span><b>${esc(p.contactName)}</b> · ${esc(p.contactInfo)}`);
  if (p.proposal) parts.push(esc(p.proposal));
  if (p.note) parts.push(`<span class="k">note</span>${esc(p.note)}`);
  return parts.join('<br>');
}

// ---------- render ----------
function render() {
  if (!hub) return;
  renderHelm(); renderDirective(); renderScoreboard(); renderStream(); renderQueue(); renderConsole();
  $('btn-sound').classList.toggle('off', !prefs.sound);
}

function renderHelm() {
  const me = actor();
  const h = $('helm');
  if (!me) { h.innerHTML = '<div class="turn">AWAITING CREW</div>'; return; }
  h.style.setProperty('--who', me.color);
  if (hub.settings.mode === 'turns') {
    h.innerHTML = `<div class="turn" title="Whose turn it is"><span class="num">T${hub.turn.number}</span><span>//</span><span class="who">${esc(me.name)}</span></div>`;
  } else {
    h.innerHTML = `<div class="mode-free">ACTING AS <select id="helm-select" aria-label="Who is using this screen">${hub.players.map(p => `<option value="${p.id}" ${p.id === me.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>`;
    $('helm-select').onchange = (e) => { prefs.me = e.target.value; ui.action = null; sfx.select(); render(); };
  }
}

function renderDirective() {
  const p = ui.view === 'system' ? currentProject() : (ui.focusId ? hub.projects.find(x => x.id === ui.focusId) : null);
  $('crumb-sep').hidden = $('crumb-project').hidden = ui.view !== 'system';
  $('crumb-project').textContent = ui.view === 'system' ? (currentProject()?.title || '') : '';
  if (p) {
    const pr = projectProgress(p);
    const owner = player(p.ownerId);
    const waiting = p.needs.filter(n => n.status === 'pending').length;
    $('directive-kicker').textContent = p.completedAt ? 'DIRECTIVE COMPLETE' : 'PRIMARY DIRECTIVE';
    $('directive-title').textContent = p.title;
    $('bar-minor').style.width = `${pr.minor.ratio * 100}%`;
    $('bar-major').style.width = `${pr.major.ratio * 100}%`;
    $('directive-meta').innerHTML = `<span>Owner <b style="color:${esc(owner?.color)}">${esc(owner?.name || 'NONE')}</b></span><span>Minor <b>${pr.minor.done}/${pr.minor.total}</b></span><span>Major <b>${pr.major.done}/${pr.major.total}</b></span>${waiting ? `<span class="amber">Waiting <b class="amber">${waiting}</b></span>` : ''}`;
  } else {
    const live = hub.projects.filter(x => !x.archived);
    const all = live.flatMap(x => x.needs);
    const done = all.filter(n => n.status === 'fulfilled').length;
    const minor = all.filter(n => n.ring === 'minor'), major = all.filter(n => n.ring === 'major');
    $('directive-kicker').textContent = 'STAR MAP';
    $('directive-title').textContent = live.length ? `${live.length} ACTIVE SYSTEM${live.length === 1 ? '' : 'S'}` : 'NO SYSTEMS YET';
    $('bar-minor').style.width = `${minor.length ? minor.filter(n => n.status === 'fulfilled').length / minor.length * 100 : 0}%`;
    $('bar-major').style.width = `${major.length ? major.filter(n => n.status === 'fulfilled').length / major.length * 100 : 0}%`;
    $('directive-meta').innerHTML = `<span>Needs met <b>${done}/${all.length}</b></span><span>Complete <b>${live.filter(x => x.completedAt).length}</b></span><span>Crew <b>${hub.players.length}</b></span>`;
  }
}

function renderScoreboard() {
  const me = actor();
  const el = $('scoreboard');
  if (!hub.players.length) { el.innerHTML = '<div class="empty-note">No crew aboard yet.</div>'; return; }
  const sorted = [...hub.players].sort((a, b) => b.score - a.score);
  el.innerHTML = sorted.map((p, i) => `
    <div class="p-row ${p.id === me?.id ? 'active' : ''}" style="--who:${esc(p.color)}" data-player="${p.id}">
      <span class="rank-pos">${i + 1}</span>
      <div class="p-name"><span><i></i>${esc(p.name)}</span><small>${rankFor(p.score)}${p.avatar ? ` · ${esc(p.avatar.alias || p.avatar.name)}` : ''}</small></div>
      <span class="p-score" data-score="${p.id}">${p.score}</span>
    </div>`).join('');
  for (const p of hub.players) {
    const prev = lastScores.get(p.id);
    if (prev !== undefined && prev !== p.score) el.querySelector(`[data-score="${p.id}"]`)?.classList.add('bump');
    lastScores.set(p.id, p.score);
  }
}

function renderStream() {
  const items = hub.activity.slice(-40).reverse();
  const el = $('stream');
  const sig = items.map(a => a.id).join();
  if (el._sig === sig) { el.querySelectorAll('time').forEach((t, i) => t.textContent = ago(items[i].at)); return; }
  el._sig = sig;
  el.innerHTML = items.length ? items.map(a => `<div class="s-item ${a.kind}" style="--c:${esc(a.color || '')}">${esc(a.text).replace(/^([A-Z0-9 ]{2,24}?)( aided| offered| launched| earned| joined| passed| left)/, '<b>$1</b>$2')}<time>${ago(a.at)}</time></div>`).join('')
    : '<div class="s-item">System state nominal. Monitoring orbital sectors.</div>';
}

function renderQueue() {
  const me = actor();
  const panel = $('queue-panel');
  if (!me) { panel.hidden = true; return; }
  const pending = hub.contributions.filter(c => c.status === 'pending');
  const forMe = pending.filter(c => hub.projects.find(p => p.id === c.projectId)?.ownerId === me.id);
  const mine = pending.filter(c => c.playerId === me.id);
  const others = pending.filter(c => !forMe.includes(c) && !mine.includes(c));
  if (!forMe.length && !mine.length && !others.length) { panel.hidden = true; return; }
  panel.hidden = false;
  $('queue-title').textContent = forMe.length ? 'INCOMING OFFERS' : 'OFFERS IN FLIGHT';
  $('queue-count').textContent = forMe.length || pending.length;
  const card = (c, mode) => {
    const pr = hub.projects.find(p => p.id === c.projectId);
    const need = pr?.needs.find(n => n.id === c.needId);
    const helper = player(c.playerId);
    return `<div class="offer" style="--c:${esc(helper?.color)}">
      <div class="offer-head"><i></i><b>${esc(helper?.name)}</b><span>${esc(METHOD_LABEL[c.method])}</span><span class="pts">+${c.points}</span></div>
      <div class="offer-need">${esc(need?.title)} · ${esc(pr?.title)}</div>
      <div class="offer-body">${payloadHtml(c)}</div>
      <div class="offer-actions">
        ${mode === 'review' ? `<button class="btn-accept" data-accept="${c.id}">ACCEPT</button><button class="btn-decline" data-decline="${c.id}">DECLINE</button>` : ''}
        ${mode === 'mine' ? `<button class="btn-decline" data-withdraw="${c.id}">WITHDRAW</button>` : ''}
        <button class="btn-goto" data-goto="${c.projectId}:${c.needId}">VIEW</button>
      </div></div>`;
  };
  let html = forMe.map(c => card(c, 'review')).join('');
  if (mine.length) html += `<div class="d-note" style="margin:8px 0 2px">Your offers waiting on an owner</div>` + mine.map(c => card(c, 'mine')).join('');
  if (others.length) {
    const owners = [...new Set(others.map(c => player(hub.projects.find(p => p.id === c.projectId)?.ownerId)?.name).filter(Boolean))];
    html += `<div class="d-note" style="margin-top:8px">${others.length} offer${others.length > 1 ? 's' : ''} waiting on ${esc(owners.join(', '))}.${hub.settings.mode === 'turns' ? ' They review on their turn.' : ''}</div>`;
  }
  $('queue').innerHTML = html;
}

$('queue').addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.accept) await act('assist.review', { contributionId: b.dataset.accept, decision: 'accept' });
  if (b.dataset.decline) await act('assist.review', { contributionId: b.dataset.decline, decision: 'decline' });
  if (b.dataset.withdraw) await act('assist.withdraw', { contributionId: b.dataset.withdraw });
  if (b.dataset.goto) gotoNeed(...b.dataset.goto.split(':'));
});

function gotoNeed(projectId, needId) {
  const sel = () => { ui.sel = { kind: 'need', id: needId }; ui.action = null; scene.select(ui.sel); render(); };
  if (ui.view === 'system' && ui.projectId === projectId) return sel();
  scene.enterSystem(projectId, { instant: ui.view === 'system' });
  setTimeout(sel, ui.view === 'system' ? 50 : 800);
}

// ---------- console ----------
const CMD = ['cmd-a', 'cmd-b', 'cmd-c', 'cmd-d'];
let cmdHandlers = [];

function turnButton() {
  if (hub.settings.mode === 'turns') return { label: 'Cycle Turn', onClick: () => act('turn.next') };
  return { label: 'Switch Operator', onClick: () => { const s = $('helm-select'); s?.focus(); try { s?.showPicker?.(); } catch {} } };
}

function consoleConfig() {
  const me = actor();
  const c = { tag: 'SCANNING SECTOR', tagColor: null, title: 'Select Module', desc: '', extra: '', hint: 'SYSTEM READY', buttons: [] };
  if (!me) { c.title = 'Awaiting crew'; c.desc = 'Set up the crew to begin.'; c.buttons = [{ label: 'Mission Briefing', accent: 'gold', onClick: openBriefing }]; return c; }

  if (ui.view === 'galaxy') {
    const focus = ui.focusId && hub.projects.find(p => p.id === ui.focusId);
    if (focus) {
      const pr = projectProgress(focus), owner = player(focus.ownerId);
      const waiting = focus.needs.filter(n => n.status === 'pending').length;
      c.tag = `${owner?.name || 'UNCLAIMED'} SYSTEM`; c.tagColor = owner?.color;
      c.title = focus.title; c.desc = focus.vision || 'No vision recorded yet.';
      c.extra = `<span>Met <b>${pr.done}/${pr.total}</b></span>${waiting ? `<span class="amber">Waiting <b class="amber">${waiting}</b></span>` : ''}${focus.completedAt ? '<span class="gold">COMPLETE</span>' : ''}${focus.archived ? '<span>ARCHIVED</span>' : ''}`;
      c.hint = 'click again or press 1 to warp in';
      c.buttons = [
        { label: 'Enter System', onClick: () => enterProject(focus.id) },
        { label: 'Launch Project', accent: 'gold', onClick: () => openBriefing() },
        { label: 'Project Ledger', accent: 'violet', onClick: () => openDrawer('ledger', { projectId: focus.id }) },
        turnButton()
      ];
    } else {
      const live = hub.projects.filter(p => !p.archived);
      const open = live.flatMap(p => p.needs.filter(n => n.status === 'open').map(n => ({ n, p })));
      const helpable = open.filter(x => x.p.ownerId !== me.id).length;
      c.tag = 'STAR MAP';
      c.title = live.length ? 'Choose a system' : 'Empty sector';
      c.desc = live.length
        ? `${me.name}, ${helpable ? `there ${helpable === 1 ? 'is' : 'are'} ${helpable} open need${helpable === 1 ? '' : 's'} you can help with.` : 'nothing is waiting on you right now. Launch a project of your own.'}`
        : 'No projects yet. Launch the first one and the crew can start helping.';
      c.extra = live.length ? `<span>Systems <b>${live.length}</b></span><span>Open <b>${open.length}</b></span><span>Offers <b>${hub.contributions.filter(x => x.status === 'pending').length}</b></span>` : '';
      c.hint = live.length ? 'select a star system' : 'press 1 to launch';
      c.buttons = [
        { label: 'Launch Project', accent: 'gold', onClick: () => openBriefing() },
        { label: 'Crew Manifest', onClick: () => openDrawer('crew') },
        { label: 'Mission Ledger', accent: 'violet', onClick: () => openDrawer('ledger', {}) },
        turnButton()
      ];
    }
    return c;
  }

  const p = currentProject();
  if (!p) return c;
  const owner = player(p.ownerId);
  const isOwner = owner?.id === me.id;
  const pr = projectProgress(p);

  if (!ui.sel) {
    c.tag = 'SYSTEM OVERVIEW'; c.tagColor = owner?.color;
    c.title = p.title; c.desc = p.vision || 'No vision recorded yet.';
    c.extra = `<span>Owner <b style="color:${esc(owner?.color)}">${esc(owner?.name)}</b></span><span>Minor <b>${pr.minor.done}/${pr.minor.total}</b></span><span>Major <b>${pr.major.done}/${pr.major.total}</b></span>`;
    c.hint = isOwner ? 'your project · select a planet to manage it' : 'select a planet to see what it needs';
    c.buttons = [
      { label: 'Star Map', onClick: toGalaxy },
      { label: 'Project Core', accent: 'gold', onClick: () => { ui.sel = { kind: 'sun' }; scene.select(ui.sel); sfx.select(); render(); } },
      { label: 'Project Ledger', accent: 'violet', onClick: () => openDrawer('ledger', { projectId: p.id }) },
      turnButton()
    ];
    return c;
  }

  if (ui.sel.kind === 'sun') {
    const helpers = new Set(hub.contributions.filter(x => x.projectId === p.id && x.status === 'accepted').map(x => x.playerId));
    c.tag = p.completedAt ? 'PROJECT CORE · COMPLETE' : 'PROJECT CORE'; c.tagColor = p.completedAt ? '#ffd36b' : owner?.color;
    c.title = p.title; c.desc = p.vision || 'No vision recorded yet.';
    c.extra = `<span>Owner <b style="color:${esc(owner?.color)}">${esc(owner?.name)}</b></span><span>Helpers <b>${helpers.size}</b></span><span>Met <b>${pr.done}/${pr.total}</b></span>`;
    c.hint = 'the project itself';
    c.buttons = [
      { label: 'Star Map', onClick: toGalaxy },
      { label: isOwner ? 'Edit Project' : 'Project Details', accent: 'gold', onClick: () => openDrawer('project', { projectId: p.id }) },
      { label: 'Project Ledger', accent: 'violet', onClick: () => openDrawer('ledger', { projectId: p.id }) },
      turnButton()
    ];
    return c;
  }

  const n = currentNeed();
  if (!n) return c;
  const ringColor = n.ring === 'minor' ? '#00d4ff' : '#b06bff';
  c.title = n.title; c.desc = n.description || 'No details given.';
  const offers = hub.contributions.filter(x => x.needId === n.id && x.status === 'pending');
  const myOffer = offers.find(x => x.playerId === me.id);

  if (n.status === 'fulfilled') {
    const acc = hub.contributions.find(x => x.id === n.contributionId);
    const by = player(n.fulfilledBy);
    c.tag = `${n.ring} sector · fulfilled`; c.tagColor = '#ffffff';
    c.extra = acc ? `<span>By <b style="color:${esc(by?.color)}">${esc(by?.name)}</b></span><span>${esc(METHOD_LABEL[acc.method])}</span>${acc.payload?.link ? `<span>${linkHtml(acc.payload.link)}</span>` : ''}` : `<span>Resolved by the owner</span>`;
    c.hint = 'need met';
    c.buttons = [
      { label: 'Back to System', onClick: () => hooksSelect(null) },
      { label: 'Project Ledger', accent: 'violet', onClick: () => openDrawer('ledger', { projectId: p.id }) },
      isOwner ? { label: 'Reopen Need', accent: 'red', onClick: () => act('need.reopen', { projectId: p.id, needId: n.id }) } : { hidden: true },
      turnButton()
    ];
    return c;
  }

  if (isOwner) {
    c.tag = `${n.ring} sector · your project`; c.tagColor = ringColor;
    c.extra = n.status === 'pending' ? `<span class="amber"><b class="amber">${offers.length}</b> offer${offers.length > 1 ? 's' : ''} waiting for your review</span>` : `<span>Open · others can help with this</span>`;
    c.hint = n.status === 'pending' ? 'review in incoming offers' : 'you review, the crew assists';
    c.buttons = [
      n.status === 'pending'
        ? { label: 'Review Offers', accent: 'amber', onClick: () => { const q = $('queue-panel'); q.animate([{ boxShadow: '0 0 0 2px #ffb52e' }, { boxShadow: '0 0 0 0 transparent' }], { duration: 900 }); q.scrollIntoView({ block: 'nearest' }); } }
        : { label: 'Resolve Myself', accent: 'gold', onClick: () => act('need.resolve', { projectId: p.id, needId: n.id }) },
      { label: 'Edit Need', onClick: () => openDrawer('project', { projectId: p.id, needId: n.id }) },
      { label: 'Project Ledger', accent: 'violet', onClick: () => openDrawer('ledger', { projectId: p.id }) },
      turnButton()
    ];
    return c;
  }

  c.tag = n.status === 'pending' ? `${n.ring} sector · offer waiting` : `${n.ring} sector`;
  c.tagColor = n.status === 'pending' ? '#ffb52e' : ringColor;
  if (myOffer) {
    c.extra = `<span class="amber">Your offer is waiting on ${esc(owner?.name)}</span>`;
    c.hint = 'awaiting owner review';
    c.buttons = [
      { label: 'Withdraw Offer', accent: 'red', onClick: () => act('assist.withdraw', { contributionId: myOffer.id }) },
      { label: 'Source Connection', disabled: true }, { label: 'Add Solution', disabled: true }, turnButton()
    ];
    return c;
  }
  c.extra = `<span>Direct <b>${pointsFor(n.ring, 'self')}</b></span><span>Connect <b>${pointsFor(n.ring, 'contact')}</b></span><span>Solution <b>${pointsFor(n.ring, 'suggestion')}</b></span>${offers.length ? `<span class="amber">${offers.length} other offer${offers.length > 1 ? 's' : ''}</span>` : ''}`;
  c.hint = `${owner?.name || 'the owner'} reviews what you send`;
  c.buttons = [
    { label: 'Fulfill Directly', onClick: () => openAction('self') },
    { label: 'Source Connection', onClick: () => openAction('contact') },
    { label: 'Add Solution', accent: 'violet', onClick: () => openAction('suggestion') },
    turnButton()
  ];
  return c;
}

function hooksSelect(sel) { ui.sel = sel; ui.action = null; scene.select(sel); sfx.back(); render(); }

function renderConsole() {
  const c = consoleConfig();
  const tag = $('intel-tag');
  tag.textContent = c.tag; tag.style.setProperty('--tag', c.tagColor || '');
  $('intel-title').textContent = c.title;
  $('intel-desc').textContent = c.desc;
  $('intel-extra').innerHTML = c.extra;
  $('intel-hint').textContent = c.hint;
  cmdHandlers = [];
  CMD.forEach((id, i) => {
    const b = $(id), cfg = c.buttons[i] || { hidden: true };
    b.querySelector('.cmd-text').textContent = cfg.label || '';
    b.className = `cmd-btn ${i >= 2 ? 'right' : ''} ${cfg.accent || ''} ${cfg.hidden ? 'hidden-cmd' : ''}`;
    b.disabled = !!cfg.disabled || !!cfg.hidden || !!ui.action;
    cmdHandlers[i] = cfg.onClick;
  });
  $('view-intel').classList.toggle('active', !ui.action);
  $('view-action').classList.toggle('active', !!ui.action);
}

CMD.forEach((id, i) => $(id).addEventListener('click', () => { if (!$(id).disabled && cmdHandlers[i]) { sfx.open(); cmdHandlers[i](); } }));

function openAction(method) {
  const n = currentNeed(); if (!n) return;
  ui.action = method;
  const tag = $('form-tag');
  tag.textContent = `MODE // ${{ self: 'DIRECT ASSIST', contact: 'SOURCE CONNECTION', suggestion: 'LEAD PROPOSAL' }[method]}`;
  tag.style.setProperty('--tag', method === 'suggestion' ? '#b06bff' : '');
  const pts = `<div class="hex-pts">${esc(n.title)} · worth <b>+${pointsFor(n.ring, method)}</b> if accepted</div>`;
  $('form-fields').innerHTML = pts + ({
    self: `<input class="hex-input" name="link" placeholder="Proof link (doc, photo, repo, receipt)" maxlength="600">
           <textarea class="hex-input" name="note" placeholder="What did you do?" maxlength="600" style="height:52px"></textarea>`,
    contact: `<div class="row2"><input class="hex-input" name="contactName" placeholder="Their name" maxlength="80"><input class="hex-input" name="contactInfo" placeholder="Email, phone or handle" maxlength="160"></div>
              <input class="hex-input" name="note" placeholder="Why they can help (optional)" maxlength="600">`,
    suggestion: `<textarea class="hex-input" name="proposal" placeholder="Describe the solution. How would you meet this need?" maxlength="1200"></textarea>`
  }[method]);
  $('hex-commit').textContent = hub.settings.ownerReview ? 'SEND OFFER' : 'EXECUTE ASSIST';
  render();
  setTimeout(() => $('form-fields').querySelector('input, textarea')?.focus(), 60);
}

function closeAction() { ui.action = null; render(); }
$('hex-cancel').addEventListener('click', () => { sfx.back(); closeAction(); });
$('view-action').addEventListener('submit', async (e) => {
  e.preventDefault();
  const n = currentNeed(), p = currentProject(); if (!n || !p || !ui.action) return;
  const data = Object.fromEntries(new FormData(e.target));
  const res = await act('assist.offer', { projectId: p.id, needId: n.id, method: ui.action, ...data });
  if (!res) return;
  ui.action = null;
  if (res.result?.status === 'pending') toast(`Sent to <b>${esc(player(p.ownerId)?.name)}</b> for review.`, 'info', 'OFFER TRANSMITTED');
  render();
});

// ---------- drawer ----------
let drawerStale = false;
function isTyping(within) {
  const el = document.activeElement;
  return !!el && within.contains(el) && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['color', 'file', 'checkbox', 'radio'].includes(el.type)));
}
$('drawer').addEventListener('focusout', () => setTimeout(() => { if (drawerStale && !isTyping($('drawer'))) { drawerStale = false; renderDrawer(); } }, 0));
function openDrawer(kind, opts = {}) {
  drawerState = { kind, opts };
  renderDrawer();
  $('drawer').classList.add('open'); $('drawer').setAttribute('aria-hidden', 'false');
}
function closeDrawer() {
  if (!drawerState) return;
  drawerState = null; $('drawer').classList.remove('open'); $('drawer').setAttribute('aria-hidden', 'true'); sfx.back();
}
$('drawer-close').addEventListener('click', closeDrawer);

function renderDrawer() {
  if (!drawerState || !hub) return;
  const { kind, opts } = drawerState;
  const body = $('drawer-body');
  const R = { crew: drawCrew, ledger: drawLedger, settings: drawSettings, project: drawProject, help: drawHelp }[kind];
  const out = R(opts);
  if (!out) return closeDrawer();
  $('drawer-kicker').textContent = out.kicker; $('drawer-title').textContent = out.title;
  body.innerHTML = out.html;
  out.bind?.(body);
}

function drawCrew() {
  const me = actor();
  const unlockedAll = Object.keys(BADGES);
  const html = `
    <div class="d-section">
      <div class="d-note">Everyone on the crew can launch projects and assist each other. Points come from accepted assists: minor needs pay 10, major needs 25, scaled by how you helped (direct 100%, connection 70%, solution 40%). Closing a ring pays a 10 point bonus; finishing your own project pays 20.</div>
      ${[...hub.players].map(p => {
        const acc = hub.contributions.filter(c => c.playerId === p.id && c.status === 'accepted').length;
        const owns = hub.projects.filter(x => x.ownerId === p.id && !x.archived).length;
        return `<div class="crew-card" style="--who:${esc(p.color)}">
          <div class="crew-top">
            <input type="color" value="${esc(p.color)}" data-color="${p.id}" title="Colour">
            <input class="input" value="${esc(p.name)}" data-name="${p.id}" maxlength="24" aria-label="Name">
          </div>
          <div class="crew-stats"><span>${rankFor(p.score)}</span><span>Score <b>${p.score}</b></span><span>Assists <b>${acc}</b></span><span>Projects <b>${owns}</b></span></div>
          ${avatarBlock(p)}
          <div class="badges">${unlockedAll.map(b => `<span class="badge ${p.badges.includes(b) ? '' : 'locked'}" title="${esc(BADGES[b].desc)}">${esc(BADGES[b].name)}</span>`).join('')}</div>
          <div class="crew-actions">
            ${hub.settings.mode === 'turns'
              ? `<button class="btn sm" data-helm="${p.id}" ${p.id === me?.id ? 'disabled' : ''}>${p.id === me?.id ? 'At the helm' : 'Give them the helm'}</button>`
              : `<button class="btn sm" data-me="${p.id}" ${p.id === me?.id ? 'disabled' : ''}>${p.id === me?.id ? 'This is you' : 'This is me'}</button>`}
            <button class="btn sm danger" data-remove="${p.id}">Remove</button>
          </div>
        </div>`;
      }).join('')}
    </div>
    ${hub.players.length < MAX_PLAYERS ? `<div class="d-section"><div class="d-title">Add crew member</div>
      <form id="crew-add" class="d-row" style="border:none"><input class="input d-grow" name="name" placeholder="Name" maxlength="24" required><button class="btn primary sm" type="submit">Add</button></form></div>` : `<div class="d-note">The crew is full (${MAX_PLAYERS}).</div>`}`;
  return {
    kicker: `${hub.players.length} ABOARD`, title: 'Crew Manifest', html,
    bind(b) {
      b.querySelectorAll('[data-color]').forEach(i => i.addEventListener('change', () => act('player.update', { playerId: i.dataset.color, color: i.value })));
      b.querySelectorAll('[data-name]').forEach(i => i.addEventListener('change', () => act('player.update', { playerId: i.dataset.name, name: i.value })));
      b.querySelectorAll('[data-helm]').forEach(x => x.addEventListener('click', () => act('turn.set', { playerId: x.dataset.helm })));
      b.querySelectorAll('[data-me]').forEach(x => x.addEventListener('click', () => { prefs.me = x.dataset.me; sfx.select(); render(); renderDrawer(); }));
      b.querySelectorAll('[data-remove]').forEach(x => x.addEventListener('click', async () => {
        const p = player(x.dataset.remove);
        if (await confirmBox('Remove crew member', `Remove ${p.name} from the crew? Their score leaves with them; accepted assists stay in the ledger.`)) act('player.remove', { playerId: p.id });
      }));
      b.querySelectorAll('[data-unlink]').forEach(x => x.addEventListener('click', () => act('player.unlinkAvatar', { playerId: x.dataset.unlink })));
      b.querySelectorAll('[data-forge]').forEach(x => x.addEventListener('click', async () => {
        const slot = x.closest('.avatar-slot');
        slot.innerHTML = '<span class="d-note">Contacting the Avatar Forge...</span>';
        const d = await fetch('/api/forge/avatars').then(r => r.json()).catch(() => ({ available: false }));
        if (!d.available) { slot.innerHTML = '<span class="d-note">The Avatar Forge is not running. Start it, or bring an avatar file instead.</span>'; return; }
        if (!d.avatars.length) { slot.innerHTML = '<span class="d-note">The Forge has no avatars yet.</span>'; return; }
        slot.innerHTML = `<select class="input" data-pick="${x.dataset.forge}"><option value="">Choose an avatar</option>${d.avatars.map(a => `<option value="${esc(a.id)}">${esc(a.alias ? `${a.name} · ${a.alias}` : a.name)}${a.level ? ` · LV ${a.level}` : ''}${a.sample ? ' (sample)' : ''}</option>`).join('')}</select>`;
        slot.querySelector('select').addEventListener('change', async (e) => {
          if (!e.target.value) return;
          const res = await fetch('/api/forge/link', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ playerId: x.dataset.forge, avatarId: e.target.value }) });
          const j = await res.json();
          if (!res.ok) { toast(j.error, 'error'); sfx.error(); return; }
          sfx.badge(); applyHub(j.hub, j.events); renderDrawer();
        });
      }));
      b.querySelectorAll('[data-avfile]').forEach(i => i.addEventListener('change', async () => {
        const f = i.files[0]; if (!f) return;
        let avatar; try { avatar = JSON.parse(await f.text()); } catch { toast('That file is not an avatar (not JSON).', 'error'); return; }
        if (await act('player.linkAvatar', { playerId: i.dataset.avfile, avatar: avatar.avatar || avatar })) { sfx.badge(); renderDrawer(); }
      }));
      b.querySelector('#crew-add')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const r = await act('player.add', { name: e.target.name.value });
        if (r) { sfx.success(); renderDrawer(); }
      });
    }
  };
}

function avatarBlock(p) {
  const a = p.avatar;
  if (!a) return `<div class="avatar-slot"><span class="av-k">AVATAR</span><button class="btn sm" data-forge="${p.id}">From Avatar Forge</button><label class="btn sm" style="cursor:pointer">From file<input type="file" accept=".json,application/json" data-avfile="${p.id}" hidden></label></div>`;
  return `<div class="avatar-card" style="--acc:${esc(a.accent || p.color)}">
    <div class="av-top"><span class="av-k">AVATAR</span><b>${esc(a.alias || a.name)}</b>${a.alias ? `<span class="av-dim">${esc(a.name)}</span>` : ''}<button class="mini-link" data-unlink="${p.id}" style="margin-left:auto">UNLINK</button></div>
    <div class="av-tags">${[a.element, a.guild, a.level ? `LV ${a.level}` : '', a.rank].filter(Boolean).map(t => `<span>${esc(t)}</span>`).join('')}</div>
    ${a.skills?.length ? `<div class="av-skills">${a.skills.slice(0, 5).map(k => `${esc(k.name)}${k.level ? ` <i>${'●'.repeat(k.level)}</i>` : ''}`).join(' · ')}</div>` : ''}
  </div>`;
}

function drawLedger(opts) {
  const pid = opts.projectId || '';
  const list = hub.contributions.filter(c => !pid || c.projectId === pid).sort((a, b) => b.createdAt - a.createdAt);
  const accepted = list.filter(c => c.status === 'accepted');
  const me = actor();
  const html = `
    <div class="ledger-filter"><select class="input" id="ledger-project"><option value="">All projects</option>${hub.projects.map(p => `<option value="${p.id}" ${p.id === pid ? 'selected' : ''}>${esc(p.title)}${p.archived ? ' (archived)' : ''}</option>`).join('')}</select></div>
    <div class="stat-grid">
      <div class="stat"><b>${accepted.length}</b><span>ACCEPTED</span></div>
      <div class="stat"><b>${list.filter(c => c.status === 'pending').length}</b><span>WAITING</span></div>
      <div class="stat"><b>${accepted.reduce((s, c) => s + (c.gained ?? c.points), 0)}</b><span>POINTS</span></div>
    </div>
    ${list.length ? list.map(c => {
      const pr = hub.projects.find(p => p.id === c.projectId);
      const need = pr?.needs.find(n => n.id === c.needId);
      const h = player(c.playerId);
      const canReview = c.status === 'pending' && pr?.ownerId === me?.id;
      return `<div class="l-item" style="--c:${esc(h?.color || '#445')}">
        <div class="l-head"><b>${esc(h?.name || 'FORMER CREW')}</b><span class="chip ${c.status}">${c.status}</span><span class="l-pts">${c.status === 'accepted' ? `+${c.gained ?? c.points}` : `${c.points} pts`}</span></div>
        <div class="l-meta">${esc(METHOD_LABEL[c.method])} · <b>${esc(need?.title || 'removed need')}</b>${pid ? '' : ` · ${esc(pr?.title || '')}`} · ${ago(c.createdAt)}</div>
        <div class="offer-body">${payloadHtml(c) || '<span class="k">no details</span>'}</div>
        ${canReview ? `<div class="offer-actions"><button class="btn-accept" data-accept="${c.id}">ACCEPT</button><button class="btn-decline" data-decline="${c.id}">DECLINE</button></div>` : ''}
      </div>`;
    }).join('') : '<div class="d-note">No assists recorded yet. When someone helps, the proof, the contact or the idea is kept here for good.</div>'}`;
  return {
    kicker: pid ? 'PROJECT LEDGER' : 'ALL PROJECTS', title: 'Mission Ledger', html,
    bind(b) {
      b.querySelector('#ledger-project').addEventListener('change', (e) => { drawerState.opts.projectId = e.target.value; renderDrawer(); });
      b.querySelectorAll('[data-accept]').forEach(x => x.addEventListener('click', () => act('assist.review', { contributionId: x.dataset.accept, decision: 'accept' })));
      b.querySelectorAll('[data-decline]').forEach(x => x.addEventListener('click', () => act('assist.review', { contributionId: x.dataset.decline, decision: 'decline' })));
    }
  };
}

function drawSettings() {
  const s = hub.settings;
  const html = `
    <div class="d-section"><div class="d-title">Play</div>
      <div class="d-row"><div class="d-grow set-label">Mode<small>Turns: one crew member at the helm at a time, like the original. Free play: everyone acts whenever they like and picks who they are on their own screen.</small></div></div>
      <div class="seg" id="seg-mode"><button data-v="turns" class="${s.mode === 'turns' ? 'on' : ''}">Turns</button><button data-v="free" class="${s.mode === 'free' ? 'on' : ''}">Free play</button></div>
      <div class="d-row"><div class="d-grow set-label">Owner review<small>Offers wait for the project owner to accept them before points are paid. Off: every offer counts instantly.</small></div><button class="toggle ${s.ownerReview ? 'on' : ''}" id="t-review" aria-label="Owner review"></button></div>
    </div>
    <div class="d-section"><div class="d-title">This screen</div>
      <div class="d-row"><div class="d-grow set-label">Sound effects</div><button class="toggle ${prefs.sound ? 'on' : ''}" id="t-sound" aria-label="Sound"></button></div>
      <div class="d-row"><div class="d-grow set-label">Ambient hum<small>A low engine drone under the map.</small></div><button class="toggle ${droneOn() ? 'on' : ''}" id="t-drone" aria-label="Ambient hum"></button></div>
      <div class="d-row"><div class="d-grow set-label">Graphics<small>Low turns off the glow and renders at standard resolution for older machines.</small></div></div>
      <div class="seg" id="seg-quality"><button data-v="high" class="${prefs.quality === 'high' ? 'on' : ''}">High</button><button data-v="low" class="${prefs.quality === 'low' ? 'on' : ''}">Low</button></div>
      <div class="d-row"><div class="d-grow set-label">Show archived projects</div><button class="toggle ${prefs.showArchived ? 'on' : ''}" id="t-archived" aria-label="Show archived"></button></div>
    </div>
    <div class="d-section"><div class="d-title">Join from other devices</div>
      ${lan.length ? `<div class="d-note">Anyone on this Wi-Fi can open:</div>${lan.map(u => `<div class="d-row"><a href="${esc(u)}" target="_blank">${esc(u)}</a></div>`).join('')}`
        : '<div class="d-note">Right now only this Mac can open the hub. Double-click <b>Start Ko-Labz on Wi-Fi</b> in the Ko-Labz folder and phones on the same Wi-Fi can join with the address it shows. Every screen updates live.</div>'}
    </div>
    <div class="d-section"><div class="d-title">Data</div>
      <div class="d-note">Everything is saved on this Mac in <b>${esc((dataDir || '~/Ko-Labz Data') + '/hub.json')}</b> after every change, with a backup every 10 minutes (the last 30 are kept).</div>
      <div class="d-row"><a class="btn sm" href="/api/export" download>Export hub</a><label class="btn sm" style="cursor:pointer">Import hub<input type="file" id="import-file" accept="application/json,.json" hidden></label></div>
    </div>
    <div class="d-section"><div class="d-title red">Danger</div>
      <div class="d-note">Reset wipes the crew, every project and the ledger. A backup is written first.</div>
      <button class="btn danger sm" id="btn-reset">Reset hub</button>
    </div>
    <div class="d-note" style="opacity:.6">Hub version ${hub.version} · ${hub.players.length} crew · ${hub.projects.length} projects · ${hub.contributions.length} assists recorded</div>`;
  return {
    kicker: 'CONFIGURATION', title: 'Systems', html,
    bind(b) {
      b.querySelectorAll('#seg-mode button').forEach(x => x.addEventListener('click', () => act('settings.update', { mode: x.dataset.v })));
      b.querySelector('#t-review').addEventListener('click', () => act('settings.update', { ownerReview: !s.ownerReview }));
      b.querySelector('#t-sound').addEventListener('click', () => { toggleSound(); renderDrawer(); });
      b.querySelector('#t-drone').addEventListener('click', () => { if (droneOn()) { stopDrone(); prefs.drone = false; } else { startDrone(); prefs.drone = true; } renderDrawer(); });
      b.querySelectorAll('#seg-quality button').forEach(x => x.addEventListener('click', () => { prefs.quality = x.dataset.v; scene.setQuality(x.dataset.v); renderDrawer(); }));
      b.querySelector('#t-archived').addEventListener('click', () => { prefs.showArchived = !prefs.showArchived; scene.setShowArchived(prefs.showArchived); renderDrawer(); });
      b.querySelector('#import-file').addEventListener('change', async (e) => {
        const f = e.target.files[0]; if (!f) return;
        if (!await confirmBox('Import hub', `Replace the current hub with ${f.name}? The current hub is backed up first.`)) return;
        const res = await fetch('/api/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: await f.text() });
        const d = await res.json();
        if (!res.ok) { toast(d.error, 'error'); sfx.error(); return; }
        applyHub(d.hub, [{ kind: 'import' }]); scene.enterGalaxy({ instant: true });
      });
      b.querySelector('#btn-reset').addEventListener('click', async () => {
        if (!await confirmBox('Reset hub', 'This removes the whole crew, every project and the ledger. Type RESET to confirm.', 'RESET')) return;
        const res = await act('hub.reset', { confirm: 'RESET' });
        if (res) { closeDrawer(); scene.enterGalaxy({ instant: true }); }
      });
    }
  };
}

function drawProject(opts) {
  const p = hub.projects.find(x => x.id === opts.projectId);
  if (!p) return null;
  const needRow = (n) => `
    <div class="need-edit ${n.ring} ${n.status}" data-need="${n.id}" id="ne-${n.id}">
      <div class="ne-row"><input class="input" name="title" value="${esc(n.title)}" maxlength="60"><span class="ne-status">${n.status}</span></div>
      <input class="input" name="description" value="${esc(n.description)}" maxlength="400" placeholder="Details">
      <div class="ne-row">
        <button class="btn sm" data-save-need>Save</button>
        ${n.status === 'fulfilled' ? '<button class="btn sm" data-reopen>Reopen</button>' : '<button class="btn sm" data-resolve>Mark resolved</button>'}
        <button class="btn sm danger" data-remove-need style="margin-left:auto">Remove</button>
      </div>
    </div>`;
  const ring = (r) => {
    const list = p.needs.filter(n => n.ring === r);
    return `<div class="d-section"><div class="d-title ${r === 'major' ? 'violet' : ''}">${r} ring · ${list.length}/${MAX_NEEDS_PER_RING}</div>
      ${list.map(needRow).join('')}
      ${list.length < MAX_NEEDS_PER_RING ? `<form class="need-edit ${r}" data-add-need="${r}" style="border-style:dashed">
        <input class="input" name="title" placeholder="New ${r} need" maxlength="60" required>
        <input class="input" name="description" placeholder="Details (optional)" maxlength="400">
        <div class="ne-row"><button class="btn sm primary" type="submit">Add need</button></div></form>` : ''}
    </div>`;
  };
  const me = actor();
  const owner = player(p.ownerId);
  const canEdit = me?.id === p.ownerId;
  const html = `
    ${canEdit ? '' : `<div class="d-note" style="border-left:2px solid var(--amber);padding-left:10px">Only <b style="color:${esc(owner?.color)}">${esc(owner?.name)}</b> can change this project${hub.settings.mode === 'turns' ? ', on their turn' : ''}. You can help with its needs from the star map.</div>`}
    <form class="d-section" id="proj-form">
      <div class="d-title">Core parameters</div>
      <label class="b-field" style="margin-bottom:10px"><span>Title</span><input class="input" name="title" value="${esc(p.title)}" maxlength="60" required></label>
      <label class="b-field" style="margin-bottom:10px"><span>Vision</span><textarea class="input" name="vision" rows="3" maxlength="600">${esc(p.vision)}</textarea></label>
      <label class="b-field" style="margin-bottom:12px"><span>Owner</span><select class="input" name="ownerId">${hub.players.map(x => `<option value="${x.id}" ${x.id === p.ownerId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      <button class="btn primary sm" type="submit">Save changes</button>
    </form>
    ${ring('minor')}${ring('major')}
    <div class="d-section"><div class="d-title red">Lifecycle</div>
      <div class="d-row"><button class="btn sm" id="btn-archive">${p.archived ? 'Restore to map' : 'Archive project'}</button><button class="btn sm danger" id="btn-delete">Delete project</button></div>
      <div class="d-note">Archiving hides the system from the star map but keeps it and its ledger. Deleting removes it; accepted assists and points stay.</div>
    </div>`;
  return {
    kicker: canEdit ? 'PROJECT CONTROL' : 'PROJECT DETAILS', title: p.title, html,
    bind(b) {
      if (!canEdit) { b.querySelectorAll('input, textarea, select, button').forEach(x => { x.disabled = true; }); b.querySelectorAll('[data-add-need]').forEach(f => f.remove()); return; }
      b.querySelector('#proj-form').addEventListener('submit', async (e) => {
        e.preventDefault(); const f = e.target;
        if (await act('project.update', { projectId: p.id, title: f.title.value, vision: f.vision.value, ownerId: f.ownerId.value })) { toast('Project updated.', 'info', 'SAVED'); renderDrawer(); }
      });
      b.querySelectorAll('[data-need]').forEach(row => {
        const id = row.dataset.need;
        row.querySelector('[data-save-need]').addEventListener('click', async () => {
          if (await act('need.update', { projectId: p.id, needId: id, title: row.querySelector('[name=title]').value, description: row.querySelector('[name=description]').value })) { toast('Need updated.', 'info', 'SAVED'); renderDrawer(); }
        });
        row.querySelector('[data-reopen]')?.addEventListener('click', async () => { if (await act('need.reopen', { projectId: p.id, needId: id })) renderDrawer(); });
        row.querySelector('[data-resolve]')?.addEventListener('click', async () => { if (await act('need.resolve', { projectId: p.id, needId: id })) renderDrawer(); });
        row.querySelector('[data-remove-need]').addEventListener('click', async () => {
          if (await confirmBox('Remove need', 'Remove this need from the project? Waiting offers on it are withdrawn.')) { if (await act('need.remove', { projectId: p.id, needId: id })) renderDrawer(); }
        });
      });
      b.querySelectorAll('[data-add-need]').forEach(f => f.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (await act('need.add', { projectId: p.id, ring: f.dataset.addNeed, title: f.title.value, description: f.description.value })) { sfx.success(); renderDrawer(); }
      }));
      b.querySelector('#btn-archive').addEventListener('click', async () => {
        if (await act('project.archive', { projectId: p.id, archived: !p.archived })) { if (!p.archived && !prefs.showArchived) { closeDrawer(); toGalaxy(); } else renderDrawer(); }
      });
      b.querySelector('#btn-delete').addEventListener('click', async () => {
        if (!await confirmBox('Delete project', `Delete ${p.title}? Type DELETE to confirm.`, 'DELETE')) return;
        if (await act('project.delete', { projectId: p.id })) { closeDrawer(); }
      });
      if (opts.needId) setTimeout(() => { const el = b.querySelector(`#ne-${CSS.escape(opts.needId)}`); el?.scrollIntoView({ block: 'center' }); el?.querySelector('input')?.focus(); }, 80);
    }
  };
}

function drawHelp() {
  return {
    kicker: 'FIELD MANUAL', title: 'How it works',
    html: `
      <div class="d-section"><div class="d-title">The idea</div>
        <div class="d-note">Every project is a star system. The project is the sun; what it needs orbits it as planets: small, quick needs on the inner <b class="minor">minor ring</b>, the big lifts on the outer <b class="major">major ring</b>. The crew helps each other finish projects, and every bit of help is kept in the ledger for good.</div>
        <div class="d-note">Pick a planet that is not yours and help it one of three ways: <b>Fulfill directly</b> (you did it, here is the proof), <b>Source a connection</b> (you know who can), or <b>Add a solution</b> (here is how). The owner reviews each offer. Accepted offers turn the planet white, give it a moon in your colour, and pay points. When every planet is met the project goes supernova.</div>
      </div>
      <div class="d-section"><div class="d-title">Controls</div>
        <div class="kbd-list">
          <kbd>drag</kbd><span>Orbit the camera</span>
          <kbd>scroll</kbd><span>Zoom</span>
          <kbd>click</kbd><span>Select a star, planet or the project core</span>
          <kbd>1-4</kbd><span>The four console buttons</span>
          <kbd>[ ]</kbd><span>Previous / next planet</span>
          <kbd>Esc</kbd><span>Back out one step</span>
          <kbd>G</kbd><span>Star map</span>
          <kbd>T</kbd><span>Cycle turn</span>
          <kbd>C</kbd><span>Crew manifest</span>
          <kbd>L</kbd><span>Ledger</span>
          <kbd>S</kbd><span>Systems</span>
          <kbd>M</kbd><span>Sound on or off</span>
        </div>
      </div>`
  };
}

// ---------- briefing ----------
let briefingFirstRun = false;
function openBriefing() {
  briefingFirstRun = !hub.players.length;
  $('b-crew').hidden = !briefingFirstRun;
  $('b-cancel').hidden = briefingFirstRun;
  $('briefing-title').textContent = briefingFirstRun ? 'Mission Briefing' : 'Launch Project';
  $('briefing-sub').textContent = briefingFirstRun ? 'ASSEMBLE THE CREW · DEFINE THE FIRST PROJECT' : 'A NEW STAR SYSTEM FOR THE MAP';
  $('briefing-error').textContent = '';
  $('b-title').value = ''; $('b-vision').value = '';
  $('b-minor').innerHTML = ''; $('b-major').innerHTML = '';
  for (let i = 0; i < 4; i++) addNeedRow('minor');
  for (let i = 0; i < 3; i++) addNeedRow('major');
  if (briefingFirstRun) { $('b-crew-rows').innerHTML = ''; addCrewRow(); addCrewRow(); }
  $('b-template-list').innerHTML = templates.map(t => `<button type="button" class="tpl" data-tpl="${esc(t.key)}">${esc(t.title)}</button>`).join('');
  refreshOwnerSelect();
  $('briefing').hidden = false;
  setTimeout(() => (briefingFirstRun ? $('b-crew-rows').querySelector('input[type=text]') : $('b-title')).focus(), 80);
}
function closeBriefing() { $('briefing').hidden = true; }

function addNeedRow(ring, t = '', d = '') {
  const box = $(`b-${ring}`);
  if (box.children.length >= MAX_NEEDS_PER_RING) return;
  const row = document.createElement('div'); row.className = 'b-need';
  row.innerHTML = `<input class="input" data-t placeholder="${ring === 'minor' ? 'Minor' : 'Major'} need ${box.children.length + 1}" maxlength="60" value="${esc(t)}"><input class="input" data-d placeholder="What exactly is needed?" maxlength="400" value="${esc(d)}"><button type="button" class="x" aria-label="Remove">✕</button>`;
  row.querySelector('.x').onclick = () => row.remove();
  box.appendChild(row);
}
function addCrewRow(name = '') {
  const box = $('b-crew-rows');
  if (box.children.length >= MAX_PLAYERS) return;
  const row = document.createElement('div'); row.className = 'b-crew-row';
  const used = [...box.querySelectorAll('input[type=color]')].map(i => i.value);
  const color = PALETTE.find(c => !used.includes(c)) || PALETTE[0];
  row.innerHTML = `<input type="color" value="${color}"><input type="text" class="input" placeholder="Crew member ${box.children.length + 1}" maxlength="24" value="${esc(name)}"><button type="button" class="x" aria-label="Remove">✕</button>`;
  row.querySelector('.x').onclick = () => { if (box.children.length > 1) { row.remove(); refreshOwnerSelect(); } };
  row.querySelector('input[type=text]').addEventListener('input', refreshOwnerSelect);
  box.appendChild(row);
  refreshOwnerSelect();
}
function refreshOwnerSelect() {
  const sel = $('b-owner'); const prev = sel.value;
  if (briefingFirstRun) {
    const names = [...$('b-crew-rows').querySelectorAll('input[type=text]')].map((i, k) => i.value.trim().toUpperCase() || `CREW MEMBER ${k + 1}`);
    sel.innerHTML = names.map((n, k) => `<option value="${k}">${esc(n)}</option>`).join('');
  } else {
    const me = actor();
    sel.innerHTML = hub.players.map(p => `<option value="${p.id}" ${p.id === me?.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  }
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
}
$('b-crew-add').addEventListener('click', () => addCrewRow());
document.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => addNeedRow(b.dataset.add)));
$('b-template-list').addEventListener('click', (e) => {
  const t = templates.find(x => x.key === e.target.dataset.tpl); if (!t) return;
  sfx.select();
  $('b-title').value = t.title; $('b-vision').value = t.vision;
  $('b-minor').innerHTML = ''; $('b-major').innerHTML = '';
  t.minor.forEach(([a, b]) => addNeedRow('minor', a, b));
  t.major.forEach(([a, b]) => addNeedRow('major', a, b));
});
$('b-cancel').addEventListener('click', () => { sfx.back(); closeBriefing(); });
$('briefing-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('briefing-error');
  const needs = (ring) => [...$(`b-${ring}`).children].map(r => ({ title: r.querySelector('[data-t]').value, description: r.querySelector('[data-d]').value })).filter(n => n.title.trim());
  const title = $('b-title').value.trim();
  $('b-title').classList.toggle('error', !title);
  if (briefingFirstRun) {
    const crew = [...$('b-crew-rows').children].map(r => ({ name: r.querySelector('input[type=text]').value, color: r.querySelector('input[type=color]').value }));
    if (!crew.some(c => c.name.trim())) { err.textContent = 'Name at least one crew member.'; sfx.error(); return; }
  }
  if (!title) { err.textContent = 'Give the project a title.'; sfx.error(); return; }
  if (!needs('minor').length && !needs('major').length) { err.textContent = 'Add at least one need so the crew knows how to help.'; sfx.error(); return; }
  err.textContent = '';
  let ownerId = $('b-owner').value;
  if (briefingFirstRun) {
    const rows = [...$('b-crew-rows').children];
    const crew = rows.map(r => ({ name: r.querySelector('input[type=text]').value, color: r.querySelector('input[type=color]').value }));
    const ownerName = (crew[Number(ownerId)]?.name || '').trim().toUpperCase();
    const res = await act('crew.setup', { players: crew });
    if (!res) return;
    ownerId = (hub.players.find(p => p.name === ownerName) || hub.players[0]).id;
    if (hub.settings.mode === 'free') prefs.me = ownerId;
  }
  const res = await act('project.create', { ownerId, title, vision: $('b-vision').value, minor: needs('minor'), major: needs('major') });
  if (!res) return;
  closeBriefing();
  sfx.success();
  setTimeout(() => enterProject(res.result.projectId), 300);
});

// ---------- confirm, toast, banner ----------
function confirmBox(title, text, typed = '') {
  return new Promise(resolve => {
    $('confirm-title').textContent = title; $('confirm-text').textContent = text;
    const inp = $('confirm-input'); inp.hidden = !typed; inp.value = ''; inp.placeholder = typed;
    $('confirm').hidden = false;
    setTimeout(() => (typed ? inp : $('confirm-yes')).focus(), 50);
    const done = (v) => { $('confirm').hidden = true; $('confirm-form').onsubmit = null; $('confirm-no').onclick = null; resolve(v); };
    $('confirm-form').onsubmit = (e) => { e.preventDefault(); if (typed && inp.value.trim().toUpperCase() !== typed) { inp.classList.add('error'); sfx.error(); return; } inp.classList.remove('error'); done(true); };
    $('confirm-no').onclick = () => done(false);
    confirmBox.cancel = () => done(false);
  });
}

function toast(html, kind = 'info', title = kind === 'error' ? 'ALERT' : 'SYSTEM') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `<small>${esc(title)}</small>${kind === 'error' ? esc(html) : html}`;
  $('toasts').appendChild(el);
  const kill = () => { el.classList.add('out'); setTimeout(() => el.remove(), 400); };
  el.onclick = kill;
  setTimeout(kill, kind === 'error' ? 5200 : 4200);
  while ($('toasts').children.length > 5) $('toasts').firstChild.remove();
}

function showBanner(project) {
  if (!project) return;
  $('banner-project').textContent = project.title;
  $('banner').hidden = false;
  $('banner-ok').focus();
}
$('banner-ok').addEventListener('click', () => { $('banner').hidden = true; });

// ---------- utility buttons ----------
function toggleSound() { prefs.sound = !prefs.sound; setSound(prefs.sound); if (prefs.sound) sfx.select(); render(); }
$('btn-sound').addEventListener('click', toggleSound);
$('btn-ledger').addEventListener('click', () => { sfx.open(); openDrawer('ledger', { projectId: ui.view === 'system' ? ui.projectId : '' }); });
$('btn-settings').addEventListener('click', () => { sfx.open(); openDrawer('settings'); });
$('btn-help').addEventListener('click', () => { sfx.open(); openDrawer('help'); });
$('btn-crew').addEventListener('click', () => { sfx.open(); openDrawer('crew'); });
$('crumb-galaxy').addEventListener('click', toGalaxy);

// First gesture unlocks audio and starts the hum if it was on last time.
window.addEventListener('pointerdown', function first() {
  window.removeEventListener('pointerdown', first);
  if (prefs.drone && prefs.sound) startDrone();
}, { once: true });

// ---------- keyboard ----------
function cycleNeed(dir) {
  const p = currentProject(); if (!p || ui.view !== 'system') return;
  const ids = p.needs.map(n => n.id);
  const i = ui.sel?.kind === 'need' ? ids.indexOf(ui.sel.id) : (dir > 0 ? -1 : 0);
  const next = ids[(i + dir + ids.length) % ids.length];
  ui.sel = { kind: 'need', id: next }; ui.action = null; scene.select(ui.sel); sfx.select(); render();
}

window.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if (e.key === 'Escape') {
    if (!$('confirm').hidden) return confirmBox.cancel?.();
    if (!$('banner').hidden) { $('banner').hidden = true; return; }
    if (typing) { document.activeElement.blur(); if (ui.action) closeAction(); return; }
    if (drawerState) return closeDrawer();
    if (!$('briefing').hidden && !briefingFirstRun) return closeBriefing();
    if (ui.action) return closeAction();
    if (ui.view === 'galaxy' && ui.focusId) { ui.focusId = null; sfx.back(); return render(); }
    if (ui.sel) return hooksSelect(null);
    if (ui.view === 'system') return toGalaxy();
    return;
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (!$('briefing').hidden || !$('confirm').hidden) return;
  const k = e.key.toLowerCase();
  if (['1', '2', '3', '4'].includes(k)) { $(CMD[Number(k) - 1]).click(); e.preventDefault(); }
  else if (k === 'g') toGalaxy();
  else if (k === 't' && hub?.settings.mode === 'turns' && hub.players.length) act('turn.next');
  else if (k === 'c') { sfx.open(); openDrawer('crew'); }
  else if (k === 'l') { sfx.open(); openDrawer('ledger', { projectId: ui.view === 'system' ? ui.projectId : '' }); }
  else if (k === 's') { sfx.open(); openDrawer('settings'); }
  else if (k === 'm') toggleSound();
  else if (k === '?' || k === 'h') { sfx.open(); openDrawer('help'); }
  else if (k === ']') cycleNeed(1);
  else if (k === '[') cycleNeed(-1);
  else if (k === 'arrowleft') scene.nudge(-0.25);
  else if (k === 'arrowright') scene.nudge(0.25);
  else if (k === '=' || k === '+') scene.zoom(0.85);
  else if (k === '-') scene.zoom(1.18);
});

setInterval(() => hub && renderStream(), 30000);
if (prefs.showArchived) scene.setShowArchived(true);
boot();
