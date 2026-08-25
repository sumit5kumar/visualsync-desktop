import { contextBridge, ipcRenderer } from "electron";
import type { LocalProjectPaths, LocalRenderRequest } from "./contracts.js";

contextBridge.exposeInMainWorld("visualSyncDesktop", {
  isDesktopApp: true,
  chooseSourceDirectory: () => ipcRenderer.invoke("local-paths:choose-source-directory") as Promise<string | null>,
  chooseOutputDirectory: () => ipcRenderer.invoke("local-paths:choose-output-directory") as Promise<string | null>,
  chooseNarration: () => ipcRenderer.invoke("local-paths:choose-narration") as Promise<string | null>,
  chooseRenderHandoff: () => ipcRenderer.invoke("local-render:choose-handoff") as Promise<string | null>,
  chooseWorker: () => ipcRenderer.invoke("local-render:choose-worker") as Promise<string | null>,
  getLocalProjectPaths: (projectId: string) => ipcRenderer.invoke("local-paths:get", projectId) as Promise<LocalProjectPaths | null>,
  saveLocalProjectPaths: (projectId: string, paths: Omit<LocalProjectPaths, "updatedAt">) => ipcRenderer.invoke("local-paths:save", projectId, paths) as Promise<LocalProjectPaths>,
  runApprovedRender: (request: LocalRenderRequest) => ipcRenderer.invoke("local-render:run", request) as Promise<void>,
  onRenderEvent: (listener: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on("local-render:event", handler);
    return () => ipcRenderer.removeListener("local-render:event", handler);
  },
});
