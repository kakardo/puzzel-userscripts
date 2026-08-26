# Puzzel Userscripts

Tampermonkey scripts for the Puzzel PCM web application.

## Structure

- `DOM/`: shared DOM helper library (`PCM_DOM_Shared_Local`), loaded via `@require` by scripts that read or watch the page's DOM. Keeps DOM/runtime logic (boot/retry, style injection, observers, widget lookup) in one place so feature scripts only handle their own state and styling.
- `PCM_Ticket_View/`: scripts for the ticket detail page (`/tickets/*`):
  - `PCM Ticket Info Extractor`: surfaces CustomerID, Customer Name, and Company Name from Customer Intelligence. Uses the shared DOM library.
  - `PCM_Name_Field_Placeholder`: adds a placeholder name link in Customer Intelligence when no name is set.
  - `Puzzel Styler (Ticket Field)`: highlights Assigned-To and Status fields.
  - `PCM_New_Ticket_Notifier`: alerts on new tickets in the PCM ticket list.
- `PCM_Ticket_List/`: scripts for the ticket list page (`/tickets`) and dashboard (`/`):
  - `PCM_Auto_Refresh`: auto-reloads the page on an interval with a countdown ring UI. Standalone.
  - `Dark_Mode/`: dark mode split into three scripts (page background, ticket list table, attributes search module). Only the Attributes script uses the shared DOM library.

## Design logic: one shared DOM library, not one per folder

The whole repo targets the same web app (puzzel.cm.puzzel.com, SmartAdmin/jarviswidget, Bootstrap accordions, DataTables, Chosen), so the same DOM helpers are valid on every page. One shared library in `DOM/` avoids per-folder copies drifting apart.

Not every script should use it, though. The rule of thumb:

- Scripts that read or watch Puzzel's DOM structure (extracting data, reacting to widget changes) `@require` the shared library. They benefit from `bootUntil`, `ensureStyleTag`, observer lifecycle helpers, and widget lookup, and they should abort with a console error if `PCM_DOM` is missing.
- Scripts that are pure CSS (`GM_addStyle` only) or pure timers stay standalone. A dependency adds nothing for them, and keeping them dependency-free means they cannot break if the `@require` fetch fails.

Current status:

| Script | Shared DOM? | Why |
| --- | --- | --- |
| PCM Ticket Info Extractor | Yes | Reads CI widget, accordion rows, tables |
| PCM Dark Mode (Attributes) | Yes (since 4.6) | Watches widget state, boots via `bootUntil`, styles via `ensureStyleTag` |
| PCM Dark Mode (Ticket List) | No | Mostly CSS plus a small toggle; marginal benefit |
| PCM Dark Mode (Ticket, Org, Customer Background) | No | Pure CSS |
| PCM_Auto_Refresh | No | Timer core, reloads the page every interval; must stay dependency-free |
| PCM_Name_Field_Placeholder, Puzzel Styler, PCM_New_Ticket_Notifier | No | Small standalone scripts; migrate only if they grow DOM-watching logic |

If ticket-list-specific helpers are ever needed (e.g. DataTables redraw hooks), add them additively to the shared library rather than forking it per folder.

## Installing

Open the raw GitHub URL of any script in a browser with Tampermonkey installed, for example:

```
https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/PCM_New_Ticket_Notifier.user.js
```

Tampermonkey detects the `.user.js` extension and offers to install it directly. Do this once per script.

## Auto-updates

Scripts with `@downloadURL` and `@updateURL` point at their own raw GitHub URL. Filenames are stable (no version or date), so these URLs never change; Tampermonkey periodically checks `@updateURL` for a higher `@version` and, if found, pulls the new file from `@downloadURL`.

## Shared DOM library

Scripts that use the shared library pull in `DOM/PCM_DOM_Shared_Local.user.js` via `@require`, pointed at the raw GitHub URL.

Important: Tampermonkey fetches `@require` content once and caches it. It only re-fetches when the parent script's own `@version` changes (or on a manual "Check for userscript updates"). So after editing the shared DOM library, bump the `@version` of every script that requires it, otherwise they keep running the cached copy.
