import type { DesktopPreviewProject, DesktopPreviewState, LocalOutputVideo, LocalProjectPaths, LocalRenderEvent, LocalRenderRequest } from "./contracts.js";

declare global {
  interface Window {
    visualSyncDesktop?: {
      isDesktopApp: true;
      chooseSourceDirectory(): Promise<string | null>;
      chooseOutputDirectory(): Promise<string | null>;
      chooseNarration(): Promise<string | null>;
      chooseRenderHandoff(): Promise<string | null>;
      chooseWorker(): Promise<string | null>;
      chooseFfmpeg(): Promise<string | null>;
      openHostedRoute(route: "/" | "/projects" | "/timeline" | "/preview"): Promise<void>;
      getLocalProjectPaths(projectId: string): Promise<LocalProjectPaths | null>;
      saveLocalProjectPaths(projectId: string, paths: Omit<LocalProjectPaths, "updatedAt">): Promise<LocalProjectPaths>;
      listOutputVideos(outputDirectory: string): Promise<LocalOutputVideo[]>;
      openOutputDirectory(outputDirectory: string): Promise<void>;
      openOutputVideo(videoPath: string): Promise<void>;
      getDesktopPreview(): Promise<DesktopPreviewState>;
      listDesktopPreviewProjects(): Promise<DesktopPreviewProject[]>;
      selectDesktopPreviewProject(projectId: number): Promise<DesktopPreviewState>;
      renderDesktopPreview(): Promise<void>;
      setDesktopPreviewFullscreen(fullscreen: boolean): Promise<boolean>;
      toggleDesktopPreviewFullscreen(): Promise<boolean>;
      onDesktopPreviewFullscreenChanged(listener: (fullscreen: boolean) => void): () => void;
      onDesktopPreviewProjectChanged(listener: () => void): () => void;
      runApprovedRender(request: LocalRenderRequest): Promise<void>;
      onRenderEvent(listener: (event: unknown) => void): () => void;
    };
  }
}

export {};
