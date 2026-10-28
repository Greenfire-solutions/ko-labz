# Ko-Labz: notes for Claude

- `shared/rules.mjs` is the only place game rules live. The server applies actions through
  `apply()`; the client never decides an outcome, it only calls `/api/action`. Add a rule there,
  plus a test in `test/rules.test.mjs`.
- Every write goes through `runAction()` in `server.mjs`, which saves and broadcasts on `/api/events`.
  The client ignores any hub whose `version` is not newer, so events are handled once.
- Ports: 8350 live, 8351 sandbox and page proofs (use a scratch `KOLABZ_DATA`), 8352 `npm test`.
  Never point a test at 8350, at `data/` or at `~/Ko-Labz Data`. The hub defaults to `~/Ko-Labz Data`;
  a copy with `./data/hub.json` (this dev folder) keeps using that.
- Shipping: `scripts/package.sh` builds the per-Mac zips (Node + trimmed node_modules inside), the
  launch logic is `scripts/start-kolabz.sh` (never runs npm), the rehearsal recipe is in README "Ship it".
  Editing anything inside `Start Ko-Labz.app` needs a re-seal (`codesign --force --deep -s -`).
- Avatar bridge: `normalizeAvatar()` keeps a summary only. Never store birth data or charts from the Forge.
  The Forge is probed by `/api/whoami` (`civilx-avatar-builder`) before it is trusted.
- `npm run e2e` (test/e2e.mjs) drives the real page in headless Chrome on 8351 with a temp data folder:
  66 checks from first run to supernova, archive, reset and phone width. Run it after any change to
  public/ or shared/. `npm run screenshots` regenerates docs/*.png the same way.
- Software rendering in headless Chrome is slow (seconds per frame under load). Scene labels only exist
  after a frame draws, so tests must wait for a label before clicking it (`clickLabel`). A test that
  fails only at a label lookup is usually timing, not the app.
- Project changes are owner-only (`ownedProject()` in rules.mjs); in turns mode, on the owner's turn.
- Warps: the newest warp request wins (`warpAfter`/`cancelWarp` in scene.js); labels are cleared on every
  view switch so a stale label can never be clicked mid-warp.
- No em dashes in anything a player reads.
