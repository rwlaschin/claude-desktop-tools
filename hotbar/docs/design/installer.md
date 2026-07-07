---
modified: 2026-07-05
dependencies: [hotbar]
---

# installer — persistent auto-load patch

The optional, advanced install path (`install-persist.sh` / `uninstall.sh`)
that patches the Claude desktop app so `hotbar.js` loads automatically on
every launch, instead of being pasted into DevTools each time. Read this
before changing either script or touching how the patch is applied/reversed.

## Sensitive Areas

- Modifies `app.asar` inside the installed Claude desktop app and
  **breaks Anthropic's code signature**. The script re-signs the app
  ad-hoc so it still launches, but this is unsupported by Anthropic and
  could interfere with future app integrity checks.
- The user must quit Claude before running the installer — patching a live
  `app.asar` is not safe.
- A one-time backup (`app.asar.hotbar-backup`) must exist before the first
  patch is applied, so the original app can always be restored via
  `uninstall.sh`. This backup step must never be skipped or overwritten by
  a later install.

## Design Constraints

- Tied to the current app version's internals: the preload's variable
  names and the exposed `claude.web` namespace. A future Claude app
  version that changes these may require the patch script to be updated.
- **Any Claude app update wipes the patch** (it replaces `app.asar`
  wholesale) — this is expected, not a bug; the install step must simply
  be re-run after an update.
- Must be fully reversible: `uninstall.sh` restores the exact pre-patch
  `app.asar` from the one-time backup.

## Feature Overview

Pasting `hotbar.js` into DevTools each launch is the safe default, but
tedious for daily use. `install-persist.sh` exists for users who've decided
the tradeoffs (broken code signature, re-signing, update-wipes-patch) are
acceptable, and want the hotbar present automatically every time the app
opens, by patching it into the app's own preload script.

## Architecture

`install-persist.sh` locates the app's preload (`mainView.js`) inside
`app.asar`, creates `app.asar.hotbar-backup` if one doesn't already exist,
injects a load of `hotbar.js` into the preload, repacks `app.asar`, and
re-signs the app ad-hoc so macOS will still launch it. `uninstall.sh`
reverses this by restoring `app.asar` from the backup.

## Functions

- `install-persist.sh`: back up `app.asar` (once), unpack, patch the
  preload to load `hotbar.js`, repack, ad-hoc re-sign.
- `uninstall.sh`: restore the original `app.asar` from
  `app.asar.hotbar-backup`.

## Models

No models required — the installer operates on filesystem artifacts
(`app.asar`, `app.asar.hotbar-backup`), not on any persisted data
structure.

## Use Cases

### UC1 — Enable persistent auto-load across app launches

- **Goal**: have `hotbar.js` load automatically every time Claude desktop
  opens, without manually pasting it into DevTools each session.
- **Stakeholders**: the developer using the hotbar daily.
- **Actors**: the developer (runs the installer); `install-persist.sh`
  (patches `app.asar` and re-signs the app).
- **Preconditions**: Claude desktop is installed and fully quit; the
  developer has accepted the tradeoffs (broken code signature, ad-hoc
  re-sign, patch wiped by future app updates — see Sensitive Areas).
- **Postconditions**: `app.asar`'s preload loads `hotbar.js` on every
  future launch; a one-time backup (`app.asar.hotbar-backup`) exists.
- **Basic Course of Events (BCE)**: developer quits Claude → runs
  `install-persist.sh` → script creates `app.asar.hotbar-backup` if none
  exists → unpacks `app.asar` and injects the `hotbar.js` load into the
  preload → repacks and ad-hoc re-signs the app → developer relaunches
  Claude and confirms the hotbar appears automatically.
- **Alternate Flows**: if `app.asar.hotbar-backup` already exists from a
  prior install, it is not overwritten — the original, pre-patch backup is
  preserved.
- **Exceptions**: if re-signing fails or the app won't launch, the
  developer restores via `uninstall.sh` from the backup.

### UC2 — Reverse the patch

- **Goal**: restore the original, unmodified Claude desktop app.
- **Stakeholders**: the developer.
- **Actors**: the developer; `uninstall.sh`.
- **Preconditions**: `app.asar.hotbar-backup` exists from a prior install.
- **Postconditions**: `app.asar` is restored exactly to its pre-patch
  state.
- **Basic Course of Events (BCE)**: developer quits Claude → runs
  `uninstall.sh` → script copies `app.asar.hotbar-backup` back over
  `app.asar` → developer relaunches Claude and confirms the app is
  unpatched.
- **Alternate Flows**: none.
- **Exceptions**: if `app.asar.hotbar-backup` is missing (e.g. deleted),
  uninstall cannot proceed — the developer must reinstall Claude fresh.

## Tests

No automated tests. Verification is manual: run `install-persist.sh`,
relaunch Claude, confirm the hotbar appears without a launch/signature
error; run `uninstall.sh` and confirm the app returns to its original,
unpatched state.

## UI/UX

No UI/UX required — command-line scripts only, no interface beyond
terminal output.

## Dependencies

Depends on `hotbar` (`docs/design/hotbar.md`) — `hotbar.js` is the script
this installer patches into the app.

## Diagrams

No diagrams are currently maintained for this subsystem.

## References

- Project `README.md` — "Auto-load on every launch (optional, advanced)"
  section; folded into this design doc as the technical source of truth.
