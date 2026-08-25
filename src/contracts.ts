export type LocalProjectPaths = {
  sourceDirectory: string;
  outputDirectory: string;
  narrationPath: string;
  updatedAt: string;
};

export type LocalRenderRequest = {
  handoffPath: string;
  sourceDirectory: string;
  outputDirectory: string;
  ffmpegPath?: string;
  workerPath: string;
};

export type LocalRenderEvent =
  | { type: "started"; command: string }
  | { type: "output"; line: string }
  | { type: "completed"; exitCode: number }
  | { type: "failed"; message: string };
