# Puzzel Userscripts

Tampermonkey scripts for the Puzzel PCM web application.

## Structure

- `DOM/`: shared DOM helper library (`PCM_DOM_Shared_Local`), loaded via `@require` by scripts that read or watch the page's DOM. Keeps DOM/runtime logic (boot/retry, style injection, observers, widget lookup) in one place so feature scripts only handle their own state and styling.
- `PCM_Ticket_View/`: scripts for the ticket detail page (`/tickets/*`):
  - `PCM_Ticket_Info_Extractor`: surfaces CustomerID, Customer Name, and Company Name from Customer Intelligence. Uses the shared DOM library.
  - `PCM_Name_Field_Placeholder`: adds a placeholder name link in Customer Intelligence when no name is set.
  - `Puzzel_Styler_(Ticket_Field)`: highlights Assigned-To and Status fields. Built on the library's `createFieldRuntime`.
  - `PCM_New_Ticket_Notifier`: alerts on new tickets in the PCM ticket list. Uses the shared DOM library.
  - `PCM_Organisation_Copy_Buttons` (.txt): copy buttons for CustomerId/Name, reading the Extractor's published outputs. Requires a local copy of the DOM library via `file://`.
- `PCM_Ticket_List/`: scripts for the ticket list page (`/tickets`) and dashboard (`/`):
  - `PCM_Auto_Refresh`: auto-reloads the page on an interval with a countdown ring UI. Standalone.
  - `Dark_Mode/`: dark mode split into three scripts (page background, ticket list table, attributes search module). Only the Attributes script uses the shared DOM library.
- `PCC_Agent_View/`: scripts for the agent application (app.puzzel.com/agent), a different app from PCM:
  - `PCC_Agent_Highlighter`: highlights agent rows by status/profile and badges names in the ARIA agents grid. SPA-safe (grid rebinding, navigation hooks). Standalone.
  - `PCC_Softphone_Status_Highlight`: colours the Softphone Online/Offline value in the header. Standalone.

## Design logic: one shared DOM library per application, not one per folder

All PCM scripts target the same web app (puzzel.cm.puzzel.com, SmartAdmin/jarviswidget, Bootstrap accordions, DataTables, Chosen), so the same DOM helpers are valid on every PCM page. One shared library in `DOM/` avoids per-folder copies drifting apart.

The boundary is the application, not the repo. `PCC_Agent_View/` targets app.puzzel.com, an ARIA-grid SPA with nothing structurally in common with PCM, so PCC scripts must NOT require `PCM_DOM_Shared_Local`. If a third PCC script ever needs the agents grid or SPA navigation handling, extract the rebind/nav-hook machinery from `PCC_Agent_Highlighter` into a separate `PCC_DOM_Shared` module rather than reusing the PCM library.

Not every script should use it, though. The rule of thumb:

- Scripts that read or watch Puzzel's DOM structure (extracting data, reacting to widget changes) `@require` the shared library. They benefit from `bootUntil`, `ensureStyleTag`, observer lifecycle helpers, and widget lookup, and they should abort with a console error if `PCM_DOM` is missing.
- Scripts that are pure CSS (`GM_addStyle` only) or pure timers stay standalone. A dependency adds nothing for them, and keeping them dependency-free means they cannot break if the `@require` fetch fails.

Current status:

| Script | Shared DOM? | Why |
| --- | --- | --- |
| PCM_Ticket_Info_Extractor | Yes | Reads CI widget, accordion rows, tables; helpers aliased to the lib since 6.1 |
| PCM_New_Ticket_Notifier | Yes | Table reading, observers, dedupe and JSON storage from the lib |
| Puzzel_Styler_(Ticket_Field) | Yes | Entirely built on `createFieldRuntime` |
| PCM_Organisation_Copy_Buttons | Yes (local `file://` copy) | General DOM work via `PCM_DOM` |
| PCM_Name_Field_Placeholder | Requires, unused | Has the `@require` but calls no lib functions; bounded one-shot retries |
| PCM Dark Mode (Attributes) | Yes (since 4.6) | Watches widget state; `bootUntil`, `ensureStyleTag`, `createVisibilityGate` |
| PCM Dark Mode (Ticket List) | No | Mostly CSS plus a small toggle; marginal benefit |
| PCM Dark Mode (Ticket, Org, Customer Background) | No | Pure CSS |
| PCM_Auto_Refresh | No | Timer core, reloads the page every interval; must stay dependency-free |
| PCC_Agent_Highlighter | No | Different app (app.puzzel.com). Its SPA machinery (grid rebind, dirty-row tracking, nav hooks) has no PCM_DOM equivalent; overlap is ~15 lines |
| PCC_Softphone_Status_Highlight | No | Different app. 99 lines, self-contained, rAF-throttled; only overlap is style injection |

If ticket-list-specific helpers are ever needed (e.g. DataTables redraw hooks), add them additively to the shared library rather than forking it per folder.

## Installing

### All scripts at once

Download the auto-built bundle, then in Tampermonkey go to Dashboard - Utilities - Import (Zip) and pick the zip. Tampermonkey installs every script in it in one action; the zip matches Tampermonkey's own backup layout (plain `.user.js` files at the root). If the Utilities tab is missing, set Config Mode to Beginner or Advanced in Settings. Dragging the unzipped files into the dashboard works too.

```
https://github.com/kakardo/puzzel-userscripts/releases/download/latest/Puzzel_Userscripts.zip
```

A GitHub Actions workflow (`.github/workflows/build_script_bundle.yml`) rebuilds this zip on every push that touches a script, so it always contains the current versions. The DOM library is not in the zip; scripts fetch it themselves via `@require`.

### One script at a time

Open the raw GitHub URL of any script in a browser with Tampermonkey installed, for example:

```
https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/PCM_New_Ticket_Notifier.user.js
```

Tampermonkey detects the `.user.js` extension and offers to install it directly. Do this once per script.

## Auto-updates

Scripts with `@downloadURL` and `@updateURL` point at their own raw GitHub URL. Filenames are stable (no version or date), so these URLs never change; Tampermonkey periodically checks `@updateURL` for a higher `@version` and, if found, pulls the new file from `@downloadURL`.

## Shared DOM library

Scripts that use the shared library pull in `DOM/PCM_DOM_Shared_Local.user.js` via `@require`, pointed at the raw GitHub URL.

Since v1.8 the library also owns the small utilities the scripts used to duplicate: `cleanText`, `wait`, `escapeRegExp`, `uniqueTexts`, `uniqueElements`, `readJson`/`writeJson`, and `createVisibilityGate` (the battery pattern: skip work while the tab is hidden, one catch-up run on return). New scripts should use these instead of writing their own. Scripts that depend on newer helpers must check for them in their startup guard so a stale cached library fails loudly.

Important: Tampermonkey fetches `@require` content once and caches it. It only re-fetches when the parent script's own `@version` changes (or on a manual "Check for userscript updates"). So after editing the shared DOM library, bump the `@version` of every script that requires it, otherwise they keep running the cached copy.

## Energy efficiency rules

All scripts are used on battery-powered laptops with the tab frequently hidden or the window covered, in Chrome, Edge, Opera, and Firefox (note: Firefox does not treat covered windows as hidden, only minimised ones or unselected tabs). The rules:

- No periodic work while `document.hidden` unless background operation IS the feature (Auto_Refresh reloads, New Ticket Notifier alerts). Everything else skips and catches up once on `visibilitychange`, via `createVisibilityGate` where the lib is available.
- Scope MutationObservers as narrowly as possible and never observe attributes on roots the script itself writes classes to (this caused a frame-rate feedback loop in the softphone script once).
- Prefer event-driven over polling; any polling must be bounded.
- Do not rely on browser throttling to save power. Be cheap by construction, identically across all four browsers.
