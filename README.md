# Ko-Labz Persistence Hub

**A crew game for finishing real projects together, on a 3D star map.**

![The star map](docs/star-map.png)

## Download for Mac (free)

Nothing to install first. Download the zip for your Mac, unzip it, and double-click
**Start Ko-Labz** inside the folder (the first time, right-click it and choose Open).
Read **READ ME FIRST.txt** in the folder for the rest.

- [Intel Mac](https://github.com/Greenfire-solutions/ko-labz/releases/latest/download/Ko-Labz-Intel-Mac.zip)
- [Apple Silicon Mac (M1 and newer)](https://github.com/Greenfire-solutions/ko-labz/releases/latest/download/Ko-Labz-Apple-Silicon.zip)

Not sure which Mac you have? Apple menu, About This Mac: "Chip: Apple M..." is Apple Silicon, "Processor: Intel" is Intel.

Every project is a star system. The project is the sun; what it needs orbits it as
planets: quick wins on the inner **minor ring**, big lifts on the outer **major ring**.
Crew members help each other's projects in one of three ways:

| how | what you send | points (minor / major) |
|---|---|---|
| Fulfill directly | a proof link and what you did | 10 / 25 |
| Source a connection | who can help and how to reach them | 7 / 17 |
| Add a solution | how you would meet the need | 4 / 10 |

The owner reviews each offer. Accepting one turns the planet white with a moon in the
helper's colour, pays the points, and keeps the proof, contact or idea in the
**Mission Ledger** for good. Closing a ring pays the closer +10. When every planet is met
the system goes supernova and the owner earns +20. Eight badges and six ranks
(Cadet to Admiral) come from what you actually did.

![Inside a system](docs/system-view.png)

## Run it

Needs [Node.js](https://nodejs.org) 20 or newer. (The ready-made Mac download needs nothing installed; see [Ship it](#ship-it).)

```bash
npm install
npm start          # http://127.0.0.1:8350
```

On a Mac you can instead double-click **Start Ko-Labz** (the app icon) or **Start Ko-Labz.command**,
which start the hub and open it in your browser. The first screen sets up the crew and the first project; four templates
(space station, album launch, food forest, product launch) get you going in a click.

To let phones on the same Wi-Fi join, double-click **Start Ko-Labz on Wi-Fi.command**
(or run `KOLABZ_HOST=0.0.0.0 npm start`); its window shows the address to type on each
phone. Every open screen updates live. Anyone on that
network can play and edit, so use it on a network you trust.

## Play

- **Turns** (default): one crew member at the helm; Cycle Turn passes it on. Owners review
  offers and change their own project on their turn.
- **Free play** (Systems panel): everyone acts any time and picks who they are on their own screen.
- **Owner review** can be switched off so offers count instantly.
- Projects can be edited, archived, restored or deleted by their owner; needs can be added,
  renamed, resolved, reopened and removed.

Keys: `1-4` console buttons · `[` `]` previous/next planet · `Esc` back · `G` star map ·
`T` cycle turn · `C` crew · `L` ledger · `S` systems · `M` sound · `?` help.
Drag to orbit, scroll or pinch to zoom.

It works on a phone too: the console stacks under the map and pinch zooms.

<img src="docs/phone.png" width="260" alt="Ko-Labz on a phone">

Graphics has a **Low** setting (Systems panel) for older machines; it switches itself on if
the map runs slowly.

## Avatars (optional)

Ko-Labz is standalone. A crew member can also bring in an avatar, either from a running
Civil X Avatar Forge (`KOLABZ_FORGE_URL`, default `http://127.0.0.1:8330`, checked by its
`/api/whoami` before it is trusted) or from an avatar JSON file. Ko-Labz keeps a summary
only: name, alias, element, guild, level, rank, accent colour and up to 12 skills. It is
stored on the player as `player.avatar`.

## How it is built

No build step and no framework: plain ES modules, [three.js](https://threejs.org) for the
3D, a small Node server, and one JSON file for the save.

| path | what |
|---|---|
| `server.mjs` | static files, `/api/state`, `/api/action`, `/api/events` (live updates), export/import, the avatar bridge |
| `shared/rules.mjs` | the one rulebook: every action, points, badges, ranks, templates, save migration |
| `public/scene.js` | the 3D: galaxy, star systems, shaders, effects, camera |
| `public/app.js` | the HUD, console, panels and setup |
| `~/Ko-Labz Data/hub.json` | the saved hub, written after every change; `backups/` next to it every 10 minutes, last 30 kept. Outside the app folder, so replacing the folder never loses it. A copy that already has `./data/hub.json` keeps using that; `KOLABZ_DATA` overrides both |
| `original/` | the single-file prototype this grew from |

The server is the only thing that decides outcomes; the page sends actions and redraws
whatever the server says. Ports: 8350 app, 8351 browser tests, 8352 unit tests.
`GET /api/whoami` answers `app: ko-labz` with its `root`, `data`, `pid`, `host` and `version`,
and the server exits with code 3 if its port is taken.

## Tests

```bash
npm test           # rules + a real server against a throwaway data folder
npm run e2e        # drives the real page in headless Chrome: 66 checks, setup to supernova
npm run check      # both
```

The browser test needs Google Chrome installed (or `CHROME_PATH`).

## Ship it

    bash scripts/package.sh      # both Macs; "x64" or "arm64" for one

makes, in `dist/`: `Ko-Labz (Intel Mac).zip` and `Ko-Labz (Apple Silicon).zip` (about
48 MB each), `SHA256SUMS` and `install.sh`. Each zip carries Node v22.23.4 in
`runtime/node` and the page's parts in `node_modules`, so a crew leader never needs Node,
npm or the internet. `node_modules` is made fresh with `npm ci` from `package-lock.json`
on the build Mac and trimmed to what the server serves (three's `build/` and
`examples/jsm/`, the font files, each licence). It has no native code, so one copy serves
both Macs; the script refuses if that ever changes. Files come from an allow list: no
tests, docs, tools, the prototype, data, logs or git. The script refuses if a hub, a log
or a path from the build Mac slips in. The version comes from `package.json`.

Two ways to hand it out:

- **The zip.** The crew leader unzips it, moves the folder to Applications and
  double-clicks Start Ko-Labz. A browser marks downloads as "from the internet", so macOS
  asks once about an unidentified developer; `READ ME FIRST.txt` says what to click
  (right-click, Open on macOS 12 to 14; Privacy and Security, Open Anyway on 15). There
  is no Apple developer signing; the icon is sealed ad hoc. Opened straight from
  Downloads, macOS runs the icon from a temporary copy (App Translocation); the icon asks
  macOS where the real folder is and carries on, and the launcher clears the quarantine
  mark from the whole folder so it does not happen again.
- **One line.** Host the three files at one address, put that address in the `BASE=`
  line at the top of `install.sh` (or set `KOLABZ_BASE`), and the crew leader runs
  `curl -fsSL <base>/install.sh | bash`. curl leaves no quarantine mark, so there is no
  warning. It installs to `~/Applications/Ko-Labz`, refuses a download whose checksum
  does not match, stops a running copy that is that install or serves `~/Ko-Labz Data`
  (a copy with its own data folder is left alone), and starts it.

The launch logic is `scripts/start-kolabz.sh`; `Start Ko-Labz.app`, `Start Ko-Labz.command`
and `Start Ko-Labz on Wi-Fi.command` (`--wifi`) all run it. It asks the port's
`/api/whoami` who is there before reusing anything, reuses its own server, restarts one
that predates the server code or that is not listening on Wi-Fi when asked to, stops an
older copy serving the same hub, and refuses another program or another copy with its own
hub. Logs go to `~/Library/Logs/Ko-Labz`. It never runs npm: a folder without
`node_modules` says to use the ready-made download. `scripts/setup.sh` finds Node 20 or
newer (the bundled one first) or fetches the pinned v22.23.4 into `runtime/`, SHA-256
checked; that needs about a minute online. Ko-Labz needs nothing newer than Node 20 (no
`node:sqlite`). The app icon is drawn by `tools/make_icon.py`; after editing anything
inside `Start Ko-Labz.app`, re-seal it with `codesign --force --deep -s - "Start Ko-Labz.app"`.

Updating: replace the folder with the new one. The hub lives in `~/Ko-Labz Data`.

Rehearsing a brand-new Mac: unzip into a scratch folder whose path has spaces, mark every
file with `xattr -w com.apple.quarantine "0083;0;Chrome;"`, then run `Start Ko-Labz.command`
with `env -i HOME=<empty folder> PATH=/usr/bin:/bin KOLABZ_LAUNCH_QUIET=1 KOLABZ_PORT=8351
SETUP_FRESH=1`. Quiet mode opens no browser and shows no dialog (a failure is printed,
exit 1); the port keeps it off the live 8350; fresh mode ignores every Node outside
`runtime/`. Delete `runtime/` to rehearse the download, and add
`https_proxy=http://127.0.0.1:9` to rehearse being offline.
