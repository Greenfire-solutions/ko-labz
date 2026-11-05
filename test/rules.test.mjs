import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, emptyHub, migrate, RuleError, pointsFor, RING_CLOSE_BONUS, MISSION_BONUS, safeLink } from '../shared/rules.mjs';

function run(state, ...actions) {
  let s = state, events = [], result;
  for (const a of actions) ({ state: s, events, result } = apply(s, a));
  return { s, events, result };
}

function seeded({ review = true } = {}) {
  let { s } = run(emptyHub(), { type: 'crew.setup', players: [{ name: 'Ava' }, { name: 'Bo' }, { name: 'Cy' }] });
  if (!review) ({ s } = run(s, { type: 'settings.update', ownerReview: false }));
  const r = run(s, {
    type: 'project.create', ownerId: s.players[0].id, title: 'Moon base', vision: 'A base',
    minor: [{ title: 'Power' }, { title: 'Relay' }], major: [{ title: 'Habitat' }]
  });
  return { s: r.s, pid: r.result.projectId };
}

test('crew setup uppercases names, assigns distinct colours and refuses a second setup', () => {
  const { s } = run(emptyHub(), { type: 'crew.setup', players: [{ name: 'ava' }, { name: 'bo' }, { name: '' }] });
  assert.deepEqual(s.players.map(p => p.name), ['AVA', 'BO']);
  assert.notEqual(s.players[0].color, s.players[1].color);
  assert.throws(() => apply(s, { type: 'crew.setup', players: [{ name: 'x' }] }), RuleError);
});

test('owner cannot assist their own project', () => {
  const { s, pid } = seeded();
  const need = s.projects[0].needs[0];
  // Turn 0 is Ava, the owner.
  assert.throws(() => apply(s, { type: 'assist.offer', projectId: pid, needId: need.id, method: 'self', note: 'did it' }), /You own this project/);
});

test('offer waits for owner review, then accept pays points and fulfils the need', () => {
  let { s, pid } = seeded();
  const need = s.projects[0].needs[0];
  ({ s } = run(s, { type: 'turn.next' })); // Bo
  let r = run(s, { type: 'assist.offer', projectId: pid, needId: need.id, method: 'contact', contactName: 'Dee', contactInfo: 'dee@x.org' });
  s = r.s;
  assert.equal(r.result.status, 'pending');
  assert.equal(s.projects[0].needs[0].status, 'pending');
  assert.equal(s.players[1].score, 0);
  // Bo cannot review Ava's project.
  assert.throws(() => apply(s, { type: 'assist.review', contributionId: r.result.contributionId, decision: 'accept' }), /Only AVA/);
  ({ s } = run(s, { type: 'turn.set', playerId: s.players[0].id }));
  r = run(s, { type: 'assist.review', contributionId: s.contributions[0].id, decision: 'accept' });
  s = r.s;
  assert.equal(s.projects[0].needs[0].status, 'fulfilled');
  assert.equal(s.players[1].score, pointsFor('minor', 'contact'));
  assert.ok(s.players[1].badges.includes('first_assist'));
  assert.ok(r.events.some(e => e.kind === 'fulfilled'));
});

test('decline returns the need to open and pays nothing', () => {
  let { s, pid } = seeded();
  const need = s.projects[0].needs[0];
  ({ s } = run(s, { type: 'turn.next' }, { type: 'assist.offer', projectId: pid, needId: need.id, method: 'suggestion', proposal: 'Use solar sails' }, { type: 'turn.set', playerId: s.players[0].id }));
  ({ s } = run(s, { type: 'assist.review', contributionId: s.contributions[0].id, decision: 'decline' }));
  assert.equal(s.projects[0].needs[0].status, 'open');
  assert.equal(s.players[1].score, 0);
  assert.equal(s.contributions[0].status, 'declined');
});

test('accepting one offer supersedes competing offers on the same need', () => {
  let { s, pid } = seeded();
  const need = s.projects[0].needs[0];
  ({ s } = run(s,
    { type: 'turn.next' }, { type: 'assist.offer', projectId: pid, needId: need.id, method: 'self', note: 'Bo did it' },
    { type: 'turn.next' }, { type: 'assist.offer', projectId: pid, needId: need.id, method: 'self', note: 'Cy did it' },
    { type: 'turn.next' }));
  assert.equal(s.turn.index, 0);
  ({ s } = run(s, { type: 'assist.review', contributionId: s.contributions[1].id, decision: 'accept' }));
  assert.equal(s.contributions[0].status, 'superseded');
  assert.equal(s.contributions[1].status, 'accepted');
  assert.equal(s.players[2].score, 10);
  assert.equal(s.players[1].score, 0);
});

test('without owner review: ring bonus and mission bonus fire, project completes once', () => {
  let { s, pid } = seeded({ review: false });
  ({ s } = run(s, { type: 'turn.next' }));
  const [m1, m2, M1] = s.projects[0].needs;
  ({ s } = run(s, { type: 'assist.offer', projectId: pid, needId: m1.id, method: 'self', link: 'example.com/proof' }));
  assert.equal(s.contributions[0].payload.link, 'https://example.com/proof');
  let r = run(s, { type: 'assist.offer', projectId: pid, needId: m2.id, method: 'self', note: 'done' });
  s = r.s;
  assert.ok(r.events.some(e => e.kind === 'ring' && e.ring === 'minor'));
  assert.equal(s.players[1].score, 10 + 10 + RING_CLOSE_BONUS);
  r = run(s, { type: 'assist.offer', projectId: pid, needId: M1.id, method: 'self', note: 'built it' });
  s = r.s;
  assert.ok(r.events.some(e => e.kind === 'complete'));
  assert.ok(s.projects[0].completedAt);
  assert.equal(s.players[0].score, MISSION_BONUS);
  assert.equal(s.players[1].score, 30 + 25 + RING_CLOSE_BONUS);
  assert.ok(s.players[0].badges.includes('supernova'));
  // Reopening clears completion; resolving again re-completes but only pays the mission bonus again on a new completion.
  assert.throws(() => apply(s, { type: 'need.reopen', projectId: pid, needId: M1.id }), /Only AVA can change/);
  ({ s } = run(s, { type: 'turn.set', playerId: s.players[0].id }, { type: 'need.reopen', projectId: pid, needId: M1.id }));
  assert.equal(s.projects[0].completedAt, null);
});

test('assist payloads are validated', () => {
  let { s, pid } = seeded();
  const need = s.projects[0].needs[0];
  ({ s } = run(s, { type: 'turn.next' }));
  assert.throws(() => apply(s, { type: 'assist.offer', projectId: pid, needId: need.id, method: 'self' }), /proof link or say/);
  assert.throws(() => apply(s, { type: 'assist.offer', projectId: pid, needId: need.id, method: 'self', link: 'javascript:alert(1)' }), /not a web address/);
  assert.throws(() => apply(s, { type: 'assist.offer', projectId: pid, needId: need.id, method: 'contact', contactName: 'X' }), /how to reach/);
  assert.throws(() => apply(s, { type: 'assist.offer', projectId: pid, needId: need.id, method: 'suggestion', proposal: 'no' }), /sentence/);
  assert.throws(() => apply(s, { type: 'assist.offer', projectId: pid, needId: need.id, method: 'bribe' }), /Unknown assist/);
});

test('safeLink only allows http(s)', () => {
  assert.equal(safeLink('https://a.b/c'), 'https://a.b/c');
  assert.equal(safeLink('a.b'), 'https://a.b/');
  assert.equal(safeLink('javascript:alert(1)'), '');
  assert.equal(safeLink('data:text/html,hi'), '');
});

test('free play uses the actorId; turns mode ignores it', () => {
  let { s, pid } = seeded();
  const need = s.projects[0].needs[0];
  // Turns mode: actor is Ava regardless of actorId, and Ava owns it.
  assert.throws(() => apply(s, { type: 'assist.offer', actorId: s.players[2].id, projectId: pid, needId: need.id, method: 'self', note: 'x' }), /You own/);
  ({ s } = run(s, { type: 'settings.update', mode: 'free' }));
  const r = run(s, { type: 'assist.offer', actorId: s.players[2].id, projectId: pid, needId: need.id, method: 'self', note: 'x' });
  assert.equal(r.s.contributions[0].playerId, s.players[2].id);
});

test('removing a player keeps the turn pointer valid and refuses owners', () => {
  let { s } = seeded();
  assert.throws(() => apply(s, { type: 'player.remove', playerId: s.players[0].id }), /still owns/);
  ({ s } = run(s, { type: 'turn.next' }, { type: 'turn.next' })); // Cy at index 2
  ({ s } = run(s, { type: 'player.remove', playerId: s.players[2].id }));
  assert.equal(s.players.length, 2);
  assert.ok(s.turn.index < s.players.length);
});

test('needs: add, edit, remove, ring limit', () => {
  let { s, pid } = seeded();
  let r = run(s, { type: 'need.add', projectId: pid, ring: 'major', title: 'Engines' });
  s = r.s;
  assert.equal(s.projects[0].needs.length, 4);
  ({ s } = run(s, { type: 'need.update', projectId: pid, needId: r.result.needId, title: 'Fusion engines' }));
  assert.equal(s.projects[0].needs.at(-1).title, 'Fusion engines');
  ({ s } = run(s, { type: 'need.remove', projectId: pid, needId: r.result.needId }));
  assert.equal(s.projects[0].needs.length, 3);
  for (let i = 0; i < 6; i++) ({ s } = run(s, { type: 'need.add', projectId: pid, ring: 'minor', title: `n${i}` }));
  assert.throws(() => apply(s, { type: 'need.add', projectId: pid, ring: 'minor', title: 'too many' }), /full/);
});

test('owner resolve fulfils with no points and can complete the project', () => {
  let { s, pid } = seeded();
  for (const n of s.projects[0].needs) ({ s } = run(s, { type: 'need.resolve', projectId: pid, needId: n.id }));
  assert.ok(s.projects[0].completedAt);
  assert.equal(s.players[1].score, 0);
  assert.equal(s.players[0].score, MISSION_BONUS);
});

test('migrate converts the original single-file save', () => {
  const old = {
    turnInfo: { currentPlayerIndex: 1, turnNumber: 3 },
    players: [{ id: 1, name: 'ALICE', color: '#ff4444', score: 10 }, { id: 2, name: 'BOB', color: '#00d4ff', score: 0 }],
    activeProject: { title: 'LUNAR GATEWAY HUB', ownerId: 1, vision: 'v' },
    needs: [{ id: 'm1', ring: 'minor', title: 'Power Cells', description: 'd', status: 'fulfilled' }, { id: 'M1', ring: 'major', title: 'Life Support', description: 'd', status: 'active' }]
  };
  const hub = migrate(old);
  assert.equal(hub.players.length, 2);
  assert.equal(hub.players[0].score, 10);
  assert.equal(hub.projects[0].needs[0].status, 'fulfilled');
  assert.equal(hub.projects[0].needs[1].status, 'open');
  assert.equal(hub.turn.number, 3);
});

test('unknown actions and versions', () => {
  assert.throws(() => apply(emptyHub(), { type: 'nope' }), RuleError);
  const { s } = run(emptyHub(), { type: 'crew.setup', players: [{ name: 'a' }] });
  assert.equal(s.version, 1);
});

test('avatar link stores only a summary and can be removed', async () => {
  const { normalizeAvatar } = await import('../shared/rules.mjs');
  let { s } = seeded();
  const forgeRecord = {
    id: 'av1', name: 'Lia Moonwell', alias: 'Herbwise', birth: { date: '1990-01-01' }, chart: { secret: true },
    civil: { element: 'Water', guild: 'health' }, progress: { level: 8, rank: 'Alchemist' }, look: { accent: '#6fe0c8' },
    skills: [{ name: 'Herbalism', level: 5, guild: 'health' }]
  };
  ({ s } = run(s, { type: 'player.linkAvatar', playerId: s.players[1].id, avatar: forgeRecord }));
  const av = s.players[1].avatar;
  assert.equal(av.alias, 'Herbwise'); assert.equal(av.element, 'Water'); assert.equal(av.level, 8); assert.equal(av.skills[0].level, 5);
  assert.equal(av.birth, undefined); assert.equal(av.chart, undefined);
  assert.equal(normalizeAvatar({}), null);
  ({ s } = run(s, { type: 'player.unlinkAvatar', playerId: s.players[1].id }));
  assert.equal(s.players[1].avatar, undefined);
});

test('only the owner can change a project', () => {
  let { s, pid } = seeded();
  ({ s } = run(s, { type: 'turn.next' })); // Bo
  const n = s.projects[0].needs[0];
  for (const a of [
    { type: 'need.resolve', needId: n.id }, { type: 'need.remove', needId: n.id }, { type: 'need.update', needId: n.id, title: 'x' },
    { type: 'need.add', ring: 'minor', title: 'x' }, { type: 'project.update', title: 'x' }, { type: 'project.archive', archived: true },
    { type: 'project.delete' }
  ]) assert.throws(() => apply(s, { ...a, projectId: pid }), /Only AVA can change MOON BASE, on their turn/, a.type);
  // Free play: the acting player is whoever this screen says it is.
  ({ s } = run(s, { type: 'settings.update', mode: 'free' }));
  assert.throws(() => apply(s, { type: 'need.resolve', actorId: s.players[1].id, projectId: pid, needId: n.id }), /Only AVA can change MOON BASE\./);
  const r = run(s, { type: 'need.resolve', actorId: s.players[0].id, projectId: pid, needId: n.id });
  assert.equal(r.s.projects[0].needs[0].status, 'fulfilled');
});
