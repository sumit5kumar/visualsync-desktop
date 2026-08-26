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

export type DesktopPreviewState = {
  projectId: number | null;
  video: LocalOutputVideo | null;
  canRender: boolean;
  message: string;
};

export type LocalRenderEvent =
  | { type: "started"; command: string }
  | { type: "output"; line: string }
  | { type: "completed"; exitCode: number }
  | { type: "failed"; message: string };
