import { contextBridge, ipcRenderer } from "electron";
import type { DesktopPreviewProject, DesktopPreviewState, LocalOutputVideo, LocalProjectPaths, LocalRenderRequest } from "./contracts.js";

const hostedOrigin = new URL(process.env.VISUALSYNC_APP_URL ?? "https://visualsync-pnpeq6e6.manus.space").origin;
let openingDesktopPreview = false;

const isHostedPage = () => window.location.origin === hostedOrigin;

function elementFrom(candidate: EventTarget | null) {
  return candidate && typeof candidate === "object" && "nodeType" in candidate ? candidate as Element : null;
}

function anchorFrom(event: Event) {
  return event.composedPath().map(candidate => elementFrom(candidate)).find(element => element?.tagName === "A") as HTMLAnchorElement | undefined;
}

function selectedTimelineProjectId() {
  const fromSearch = Number(new URLSearchParams(window.location.search).get("project"));
  if (Number.isInteger(fromSearch) && fromSearch > 0) return fromSearch;
  const selectors = Array.from(document.querySelectorAll<HTMLSelectElement>("select"));
  const projectSelector = selectors.find(select => Array.from(select.options).some(option => option.textContent?.trim() === "Select project"));
  const selection = [projectSelector, ...selectors.filter(select => select !== projectSelector)]
    .filter((select): select is HTMLSelectElement => Boolean(select))
    .map(select => Number(select.value))
    .find(value => Number.isInteger(value) && value > 0);
  return selection ?? null;
}

function isPreviewControl(event: Event) {
  return event.composedPath().map(candidate => elementFrom(candidate)).some(element => element?.textContent?.replace(/\s+/g, " ").trim() === "Preview");
}

function openDesktopPreviewImmediately(event: Event) {
  event.preventDefault();
  event.stopImmediatePropagation();
  if (openingDesktopPreview) return;
  openingDesktopPreview = true;
  void ipcRenderer.invoke("desktop-preview:open").finally(() => {
    setTimeout(() => { openingDesktopPreview = false; }, 300);
  });
}

function persistTimelineProjectRoute(projectId: number) {
  const url = new URL(window.location.href);
  if (url.pathname !== "/timeline" || url.searchParams.get("project") === String(projectId)) return;
  url.searchParams.set("project", String(projectId));
  history.replaceState(history.state, "", url);
}

document.addEventListener("change", event => {
  const target = elementFrom(event.target);
  if (!isHostedPage() || target?.tagName !== "SELECT") return;
  const selector = target as HTMLSelectElement;
  const isTimelineProjectSelector = Array.from(selector.options).some(option => option.textContent?.trim() === "Select project");
  const projectId = isTimelineProjectSelector ? selectedTimelineProjectId() : null;
  if (projectId) {
    persistTimelineProjectRoute(projectId);
    ipcRenderer.send("desktop-preview:timeline-selection", projectId);
  }
}, true);

document.addEventListener("pointerdown", event => {
  if (!isHostedPage()) return;
    if (event.button !== 0) return;
    const anchor = anchorFrom(event);
    if (anchor?.href) {
      const target = new URL(anchor.href, window.location.href);
      if (target.origin === hostedOrigin && target.pathname === "/preview") {
        openDesktopPreviewImmediately(event);
        return;
      }
    }
    if (isPreviewControl(event)) {
      openDesktopPreviewImmediately(event);
      return;
    }
    // The local Preview covers only the hosted content pane. Any pointer event
    // received by this hosted document therefore comes from its still-visible
    // shell, such as a button-based sidebar item; remove the overlay before that
    // original click proceeds.
    void ipcRenderer.invoke("desktop-preview:close");
}, true);

document.addEventListener("mousedown", event => {
  if (!isHostedPage() || event.button !== 0 || !isPreviewControl(event)) return;
  openDesktopPreviewImmediately(event);
}, true);

document.addEventListener("click", event => {
  if (!isHostedPage()) return;
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (isPreviewControl(event)) {
      openDesktopPreviewImmediately(event);
      return;
    }
    const anchor = anchorFrom(event);
    if (!anchor?.href) return;
    const target = new URL(anchor.href, window.location.href);
    if (target.origin !== hostedOrigin) return;
    if (target.pathname === "/preview") {
      openDesktopPreviewImmediately(event);
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
  listDesktopPreviewProjects: () => ipcRenderer.invoke("desktop-preview:list-projects") as Promise<DesktopPreviewProject[]>,
  selectDesktopPreviewProject: (projectId: number) => ipcRenderer.invoke("desktop-preview:select-project", projectId) as Promise<DesktopPreviewState>,
  renderDesktopPreview: () => ipcRenderer.invoke("desktop-preview:render") as Promise<void>,
  cancelDesktopPreviewRender: () => ipcRenderer.invoke("desktop-preview:cancel-render") as Promise<boolean>,
  setDesktopPreviewFullscreen: (fullscreen: boolean) => ipcRenderer.invoke("desktop-preview:set-fullscreen", fullscreen) as Promise<boolean>,
  toggleDesktopPreviewFullscreen: () => ipcRenderer.invoke("desktop-preview:toggle-fullscreen") as Promise<boolean>,
  onDesktopPreviewFullscreenChanged: (listener: (fullscreen: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, fullscreen: unknown) => listener(fullscreen === true);
    ipcRenderer.on("desktop-preview:fullscreen-changed", handler);
    return () => ipcRenderer.removeListener("desktop-preview:fullscreen-changed", handler);
  },
  onDesktopPreviewProjectChanged: (listener: () => void) => {
    const handler = () => listener();
    ipcRenderer.on("desktop-preview:project-changed", handler);
    return () => ipcRenderer.removeListener("desktop-preview:project-changed", handler);
  },
  runApprovedRender: (request: LocalRenderRequest) => ipcRenderer.invoke("local-render:run", request) as Promise<void>,
  onRenderEvent: (listener: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on("local-render:event", handler);
    return () => ipcRenderer.removeListener("local-render:event", handler);
  },
});
