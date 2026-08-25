# VisualSync Desktop

VisualSync Desktop is an **isolated Windows Electron companion** for the existing hosted VisualSync web app. It deliberately does not modify, replace, or deploy the current web project.

## Product boundary

The desktop window opens the existing hosted VisualSync application, so its authenticated account, projects, provider setup, hosted Timeline queue, and browser-independent Timeline Generation behavior remain the same. Once media upload finishes and the hosted job is queued, closing the desktop app does not stop the Timeline job; Groq analysis continues server-side as it does in the web application.

The Electron shell adds a secure, opt-in native bridge for Windows-only local paths and approved local rendering. It uses context isolation and never exposes Node.js directly to hosted page JavaScript. Local folder paths are stored only in Electron's per-user application-data folder. API keys are not copied into the desktop source code, bundled into an installer, or exposed to the bridge.

## Status

This first foundation provides the signed-in hosted app shell and secure native handlers for selecting local source/output/narration/handoff/worker paths, storing local project paths, and launching the existing approved PowerShell renderer. The next implementation phase wires these native capabilities into an Electron-specific companion surface without changing the hosted web experience.

## Development

```bash
pnpm install
pnpm dev
```

Run `pnpm typecheck` before committing. Build a Windows installer from a Windows machine using:

```bash
pnpm dist:win
```

## Security and selling

Each customer must sign in to their own account and use provider credentials they are authorized to use. The app must not ship the developer's Groq keys or embed them in any installer. A sellable release will also need a license policy, Windows code-signing certificate, privacy policy, and support/update process.
