import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } from "electron";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { DesktopPreviewState, LocalOutputVideo, LocalProjectPaths, LocalRenderEvent, LocalRenderRequest } from "./contracts.js";
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
let desktopPreviewWindow: BrowserWindow | null = null;
let desktopPreviewRenderInProgress = false;

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

async function latestApprovedHandoff(): Promise<ApprovedRenderHandoff> {
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

async function choosePreviewFolders(handoff: ApprovedRenderHandoff): Promise<LocalProjectPaths> {
  const owner = desktopPreviewWindow && !desktopPreviewWindow.isDestroyed() ? desktopPreviewWindow : activeHostedWindow();
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
  return (await savedLocalPathsForHandoff(handoff)) ?? choosePreviewFolders(handoff);
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
    const paths = await savedLocalPathsForHandoff(handoff);
    if (!paths) return { projectId: handoff.projectId, video: null, canRender: true, message: "Click Render once to choose this project's folders. They will be remembered automatically." };
    const [video] = await listOutputVideos(paths.outputDirectory);
    return { projectId: handoff.projectId, video: video ?? null, canRender: true, message: video ? "" : "Final output will appear here after Render completes." };
  } catch (error) {
    return { projectId: null, video: null, canRender: false, message: error instanceof Error ? error.message : "Preview is unavailable." };
  }
}

async function runApprovedLocalRender(request: LocalRenderRequest) {
  requireWindowsExecutable(request.workerPath, ".ps1", "VisualSync worker");
  requireWindowsExecutable(request.handoffPath, ".json", "approved handoff");
  if (!request.sourceDirectory || !request.outputDirectory) throw new Error("Choose the saved source and output folders before rendering.");
  const argumentsList = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", request.workerPath, "-HandoffPath", request.handoffPath, "-SourceDirectory", request.sourceDirectory, "-OutputDirectory", request.outputDirectory];
  if (request.ffmpegPath?.trim()) argumentsList.push("-FFmpegPath", request.ffmpegPath.trim());
  emitRenderEvent({ type: "started", command: `powershell.exe ${argumentsList.map(value => JSON.stringify(value)).join(" ")}` });
  await new Promise<void>((resolve, reject) => {
    const child = spawn("powershell.exe", argumentsList, { windowsHide: true });
    child.stdout.on("data", chunk => emitRenderEvent({ type: "output", line: String(chunk) }));
    child.stderr.on("data", chunk => emitRenderEvent({ type: "output", line: String(chunk) }));
    child.once("error", error => { emitRenderEvent({ type: "failed", message: error.message }); reject(error); });
    child.once("exit", exitCode => {
      if (exitCode === 0) { emitRenderEvent({ type: "completed", exitCode }); resolve(); }
      else { const message = `Local render exited with code ${exitCode ?? "unknown"}.`; emitRenderEvent({ type: "failed", message }); reject(new Error(message)); }
    });
  });
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
    if (route === "/preview") return openDesktopPreview();
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
  ipcMain.handle("desktop-preview:open", () => openDesktopPreview());
  ipcMain.handle("desktop-preview:get", () => desktopPreviewState());
  ipcMain.handle("desktop-preview:render", async () => {
    if (desktopPreviewRenderInProgress) throw new Error("A local render is already running.");
    desktopPreviewRenderInProgress = true;
    try {
      const handoff = await latestApprovedHandoff();
      const paths = await localPathsForRender(handoff);
      await runApprovedLocalRender(await prepareRenderFiles(handoff, paths));
    } finally { desktopPreviewRenderInProgress = false; }
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

function openDesktopPreview() {
  if (desktopPreviewWindow && !desktopPreviewWindow.isDestroyed()) { desktopPreviewWindow.show(); desktopPreviewWindow.focus(); return; }
  const parent = activeHostedWindow();
  desktopPreviewWindow = new BrowserWindow({
    width: 1040, height: 720, minWidth: 760, minHeight: 520, parent, title: "VisualSync Desktop · Preview", backgroundColor: "#030912", autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, partition: SESSION_PARTITION },
  });
  desktopPreviewWindow.on("closed", () => { desktopPreviewWindow = null; });
  void desktopPreviewWindow.loadFile(path.join(__dirname, "desktop-preview.html"));
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1080, minHeight: 720, backgroundColor: "#08111f",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, partition: SESSION_PARTITION },
  });
  hostedWindow = window;
  window.on("closed", () => { if (hostedWindow === window) hostedWindow = null; });
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
  window.webContents.on("did-navigate-in-page", (_event, url) => {
    if (isHostedVisualSyncUrl(url, APP_URL) && new URL(url).pathname === "/preview") {
      openDesktopPreview();
      if (window.webContents.canGoBack()) window.webContents.goBack();
      else void window.loadURL(APP_URL);
    }
  });
  void window.loadURL(APP_URL);
}

app.whenReady().then(() => {
  session.fromPartition(SESSION_PARTITION).setPermissionRequestHandler((_webContents, permission, callback) => callback(permission === "notifications"));
  registerLocalHandlers();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "VisualSync", submenu: [{ label: "Local workspace", accelerator: "Ctrl+Shift+L", click: () => openLocalWorkspace() }, { type: "separator" }, { label: "Quit", role: "quit" }] },
    { label: "Hosted workflow", submenu: [
      { label: "Projects", click: () => void activeHostedWindow().loadURL(new URL("/projects", APP_URL).toString()) },
      { label: "Timeline", click: () => void activeHostedWindow().loadURL(new URL("/timeline", APP_URL).toString()) },
      { label: "Preview", click: () => openDesktopPreview() },
    ] },
  ]));
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
