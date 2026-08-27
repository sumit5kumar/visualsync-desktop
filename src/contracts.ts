export type LocalProjectPaths = {
  sourceDirectory: string;
  outputDirectory: string;
  narrationPath: string;
  handoffPath?: string;
  workerPath?: string;
  ffmpegPath?: string;
  updatedAt: string;
};

export type LocalRenderRequest = {
  handoffPath: string;
  sourceDirectory: string;
  outputDirectory: string;
  ffmpegPath?: string;
  workerPath: string;
};

export type LocalOutputVideo = {
  name: string;
  path: string;
  fileUrl: string;
  byteSize: number;
  modifiedAt: string;
};

export type DesktopPreviewProject = {
  id: number;
  name: string;
};

export type DesktopPreviewState = {
  projectId: number | null;
  projectName: string | null;
  video: LocalOutputVideo | null;
  canRender: boolean;
  message: string;
};

export type LocalRenderEvent =
  | { type: "started"; command: string }
  | { type: "preparing"; generatedFrames: number; expectedFrames: number }
  | { type: "output"; line: string }
  | { type: "completed"; exitCode: number }
  | { type: "cancelled"; message: string }
  | { type: "failed"; message: string };
