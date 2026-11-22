# Development

## Run

```bash
npm install
npm start      # real data in the user-data folder (macOS: ~/Library/Application Support/Clockodile)
npm run demo   # sample data, throwaway profile, nothing saved
```

`npm start` uses the same data folder as the installed app, and only one copy runs at a time: opening the installed Clockodile while a dev copy runs just focuses the dev copy. Quit one before using the other.

Clockodile opens its window and adds a menu-bar (tray) icon. Closing the window keeps it running in the menu bar. When it was launched at login, it starts with only the menu-bar icon.

## Test

```bash
npm test        # unit tests: time parsing, reducer, quick entry, reports (node:test, no deps)
npm run smoke   # launches the real app per view with demo data, drives it, exports a PDF
npm run lint
npm run check   # all three
```

`SMOKE_OUT=docs/assets npm run smoke` keeps the screenshots (useful for refreshing the README images).

### Debug hooks (dev builds only)

They use a throwaway profile, so they never touch real data or a running Clockodile.

| Variable | Effect |
|---|---|
| `CLOCKODILE_DEMO=1` | demo data, nothing saved (`npm run demo`) |
| `CLOCKODILE_DEBUG_SHOT=/path.png` | screenshot the first window after it loads |
| `CLOCKODILE_DEBUG_JS="…"` | run this JS in that window before the screenshot (a throw is reported) |
| `CLOCKODILE_DEBUG_QUIT=1` | quit after the screenshot |
| `CLOCKODILE_DEBUG_SEED=1` | start with demo data |
| `CLOCKODILE_DEBUG_WINDOW=popover` | open the menu-bar popover instead of the main window |
| `CLOCKODILE_DEBUG_PDF=/path.pdf` | write PDF exports there without a save dialog |
| `CLOCKODILE_DEBUG_IMPORT=/path.csv` | import this file without an open dialog |

## How it works

```
src/core/model.js     database shape, migrate(), apply(db, op) reducer, selectors (rates, recents)
src/core/time.js      dates, ranges, duration/clock parsing, formatting, rounding
src/core/parse.js     quick entry ("Call 30m @acme #meeting") → timer.start / entry.add
src/core/report.js    filter + totals + groupings + CSV
src/core/importer.js  CSV import: column recognition (Timemator, Toggl, Clockify, own CSV), plan + dedupe
src/core/demo.js      sample data
src/main/main.js      owns the database, tray + popover, menu, global shortcut, idle detection, exports
src/main/store.js     atomic JSON writes + daily backups (last 14)
src/preload.cjs       window.clockodile bridge
src/ui/app.*          main window shell (sidebar, routing)
src/ui/views/         track, reports, projects, settings, entry sheet
src/ui/lib/           dom helper h(), icons, renderer state, widgets (picker, sheet, toast…)
src/ui/popover.*      menu-bar popover
src/ui/report.*       PDF template (rendered hidden, printed to A4 by the main process)
```

- **One source of truth.** The main process holds the database. Windows send operations (`{ type: 'entry.update', id, patch }`) over IPC, the main process runs them through the pure `apply()` reducer, saves (debounced, atomic) and broadcasts the new database to every window. The core modules are shared by the main process, the pages and the tests.
- **The running timer is just an entry with `end: null`.** There's at most one; starting a timer stops the running one. Timers under a minute are dropped as accidental.
- **Rates** resolve project → client → default. Amounts count only billable entries. Rounding (Settings) rounds each entry up in reports and exports, never the stored entries.
- **Import** turns any CSV into neutral rows (`readCSV`), then `planImport` matches clients, projects and tags by name, creates the missing ones, skips entries that already exist (same start, end and project), and returns one `db.merge` operation. New projects take the rate of their latest entry; older entries with a different rate keep it as a per-entry `rate`, so imported history isn't repriced.
- **Status** is `unbilled | billed | paid` per entry, changed from the entry menu, in bulk in Reports, or by the PDF export.
- **Idle detection** polls `powerMonitor.getSystemIdleTime()` and listens for lock/suspend while a timer runs. On return it asks: keep the time, remove it and continue, or remove it and stop.

## Build

| Command | Output in `dist/` |
|---|---|
| `npm run dist:mac` | `.dmg` + `.zip`, Apple Silicon and Intel |
| `npm run dist:win` | NSIS installer `.exe`, x64 and ARM64 |
| `npm run dist:linux` | `.AppImage` + `.deb`, x64 |
| `npm run pack` | unpacked app for a quick local try |

The icons come from `npm run icon` (`scripts/make-icon.mjs`): `build/icon.png` for the app and `src/assets/tray*.png` for the menu bar.

## Release

Same flow as OneShot. `package.json` → `version` is the only place to change the version.

```bash
npm run release:patch   # or :minor / :major
```

This tests, bumps the version, commits `Release vX.Y.Z`, pushes, then runs `scripts/release-mac.sh`, which builds both mac architectures, signs them (Developer ID: Digital Vibes GmbH, 8HFX6YPXXN), notarizes them, verifies them with `codesign`/`spctl`, tags, and uploads them to the GitHub release. The tag push triggers `.github/workflows/release.yml`, which adds the Windows and Linux builds.

Local-only builds:
- `SKIP_UPLOAD=1 npm run release:mac`: a signed and notarized build in `dist/`, with no tag and no upload (works on a dirty tree).
- `NOTARIZE=0 SKIP_UPLOAD=1 npm run release:mac`: signed but not notarized.

Notarization uses the notarytool keychain profile `splatcraft` (same Apple team) unless `APPLE_KEYCHAIN_PROFILE` is set.

## Appetizer

`appetizer.json` controls the listing in the [Appetizer launcher](https://github.com/fabianfreund/Appetizer-launcher). After the first GitHub release, run this in the launcher repo:

```bash
pnpm catalog add fabianfreund/Clockodile --category Productivity
```
