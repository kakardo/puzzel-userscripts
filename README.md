# Puzzel Userscripts

Tampermonkey scripts for the Puzzel PCM web application.

## Structure

- `DOM/`: shared DOM helper library (`PCM_DOM_Shared_Local`), loaded by every script in `PCM/` via `@require`. Keeps DOM/runtime logic in one place so feature scripts only handle their own state and styling.
- `PCM/`: individual feature scripts:
  - `PCM Ticket Info Extractor`: surfaces CustomerID, Customer Name, and Company Name from Customer Intelligence.
  - `PCM_Name_Field_Placeholder`: adds a placeholder name link in Customer Intelligence when no name is set.
  - `Puzzel Styler (Ticket Field)`: highlights Assigned-To and Status fields.
  - `PCM_New_Ticket_Notifier`: alerts on new tickets in the PCM ticket list.

## Installing

Open the raw GitHub URL of any script in `PCM/` in a browser with Tampermonkey installed, for example:

```
https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM/PCM_New_Ticket_Notifier_1.5_2026-04-24.user.js
```

Tampermonkey detects the `.user.js` extension and offers to install it directly. Do this once per script.

## Auto-updates

Each script in `PCM/` has `@downloadURL` and `@updateURL` pointing at its own raw GitHub URL. Tampermonkey periodically checks `@updateURL` for a higher `@version` and, if found, pulls the new file from `@downloadURL`.

## Shared DOM library

Each script in `PCM/` pulls in `DOM/PCM_DOM_Shared_Local_*.user.js` via `@require`, pointed at the raw GitHub URL.

Important: Tampermonkey fetches `@require` content once and caches it. It only re-fetches when the parent script's own `@version` changes (or on a manual "Check for userscript updates"). So after editing the shared DOM library, bump the `@version` of every script in `PCM/` that requires it, otherwise they keep running the cached copy.
