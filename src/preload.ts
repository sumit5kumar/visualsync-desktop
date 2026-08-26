import { contextBridge, ipcRenderer } from "electron";
import type { DesktopPreviewState, LocalOutputVideo, LocalProjectPaths, LocalRenderRequest } from "./contracts.js";

const hostedOrigin = new URL(process.env.VISUALSYNC_APP_URL ?? "https://visualsync-pnpeq6e6.manus.space").origin;

const isHostedPage = () => window.location.origin === hostedOrigin;

document.addEventListener("pointerdown", event => {
  if (!isHostedPage()) return;
    if (event.button !== 0) return;
    const anchor = event.composedPath().find(candidate => candidate instanceof HTMLAnchorElement) as HTMLAnchorElement | undefined;
    if (anchor?.href) {
      const target = new URL(anchor.href, window.location.href);
      if (target.origin === hostedOrigin && target.pathname === "/preview") return;
    }
    // The local Preview covers only the hosted content pane. Any pointer event
    // received by this hosted document therefore comes from its still-visible
    // shell, such as a button-based sidebar item; remove the overlay before that
    // original click proceeds.
    void ipcRenderer.invoke("desktop-preview:close");
}, true);

document.addEventListener("click", event => {
  if (!isHostedPage()) return;
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.composedPath().find(candidate => candidate instanceof HTMLAnchorElement) as HTMLAnchorElement | undefined;
    if (!anchor?.href) return;
    const target = new URL(anchor.href, window.location.href);
    if (target.origin !== hostedOrigin) return;
    if (target.pathname === "/preview") {
      event.preventDefault();
      event.stopImmediatePropagation();
      void ipcRenderer.invoke("desktop-preview:open");
      return;
    }
    void ipcRenderer.invoke("desktop-preview:close");
}, true);

document.addEventListener("keydown", event => {
  if (!isHostedPage()) return;
    if (event.key === "Enter" || event.key === " ") void ipcRenderer.invoke("desktop-preview:close");
}, true);

contextBridge.exposeInMainWorld("visualSyncDesktop", {
  isDesktopApp: true,
  chooseSourceDirectory: () => ipcRenderer.invoke("local-paths:choose-source-directory") as Promise<string | null>,
  chooseOutputDirectory: () => ipcRenderer.invoke("local-paths:choose-output-directory") as Promise<string | null>,
  chooseNarration: () => ipcRenderer.invoke("local-paths:choose-narration") as Promise<string | null>,
  chooseRenderHandoff: () => ipcRenderer.invoke("local-render:choose-handoff") as Promise<string | null>,
  chooseWorker: () => ipcRenderer.invoke("local-render:choose-worker") as Promise<string | null>,
  chooseFfmpeg: () => ipcRenderer.invoke("local-render:choose-ffmpeg") as Promise<string | null>,
  openHostedRoute: (route: "/" | "/projects" | "/timeline" | "/preview") => ipcRenderer.invoke("hosted-navigation:open", route) as Promise<void>,
  getLocalProjectPaths: (projectId: string) => ipcRenderer.invoke("local-paths:get", projectId) as Promise<LocalProjectPaths | null>,
  saveLocalProjectPaths: (projectId: string, paths: Omit<LocalProjectPaths, "updatedAt">) => ipcRenderer.invoke("local-paths:save", projectId, paths) as Promise<LocalProjectPaths>,
  listOutputVideos: (outputDirectory: string) => ipcRenderer.invoke("local-preview:list-output-videos", outputDirectory) as Promise<LocalOutputVideo[]>,
  openOutputDirectory: (outputDirectory: string) => ipcRenderer.invoke("local-preview:open-output-directory", outputDirectory) as Promise<void>,
  openOutputVideo: (videoPath: string) => ipcRenderer.invoke("local-preview:open-output-video", videoPath) as Promise<void>,
  getDesktopPreview: () => ipcRenderer.invoke("desktop-preview:get") as Promise<DesktopPreviewState>,
  renderDesktopPreview: () => ipcRenderer.invoke("desktop-preview:render") as Promise<void>,
  runApprovedRender: (request: LocalRenderRequest) => ipcRenderer.invoke("local-render:run", request) as Promise<void>,
  onRenderEvent: (listener: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on("local-render:event", handler);
    return () => ipcRenderer.removeListener("local-render:event", handler);
  },
});
