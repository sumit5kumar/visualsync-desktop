import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell, WebContentsView } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { DesktopPreviewProject, DesktopPreviewState, LocalOutputVideo, LocalProjectPaths, LocalRenderEvent, LocalRenderRequest } from "./contracts.js";
import { isHostedVisualSyncCallback, isHostedVisualSyncUrl } from "./security.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_URL = process.env.VISUALSYNC_APP_URL ?? "https://visualsync-pnpeq6e6.manus.space";
const SETTINGS_FILE = () => path.join(app.getPath("userData"), "local-project-paths.json");
const SESSION_PARTITION = "persist:visualsync-desktop";

type LocalPathStore = Record<string, LocalProjectPaths>;
type HostedProject = { id: number; status: string };
type ApprovedRenderHandoff = {
  projectId: number;
  projectName: string;
  nativePaths: { sourceDirectory: string | null; outputDirectory: string | null };
};

let hostedWindow: BrowserWindow | null = null;
let localWorkspaceWindow: BrowserWindow | null = null;
let desktopPreviewView: WebContentsView | null = null;
let desktopPreviewLoaded = false;
let desktopPreviewLoadPromise: Promise<void> | null = null;
let desktopPreviewOpen = false;
let desktopPreviewRenderInProgress = false;
let activeDesktopRender: ChildProcess | null = null;
let desktopRenderCancellationRequested = false;
let restoringHostedRouteAfterPreview = false;
let desktopPreviewFullscreen = false;
let desktopPreviewProjectId: number | null = null;
let pendingDesktopPreviewOpen = false;
let desktopPreviewRouteRestored = false;

function previewRuntimeLog(message: string) {
  void fs.appendFile(path.join(app.getPath("userData"), "preview-runtime.log"), `${new Date().toISOString()} ${message}\n`).catch(() => undefined);
}

function desktopPreviewBounds(window: BrowserWindow) {
  const [width, height] = window.getContentSize();
  return desktopPreviewFullscreen
    ? { x: 0, y: 0, width: Math.max(1, width), height: Math.max(1, height) }
    : { x: 280, y: 60, width: Math.max(1, width - 280), height: Math.max(1, height - 60) };
}

function positionDesktopPreview(window: BrowserWindow) {
  if (!desktopPreviewView) return;
  desktopPreviewView.setBounds(desktopPreviewBounds(window));
  if (!desktopPreviewLoaded) return;
  desktopPreviewView.setVisible(true);
  previewRuntimeLog(`bounds=${JSON.stringify(desktopPreviewView.getBounds())} visible=${desktopPreviewView.getVisible()} fullscreen=${desktopPreviewFullscreen}`);
}

function settleDesktopPreviewBounds(window: BrowserWindow, fullscreen: boolean) {
  for (const delay of [0, 80, 220, 520]) {
    setTimeout(() => {
      if (!window.isDestroyed() && desktopPreviewFullscreen === fullscreen) positionDesktopPreview(window);
    }, delay);
  }
}

function publishDesktopPreviewFullscreenState(fullscreen: boolean) {
  desktopPreviewView?.webContents.send("desktop-preview:fullscreen-changed", fullscreen);
}

function publishDesktopPreviewProjectChanged() {
  desktopPreviewView?.webContents.send("desktop-preview:project-changed");
}

async function setHostedPreviewNavigationState(active: boolean) {
  const window = activeHostedWindow();
  const script = `(() => {
    const labels = new Set(["Home", "Projects", "AI Providers", "Timeline", "Preview", "Settings"]);
    const candidates = [...document.querySelectorAll("a,button,[role=link],[role=button]")];
    for (const element of candidates) {
      const label = (element.textContent || "").replace(/\\s+/g, " ").trim();
      if (!labels.has(label)) continue;
      const item = element.closest("a,button,[role=link],[role=button]") || element;
      if (${active ? "true" : "false"}) {
        item.dataset.visualsyncDesktopPreviewItem = label === "Preview" ? "active" : "inactive";
      } else {
        delete item.dataset.visualsyncDesktopPreviewItem;
      }
    }
    const itemFor = label => candidates.map(element => ({ element, text: (element.textContent || "").replace(/\\s+/g, " ").trim() })).find(candidate => candidate.text === label)?.element.closest("li");
    const preview = itemFor("Preview");
    const providers = itemFor("AI Providers");
    const settings = itemFor("Settings");
    if (preview?.parentElement && preview.parentElement === providers?.parentElement && providers?.parentElement === settings?.parentElement) {
      preview.parentElement.insertBefore(providers, settings);
    }
  })()`;
  try {
    await window.webContents.insertCSS(`
      [data-visualsync-desktop-preview-item="active"] {
        background: linear-gradient(135deg, rgba(28, 100, 119, .45), rgba(11, 42, 55, .72)) !important;
        border-color: rgba(126, 235, 245, .26) !important;
        box-shadow: inset 0 0 0 1px rgba(126, 235, 245, .07), 0 8px 22px rgba(0, 0, 0, .16) !important;
        color: #efffff !important;
      }
      [data-visualsync-desktop-preview-item="inactive"] {
        background: transparent !important;
        border-color: transparent !important;
        box-shadow: none !important;
      }
    `);
    await window.webContents.executeJavaScript(script, true);
  } catch (error) {
    previewRuntimeLog(`preview navigation state failed=${String(error)}`);
  }
}

function restoreTimelineProjectIfNeeded(window: BrowserWindow, url: string) {
  const navigatedUrl = new URL(url);
  if (navigatedUrl.pathname !== "/timeline" || !desktopPreviewProjectId || navigatedUrl.searchParams.get("project") === String(desktopPreviewProjectId)) return false;
  const selectedTimelineUrl = new URL(`/timeline?project=${desktopPreviewProjectId}`, APP_URL).toString();
  previewRuntimeLog(`restoring timeline project=${desktopPreviewProjectId}`);
  void window.loadURL(selectedTimelineUrl);
  closeDesktopPreview();
  return true;
}

async function resolveTimelineProjectSelection(window: BrowserWindow) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const projectId = await window.webContents.executeJavaScript(`(() => {
        const select = Array.from(document.querySelectorAll("select")).find(element => Array.from(element.options).some(option => option.textContent?.trim() === "Select project"));
        const value = Number(select?.value);
        return Number.isInteger(value) && value > 0 ? value : null;
      })()`, true) as number | null;
      if (projectId) {
        desktopPreviewProjectId = projectId;
        publishDesktopPreviewProjectChanged();
        previewRuntimeLog(`timeline project resolved=${projectId}`);
        return projectId;
      }
    } catch (error) {
      previewRuntimeLog(`timeline project resolve failed=${String(error)}`);
      return null;
    }
    await new Promise(resolve => setTimeout(resolve, 180));
  }
  previewRuntimeLog("timeline project resolve unavailable");
  return null;
}

async function loadPathStore(): Promise<LocalPathStore> {
  try {
    return JSON.parse(await fs.readFile(SETTINGS_FILE(), "utf8")) as LocalPathStore;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function savePathStore(store: LocalPathStore) {
  await fs.mkdir(path.dirname(SETTINGS_FILE()), { recursive: true });
  await fs.writeFile(SETTINGS_FILE(), JSON.stringify(store, null, 2), "utf8");
}

async function requireConfiguredOutputDirectory(outputDirectory: string) {
  const requestedDirectory = path.resolve(outputDirectory);
  const savedDirectories = Object.values(await loadPathStore())
    .map(paths => paths.outputDirectory)
    .filter((directory): directory is string => Boolean(directory))
    .map(directory => path.resolve(directory));
  if (!savedDirectories.includes(requestedDirectory)) throw new Error("Save this local workspace before browsing its output folder.");
  const stats = await fs.stat(requestedDirectory).catch(() => null);
  if (!stats?.isDirectory()) throw new Error("The saved output folder is unavailable.");
  return requestedDirectory;
}

async function requireExistingOutputDirectory(outputDirectory: string) {
  const requestedDirectory = path.resolve(outputDirectory);
  const stats = await fs.stat(requestedDirectory).catch(() => null);
  if (!stats?.isDirectory()) throw new Error("The output folder is unavailable.");
  return requestedDirectory;
}

async function resolveLocalFfmpegPath(configuredPath?: string) {
  const configured = configuredPath?.trim();
  if (configured) {
    const stats = await fs.stat(configured).catch(() => null);
    if (stats?.isFile()) return path.resolve(configured);
  }
  const environmentPath = Object.entries(process.env).find(([key]) => key.toUpperCase() === "PATH")?.[1] ?? "";
  for (const directory of environmentPath.split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, "ffmpeg.exe");
    const stats = await fs.stat(candidate).catch(() => null);
    if (stats?.isFile()) return candidate;
  }
  throw new Error("FFmpeg was not found. Install FFmpeg or select its executable once in the local workspace.");
}

async function listOutputVideos(outputDirectory: string): Promise<LocalOutputVideo[]> {
  const safeOutputDirectory = await requireExistingOutputDirectory(outputDirectory);
  const entries = await fs.readdir(safeOutputDirectory, { withFileTypes: true });
  const files = await Promise.all(entries
    .filter(entry => entry.isFile() && path.extname(entry.name).toLowerCase() === ".mp4")
    .map(async entry => {
      const filePath = path.join(safeOutputDirectory, entry.name);
      const stats = await fs.stat(filePath);
      return { name: entry.name, path: filePath, fileUrl: pathToFileURL(filePath).toString(), byteSize: stats.size, modifiedAt: stats.mtime.toISOString(), modifiedMs: stats.mtimeMs };
    }));
  return files.sort((left, right) => right.modifiedMs - left.modifiedMs).map(({ modifiedMs: _modifiedMs, ...video }) => video);
}

async function listConfiguredOutputVideos(outputDirectory: string): Promise<LocalOutputVideo[]> {
  return listOutputVideos(await requireConfiguredOutputDirectory(outputDirectory));
}

async function requireConfiguredOutputVideo(videoPath: string) {
  const resolvedVideoPath = path.resolve(videoPath);
  if (path.extname(resolvedVideoPath).toLowerCase() !== ".mp4") throw new Error("Choose a valid rendered MP4 from the saved output folder.");
  const safeOutputDirectory = await requireConfiguredOutputDirectory(path.dirname(resolvedVideoPath));
  if (path.dirname(resolvedVideoPath) !== safeOutputDirectory) throw new Error("The selected video must be inside the saved output folder.");
  const stats = await fs.stat(resolvedVideoPath).catch(() => null);
  if (!stats?.isFile()) throw new Error("The selected rendered MP4 is unavailable.");
  return resolvedVideoPath;
}

function safeOutputFilename(projectName: string) {
  return `${projectName.replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "") || "project"}-approved-render-handoff.json`;
}

function focusedWindow() {
  const window = BrowserWindow.getFocusedWindow();
  if (!window) throw new Error("No VisualSync desktop window is open.");
  return window;
}

function activeHostedWindow() {
  if (!hostedWindow || hostedWindow.isDestroyed()) throw new Error("The hosted VisualSync window is unavailable.");
  return hostedWindow;
}

function emitRenderEvent(event: LocalRenderEvent) {
  BrowserWindow.getAllWindows().forEach(window => window.webContents.send("local-render:event", event));
}

async function renderPreparationFrameTarget(handoffPath: string) {
  try {
    const parsed = JSON.parse(await fs.readFile(handoffPath, "utf8")) as { timeline?: Array<{ endMs?: unknown }>; output?: { frameRate?: unknown } };
    const endMs = Number(parsed.timeline?.at(-1)?.endMs);
    const frameRate = Number(parsed.output?.frameRate) || 30;
    return Number.isFinite(endMs) && endMs > 0 ? Math.ceil((endMs / 1000) * frameRate) : 0;
  } catch {
    return 0;
  }
}

async function countGeneratedRenderFrames(outputDirectory: string) {
  const countIn = async (directory: string): Promise<number> => {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    const counts = await Promise.all(entries.map(async entry => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return entry.name.startsWith(".visualsync-") ? countIn(entryPath) : 0;
      return /^frame_\d+\.jpg$/i.test(entry.name) ? 1 : 0;
    }));
    return counts.reduce((sum, value) => sum + value, 0);
  };
  return countIn(outputDirectory);
}

async function stopDesktopRenderProcess(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null) return false;
  desktopRenderCancellationRequested = true;
  await new Promise<void>(resolve => {
    const taskkill = spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true });
    taskkill.once("exit", () => resolve());
    taskkill.once("error", () => { child.kill(); resolve(); });
  });
  return true;
}

function requireWindowsExecutable(filePath: string, expectedExtension: string, label: string) {
  if (process.platform !== "win32") throw new Error(`${label} is available only in the Windows desktop app.`);
  if (path.extname(filePath).toLowerCase() !== expectedExtension) throw new Error(`Choose a valid ${label} (${expectedExtension}).`);
}

async function hostedTrpcQuery<T>(procedure: string, input?: unknown): Promise<T> {
  const url = new URL(`/api/trpc/${procedure}`, APP_URL);
  url.searchParams.set("batch", "1");
  url.searchParams.set("input", JSON.stringify({ 0: { json: input ?? null } }));
  const response = await activeHostedWindow().webContents.session.fetch(url.toString(), { headers: { accept: "application/json" } });
  const [payload] = await response.json() as Array<{ result?: { data?: { json?: T } }; error?: { json?: { message?: string } } }>;
  if (!response.ok || !payload.result?.data) throw new Error(payload.error?.json?.message || `Hosted request failed (${response.status}).`);
  return payload.result.data.json as T;
}

async function approvedPreviewProjects(): Promise<DesktopPreviewProject[]> {
  const projects = await hostedTrpcQuery<HostedProject[]>("project.list");
  const candidates = projects.filter(project => project.status === "timeline_ready" || project.status === "completed");
  const settled = await Promise.allSettled(candidates.map(async project => {
    const handoff = await hostedTrpcQuery<ApprovedRenderHandoff>("worker.renderHandoff", { projectId: project.id });
    return { id: handoff.projectId, name: handoff.projectName };
  }));
  const approved = settled.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
  if (!approved.length) throw new Error("Approve a Timeline in the hosted app before using desktop Render.");
  return approved;
}

async function latestApprovedHandoff(projectId: number | null = desktopPreviewProjectId): Promise<ApprovedRenderHandoff> {
  if (projectId) return hostedTrpcQuery<ApprovedRenderHandoff>("worker.renderHandoff", { projectId });
  const projects = await hostedTrpcQuery<HostedProject[]>("project.list");
  const candidates = projects.filter(project => project.status === "timeline_ready" || project.status === "completed");
  if (!candidates.length) throw new Error("Approve a Timeline in the hosted app before using desktop Render.");
  let lastError: Error | null = null;
  for (const project of candidates) {
    try { return await hostedTrpcQuery<ApprovedRenderHandoff>("worker.renderHandoff", { projectId: project.id }); }
    catch (error) { lastError = error instanceof Error ? error : new Error("Approved Timeline handoff is unavailable."); }
  }
  throw lastError ?? new Error("No approved Timeline handoff is available.");
}

async function selectDesktopPreviewProject(projectId: number) {
  const approved = await approvedPreviewProjects();
  if (!approved.some(project => project.id === projectId)) throw new Error("That project does not have an approved Timeline for Preview yet.");
  desktopPreviewProjectId = projectId;
  publishDesktopPreviewProjectChanged();
  previewRuntimeLog(`preview project selected=${projectId}`);
  return desktopPreviewState();
}

async function savedLocalPathsForHandoff(handoff: ApprovedRenderHandoff): Promise<LocalProjectPaths | null> {
  const store = await loadPathStore();
  const saved = Object.values(store);
  const samePath = (left: string | undefined | null, right: string | undefined | null) => Boolean(left && right && path.resolve(left) === path.resolve(right));
  const paths = store[String(handoff.projectId)]
    ?? saved.find(item => samePath(item.sourceDirectory, handoff.nativePaths.sourceDirectory) || samePath(item.outputDirectory, handoff.nativePaths.outputDirectory))
    ?? (saved.length === 1 ? saved[0] : undefined)
    ?? (handoff.nativePaths.sourceDirectory && handoff.nativePaths.outputDirectory
      ? { sourceDirectory: handoff.nativePaths.sourceDirectory, outputDirectory: handoff.nativePaths.outputDirectory, narrationPath: "", updatedAt: new Date(0).toISOString() }
      : undefined);
  return paths?.sourceDirectory && paths.outputDirectory ? paths : null;
}

async function usableLocalPathsForHandoff(handoff: ApprovedRenderHandoff): Promise<LocalProjectPaths | null> {
  const paths = await savedLocalPathsForHandoff(handoff);
  if (!paths) return null;
  const [sourceStats, outputStats] = await Promise.all([
    fs.stat(paths.sourceDirectory).catch(() => null),
    fs.stat(paths.outputDirectory).catch(() => null),
  ]);
  return sourceStats?.isDirectory() && outputStats?.isDirectory() ? paths : null;
}

async function choosePreviewFolders(handoff: ApprovedRenderHandoff): Promise<LocalProjectPaths> {
  const owner = activeHostedWindow();
  const source = await dialog.showOpenDialog(owner, { title: "Choose this project's image and narration folder", properties: ["openDirectory"] });
  if (source.canceled || !source.filePaths[0]) throw new Error("Render was not started because a source folder was not selected.");
  const output = await dialog.showOpenDialog(owner, { title: "Choose this project's output folder", properties: ["openDirectory", "createDirectory"] });
  if (output.canceled || !output.filePaths[0]) throw new Error("Render was not started because an output folder was not selected.");
  const store = await loadPathStore();
  const saved: LocalProjectPaths = { sourceDirectory: source.filePaths[0], outputDirectory: output.filePaths[0], narrationPath: "", updatedAt: new Date().toISOString() };
  store[String(handoff.projectId)] = saved;
  await savePathStore(store);
  return saved;
}

async function localPathsForRender(handoff: ApprovedRenderHandoff): Promise<LocalProjectPaths> {
  return (await usableLocalPathsForHandoff(handoff)) ?? choosePreviewFolders(handoff);
}

async function writeAtomically(destinationPath: string, content: string | Uint8Array) {
  const temporaryPath = `${destinationPath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, content);
  await fs.rm(destinationPath, { force: true });
  await fs.rename(temporaryPath, destinationPath);
}

async function prepareRenderFiles(handoff: ApprovedRenderHandoff, paths: LocalProjectPaths) {
  const outputDirectory = await requireExistingOutputDirectory(paths.outputDirectory);
  const workerResponse = await activeHostedWindow().webContents.session.fetch(new URL("/api/project-media/latest-worker", APP_URL).toString());
  if (!workerResponse.ok) throw new Error(`The latest approved worker could not be refreshed (${workerResponse.status}).`);
  const workerPath = path.join(outputDirectory, "render-approved-handoff.ps1");
  const handoffPath = path.join(outputDirectory, safeOutputFilename(handoff.projectName));
  await Promise.all([
    writeAtomically(workerPath, new Uint8Array(await workerResponse.arrayBuffer())),
    writeAtomically(handoffPath, `${JSON.stringify(handoff, null, 2)}\n`),
  ]);
  return { workerPath, handoffPath, sourceDirectory: paths.sourceDirectory, outputDirectory, ffmpegPath: paths.ffmpegPath };
}

async function desktopPreviewState(): Promise<DesktopPreviewState> {
  try {
    const handoff = await latestApprovedHandoff();
    const paths = await usableLocalPathsForHandoff(handoff);
    if (!paths) return { projectId: handoff.projectId, projectName: handoff.projectName, video: null, canRender: true, message: "No final video is linked on this computer yet. Render will ask once for this project's folders and remember them." };
    const [video] = await listOutputVideos(paths.outputDirectory);
    return { projectId: handoff.projectId, projectName: handoff.projectName, video: video ?? null, canRender: true, message: video ? "" : "Final video will appear here after Render completes." };
  } catch (error) {
    return { projectId: null, projectName: null, video: null, canRender: false, message: error instanceof Error ? error.message : "Preview is unavailable." };
  }
}

async function runApprovedLocalRender(request: LocalRenderRequest) {
  requireWindowsExecutable(request.workerPath, ".ps1", "VisualSync worker");
  requireWindowsExecutable(request.handoffPath, ".json", "approved handoff");
  if (!request.sourceDirectory || !request.outputDirectory) throw new Error("Choose the saved source and output folders before rendering.");
  const ffmpegPath = await resolveLocalFfmpegPath(request.ffmpegPath);
  const argumentsList = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", request.workerPath, "-HandoffPath", request.handoffPath, "-SourceDirectory", request.sourceDirectory, "-OutputDirectory", request.outputDirectory, "-FFmpegPath", ffmpegPath];
  emitRenderEvent({ type: "started", command: `powershell.exe ${argumentsList.map(value => JSON.stringify(value)).join(" ")}` });
  await new Promise<void>((resolve, reject) => {
    const child = spawn("powershell.exe", argumentsList, { windowsHide: true });
    activeDesktopRender = child;
    desktopRenderCancellationRequested = false;
    let frameProgressTimer: ReturnType<typeof setInterval> | null = null;
    void renderPreparationFrameTarget(request.handoffPath).then(expectedFrames => {
      if (!expectedFrames || child.exitCode !== null) return;
      const reportProgress = () => {
        void countGeneratedRenderFrames(request.outputDirectory).then(generatedFrames => {
          if (child.exitCode === null) emitRenderEvent({ type: "preparing", generatedFrames, expectedFrames });
        });
      };
      reportProgress();
      frameProgressTimer = setInterval(reportProgress, 2000);
    });
    child.stdout.on("data", chunk => emitRenderEvent({ type: "output", line: String(chunk) }));
    child.stderr.on("data", chunk => emitRenderEvent({ type: "output", line: String(chunk) }));
    child.once("error", error => {
      if (frameProgressTimer) clearInterval(frameProgressTimer);
      if (activeDesktopRender === child) activeDesktopRender = null;
      emitRenderEvent({ type: "failed", message: error.message });
      reject(error);
    });
    child.once("exit", exitCode => {
      if (frameProgressTimer) clearInterval(frameProgressTimer);
      if (activeDesktopRender === child) activeDesktopRender = null;
      if (exitCode === 0) { emitRenderEvent({ type: "completed", exitCode }); resolve(); }
      else if (desktopRenderCancellationRequested) { const message = "Local render was cancelled."; emitRenderEvent({ type: "cancelled", message }); reject(new Error(message)); }
      else { const message = `Local render exited with code ${exitCode ?? "unknown"}.`; emitRenderEvent({ type: "failed", message }); reject(new Error(message)); }
    });
  });
}

function setDesktopPreviewFullscreen(fullscreen: boolean) {
  const window = activeHostedWindow();
  if (!desktopPreviewView) throw new Error("Open Preview before using fullscreen.");
  desktopPreviewFullscreen = fullscreen;
  window.setKiosk(fullscreen);
  positionDesktopPreview(window);
  settleDesktopPreviewBounds(window, fullscreen);
  publishDesktopPreviewFullscreenState(fullscreen);
  previewRuntimeLog(`preview native fullscreen=${fullscreen}`);
  return fullscreen;
}

function registerLocalHandlers() {
  ipcMain.handle("local-paths:choose-source-directory", async () => {
    const result = await dialog.showOpenDialog(focusedWindow(), { properties: ["openDirectory", "createDirectory"] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle("local-paths:choose-output-directory", async () => {
    const result = await dialog.showOpenDialog(focusedWindow(), { properties: ["openDirectory", "createDirectory"] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle("local-paths:choose-narration", async () => {
    const result = await dialog.showOpenDialog(focusedWindow(), { properties: ["openFile", "dontAddToRecent"], filters: [{ name: "Narration", extensions: ["mp3", "wav", "m4a", "aac", "ogg"] }] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle("local-render:choose-handoff", async () => {
    const result = await dialog.showOpenDialog(focusedWindow(), { properties: ["openFile", "dontAddToRecent"], filters: [{ name: "Approved render handoff", extensions: ["json"] }] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle("local-render:choose-worker", async () => {
    const result = await dialog.showOpenDialog(focusedWindow(), { properties: ["openFile", "dontAddToRecent"], filters: [{ name: "VisualSync worker", extensions: ["ps1"] }] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle("local-render:choose-ffmpeg", async () => {
    const result = await dialog.showOpenDialog(focusedWindow(), { properties: ["openFile", "dontAddToRecent"], filters: [{ name: "FFmpeg", extensions: ["exe"] }] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle("hosted-navigation:open", async (_event, route: "/" | "/projects" | "/timeline" | "/preview") => {
    const allowedRoutes = new Set(["/", "/projects", "/timeline", "/preview"]);
    if (!allowedRoutes.has(route)) throw new Error("Unsupported hosted VisualSync route.");
    if (route === "/preview") return openDesktopPreview(null);
    const window = activeHostedWindow();
    await window.loadURL(new URL(route, APP_URL).toString());
    window.show();
    window.focus();
  });
  ipcMain.handle("local-paths:get", async (_event, projectId: string) => (await loadPathStore())[projectId] ?? null);
  ipcMain.handle("local-paths:save", async (_event, projectId: string, paths: Omit<LocalProjectPaths, "updatedAt">) => {
    if (!projectId.trim()) throw new Error("A project id is required to save local paths.");
    const store = await loadPathStore();
    const next: LocalProjectPaths = { ...paths, updatedAt: new Date().toISOString() };
    store[projectId] = next;
    await savePathStore(store);
    return next;
  });
  ipcMain.handle("local-preview:list-output-videos", async (_event, outputDirectory: string) => listConfiguredOutputVideos(outputDirectory));
  ipcMain.handle("local-preview:open-output-directory", async (_event, outputDirectory: string) => {
    const error = await shell.openPath(await requireConfiguredOutputDirectory(outputDirectory));
    if (error) throw new Error(error);
  });
  ipcMain.handle("local-preview:open-output-video", async (_event, videoPath: string) => {
    const error = await shell.openPath(await requireConfiguredOutputVideo(videoPath));
    if (error) throw new Error(error);
  });
  ipcMain.handle("desktop-preview:open", (_event, projectId: unknown) => {
    desktopPreviewProjectId = typeof projectId === "number" && Number.isInteger(projectId) && projectId > 0 ? projectId : null;
    publishDesktopPreviewProjectChanged();
    previewRuntimeLog(`preview requested project=${desktopPreviewProjectId ?? "latest"}`);
    return openDesktopPreview();
  });
  ipcMain.on("desktop-preview:timeline-selection", (_event, projectId: unknown) => {
    if (typeof projectId !== "number" || !Number.isInteger(projectId) || projectId <= 0) return;
    desktopPreviewProjectId = projectId;
    publishDesktopPreviewProjectChanged();
    previewRuntimeLog(`timeline project persisted=${projectId}`);
  });
  ipcMain.handle("desktop-preview:close", () => closeDesktopPreview());
  ipcMain.handle("desktop-preview:get", () => desktopPreviewState());
  ipcMain.handle("desktop-preview:list-projects", () => approvedPreviewProjects());
  ipcMain.handle("desktop-preview:select-project", (_event, projectId: unknown) => {
    if (typeof projectId !== "number" || !Number.isInteger(projectId) || projectId <= 0) throw new Error("Choose a valid approved project.");
    return selectDesktopPreviewProject(projectId);
  });
  ipcMain.handle("desktop-preview:set-fullscreen", (_event, fullscreen: unknown) => {
    if (typeof fullscreen !== "boolean") throw new Error("Fullscreen state must be true or false.");
    return setDesktopPreviewFullscreen(fullscreen);
  });
  ipcMain.handle("desktop-preview:toggle-fullscreen", () => setDesktopPreviewFullscreen(!desktopPreviewFullscreen));
  ipcMain.handle("desktop-preview:render", async () => {
    if (desktopPreviewRenderInProgress) throw new Error("A local render is already running.");
    desktopPreviewRenderInProgress = true;
    try {
      const handoff = await latestApprovedHandoff();
      const paths = await localPathsForRender(handoff);
      await runApprovedLocalRender(await prepareRenderFiles(handoff, paths));
    } finally { desktopPreviewRenderInProgress = false; }
  });
  ipcMain.handle("desktop-preview:cancel-render", async () => {
    if (!activeDesktopRender) return false;
    return stopDesktopRenderProcess(activeDesktopRender);
  });
  ipcMain.handle("local-render:run", async (_event, request: LocalRenderRequest) => runApprovedLocalRender(request));
}

function openLocalWorkspace() {
  if (localWorkspaceWindow && !localWorkspaceWindow.isDestroyed()) { localWorkspaceWindow.show(); localWorkspaceWindow.focus(); return; }
  localWorkspaceWindow = new BrowserWindow({
    width: 780, height: 760, minWidth: 680, minHeight: 620, title: "VisualSync Desktop · Local workspace", backgroundColor: "#08111f", autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, partition: SESSION_PARTITION },
  });
  localWorkspaceWindow.on("closed", () => { localWorkspaceWindow = null; });
  void localWorkspaceWindow.loadFile(path.join(__dirname, "local-workspace.html"));
}

function ensureDesktopPreviewView(window: BrowserWindow) {
  if (desktopPreviewView) return;
  desktopPreviewView = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: false, partition: SESSION_PARTITION },
  });
  desktopPreviewLoaded = false;
  desktopPreviewView.setVisible(false);
  previewRuntimeLog(`view created id=${desktopPreviewView.webContents.id}`);
  desktopPreviewView.webContents.on("console-message", (_event, level, message, line, sourceId) => previewRuntimeLog(`console:${level} ${sourceId}:${line} ${message}`));
  desktopPreviewView.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    previewRuntimeLog(`load:${errorCode} ${errorDescription} ${validatedURL}`);
  });
  desktopPreviewLoadPromise = new Promise(resolve => {
    desktopPreviewView?.webContents.once("did-finish-load", () => {
      desktopPreviewLoaded = true;
      previewRuntimeLog(`view loaded url=${desktopPreviewView?.webContents.getURL() ?? "closed"}`);
      resolve();
    });
  });
  window.contentView.addChildView(desktopPreviewView);
  previewRuntimeLog(`view attached window=${window.id}`);
  void desktopPreviewView.webContents.loadFile(path.join(__dirname, "desktop-preview.html")).catch(error => previewRuntimeLog(`load exception=${String(error)}`));
}

function openDesktopPreview(projectId?: number | null) {
  if (projectId !== undefined) desktopPreviewProjectId = projectId;
  desktopPreviewOpen = true;
  const window = activeHostedWindow();
  previewRuntimeLog(`open requested existing=${Boolean(desktopPreviewView)} window=${window.id}`);
  ensureDesktopPreviewView(window);
  void desktopPreviewLoadPromise?.then(() => positionDesktopPreview(window));
  setTimeout(() => { void setHostedPreviewNavigationState(true); }, 120);
  window.show();
  window.focus();
}

function closeDesktopPreview() {
  desktopPreviewOpen = false;
  if (!desktopPreviewView) return;
  previewRuntimeLog(`close requested view=${desktopPreviewView.webContents.id}`);
  const window = activeHostedWindow();
  if (desktopPreviewFullscreen) window.setKiosk(false);
  desktopPreviewFullscreen = false;
  pendingDesktopPreviewOpen = false;
  desktopPreviewRouteRestored = false;
  void setHostedPreviewNavigationState(false);
  window.contentView.removeChildView(desktopPreviewView);
  desktopPreviewView.webContents.close();
  desktopPreviewView = null;
  desktopPreviewLoaded = false;
  desktopPreviewLoadPromise = null;
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1080, minHeight: 720, backgroundColor: "#08111f",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, partition: SESSION_PARTITION },
  });
  hostedWindow = window;
  window.on("closed", () => { desktopPreviewView = null; desktopPreviewLoaded = false; desktopPreviewLoadPromise = null; desktopPreviewOpen = false; if (hostedWindow === window) hostedWindow = null; });
  window.on("resize", () => {
    positionDesktopPreview(window);
  });
  window.on("restore", () => {
    settleDesktopPreviewBounds(window, desktopPreviewFullscreen);
  });
  window.on("enter-full-screen", () => {
    if (!desktopPreviewView) return;
    desktopPreviewFullscreen = true;
    positionDesktopPreview(window);
    settleDesktopPreviewBounds(window, true);
    publishDesktopPreviewFullscreenState(true);
    previewRuntimeLog("preview entered native fullscreen");
  });
  window.on("leave-full-screen", () => {
    if (!desktopPreviewView) return;
    desktopPreviewFullscreen = false;
    positionDesktopPreview(window);
    settleDesktopPreviewBounds(window, false);
    publishDesktopPreviewFullscreenState(false);
    previewRuntimeLog("preview left native fullscreen");
  });
  window.on("enter-html-full-screen", () => {
    if (!desktopPreviewView || desktopPreviewFullscreen) return;
    setDesktopPreviewFullscreen(true);
    previewRuntimeLog("preview HTML fullscreen forwarded to native fullscreen");
  });
  window.on("leave-html-full-screen", () => {
    if (!desktopPreviewView) return;
    previewRuntimeLog("preview HTML fullscreen ended; native state retained until native exit");
  });
  const openHostedSignIn = (loginUrl: string) => {
    const authWindow = new BrowserWindow({ width: 520, height: 720, parent: window, modal: true, autoHideMenuBar: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, partition: SESSION_PARTITION } });
    const finishLogin = (url: string) => {
      if (!isHostedVisualSyncCallback(url, APP_URL)) return;
      authWindow.webContents.once("did-finish-load", () => { void window.loadURL(APP_URL); if (!authWindow.isDestroyed()) authWindow.close(); });
    };
    authWindow.webContents.on("will-redirect", (_event, url) => finishLogin(url));
    authWindow.webContents.on("will-navigate", (_event, url) => finishLogin(url));
    void authWindow.loadURL(loginUrl);
  };
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isHostedVisualSyncUrl(url, APP_URL)) {
      if (new URL(url).pathname === "/preview") openDesktopPreview();
      else void window.loadURL(url);
    } else void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (isHostedVisualSyncUrl(url, APP_URL) && new URL(url).pathname === "/preview") { event.preventDefault(); openDesktopPreview(); return; }
    if (!isHostedVisualSyncUrl(url, APP_URL)) { event.preventDefault(); openHostedSignIn(url); }
  });
  window.webContents.on("before-input-event", (_event, input) => {
    if (input.type !== "mouseDown" || new URL(window.webContents.getURL()).pathname !== "/timeline") return;
    void resolveTimelineProjectSelection(window);
  });
  window.webContents.on("did-navigate-in-page", (_event, url) => {
    if (isHostedVisualSyncUrl(url, APP_URL) && new URL(url).pathname === "/preview") {
      openDesktopPreview();
      if (window.webContents.canGoBack()) {
        restoringHostedRouteAfterPreview = true;
        window.webContents.goBack();
      } else {
        void window.loadURL(APP_URL);
      }
      return;
    }
    if (restoringHostedRouteAfterPreview) {
      restoringHostedRouteAfterPreview = false;
      previewRuntimeLog(`retained preview after route restore=${url}`);
      return;
    }
    previewRuntimeLog(`host in-page route=${url}`);
    closeDesktopPreview();
  });
  window.webContents.on("did-finish-load", () => {
    ensureDesktopPreviewView(window);
    void setHostedPreviewNavigationState(desktopPreviewOpen);
  });
  void window.loadURL(APP_URL);
  window.webContents.once("did-finish-load", () => {
    ensureDesktopPreviewView(window);
    if (process.env.VISUALSYNC_AUTO_PREVIEW === "1" || process.argv.includes("--visualsync-auto-preview")) setTimeout(() => openDesktopPreview(null), 350);
  });
}

app.whenReady().then(() => {
  session.fromPartition(SESSION_PARTITION).setPermissionRequestHandler((_webContents, permission, callback) => callback(permission === "notifications"));
  registerLocalHandlers();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "VisualSync", submenu: [{ label: "Local workspace", accelerator: "Ctrl+Shift+L", click: () => openLocalWorkspace() }, { type: "separator" }, { label: "Quit", role: "quit" }] },
    { label: "Hosted workflow", submenu: [
      { label: "Projects", click: () => void activeHostedWindow().loadURL(new URL("/projects", APP_URL).toString()) },
      { label: "Timeline", click: () => void activeHostedWindow().loadURL(new URL("/timeline", APP_URL).toString()) },
      { label: "Preview", click: () => openDesktopPreview(null) },
    ] },
  ]));
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
