// Ko-Labz rulebook. The one place that decides what an action does to the hub.
// Pure: apply(state, action) returns { state, events } or throws a RuleError.
// The server runs it (authoritative); the tests run it directly.

export const RING_BASE = { minor: 10, major: 25 };
export const METHOD_MULT = { self: 1, contact: 0.7, suggestion: 0.4 };
export const METHOD_LABEL = { self: 'Fulfilled directly', contact: 'Sourced a connection', suggestion: 'Proposed a solution' };
export const RING_CLOSE_BONUS = 10;
export const MISSION_BONUS = 20;
export const MAX_PLAYERS = 8;
export const MAX_NEEDS_PER_RING = 8;
export const PALETTE = ['#ff4f6d', '#00d4ff', '#4dff9a', '#b06bff', '#ffb52e', '#ff7ae0', '#7dfcff', '#d4ff4d'];

export const RANKS = [
  [0, 'Cadet'], [25, 'Ensign'], [60, 'Navigator'], [110, 'Commander'], [180, 'Captain'], [280, 'Admiral']
];
export function rankFor(score) {
  let r = RANKS[0][1];
  for (const [min, name] of RANKS) if (score >= min) r = name;
  return r;
}

export const BADGES = {
  first_assist: { name: 'First Contact', desc: 'Your first accepted assist.' },
  ring_closer: { name: 'Ring Closer', desc: 'Your assist completed a whole ring.' },
  connector: { name: 'Switchboard', desc: 'Three accepted connections.' },
  architect: { name: 'Architect', desc: 'Three accepted solutions.' },
  hands_on: { name: 'Hands On', desc: 'Three needs fulfilled directly.' },
  supernova: { name: 'Supernova', desc: 'One of your projects reached completion.' },
  heavy_lifter: { name: 'Heavy Lifter', desc: 'Fulfilled a major need.' },
  founder: { name: 'Founder', desc: 'Launched your first project.' }
};

export class RuleError extends Error {
  constructor(msg) { super(msg); this.name = 'RuleError'; }
}
const fail = (msg) => { throw new RuleError(msg); };

let idCounter = 0;
export function makeId(prefix) {
  idCounter = (idCounter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function emptyHub() {
  return {
    version: 0,
    players: [],
    projects: [],
    contributions: [],
    activity: [],
    turn: { index: 0, number: 1 },
    settings: { mode: 'turns', ownerReview: true },
    createdAt: Date.now()
  };
}

const clean = (v, max = 400) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const cleanMulti = (v, max = 2000) => String(v ?? '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim().slice(0, max);

export function safeLink(v) {
  const s = clean(v, 600);
  if (!s) return '';
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
    return ['http:', 'https:'].includes(u.protocol) ? u.href : '';
  } catch { return ''; }
}

export function pointsFor(ring, method) {
  return Math.round(RING_BASE[ring] * METHOD_MULT[method]);
}

export function actingPlayer(state, action) {
  if (state.settings.mode === 'turns') return state.players[state.turn.index] || null;
  return state.players.find(p => p.id === action.actorId) || state.players[state.turn.index] || null;
}

export function projectProgress(project) {
  const by = (ring) => {
    const list = project.needs.filter(n => n.ring === ring);
    const done = list.filter(n => n.status === 'fulfilled').length;
    return { done, total: list.length, ratio: list.length ? done / list.length : 1 };
  };
  const minor = by('minor'), major = by('major');
  const total = minor.total + major.total, done = minor.done + major.done;
  return { minor, major, done, total, ratio: total ? done / total : 0 };
}

function normalizeNeeds(list, ring) {
  if (!Array.isArray(list)) return [];
  return list
    .map(n => ({ title: clean(n?.title, 60), description: cleanMulti(n?.description, 400) }))
    .filter(n => n.title)
    .slice(0, MAX_NEEDS_PER_RING)
    .map(n => ({ id: makeId('need'), ring, title: n.title, description: n.description, status: 'open', fulfilledBy: null, contributionId: null }));
}

function award(state, events, player, badge) {
  if (!player || player.badges.includes(badge)) return;
  player.badges.push(badge);
  events.push({ kind: 'badge', playerId: player.id, badge });
  log(state, { kind: 'badge', text: `${player.name} earned the ${BADGES[badge].name} badge`, color: player.color });
}

function log(state, entry) {
  state.activity.push({ id: makeId('act'), at: Date.now(), ...entry });
  if (state.activity.length > 400) state.activity.splice(0, state.activity.length - 400);
}

function getProject(state, id) { return state.projects.find(p => p.id === id) || fail('That project no longer exists.'); }
// Project changes belong to the owner. In turns mode that means on their turn.
function ownedProject(state, a) {
  const project = getProject(state, a.projectId);
  const actor = actingPlayer(state, a);
  if (!actor || actor.id !== project.ownerId) {
    const owner = state.players.find(p => p.id === project.ownerId);
    fail(`Only ${owner?.name ?? 'the owner'} can change ${project.title}${state.settings.mode === 'turns' ? ', on their turn' : ''}.`);
  }
  return project;
}
function getNeed(project, id) { return project.needs.find(n => n.id === id) || fail('That need no longer exists.'); }
function getPlayer(state, id) { return state.players.find(p => p.id === id) || fail('That crew member no longer exists.'); }

function nextColor(state) {
  const used = new Set(state.players.map(p => p.color));
  return PALETTE.find(c => !used.has(c)) || PALETTE[state.players.length % PALETTE.length];
}

function addPlayer(state, name, color) {
  const n = clean(name, 24).toUpperCase();
  if (!n) fail('Give the crew member a name.');
  if (state.players.length >= MAX_PLAYERS) fail(`The crew is full (${MAX_PLAYERS} max).`);
  if (state.players.some(p => p.name === n)) fail(`${n} is already aboard.`);
  const c = /^#[0-9a-f]{6}$/i.test(color || '') ? color.toLowerCase() : nextColor(state);
  const p = { id: makeId('pl'), name: n, color: c, score: 0, badges: [], joinedAt: Date.now() };
  state.players.push(p);
  return p;
}

// Accepting one contribution fulfils the need, awards points and bonuses,
// and supersedes any other pending offers on the same need.
function accept(state, events, contribution) {
  const project = getProject(state, contribution.projectId);
  const need = getNeed(project, contribution.needId);
  const player = state.players.find(p => p.id === contribution.playerId);
  const before = projectProgress(project);

  contribution.status = 'accepted';
  contribution.resolvedAt = Date.now();
  need.status = 'fulfilled';
  need.fulfilledBy = contribution.playerId;
  need.contributionId = contribution.id;
  for (const c of state.contributions) {
    if (c !== contribution && c.needId === need.id && c.status === 'pending') {
      c.status = 'superseded'; c.resolvedAt = Date.now();
    }
  }

  let gained = contribution.points;
  if (player) player.score += contribution.points;
  const after = projectProgress(project);
  const owner = state.players.find(p => p.id === project.ownerId);

  log(state, {
    kind: 'assist', color: player?.color,
    text: `${player?.name ?? 'Someone'} aided ${owner?.name ?? 'the owner'} on ${need.title} (+${contribution.points})`,
    projectId: project.id, needId: need.id
  });
  events.push({ kind: 'fulfilled', projectId: project.id, needId: need.id, playerId: contribution.playerId, points: contribution.points });

  if (player) {
    award(state, events, player, 'first_assist');
    if (need.ring === 'major') award(state, events, player, 'heavy_lifter');
    const mine = state.contributions.filter(c => c.playerId === player.id && c.status === 'accepted');
    if (mine.filter(c => c.method === 'contact').length >= 3) award(state, events, player, 'connector');
    if (mine.filter(c => c.method === 'suggestion').length >= 3) award(state, events, player, 'architect');
    if (mine.filter(c => c.method === 'self').length >= 3) award(state, events, player, 'hands_on');
  }

  for (const ring of ['minor', 'major']) {
    if (after[ring].total && after[ring].done === after[ring].total && before[ring].done < before[ring].total) {
      if (player) { player.score += RING_CLOSE_BONUS; gained += RING_CLOSE_BONUS; award(state, events, player, 'ring_closer'); }
      log(state, { kind: 'ring', color: ring === 'minor' ? '#00d4ff' : '#b06bff', text: `${project.title}: ${ring} ring complete${player ? ` (${player.name} +${RING_CLOSE_BONUS})` : ''}`, projectId: project.id });
      events.push({ kind: 'ring', projectId: project.id, ring });
    }
  }
  if (after.total && after.done === after.total && !project.completedAt) completeProject(state, events, project);
  contribution.gained = gained;
}

function completeProject(state, events, project) {
  project.completedAt = Date.now();
  const owner = state.players.find(p => p.id === project.ownerId);
  if (owner) { owner.score += MISSION_BONUS; award(state, events, owner, 'supernova'); }
  log(state, { kind: 'complete', color: '#ffd36b', text: `PROJECT COMPLETE: ${project.title}${owner ? ` (${owner.name} +${MISSION_BONUS})` : ''}`, projectId: project.id });
  events.push({ kind: 'complete', projectId: project.id });
}

function reopenIfNeeded(project) {
  const pr = projectProgress(project);
  if (project.completedAt && pr.done < pr.total) project.completedAt = null;
}

const handlers = {
  'crew.setup'(state, a, events) {
    if (state.players.length) fail('The crew is already set up. Use the crew panel to add people.');
    const names = Array.isArray(a.players) ? a.players : [];
    for (const p of names) if (clean(p?.name)) addPlayer(state, p.name, p.color);
    if (state.players.length < 1) fail('Add at least one crew member.');
    log(state, { kind: 'system', text: `Crew assembled: ${state.players.map(p => p.name).join(', ')}` });
    events.push({ kind: 'crew' });
  },

  'player.add'(state, a, events) {
    const p = addPlayer(state, a.name, a.color);
    log(state, { kind: 'system', color: p.color, text: `${p.name} joined the crew` });
    events.push({ kind: 'crew' });
  },

  'player.update'(state, a, events) {
    const p = getPlayer(state, a.playerId);
    if (a.name !== undefined) {
      const n = clean(a.name, 24).toUpperCase();
      if (!n) fail('Name cannot be empty.');
      if (state.players.some(o => o !== p && o.name === n)) fail(`${n} is already aboard.`);
      p.name = n;
    }
    if (a.color !== undefined) {
      if (!/^#[0-9a-f]{6}$/i.test(a.color)) fail('Pick a colour.');
      p.color = a.color.toLowerCase();
    }
    events.push({ kind: 'crew' });
  },

  // Avatars are optional. Ko-Labz is standalone; a crew member can carry in a
  // summary of their Civil X Avatar Forge avatar (or any avatar file with the
  // same fields). Only this summary is stored, never birth data or charts.
  'player.linkAvatar'(state, a, events) {
    const p = getPlayer(state, a.playerId);
    const av = normalizeAvatar(a.avatar) || fail('That avatar file has no name in it.');
    p.avatar = av;
    log(state, { kind: 'system', color: p.color, text: `${p.name} brought in their avatar ${av.alias || av.name}` });
    events.push({ kind: 'crew' });
  },

  'player.unlinkAvatar'(state, a, events) {
    const p = getPlayer(state, a.playerId);
    delete p.avatar;
    events.push({ kind: 'crew' });
  },

  'player.remove'(state, a, events) {
    const p = getPlayer(state, a.playerId);
    if (state.projects.some(pr => pr.ownerId === p.id && !pr.archived)) fail(`${p.name} still owns a project. Hand it over or archive it first.`);
    const idx = state.players.indexOf(p);
    state.players.splice(idx, 1);
    if (state.turn.index > idx) state.turn.index--;
    if (state.turn.index >= state.players.length) state.turn.index = 0;
    for (const c of state.contributions) if (c.playerId === p.id && c.status === 'pending') { c.status = 'withdrawn'; c.resolvedAt = Date.now(); }
    for (const pr of state.projects) for (const n of pr.needs) {
      if (n.status === 'pending' && !state.contributions.some(c => c.needId === n.id && c.status === 'pending')) n.status = 'open';
    }
    log(state, { kind: 'system', text: `${p.name} left the crew` });
    events.push({ kind: 'crew' });
  },

  'project.create'(state, a, events) {
    const owner = getPlayer(state, a.ownerId);
    const title = clean(a.title, 60).toUpperCase();
    if (!title) fail('Give the project a title.');
    const needs = [...normalizeNeeds(a.minor, 'minor'), ...normalizeNeeds(a.major, 'major')];
    if (!needs.length) fail('Add at least one need so the crew knows how to help.');
    const project = {
      id: makeId('prj'), title, vision: cleanMulti(a.vision, 600), ownerId: owner.id,
      needs, createdAt: Date.now(), completedAt: null, archived: false,
      seed: Math.floor(Math.random() * 1e9)
    };
    state.projects.push(project);
    award(state, events, owner, 'founder');
    log(state, { kind: 'project', color: owner.color, text: `${owner.name} launched ${title} (${needs.length} needs)`, projectId: project.id });
    events.push({ kind: 'project', projectId: project.id });
    return { projectId: project.id };
  },

  'project.update'(state, a, events) {
    const project = ownedProject(state, a);
    if (a.title !== undefined) { const t = clean(a.title, 60).toUpperCase(); if (!t) fail('Title cannot be empty.'); project.title = t; }
    if (a.vision !== undefined) project.vision = cleanMulti(a.vision, 600);
    if (a.ownerId !== undefined) project.ownerId = getPlayer(state, a.ownerId).id;
    events.push({ kind: 'project', projectId: project.id });
  },

  'project.archive'(state, a, events) {
    const project = ownedProject(state, a);
    project.archived = !!a.archived;
    log(state, { kind: 'project', text: `${project.title} ${project.archived ? 'archived' : 'restored'}`, projectId: project.id });
    events.push({ kind: 'project', projectId: project.id });
  },

  'project.delete'(state, a, events) {
    const project = ownedProject(state, a);
    state.projects = state.projects.filter(p => p !== project);
    state.contributions = state.contributions.filter(c => c.projectId !== project.id || c.status === 'accepted');
    log(state, { kind: 'project', text: `${project.title} was removed from the map` });
    events.push({ kind: 'project', projectId: project.id });
  },

  'need.add'(state, a, events) {
    const project = ownedProject(state, a);
    const ring = a.ring === 'major' ? 'major' : 'minor';
    if (project.needs.filter(n => n.ring === ring).length >= MAX_NEEDS_PER_RING) fail(`The ${ring} ring is full (${MAX_NEEDS_PER_RING} max).`);
    const [need] = normalizeNeeds([{ title: a.title, description: a.description }], ring);
    if (!need) fail('Give the need a title.');
    project.needs.push(need);
    project.completedAt = null;
    log(state, { kind: 'project', text: `${project.title}: new ${ring} need, ${need.title}`, projectId: project.id });
    events.push({ kind: 'project', projectId: project.id });
    return { needId: need.id };
  },

  'need.update'(state, a, events) {
    const project = ownedProject(state, a);
    const need = getNeed(project, a.needId);
    if (a.title !== undefined) { const t = clean(a.title, 60); if (!t) fail('Title cannot be empty.'); need.title = t; }
    if (a.description !== undefined) need.description = cleanMulti(a.description, 400);
    events.push({ kind: 'project', projectId: project.id });
  },

  'need.remove'(state, a, events) {
    const project = ownedProject(state, a);
    const need = getNeed(project, a.needId);
    if (project.needs.length <= 1) fail('A project needs at least one need. Archive the project instead.');
    project.needs = project.needs.filter(n => n !== need);
    for (const c of state.contributions) if (c.needId === need.id && c.status === 'pending') { c.status = 'withdrawn'; c.resolvedAt = Date.now(); }
    const pr = projectProgress(project);
    if (!project.completedAt && pr.total && pr.done === pr.total) completeProject(state, events, project);
    events.push({ kind: 'project', projectId: project.id });
  },

  'need.reopen'(state, a, events) {
    const project = ownedProject(state, a);
    const need = getNeed(project, a.needId);
    if (need.status !== 'fulfilled') fail('That need is not fulfilled.');
    need.status = 'open'; need.fulfilledBy = null; need.contributionId = null;
    reopenIfNeeded(project);
    log(state, { kind: 'project', text: `${project.title}: ${need.title} reopened`, projectId: project.id });
    events.push({ kind: 'project', projectId: project.id });
  },

  'need.resolve'(state, a, events) {
    // The owner closes a need themselves. No points: you cannot score on your own project.
    const project = ownedProject(state, a);
    const need = getNeed(project, a.needId);
    if (need.status === 'fulfilled') fail('Already fulfilled.');
    const before = projectProgress(project);
    need.status = 'fulfilled'; need.fulfilledBy = project.ownerId; need.contributionId = null;
    for (const c of state.contributions) if (c.needId === need.id && c.status === 'pending') { c.status = 'superseded'; c.resolvedAt = Date.now(); }
    log(state, { kind: 'project', text: `${project.title}: owner resolved ${need.title}`, projectId: project.id, needId: need.id });
    events.push({ kind: 'fulfilled', projectId: project.id, needId: need.id, playerId: project.ownerId, points: 0 });
    const after = projectProgress(project);
    for (const ring of ['minor', 'major']) {
      if (after[ring].total && after[ring].done === after[ring].total && before[ring].done < before[ring].total) events.push({ kind: 'ring', projectId: project.id, ring });
    }
    if (after.total && after.done === after.total && !project.completedAt) completeProject(state, events, project);
  },

  'assist.offer'(state, a, events) {
    const player = actingPlayer(state, a) || fail('Nobody is at the helm.');
    const project = getProject(state, a.projectId);
    if (project.archived) fail('That project is archived.');
    const need = getNeed(project, a.needId);
    if (project.ownerId === player.id) fail('You own this project. Other crew members assist it; you review their offers.');
    if (need.status === 'fulfilled') fail('That need is already fulfilled.');
    const method = a.method;
    if (!METHOD_MULT[method]) fail('Unknown assist type.');
    if (state.contributions.some(c => c.needId === need.id && c.playerId === player.id && c.status === 'pending')) fail('You already have an offer waiting on this need.');

    const payload = {};
    if (method === 'self') {
      payload.link = safeLink(a.link);
      payload.note = cleanMulti(a.note, 600);
      if (clean(a.link) && !payload.link) fail('That proof link is not a web address.');
      if (!payload.link && !payload.note) fail('Add a proof link or say what you did.');
    } else if (method === 'contact') {
      payload.contactName = clean(a.contactName, 80);
      payload.contactInfo = clean(a.contactInfo, 160);
      payload.note = cleanMulti(a.note, 600);
      if (!payload.contactName || !payload.contactInfo) fail('Add the contact\'s name and how to reach them.');
    } else {
      payload.proposal = cleanMulti(a.proposal, 1200);
      if (payload.proposal.length < 8) fail('Describe the solution in a sentence or two.');
    }

    const c = {
      id: makeId('ctb'), projectId: project.id, needId: need.id, playerId: player.id, method, payload,
      points: pointsFor(need.ring, method), status: 'pending', createdAt: Date.now(), resolvedAt: null
    };
    state.contributions.push(c);
    const owner = state.players.find(p => p.id === project.ownerId);
    if (!state.settings.ownerReview) {
      accept(state, events, c);
    } else {
      need.status = 'pending';
      log(state, { kind: 'offer', color: player.color, text: `${player.name} offered ${owner?.name ?? 'the owner'} help on ${need.title}: ${METHOD_LABEL[method].toLowerCase()}`, projectId: project.id, needId: need.id });
      events.push({ kind: 'offer', projectId: project.id, needId: need.id, playerId: player.id });
    }
    return { contributionId: c.id, status: c.status };
  },

  'assist.review'(state, a, events) {
    const c = state.contributions.find(x => x.id === a.contributionId) || fail('That offer no longer exists.');
    if (c.status !== 'pending') fail('That offer was already settled.');
    const project = getProject(state, c.projectId);
    const reviewer = actingPlayer(state, a);
    if (!reviewer || reviewer.id !== project.ownerId) {
      const owner = state.players.find(p => p.id === project.ownerId);
      fail(`Only ${owner?.name ?? 'the owner'} can review offers on ${project.title}.`);
    }
    if (a.decision === 'accept') {
      accept(state, events, c);
    } else if (a.decision === 'decline') {
      c.status = 'declined'; c.resolvedAt = Date.now();
      c.reason = clean(a.reason, 200);
      const need = getNeed(project, c.needId);
      if (need.status === 'pending' && !state.contributions.some(x => x.needId === need.id && x.status === 'pending')) need.status = 'open';
      const player = state.players.find(p => p.id === c.playerId);
      log(state, { kind: 'decline', text: `${reviewer.name} passed on ${player?.name ?? 'an'} offer for ${need.title}`, projectId: project.id });
      events.push({ kind: 'declined', projectId: project.id, needId: need.id });
    } else fail('Choose accept or decline.');
  },

  'assist.withdraw'(state, a, events) {
    const c = state.contributions.find(x => x.id === a.contributionId) || fail('That offer no longer exists.');
    if (c.status !== 'pending') fail('That offer was already settled.');
    const player = actingPlayer(state, a);
    if (!player || player.id !== c.playerId) fail('Only the crew member who made an offer can withdraw it.');
    c.status = 'withdrawn'; c.resolvedAt = Date.now();
    const project = getProject(state, c.projectId);
    const need = getNeed(project, c.needId);
    if (need.status === 'pending' && !state.contributions.some(x => x.needId === need.id && x.status === 'pending')) need.status = 'open';
    events.push({ kind: 'project', projectId: project.id });
  },

  'turn.next'(state, a, events) {
    if (!state.players.length) fail('No crew yet.');
    state.turn.index = (state.turn.index + 1) % state.players.length;
    if (state.turn.index === 0) state.turn.number++;
    const p = state.players[state.turn.index];
    events.push({ kind: 'turn', playerId: p.id });
  },

  'turn.set'(state, a, events) {
    const idx = state.players.findIndex(p => p.id === a.playerId);
    if (idx < 0) fail('That crew member no longer exists.');
    state.turn.index = idx;
    events.push({ kind: 'turn', playerId: a.playerId });
  },

  'settings.update'(state, a, events) {
    if (a.mode !== undefined) {
      if (!['turns', 'free'].includes(a.mode)) fail('Unknown mode.');
      state.settings.mode = a.mode;
    }
    if (a.ownerReview !== undefined) state.settings.ownerReview = !!a.ownerReview;
    events.push({ kind: 'settings' });
  },

  'hub.reset'(state) {
    const fresh = emptyHub();
    for (const k of Object.keys(state)) delete state[k];
    Object.assign(state, fresh);
  }
};

export const ACTIONS = Object.keys(handlers);

export function normalizeAvatar(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = clean(raw.name, 60);
  if (!name) return null;
  const prog = raw.progress || {};
  const skills = (Array.isArray(raw.skills) ? raw.skills : [])
    .map(k => ({ name: clean(k?.name ?? k, 40), level: Math.max(0, Math.min(5, Number(k?.level) || 0)), guild: clean(k?.guild, 24) }))
    .filter(k => k.name).slice(0, 12);
  const accent = clean(raw.look?.accent ?? raw.accent, 7);
  return {
    source: clean(raw.source, 40) || 'civilx-avatar-forge',
    avatarId: clean(raw.avatarId ?? raw.id, 64),
    name, alias: clean(raw.alias, 60), tagline: clean(raw.tagline, 160),
    element: clean(raw.element ?? raw.civil?.element, 20), guild: clean(raw.guild ?? raw.civil?.guild, 24),
    level: Math.max(0, Math.min(999, Number(raw.level ?? prog.level) || 0)), rank: clean(raw.rank ?? prog.rank, 30),
    accent: /^#[0-9a-f]{6}$/i.test(accent) ? accent : '',
    skills, linkedAt: Date.now()
  };
}

export function apply(prev, action) {
  if (!action || typeof action.type !== 'string' || !handlers[action.type]) throw new RuleError('Unknown action.');
  const state = structuredClone(prev);
  const events = [];
  const result = handlers[action.type](state, action, events) || {};
  state.version = (prev.version || 0) + 1;
  state.updatedAt = Date.now();
  return { state, events, result };
}

// Bring any saved or imported hub up to the current shape. Also converts the
// single-file prototype's localStorage save (koLabz_orbital_state_v1).
export function migrate(raw) {
  if (!raw || typeof raw !== 'object') return emptyHub();
  if (Array.isArray(raw.needs) && raw.activeProject) {
    const hub = emptyHub();
    for (const p of raw.players || []) { try { addPlayer(hub, p.name, p.color); hub.players.at(-1).score = Number(p.score) || 0; } catch {} }
    if (!hub.players.length) addPlayer(hub, 'OPERATOR');
    const owner = hub.players[Math.max(0, (raw.players || []).findIndex(p => p.id === raw.activeProject.ownerId))] || hub.players[0];
    const needs = raw.needs.map(n => ({
      id: makeId('need'), ring: n.ring === 'major' ? 'major' : 'minor', title: clean(n.title, 60) || 'Need',
      description: cleanMulti(n.description, 400), status: n.status === 'fulfilled' ? 'fulfilled' : 'open', fulfilledBy: null, contributionId: null
    }));
    const project = { id: makeId('prj'), title: clean(raw.activeProject.title, 60).toUpperCase() || 'IMPORTED PROJECT', vision: cleanMulti(raw.activeProject.vision, 600), ownerId: owner.id, needs, createdAt: Date.now(), completedAt: null, archived: false, seed: 1 };
    const pr = projectProgress(project);
    if (pr.total && pr.done === pr.total) project.completedAt = Date.now();
    hub.projects.push(project);
    hub.turn = { index: Math.min(raw.turnInfo?.currentPlayerIndex || 0, hub.players.length - 1), number: raw.turnInfo?.turnNumber || 1 };
    log(hub, { kind: 'system', text: 'Imported from the original Persistence Hub save' });
    return hub;
  }
  const hub = { ...emptyHub(), ...raw };
  hub.settings = { ...emptyHub().settings, ...(raw.settings || {}) };
  hub.turn = { ...emptyHub().turn, ...(raw.turn || {}) };
  for (const k of ['players', 'projects', 'contributions', 'activity']) if (!Array.isArray(hub[k])) hub[k] = [];
  for (const p of hub.players) { p.badges ||= []; p.score = Number(p.score) || 0; }
  for (const pr of hub.projects) { pr.needs ||= []; pr.archived = !!pr.archived; pr.seed ??= 1; }
  if (hub.turn.index >= hub.players.length) hub.turn.index = 0;
  return hub;
}

export const TEMPLATES = [
  {
    key: 'lunar', title: 'Lunar Gateway Hub', vision: 'Establish strategic deep-space logistics and modular habitation hubs.',
    minor: [
      ['Power Cells', 'Install high-density ionic storage arrays.'],
      ['Data Relay', 'Establish a low-latency laser link network.'],
      ['Shielding', 'Deploy magnetic radiation shielding.'],
      ['Cooling Loop', 'Regulate internal thermal exhaust.']
    ],
    major: [
      ['Life Support', 'Calibrate O2 scrubbers and algae-based filtration.'],
      ['Engine Array', 'Assemble fusion propulsion blocks.'],
      ['Habitat Pods', 'Finalize modular pressurized sections.']
    ]
  },
  {
    key: 'album', title: 'Debut Album Launch', vision: 'Release a ten-track record with a live show and a story people want to share.',
    minor: [
      ['Mix Engineer', 'Someone to mix three tracks at a fair rate.'],
      ['Cover Art', 'An illustrator for the cover and three single covers.'],
      ['Press Photos', 'One shoot, five usable portraits.'],
      ['Release Plan', 'A 6-week rollout calendar.']
    ],
    major: [
      ['Venue', 'A 200-cap room for the release show.'],
      ['Distribution', 'Distributor plus playlist pitching.'],
      ['Funding', '$4k to cover mastering, vinyl test pressing and the show.']
    ]
  },
  {
    key: 'garden', title: 'Community Food Forest', vision: 'Turn a vacant lot into a shared food forest that feeds the block.',
    minor: [
      ['Soil Test', 'Lab test for lead and nutrients.'],
      ['Tools', 'Borrow shovels, wheelbarrows and a broadfork.'],
      ['Mulch', 'Ten yards of wood chips delivered.'],
      ['Signage', 'Painted signs naming each guild.']
    ],
    major: [
      ['Land Agreement', 'A written use agreement with the lot owner.'],
      ['Water', 'Rain catchment or a city water hookup.'],
      ['Planting Day', 'Thirty volunteers and 80 trees and shrubs.']
    ]
  },
  {
    key: 'startup', title: 'Product Launch', vision: 'Ship version one, find the first hundred paying customers.',
    minor: [
      ['Landing Page', 'One page that explains it in ten seconds.'],
      ['Demo Video', 'A 60-second walkthrough.'],
      ['Beta Testers', 'Ten people who will use it weekly.'],
      ['Pricing', 'A price and a reason for it.']
    ],
    major: [
      ['First Customer', 'An intro to someone who would pay today.'],
      ['Advisor', 'An operator who has scaled this before.'],
      ['Launch Partner', 'A brand or community to launch alongside.']
    ]
  }
];
