# Research and plan

## The reference: Timemator (Setapp)

Timemator is a Mac time tracker sold through Setapp. Its listings cite manual timers, quick access from the menu bar, flexible project/task structure, billable hours and revenue tracking, reports, offline use, and automatic tracking rules built from app, file and website activity.

Where it falls short for a freelancer who just wants to report time quickly:
- Getting a finished block of time in takes several clicks. There's no "type one line and it's logged".
- Billing status is coarse: it's hard to see at a glance what has been invoiced and what has been paid.
- It's closed source, macOS only, and needs a subscription.

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

## Roadmap ideas
- Automatic tracking (an app/window activity timeline, with rules that suggest entries). On macOS this needs the Accessibility permission.
- Invoices with numbering and tax lines, built on the same PDF pipeline.
- Calendar import (ICS) to turn meetings into entries.
- Weekly goals per project and budget alerts.
- Pomodoro mode in the popover.
- Optional sync via a user-chosen folder (iCloud Drive, Dropbox).
