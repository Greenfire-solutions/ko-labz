// Ko-Labz Persistence Hub server. Serves the 3D hub and keeps the one saved hub.
// Port 8350 (8352 for tests). Identity: GET /api/whoami -> { app: "ko-labz", root, data, pid, host, version }.
// Set KOLABZ_HOST=0.0.0.0 to let the crew join from phones on the same Wi-Fi.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { apply, migrate, emptyHub, RuleError, TEMPLATES } from './shared/rules.mjs';

// Optional bridge to the Civil X Avatar Forge. Ko-Labz runs fine without it.
const FORGE = process.env.KOLABZ_FORGE_URL || 'http://127.0.0.1:8330';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.KOLABZ_PORT || 8350);
const HOST = process.env.KOLABZ_HOST || '127.0.0.1';
// The hub lives outside the app folder (~/Ko-Labz Data) so replacing the folder with a newer
// version never touches it. A copy that already keeps its hub in ./data goes on using that.
const DATA = path.resolve(process.env.KOLABZ_DATA || (fs.existsSync(path.join(ROOT, 'data', 'hub.json')) ? path.join(ROOT, 'data') : path.join(process.env.HOME || os.homedir(), 'Ko-Labz Data')));
// Where the hub is saved, as the Systems panel shows it (home folder as ~, so a phone never sees a user name).
const SHOWN_DATA = DATA.startsWith(os.homedir() + path.sep) ? '~' + DATA.slice(os.homedir().length) : DATA;
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const HUB_FILE = path.join(DATA, 'hub.json');
const BACKUPS = path.join(DATA, 'backups');
const STARTED = Date.now();
const BUILD = String(STARTED);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon'
};

// Static roots: URL prefix -> folder. Nothing outside these is served.
const STATIC = [
  ['/vendor/three/', path.join(ROOT, 'node_modules/three')],
  ['/fonts/orbitron/', path.join(ROOT, 'node_modules/@fontsource/orbitron/files')],
  ['/fonts/rajdhani/', path.join(ROOT, 'node_modules/@fontsource/rajdhani/files')],
  ['/fonts/mono/', path.join(ROOT, 'node_modules/@fontsource/jetbrains-mono/files')],
  ['/shared/', path.join(ROOT, 'shared')],
  ['/', path.join(ROOT, 'public')]
];

let hub = emptyHub();
let lastBackup = 0;
const clients = new Set();

async function load() {
  await fsp.mkdir(BACKUPS, { recursive: true });
  try {
    hub = migrate(JSON.parse(await fsp.readFile(HUB_FILE, 'utf8')));
  } catch (e) {
    if (e.code !== 'ENOENT') {
      const bad = `${HUB_FILE}.unreadable-${Date.now()}`;
      await fsp.copyFile(HUB_FILE, bad).catch(() => {});
      console.error(`[ko-labz] hub.json could not be read; kept a copy at ${bad} and started fresh.`);
    }
    hub = emptyHub();
  }
}

let writing = Promise.resolve();
function save() {
  const snapshot = JSON.stringify(hub, null, 1);
  writing = writing.then(async () => {
    const tmp = `${HUB_FILE}.tmp`;
    await fsp.writeFile(tmp, snapshot);
    await fsp.rename(tmp, HUB_FILE);
    if (Date.now() - lastBackup > 10 * 60 * 1000) {
      lastBackup = Date.now();
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await fsp.writeFile(path.join(BACKUPS, `hub-${stamp}.json`), snapshot);
      const old = (await fsp.readdir(BACKUPS)).filter(f => f.endsWith('.json')).sort();
      for (const f of old.slice(0, Math.max(0, old.length - 30))) await fsp.unlink(path.join(BACKUPS, f)).catch(() => {});
    }
  }).catch(e => console.error('[ko-labz] save failed:', e.message));
  return writing;
}

function broadcast(events) {
  const msg = `event: hub\ndata: ${JSON.stringify({ hub, events })}\n\n`;
  for (const res of clients) res.write(msg);
}

function send(res, code, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(code, { 'content-type': isObj ? 'application/json' : 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
}

async function readBody(req, limit = 2_000_000) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > limit) throw new RuleError('That file is too large.'); chunks.push(c); }
  const text = Buffer.concat(chunks).toString('utf8');
  try { return text ? JSON.parse(text) : {}; } catch { throw new RuleError('That was not valid JSON.'); }
}

// Ask the Forge who it is before trusting anything it says (a busy port is not identity).
async function forge(pathname) {
  const get = async (p) => { const r = await fetch(FORGE + p, { signal: AbortSignal.timeout(2500) }); if (!r.ok) throw new Error(`forge ${r.status}`); return r.json(); };
  const who = await get('/api/whoami');
  if (who.app !== 'civilx-avatar-builder') throw new Error('not the forge');
  return get(pathname);
}

async function runAction(action) {
  const { state, events, result } = apply(hub, action);
  hub = state;
  await save();
  broadcast(events);
  return { ok: true, hub, events, result };
}

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
}

async function serveStatic(req, res, pathname) {
  for (const [prefix, dir] of STATIC) {
    if (!pathname.startsWith(prefix)) continue;
    let rel = decodeURIComponent(pathname.slice(prefix.length));
    if (prefix === '/' && (rel === '' || rel.endsWith('/'))) rel += 'index.html';
    const file = path.resolve(dir, rel);
    if (!file.startsWith(dir + path.sep) && file !== dir) return send(res, 403, 'Forbidden');
    try {
      const st = await fsp.stat(file);
      if (!st.isFile()) continue;
      const ext = path.extname(file);
      const headers = { 'content-type': MIME[ext] || 'application/octet-stream' };
      // Vendored libraries and fonts never change; app code always revalidates.
      headers['cache-control'] = prefix.startsWith('/vendor') || prefix.startsWith('/fonts') ? 'public, max-age=86400' : 'no-cache';
      if (ext === '.html') {
        const html = (await fsp.readFile(file, 'utf8')).replaceAll('__BUILD__', BUILD);
        res.writeHead(200, headers); return res.end(html);
      }
      res.writeHead(200, headers);
      return fs.createReadStream(file).pipe(res);
    } catch { continue; }
  }
  send(res, 404, 'Not found');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    if (p === '/api/whoami') return send(res, 200, { app: 'ko-labz', root: ROOT, data: DATA, pid: process.pid, startedAt: STARTED, port: PORT, host: HOST, version: VERSION });
    if (p === '/api/health') return send(res, 200, { ok: true, app: 'ko-labz', version: hub.version, players: hub.players.length, projects: hub.projects.length });
    if (p === '/api/state' && req.method === 'GET') return send(res, 200, { hub, templates: TEMPLATES, lan: HOST === '0.0.0.0' ? lanAddresses().map(a => `http://${a}:${PORT}`) : [], dataDir: SHOWN_DATA });

    if (p === '/api/events' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(`retry: 1500\nevent: hub\ndata: ${JSON.stringify({ hub, events: [] })}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => { clearInterval(ping); clients.delete(res); });
      return;
    }

    if (p === '/api/action' && req.method === 'POST') {
      const action = await readBody(req);
      if (action.type === 'hub.reset' && action.confirm !== 'RESET') throw new RuleError('Reset needs confirming.');
      return send(res, 200, await runAction(action));
    }

    if (p === '/api/forge/avatars' && req.method === 'GET') {
      try {
        const { avatars } = await forge('/api/avatars');
        return send(res, 200, { available: true, url: FORGE, avatars: (avatars || []).map(a => ({ id: a.id, name: a.name, alias: a.alias, element: a.element, guild: a.guild, level: a.progress?.level, rank: a.progress?.rank, accent: a.look?.accent, sample: !!a.sample })) });
      } catch { return send(res, 200, { available: false, url: FORGE, avatars: [] }); }
    }

    if (p === '/api/forge/link' && req.method === 'POST') {
      const { playerId, avatarId } = await readBody(req);
      let avatar;
      try { avatar = await forge(`/api/avatars/${encodeURIComponent(String(avatarId || ''))}`); } catch { throw new RuleError('Could not reach the Avatar Forge. Is it running?'); }
      return send(res, 200, await runAction({ type: 'player.linkAvatar', playerId, avatar: { ...avatar, source: 'civilx-avatar-forge' } }));
    }

    if (p === '/api/export' && req.method === 'GET') {
      const name = `ko-labz-hub-${new Date().toISOString().slice(0, 10)}.json`;
      return send(res, 200, JSON.stringify(hub, null, 2), { 'content-type': 'application/json', 'content-disposition': `attachment; filename="${name}"` });
    }

    if (p === '/api/import' && req.method === 'POST') {
      const raw = await readBody(req);
      const next = migrate(raw);
      if (!next.players.length && !next.projects.length) throw new RuleError('That file has no crew or projects in it.');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await fsp.writeFile(path.join(BACKUPS, `hub-before-import-${stamp}.json`), JSON.stringify(hub));
      next.version = hub.version + 1;
      hub = next;
      await save();
      broadcast([{ kind: 'import' }]);
      return send(res, 200, { ok: true, hub });
    }

    if (p.startsWith('/api/')) return send(res, 404, { error: 'No such endpoint.' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    return serveStatic(req, res, p);
  } catch (e) {
    if (e instanceof RuleError) return send(res, 400, { error: e.message });
    console.error('[ko-labz]', e);
    return send(res, 500, { error: 'Something went wrong on the hub. It has been logged.' });
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`[ko-labz] Port ${PORT} is already in use. Ko-Labz will not share a port. Exiting.`);
    process.exit(3);
  }
  throw e;
});

await load();
server.listen(PORT, HOST, () => {
  console.log(`[ko-labz] Persistence Hub on http://127.0.0.1:${PORT}  (data: ${DATA})`);
  if (HOST === '0.0.0.0') for (const a of lanAddresses()) console.log(`[ko-labz] crew on Wi-Fi can join at http://${a}:${PORT}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await writing; process.exit(0); });
