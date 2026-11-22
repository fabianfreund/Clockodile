# Research and plan

## The reference: Timemator (Setapp)

Timemator is a Mac time tracker sold through Setapp. Its listings cite manual timers, quick access from the menu bar, flexible project/task structure, billable hours and revenue tracking, reports, offline use, and automatic tracking rules built from app, file and website activity.

Where it falls short for a freelancer who just wants to report time quickly:
- Getting a finished block of time in takes several clicks. There's no "type one line and it's logged".
- Billing status is coarse: it's hard to see at a glance what has been invoiced and what has been paid.
- It's closed source, macOS only, and needs a subscription.

## The pitch

Timemator's calm menu-bar tracking, plus one-line logging and real billing status, free and open on every platform.

## What Clockodile does differently (v0.1)

| | Clockodile |
|---|---|
| Logging speed | One-line quick entry: `Call 45m @acme #meeting`, `Standup 9:30-9:45`, `… yesterday` |
| Billing | Per-entry `unbilled → billed → paid`, bulk actions, "unbilled" total always in the sidebar, mark-as-billed on PDF export |
| Rates | project → client → default, per-entry billable flag, report-time rounding |
| Output | A4 PDF timesheet (summary + grouped entries + totals, your header) and CSV |
| Away time | Idle, lock and sleep detection with keep / remove / stop |
| Platforms | macOS, Windows, Linux; MIT licensed; no account; local JSON with daily backups |

## Design principles
- Same visual language as OneShot: system font, quiet chrome, vibrancy sidebar on macOS, shared tokens, light and dark.
- Fewer, better controls. One timer bar, one list per day, one place for billing (Reports).
- Data stays editable and portable: a plain JSON file, import/export, CSV.

## Feature map

| Stage | Features |
|---|---|
| **MVP (v0.1)** | Menu-bar timer, quick entry, week/day views, clients/projects/tags, rates, billing status, reports, PDF/CSV export, CSV import, idle detection, backups |
| **v1** | Invoices with numbering and tax lines, calendar (ICS) import, weekly goals and budgets, Pomodoro in the popover |
| **Deep** | Automatic tracking from app and window activity with rules that suggest entries, optional folder sync |

## Technical plan

- Electron + plain JS, no runtime dependencies. Pure core modules (`src/core`) shared by the main process, the pages and `node:test`.
- The main process owns one JSON database. Changes go through a reducer over IPC and are saved atomically, with daily backups.
- PDFs come from Chromium's `printToPDF` on a hidden HTML template, so no PDF library is needed.
- Idle detection uses `powerMonitor` (idle time, lock, suspend).
- Risk: automatic tracking needs the Accessibility permission on macOS and different APIs on each OS, so it waits until after v1.
