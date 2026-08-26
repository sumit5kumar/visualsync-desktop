import type { DesktopPreviewState, LocalOutputVideo, LocalProjectPaths, LocalRenderRequest } from "./contracts.js";

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
      renderDesktopPreview(): Promise<void>;
      toggleDesktopPreviewFullscreen(): Promise<boolean>;
      runApprovedRender(request: LocalRenderRequest): Promise<void>;
      onRenderEvent(listener: (event: unknown) => void): () => void;
    };
  }
}

export {};
