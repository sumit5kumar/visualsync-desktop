# VisualSync Desktop TODO

- [x] Create a separate private repository and Electron foundation without changing the hosted VisualSync web app.
- [x] Add a context-isolated Windows native bridge for the desktop application.
- [x] Add local-only source/output/narration path storage and validated approved-render worker launch contracts.
- [x] Wire native path selection and approved render progress into an Electron-specific companion surface without altering the hosted web UI.
- [x] Build and validate the Windows installer on a Windows device; account sign-in remains a user-owned first-launch step.
- [x] Defer independent VisualSync customer accounts, isolated provider-key storage, and a separate hosted queue backend; retain the completed current hosted account flow until independent infrastructure is intentionally funded and configured.
- [x] Defer Cloudflare R2, queue resources, and independent Groq/Gemini onboarding because no authorized Cloudflare payment method is currently available.
- [x] Supersede the proposed automatic retention cleanup in favor of a hosted manual-deletion and storage-warning policy, as requested by the user.
- [x] Improve only the separate desktop app's Preview and local workflow for faster use, without modifying any hosted web page, Timeline pipeline, provider flow, or web-app source.
- [x] Modify only the desktop Preview tab/window to show final local MP4 playback and a one-click Render action that silently reuses saved paths and refreshes the worker plus approved handoff into the output folder; do not change any other desktop screen or the hosted web app.
- [x] Remove explicit Windows-path saving from the desktop workflow: silently retain first-time local selections and keep the Preview limited to final-video playback plus one Render/Export action.
- [x] Polish only the desktop Preview presentation into a smooth, clean editor-style output surface with clear loading and render states and no technical clutter.
- [ ] Define release licensing, code-signing, privacy, update, and support requirements before selling.
