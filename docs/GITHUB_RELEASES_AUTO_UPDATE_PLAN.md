# GitHub Releases UI Auto Update Plan

## 1. Goal

Implement a reliable desktop update flow for the current project so users can:

1. view the current app version in UI,
2. manually check for updates from GitHub Releases,
3. download the latest version from UI,
4. install updates with a controlled restart flow,
5. keep a stable fallback path when auto-install is not available.

The update path should be driven by Electron main process, not by the gateway web server.

## 2. Current Project State

### 2.1 Packaging and runtime shape

Current repository already has the right baseline:

- Electron app entry: `apps/desktop-live2d/main/electronMain.js`
- Product version: `package.json`
- Packaging tool: `electron-builder`
- mac targets: `dmg`, `zip`
- win target: `nsis`
- preload bridge exists:
  - `apps/desktop-live2d/main/preload.js`
  - `apps/desktop-live2d/main/onboardingPreload.js`
- web UI exists under `apps/gateway/public/`

Relevant existing files:

- `package.json`
- `apps/desktop-live2d/main/electronMain.js`
- `apps/desktop-live2d/main/preload.js`
- `apps/desktop-live2d/main/onboardingPreload.js`
- `apps/gateway/public/index.html`
- `apps/gateway/public/chat.js`
- `apps/gateway/public/config-v2.html`
- `apps/gateway/public/config-v2.js`
- `apps/gateway/server.js`
- `docs/MAC_PACKAGING_GUIDE.md`
- `docs/WINDOWS_PACKAGING_GUIDE.md`

### 2.2 Current gap

Current project does not yet have:

- updater service in Electron main process,
- preload API for update control,
- update UI state model,
- release publishing metadata for auto-update,
- signing/notarization-aware platform policy,
- reliable version endpoint beyond git branch.

Current `/api/version` only returns branch name, which is not sufficient for update UX.

## 3. High-Level Strategy

Use the standard Electron stack:

- packaging: `electron-builder`
- update orchestration: `electron-updater`
- release source: GitHub Releases
- UI communication: Electron IPC through preload bridge

This is the correct fit for the current repo because the application is already packaged with `electron-builder` and distributed as installable desktop artifacts.

## 4. Platform Policy

### 4.1 Windows

Windows should support the full auto-update path first.

Target behavior:

1. user clicks `Check for updates`,
2. app finds a newer GitHub Release,
3. user clicks `Download update`,
4. app downloads update package,
5. user clicks `Restart and install`,
6. app exits and installs the new version.

Reason:

- NSIS + `electron-updater` is the most mature path.
- Installation flow is predictable.

### 4.2 macOS

macOS should be split into two phases.

#### Phase A

Support:

- check update,
- show latest release info,
- download update,
- open release page or reveal downloaded artifact.

Do not rely on auto-install yet.

#### Phase B

After the following are done:

- Developer ID signing,
- notarization,
- hardened runtime / entitlements validation,

then enable:

- download update,
- restart and install.

Reason:

- macOS auto-update without proper signing and notarization is not reliable enough.
- A broken updater path is worse than a manual but predictable update path.

## 5. Functional Requirements

### 5.1 UI requirements

The user should be able to:

- see current app version,
- see update channel,
- click `Check for updates`,
- see `Checking...`,
- see `Up to date` or `Update available`,
- view latest version number,
- view release notes summary,
- click `Download update`,
- see progress percentage,
- click `Restart and install` when ready,
- see an actionable fallback if update fails.

### 5.2 Reliability requirements

The updater must:

- never block core app boot,
- never depend on gateway availability to function,
- degrade gracefully when GitHub is unreachable,
- preserve a manual update path,
- not allow arbitrary download sources from renderer,
- log enough information for diagnosis.

## 6. System Architecture

### 6.1 Main process owns update logic

All update operations should live in Electron main process.

Responsibilities:

- determine current packaged version,
- check GitHub Releases,
- compare versions,
- download update,
- emit state changes,
- trigger install,
- write updater logs.

Main process is the correct place because:

- it has OS-level lifecycle control,
- it can safely call updater APIs,
- it can restart the app,
- it can keep renderer sandboxed.

### 6.2 Preload is the renderer boundary

Renderer should not directly call Node APIs or GitHub APIs.

Preload should expose a small `desktopUpdater` API.

### 6.3 Renderer is pure UI

The web UI should:

- request updater state,
- trigger actions,
- render status,
- subscribe to state changes.

Renderer should not implement update business logic.

## 7. Proposed File-Level Design

### 7.1 New files

Add:

- `apps/desktop-live2d/main/updateService.js`
- `apps/desktop-live2d/main/updateIpc.js`
- `docs/GITHUB_RELEASES_AUTO_UPDATE_PLAN.md`

Optional if you want tests immediately:

- `test/desktop-live2d/updateService.test.js`
- `test/desktop-live2d/updateIpc.test.js`

### 7.2 Existing files to update

Update:

- `package.json`
- `apps/desktop-live2d/main/electronMain.js`
- `apps/desktop-live2d/main/preload.js`
- `apps/desktop-live2d/main/onboardingPreload.js`
- `apps/gateway/public/config-v2.html`
- `apps/gateway/public/config-v2.js`
- `apps/gateway/public/index.html`
- `apps/gateway/public/chat.js`
- `apps/gateway/server.js`
- `docs/MAC_PACKAGING_GUIDE.md`
- `docs/WINDOWS_PACKAGING_GUIDE.md`

## 8. Updater Service Design

### 8.1 Core abstraction

Create a wrapper around `electron-updater` rather than using it directly everywhere.

Suggested interface:

```js
class UpdateService {
  getState() {}
  async checkForUpdates() {}
  async downloadUpdate() {}
  async quitAndInstall() {}
  async openReleasePage() {}
  dispose() {}
}
```

### 8.2 State model

Use a single in-memory state object.

Suggested shape:

```js
{
  state: 'idle',
  currentVersion: null,
  latestVersion: null,
  releaseName: null,
  releaseNotes: null,
  publishedAt: null,
  downloadProgress: 0,
  downloadedFilePath: null,
  canCheck: true,
  canDownload: false,
  canInstall: false,
  canAutoInstall: false,
  platform: process.platform,
  isPackaged: app.isPackaged,
  channel: 'stable',
  errorCode: null,
  errorMessage: null
}
```

### 8.3 Event mapping

Map updater events into internal state:

- `checking-for-update` -> `checking`
- `update-available` -> `update_available`
- `update-not-available` -> `up_to_date`
- `download-progress` -> `downloading`
- `update-downloaded` -> `downloaded`
- `error` -> `error`

### 8.4 Safe behavior in dev mode

If `!app.isPackaged`:

- do not run install operations,
- optionally allow release metadata check for development,
- clearly return `Updater available only in packaged builds`.

This avoids confusing local dev behavior.

## 9. IPC and Preload Design

### 9.1 IPC channels

Recommended channels:

- `desktop:update:get-state`
- `desktop:update:check`
- `desktop:update:download`
- `desktop:update:install`
- `desktop:update:open-release-page`
- `desktop:update:state-changed`

### 9.2 Preload API

Expose this API from preload:

```js
window.desktopUpdater = {
  getState: () => ipcRenderer.invoke('desktop:update:get-state'),
  check: () => ipcRenderer.invoke('desktop:update:check'),
  download: () => ipcRenderer.invoke('desktop:update:download'),
  install: () => ipcRenderer.invoke('desktop:update:install'),
  openReleasePage: () => ipcRenderer.invoke('desktop:update:open-release-page'),
  onStateChange: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('desktop:update:state-changed', listener);
    return () => ipcRenderer.off('desktop:update:state-changed', listener);
  }
};
```

### 9.3 Security rules

Do not expose:

- arbitrary URLs,
- arbitrary shell commands,
- arbitrary file open paths.

Renderer should only call fixed updater actions.

## 10. UI Integration Plan

## 10.1 Primary entry point

Primary update UI should live in:

- `apps/gateway/public/config-v2.html`
- `apps/gateway/public/config-v2.js`

Reason:

- update is a client/runtime concern,
- config page is the right place for maintenance actions,
- avoid cluttering the main chat surface.

### 10.2 Secondary surface

The chat page can show a lightweight status only:

- current app version,
- optional badge if update is available.

Relevant files:

- `apps/gateway/public/index.html`
- `apps/gateway/public/chat.js`

### 10.3 UI states

Suggested display states:

- `Current version: 0.1.1`
- `Checking for updates...`
- `You are on the latest version`
- `Update available: v0.1.2`
- `Downloading update: 43%`
- `Update downloaded. Restart to install.`
- `Update failed: <reason>`

### 10.4 Action buttons

Suggested buttons:

- `Check for updates`
- `Download update`
- `Restart and install`
- `Open release page`

Disable buttons according to updater state.

## 11. Version Information API

Current `/api/version` should be expanded.

Suggested response:

```json
{
  "ok": true,
  "data": {
    "app_version": "0.1.1",
    "branch": "main",
    "platform": "darwin",
    "is_packaged": true,
    "electron_version": "30.5.1"
  }
}
```

Notes:

- This endpoint is only for display and diagnostics.
- Actual update logic should not depend on gateway server responses.

## 12. GitHub Releases Publishing Requirements

## 12.1 Release format

Use semantic version tags:

- `v0.1.2`
- `v0.1.3`

Do not publish updater-compatible releases without matching build artifacts.

### 12.2 Assets required

For Windows auto-update:

- NSIS installer
- `latest.yml`

For macOS update path:

- `.zip`
- `latest-mac.yml`
- optionally `.dmg` for manual install UX

Important:

- macOS auto-update requires zip-based artifacts.
- Do not publish only dmg for mac.

### 12.3 Draft/prerelease policy

Recommended:

- stable updates come only from non-prerelease releases,
- beta channel can be added later if needed,
- do not mix prerelease assets into stable channel logic in phase 1.

## 13. package.json / electron-builder Changes

### 13.1 Add dependency

Add:

```json
"electron-updater": "^6.x"
```

### 13.2 Add publish config

Under `build` add GitHub publish config:

```json
{
  "build": {
    "publish": [
      {
        "provider": "github",
        "owner": "sdyzjx",
        "repo": "open-yachiyo"
      }
    ]
  }
}
```

### 13.3 Keep current target setup

Current targets are already close to what updater needs:

- Windows NSIS
- macOS zip + dmg

This is good. Do not simplify away mac zip.

## 14. CI/CD Release Flow

## 14.1 Trigger

Use git tags as the release boundary.

Example:

- push `v0.1.2`

### 14.2 Pipeline stages

Recommended flow:

1. install dependencies,
2. run test suite,
3. build Windows artifacts,
4. build macOS artifacts,
5. publish release assets to GitHub Releases.

### 14.3 Publish mechanism

Use `electron-builder --publish always` in release workflow.

Provide:

- `GH_TOKEN`

### 14.4 Branch policy

Recommended:

- normal `main` pushes do not publish updater releases,
- only version tag pushes produce updater-compatible releases.

This keeps update metadata coherent.

## 15. Logging and Diagnostics

Updater must write a dedicated log file.

Suggested path:

- inside `app.getPath('userData')`
- file name like `updater.log`

Log entries should include:

- current version,
- package mode,
- platform and arch,
- update check start/end,
- matched release version,
- download start/progress/end,
- install trigger,
- error stack.

This is required to debug field failures.

## 16. Failure Modes and Recovery

Design for the following failures explicitly.

### 16.1 Network or GitHub unavailable

Behavior:

- show non-blocking error,
- keep app usable,
- offer `Open release page` fallback.

### 16.2 No matching asset for current platform

Behavior:

- show `No compatible asset found for darwin-arm64` or equivalent,
- do not enter broken download state.

### 16.3 Corrupt or incomplete release metadata

Behavior:

- surface a structured error,
- keep manual update fallback.

### 16.4 Download interrupted

Behavior:

- keep state as `error` or `idle`,
- allow retry,
- do not leave renderer stuck in `downloading`.

### 16.5 Install path unavailable

Behavior:

- especially on macOS phase A, reveal the downloaded file or open release page,
- do not pretend installation succeeded.

## 17. Security Constraints

Updater must enforce:

- fixed repository source only,
- no renderer-provided download URL,
- install actions only in packaged mode,
- sanitized release-note rendering,
- no shell-based installation path in renderer.

## 18. Rollout Plan

## Phase 1: Reliable update visibility

Scope:

- add version info to UI,
- add updater service skeleton,
- add `Check for updates`,
- show latest version and release notes,
- add `Open release page` fallback.

Deliverable:

- users can reliably discover updates from UI.

## Phase 2: Controlled download flow

Scope:

- add download flow,
- show progress,
- support `downloaded` state,
- support Windows install,
- support macOS manual install handoff.

Deliverable:

- Windows full update path,
- macOS download-and-open path.

## Phase 3: Production-grade macOS auto install

Scope:

- signing,
- notarization,
- hardened runtime validation,
- enable `quitAndInstall` on macOS.

Deliverable:

- full auto-update on macOS.

## 19. Test Plan

### 19.1 Unit tests

Add tests for:

- state transitions,
- error mapping,
- packaged vs dev behavior,
- platform gating,
- progress update handling.

### 19.2 Integration tests

Mock updater adapter instead of using live GitHub network.

Cover:

- update available,
- update not available,
- download progress,
- update downloaded,
- error,
- install action allowed/blocked by platform policy.

### 19.3 Manual verification

Minimum manual matrix:

- Windows packaged app upgrade from previous release,
- macOS arm64 packaged app update check,
- offline network behavior,
- malformed release behavior,
- UI state reset after restart.

## 20. Recommended First Implementation Slice

The first implementation slice should be deliberately small:

1. add `electron-updater`,
2. add `updateService.js`,
3. add preload API,
4. add update section in `config-v2.html`,
5. extend `/api/version`,
6. implement `check` only,
7. wire `Open release page` fallback.

Then implement:

8. Windows download/install,
9. macOS download/reveal fallback,
10. release workflow.

This ordering minimizes risk and gives a usable result early.

## 21. Concrete Recommendation for This Repo

Recommended policy for this project:

- do not make gateway server responsible for update orchestration,
- do not attempt silent in-place replacement manually,
- do not make macOS auto-install a day-one requirement,
- do implement a stable Electron-owned updater service now,
- do prioritize Windows first for auto-install,
- do preserve a manual fallback path on every platform.

That is the most defensible engineering path for the current codebase.
