# Puzzel Userscripts

Tampermonkey scripts for the Puzzel web applications: PCM (ticketing), the Admin console, the agent application and Organisation Settings, plus the shared Geckoboard dashboards.

[![Download all scripts (zip)](https://img.shields.io/badge/%E2%AC%87%EF%B8%8F%20Download%20all%20scripts-Puzzel__Userscripts.zip-2ea44f?style=for-the-badge)](https://github.com/kakardo/puzzel-userscripts/releases/download/latest/Puzzel_Userscripts.zip)

Then in Tampermonkey: Dashboard, Utilities, Import (Zip), pick the downloaded file. All scripts install in one go. Full details under [Installing](#installing).

## Structure

- `PCM_Shared_Library/`: shared DOM helper library (`PCM_Shared_Library`), loaded via `@require` by scripts that read or watch the page's DOM. Keeps DOM/runtime logic (boot/retry, style injection, observers, widget lookup) in one place so feature scripts only handle their own state and styling.
- `PCM_Ticket_View/`: scripts for the ticket detail page (`/tickets/*`):
  - `PCM_Ticket_Info_Extractor`: surfaces CustomerID, Customer Name, Company Name and Partner from Customer Intelligence on one compact line, and publishes them for the other scripts (`PCM_TICKET_INFO`, data attributes, fixed elements, `pcm-ticket-info-ready`). Reads the ID from both the `CustomerID` and the newer `AccountNumber` attribute. Uses the shared DOM library.
  - `PCM_Name_Field_Placeholder`: adds a placeholder name link in Customer Intelligence when no name is set.
  - `PCM_Image_Viewer`: upgrades the attachment preview modal with an Open in tab button, zoom controls and drag to pan for images. Standalone, purely event-driven.
  - `PCM_Merge_By_Number`: adds a ticket number field to the Merge Tickets window, because PCM's search list leaves out some tickets it does accept as merge targets (seen with tickets generated from incoming mail). The ticket is looked up and shown first; you still press PCM's own Merge button. Limitation: a ticket created by hand in PCM (no initial channel) cannot be merged in either direction; PCM refuses it, so link such tickets with Parent and Child Tickets instead. Optional automatic lookup from PCM's own search field. Standalone, purely event-driven.
  - `PCM_No_Autoscroll`: keeps a ticket at the top when it opens instead of jumping down to the Timeline. Stops page scrolls started by code while the ticket loads, until your first own scroll (clicks and typing do not end it). Runs at document-start so it is in place before PCM's code. Standalone.
  - `PCM_Timeline_Preview_Cleanup`: tidies the Timeline Preview window shown when clicking an older ticket in Customer Intelligence. Hides the "Rules applied" entries (which types are hidden is a list at the top), merges entries in the same minute by the same person into one row, shows system events as slim rows, status changes as coloured status labels, shows the previewed ticket's organisation in a bar at the top (read from that ticket's page), and puts an avatar in front of entries done by a person: coloured initials, or their profile picture once their user id has been learned from an Assigned To list (kept in localStorage). Standalone, event-driven via jQuery's ajaxComplete.
  - `PCM_Jira_Quick_Link`: a split button right of Link Issue in the Jira widget; the key half fills in your saved Jira key and presses Link Issue (when another issue is linked it unlinks that one first, then links the new key), the arrow lets you type the key (remembered per browser). Uses the shared DOM library.
  - `PCM_No_Access_Redirection_Button`: adds a large Go to ticket list button to the "Ticket reassigned" message shown after sending a ticket to a team you cannot access, skipping the leave-page prompt; PCM's Confirm is replaced by a "stay in this ticket" link. Uses the shared DOM library.
  - `Attributes/`: scripts scoped to the Attributes widget (Organisation, Team, Assigned To, Status, Priority, Tags):
    - `Puzzel_Styler_(Ticket_Field)`: highlights Assigned-To and Status fields. Built on the library's `createFieldRuntime`.
    - `PCM_Team_Quick_Select`: one-click buttons under the Team dropdown that select configured teams in the Chosen widget, each team in its own colour. Teams are a config array at the top. Uses the shared DOM library.
    - `PCM_Organisation_Quick_Search`: one-click search buttons under the Organisation dropdown for the Customer ID found on the ticket, the Customer ID entered in Forms (when it differs), and fixed search strings; a single matching organisation is picked automatically. Uses the shared DOM library.
    - `PCM_Show_Organisation_Info`: shows the Organisation Information module right after an organisation is saved in Attributes, instead of only after a reload, by loading it once from the ticket page in the background. Standalone, event-driven via jQuery's ajaxComplete.
    - `PCM_Partner_Highlight`: shows the ticket's partner in large purple letters beside the Attributes heading, read from the Ticket Info Extractor; nothing is shown without a partner. Uses the shared DOM library.
    - `PCM_Assign_Buttons`: Me and Unassign buttons beside the Assigned To label; Me picks you (recognised from your profile picture in the top bar) and is greyed out when you are not in the team's list, Unassign picks the empty entry. You still press Save. Uses the shared DOM library.
    - `PCM_PostIt_Quick_Text`: a red button beside the Post-It Note label that writes INCIDENT into the note (as its first line when there is text already, not at all when it is there); the arrow beside it lets you type another text for the button, remembered per browser. You still press Save. Uses the shared DOM library.
    - `PCM_Unsaved_Attributes_Warning`: snapshot-based unsaved change detection for the Attributes widget; highlights changed fields and dropdowns and shows a warning next to Save. Uses the shared DOM library.
  - `Forms/`: scripts scoped to the Forms widget:
    - `PCM_Form_Buttons`: copy buttons for CustomerId/Name above `Form:`, reading the Extractor's published outputs, plus autofill of empty Customer ID / Customer Ref fields. Uses the shared DOM library. Renamed from `PCM_Organisation_Copy_Buttons` in 3.6, when the Attributes > Organisation button was dropped.
    - `PCM_Unsaved_Form_Warning`: snapshot-based unsaved change detection for the Forms widget; highlights changed fields and shows a warning next to Save. Colour, mode, and text are settings at the top. Uses the shared DOM library.
    - `PCM_Incident_Button`: one button that sets the Forms widget to the platform-incident preset (Form, Puzzel Service, Product Area, cause, Impact, Urgency), waiting for each re-render. Uses the shared DOM library.
    - `PCM_Change_Completed_Now`: a Now button beside Change Completed that fills in the current date and time with the timezone visible. Uses the shared DOM library.
  - `Reply_Editor/`: scripts scoped to the Summernote reply editor:
    - `PCM_Reply_Editor_Autosize`: the reply editor grows with its text from 10 rows and only scrolls past 100 rows. Pure CSS, standalone.
    - `PCM_Timeline_Box_Autosize`: sizes the Timeline boxes (notes, mails, API entries) to their content between a min and max height, wraps long lines so there is no sideways scrolling (switchable), with a Box Sizing menu next to Timeline Options. Uses the shared DOM library.
    - `PCM_Mail_Templates`: template buttons and dropdowns above the reply editor, with `{firstName}`, `{fullName}`, `{customer}`, `{partner}` and `{ticket}` placeholders and one-press shortcuts to PCM's own Insert Template entries. The editor is kept out of browser page translation, so typing is never rewritten and the cursor stays put. Uses the shared DOM library.
    - `PCM_Subscription_Buttons`: one-press handling of partner telephony subscription tickets (one button per product): fills the Change form fields and appends the confirmation mail, with user details read from the first mail in the ticket. Uses the shared DOM library.
    - `PCM_Template_ID_Viewer`: shows and copies the numeric template id of the selected entry in PCM's Insert Template modal. Standalone, purely event-driven.
- `PCM_Ticket_List/`: scripts for the ticket list page (`/tickets`) and dashboard (`/`):
  - `PCM_Auto_Refresh`: auto-reloads the page on an interval with a countdown ring UI. Standalone and light by default; turns dark with the toggle in `PCM_Dark_Mode_(Ticket_List)` when that script is installed (optional link, not a dependency).
  - `PCM_New_Ticket_Notifier`: alerts on new tickets in the PCM ticket list. Uses the shared DOM library.
  - `PCM_Hide_Columns`: Hide Columns button with a checkbox panel per column; localStorage persistence with a FORCE_HIDDEN override at the top. Standalone, drives the DataTables API.
  - `PCM_Compact_View`: Compact toggle left of Hide Columns; tight cell padding, table shrinks to content, Subject clamped to a configurable line count, times shortened (s/m/h/d/w/mo/y, "less than a minute" to <1m). Uses the shared DOM library.
  - `PCM_Selected_Row_Highlight`: makes selected rows (round checkbox) clear in light and dark mode with a coloured left band, bold coloured text and a tint laid over the row's own colour, so SLA colours still show. Standalone, pure CSS; dark colours follow the toggle in `PCM_Dark_Mode_(Ticket_List)`.
  - `PCM_Last_Activity_Sort`: makes the Last Activity column sortable (server-side, so the whole list is sorted) and keeps that sort across reloads. Standalone, drives the DataTables API.
  - `PCM_Bulk_Update_Presets`: preset buttons in the bulk "Updating Ticket(s)" window; Spam fills in Team Spam/Virus Quarantine, Status Closed and Priority Junk. You still press Update. Presets are a list at the top. Standalone, event-driven via shown.bs.modal.
  - `Dark_Mode/`: dark mode split into three scripts (page background, ticket list table, attributes search module). The Ticket List script puts its on/off toggle in the top bar between the bell and the profile picture and colours every SLA step, with overdue rows in red text. The Ticket List script owns the toggle and marks the page; the Attributes script follows that mark, so install them together. Only the Attributes script uses the shared DOM library.
- `PCC_Admin_View/`: scripts for the Puzzel Admin console (app.puzzel.com/admin), a different app from PCM:
  - `PCC_User_Group_Search`: search box that live-filters the User Group dropdown on the Add/Edit User pages. Standalone (server-rendered pages, no DOM watching to share).
- `Organisation_Settings/`: scripts for Puzzel Organisation Settings (app.puzzel.com/settings and uk.puzzel.com/settings), a different app from PCM:
  - `POS_Access_Log_Filter`: filter box above the Access log table; only rows whose Puzzel Id contains the typed text (or any of several comma-separated terms) stay visible. Standalone.
- `Geckoboard/`: scripts for shared Geckoboard dashboards (share.geckoboard.com, which frames the dashboard from app.geckoboard.com; the scripts run in that frame), a different app from PCM:
  - `Geckoboard_Full_Numbers`: shows numbers in table widgets in full instead of cut off with an ellipsis ("1,6..." becomes the whole number); right-aligned cells grow into the empty space on their left, names keep their normal shortening. Pure CSS, standalone.
  - `Geckoboard_Keep_Last_Data`: when Geckoboard's data server fails a widget refresh (for example error 520), retries after 1 and 3 seconds and otherwise gives the widget its last good data, or (when it never loaded) leaves the failed request unanswered so the widget keeps what it shows, instead of "Failed to load widget data"; a note in the corner says when saved data is shown and how old it is. Runs at document-start so it wraps fetch before Geckoboard does. Standalone.
- `PCC_Agent_View/`: scripts for the agent application (app.puzzel.com/agent), a different app from PCM:
  - `PCC_Agent_Highlighter`: highlights agent rows by status/profile and badges names in the ARIA agents grid. SPA-safe (grid rebinding, navigation hooks). Standalone.
  - `PCC_Softphone_Status_Highlight`: colours the Softphone Online/Offline value in the header. Standalone.
  - `PCC_Request_Alert`: rings (and optionally notifies, flashes the tab title or the screen) when your status leaves Ready or a chat request arrives. Settings in the code and under the main menu. Standalone.

## Design logic: one shared DOM library per application, not one per folder

All PCM scripts target the same web app (puzzel.cm.puzzel.com, SmartAdmin/jarviswidget, Bootstrap accordions, DataTables, Chosen), so the same DOM helpers are valid on every PCM page. One shared library in `PCM_Shared_Library/` avoids per-folder copies drifting apart.

The boundary is the application, not the repo. `PCC_Agent_View/` targets app.puzzel.com, an ARIA-grid SPA with nothing structurally in common with PCM, so PCC scripts must NOT require `PCM_Shared_Library`. If a third PCC script ever needs the agents grid or SPA navigation handling, extract the rebind/nav-hook machinery from `PCC_Agent_Highlighter` into a separate `PCC_DOM_Shared` module rather than reusing the PCM library.

Not every script should use it, though. The rule of thumb:

- Scripts that read or watch Puzzel's DOM structure (extracting data, reacting to widget changes) `@require` the shared library. They benefit from `bootUntil`, `ensureStyleTag`, observer lifecycle helpers, and widget lookup, and they should abort with a console error if `PCM_DOM` is missing.
- Scripts that are pure CSS (`GM_addStyle` only) or pure timers stay standalone. A dependency adds nothing for them, and keeping them dependency-free means they cannot break if the `@require` fetch fails.

Current status:

| Script | Shared DOM? | Why |
| --- | --- | --- |
| PCM_Ticket_Info_Extractor | Yes | Reads CI widget, accordion rows, tables; helpers aliased to the lib since 6.1 |
| PCM_New_Ticket_Notifier | Yes | Table reading, observers, dedupe and JSON storage from the lib |
| Puzzel_Styler_(Ticket_Field) | Yes | Entirely built on `createFieldRuntime` |
| PCM_Form_Buttons | Yes | General DOM work via `PCM_DOM`; GitHub `@require` since 2.3 |
| PCM_Unsaved_Form_Warning | Yes | `bootUntil`, `ensureStyleTag`, `createVisibilityGate`, snapshot diffing over form fields |
| PCM_Team_Quick_Select | Yes | `bootUntil`, `ensureStyleTag`, `cleanText`; drives the Chosen team widget |
| PCM_Name_Field_Placeholder | No (since 1.8) | Calls no lib functions; bounded one-shot retries, so it stays dependency-free |
| PCM Dark Mode (Attributes) | Yes (since 4.6) | Watches widget state; `bootUntil`, `ensureStyleTag`, `createVisibilityGate` |
| PCM Dark Mode (Ticket List) | No | Mostly CSS plus a small toggle; marginal benefit |
| PCM Dark Mode (Ticket, Org, Customer Background) | No | Pure CSS |
| PCM_Auto_Refresh | No | Timer core, reloads the page every interval; must stay dependency-free |
| PCM_Hide_Columns | No | Drives the DataTables API, event-driven via init.dt; no DOM watching to share |
| PCM_Compact_View | Yes | `bootUntil`, `ensureStyleTag`, `createVisibilityGate`; rewrites cells per draw so the visibility gate matters |
| PCM_Selected_Row_Highlight | No | Pure CSS on the `selected` class DataTables sets |
| PCM_Last_Activity_Sort | No | Drives the DataTables API, event-driven via init.dt and order.dt; no DOM watching to share |
| PCM_Bulk_Update_Presets | No | Purely event-driven via `shown.bs.modal`; sets three plain selects |
| PCM_Unsaved_Attributes_Warning | Yes | Built on `createUnsavedWatcher` |
| PCM_Organisation_Quick_Search | Yes | `createFieldFinder`, `createVisibilityGate`, `flashLabel`; drives the select2 Organisation widget |
| PCM_Show_Organisation_Info | No | Event-driven via jQuery `ajaxComplete`; one background request per organisation change |
| PCM_Partner_Highlight | Yes | `createVisibilityGate`, `installNavigationHooks`; reads the Extractor's outputs |
| PCM_PostIt_Quick_Text | Yes | `bootUntil`, `setNativeFieldValue`, `flashLabel`, `createVisibilityGate`; one scoped MutationObserver |
| PCM_Assign_Buttons | Yes | `bootUntil`, `createVisibilityGate`, `cleanText`; one scoped MutationObserver |
| PCM_Incident_Button | Yes | Field lookup and value setting over the re-rendering Forms widget |
| PCM_Change_Completed_Now | Yes | Widget-scoped observer behind `createVisibilityGate` |
| PCM_Reply_Editor_Autosize | No | Pure CSS, a single style tag |
| PCM_Timeline_Box_Autosize | Yes | `createVisibilityGate`, `installNavigationHooks`, `readJson`/`writeJson`; one ResizeObserver plus one scoped MutationObserver |
| PCM_Mail_Templates | Yes | Summernote editor helpers, `createVisibilityGate`, `flashLabel` |
| PCM_Subscription_Buttons | Yes | Field finder, native value setter and editor helpers |
| PCM_Template_ID_Viewer | No | Purely event-driven inside one modal |
| PCM_Image_Viewer | No | Purely event-driven via `shown.bs.modal` and the iframe load event |
| PCM_Merge_By_Number | No | Purely event-driven via `shown.bs.modal`; one lookup per Use click |
| PCM_No_Autoscroll | No | Must run at document-start, before the library loads; active only while a ticket opens |
| PCM_Timeline_Preview_Cleanup | No | CSS for hiding, plus jQuery `ajaxComplete` and `shown.bs.modal` for avatars; no observers |
| PCM_Jira_Quick_Link | Yes | `bootUntil`, `setNativeFieldValue`, `flashLabel`, `createVisibilityGate`; one scoped MutationObserver |
| PCM_No_Access_Redirection_Button | Yes | `bootUntil`, `ensureStyleTag`, `cleanText`; one observer on the direct children of body |
| PCC_User_Group_Search | No | Different app (Admin console), server-rendered, bounded boot only |
| POS_Access_Log_Filter | No | Different app (Organisation Settings), server-rendered, bounded boot plus one row observer |
| PCC_Agent_Highlighter | No | Different app (app.puzzel.com). Its SPA machinery (grid rebind, dirty-row tracking, nav hooks) has no PCM_DOM equivalent; overlap is ~15 lines |
| PCC_Request_Alert | No | Different app. Watches one status element and adds one main menu entry; nothing to share |
| PCC_Softphone_Status_Highlight | No | Different app. 99 lines, self-contained, rAF-throttled; only overlap is style injection |
| Geckoboard_Full_Numbers | No | Different app (Geckoboard). Pure CSS, a single style tag |
| Geckoboard_Keep_Last_Data | No | Different app. Wraps fetch for widget data requests only; no observers, no polling |

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
https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_List/PCM_New_Ticket_Notifier.user.js
```

Tampermonkey detects the `.user.js` extension and offers to install it directly. Do this once per script.

## Auto-updates

Scripts with `@downloadURL` and `@updateURL` point at their own raw GitHub URL. Filenames are stable (no version or date), so these URLs never change; Tampermonkey periodically checks `@updateURL` for a higher `@version` and, if found, pulls the new file from `@downloadURL`.

## Shared DOM library

Scripts that use the shared library pull in `PCM_Shared_Library/PCM_Shared_Library.user.js` via `@require`, pointed at the raw GitHub URL.

Since v1.8 the library also owns the small utilities the scripts used to duplicate: `cleanText`, `wait`, `escapeRegExp`, `uniqueTexts`, `uniqueElements`, `readJson`/`writeJson`, and `createVisibilityGate` (the battery pattern: skip work while the tab is hidden, one catch-up run on return). Since v1.9 it also owns `installNavigationHooks`: one shared history wrap for SPA navigation detection with per-script callbacks, replacing the per-script copies that stacked multiple wrappers on `history.pushState`. Since v2.0 it additionally owns the machinery the Forms and Reply_Editor scripts used to carry as private copies: `createFieldFinder` (label-based form field lookup with a connected-node cache), `setNativeFieldValue` (select-aware value setter firing input/change through the native setter), the Summernote editor helpers (`editorTextToHtml`, `editorIsEmpty`, `editorAppendHtml`), `flashLabel` (transient button label swap), and `createUnsavedWatcher` (the snapshot-based unsaved-change engine behind PCM_Unsaved_Form_Warning, configurable per widget zone with per-zone save clearing). Since v2.2 `createUnsavedWatcher` names each field by its label's own text, so notes or buttons placed inside a label (PCM's "(User is online)", the Assign and Post-It buttons) no longer make a saved field look unsaved after a re-render. New scripts should use these instead of writing their own. Scripts that depend on newer helpers must check for them in their startup guard so a stale cached library fails loudly.

Important: Tampermonkey fetches `@require` content once and caches it. It only re-fetches when the parent script's own `@version` changes, when the script is re-saved in the Tampermonkey editor, or on the Externals update interval. Scripts without code changes are not version-bumped when the library changes; after a library change is pushed, refresh the requiring scripts in Tampermonkey (re-save, or Check for userscript updates). `PCM_DOM.LIB_VERSION` (since lib 2.1) shows the loaded library version in the console, and scripts that need newer helpers fail loudly in their startup guard.

## CI

Two GitHub Actions workflows run automatically:

- `lint_scripts.yml`: on every push and pull request, syntax-checks all userscripts and enforces the repo rules via `tools/lint_scripts.py`: uniform headers, matching `@version` fields, correct download/update URLs, version format, no em/en dashes, and a bumped `@version` on every changed script. (The library cascade check was removed in lint 1.2: requiring scripts are refreshed manually instead, see Shared DOM library.)
- `build_script_bundle.yml`: rebuilds the download bundle on script changes (see Installing).

## Energy efficiency rules

All scripts are used on battery-powered laptops with the tab frequently hidden or the window covered, in Chrome, Edge, Opera, and Firefox (note: Firefox does not treat covered windows as hidden, only minimised ones or unselected tabs). The rules:

- No periodic work while `document.hidden` unless background operation IS the feature (Auto_Refresh reloads, New Ticket Notifier alerts). Everything else skips and catches up once on `visibilitychange`, via `createVisibilityGate` where the lib is available.
- Scope MutationObservers as narrowly as possible and never observe attributes on roots the script itself writes classes to (this caused a frame-rate feedback loop in the softphone script once).
- Prefer event-driven over polling; any polling must be bounded.
- Do not rely on browser throttling to save power. Be cheap by construction, identically across all four browsers.
