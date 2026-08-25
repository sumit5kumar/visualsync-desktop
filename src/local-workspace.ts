import type { LocalOutputVideo, LocalRenderEvent } from "./contracts.js";

type FieldId = "projectId" | "narrationPath" | "sourceDirectory" | "outputDirectory" | "handoffPath" | "workerPath" | "ffmpegPath";

const bridge = window.visualSyncDesktop;
if (!bridge) throw new Error("VisualSync Desktop bridge is unavailable.");
const desktop = bridge;

const fields = Object.fromEntries(([
  "projectId", "narrationPath", "sourceDirectory", "outputDirectory", "handoffPath", "workerPath", "ffmpegPath",
] as FieldId[]).map(id => [id, document.getElementById(id) as HTMLInputElement])) as Record<FieldId, HTMLInputElement>;
const status = document.getElementById("status") as HTMLDivElement;
const renderLog = document.getElementById("renderLog") as HTMLPreElement;
const renderButton = document.getElementById("render") as HTMLButtonElement;
const outputVideo = document.getElementById("outputVideo") as HTMLSelectElement;
const localPreview = document.getElementById("localPreview") as HTMLVideoElement;
const previewName = document.getElementById("previewName") as HTMLSpanElement;
const previewDetails = document.getElementById("previewDetails") as HTMLSpanElement;
const openOutputVideoButton = document.getElementById("openOutputVideo") as HTMLButtonElement;
let localVideos: LocalOutputVideo[] = [];
let renderInProgress = false;

function report(message: string) { status.textContent = message; }
function appendRenderLog(line: string) { renderLog.textContent = `${renderLog.textContent}\n${line}`.trim().slice(-10_000); renderLog.scrollTop = renderLog.scrollHeight; }
function projectReference() { return fields.projectId.value.trim(); }
function currentPaths() {
  return {
    narrationPath: fields.narrationPath.value,
    sourceDirectory: fields.sourceDirectory.value,
    outputDirectory: fields.outputDirectory.value,
    handoffPath: fields.handoffPath.value || undefined,
    workerPath: fields.workerPath.value || undefined,
    ffmpegPath: fields.ffmpegPath.value || undefined,
  };
}

async function loadWorkspace() {
  const projectId = projectReference();
  if (!projectId) return;
  const saved = await desktop.getLocalProjectPaths(projectId);
  if (!saved) return;
  (Object.keys(currentPaths()) as (keyof typeof saved)[]).forEach(key => {
    const field = fields[key as FieldId];
    if (field) field.value = saved[key] ?? "";
  });
  report(`Loaded local workspace saved ${new Date(saved.updatedAt).toLocaleString()}.`);
  await refreshLocalPreview(false);
}

function formatBytes(bytes: number) { return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${Math.max(0, bytes / 1024 ** 2).toFixed(1)} MB`; }

function selectedVideo() { return localVideos.find(video => video.path === outputVideo.value) ?? null; }

function showVideo(video: LocalOutputVideo | null) {
  if (!video) {
    localPreview.removeAttribute("src");
    localPreview.load();
    previewName.textContent = "No local MP4 selected";
    previewDetails.textContent = "Choose a saved output folder";
    openOutputVideoButton.disabled = true;
    return;
  }
  if (localPreview.src !== video.fileUrl) {
    localPreview.src = video.fileUrl;
    localPreview.load();
  }
  previewName.textContent = video.name;
  previewDetails.textContent = `${formatBytes(video.byteSize)} · ${new Date(video.modifiedAt).toLocaleString()}`;
  openOutputVideoButton.disabled = false;
}

function populateOutputVideos(videos: LocalOutputVideo[]) {
  const previousValue = outputVideo.value;
  localVideos = videos;
  outputVideo.replaceChildren();
  if (!videos.length) {
    const option = document.createElement("option");
    option.textContent = "No MP4 files found in this output folder.";
    outputVideo.append(option);
    outputVideo.disabled = true;
    showVideo(null);
    return;
  }
  videos.forEach(video => {
    const option = document.createElement("option");
    option.value = video.path;
    option.textContent = video.name;
    outputVideo.append(option);
  });
  outputVideo.disabled = false;
  outputVideo.value = videos.some(video => video.path === previousValue) ? previousValue : videos[0].path;
  showVideo(selectedVideo());
}

async function refreshLocalPreview(announce = true) {
  const outputDirectory = fields.outputDirectory.value;
  if (!outputDirectory) {
    populateOutputVideos([]);
    if (announce) report("Choose and save a local MP4 output folder first.");
    return;
  }
  try {
    const videos = await desktop.listOutputVideos(outputDirectory);
    populateOutputVideos(videos);
    if (announce) report(videos.length ? `Loaded ${videos.length} local MP4 ${videos.length === 1 ? "file" : "files"}.` : "No rendered MP4 files are in the saved output folder yet.");
  } catch (error) {
    populateOutputVideos([]);
    if (announce) report(error instanceof Error ? error.message : "Could not read the saved output folder.");
  }
}

document.querySelectorAll<HTMLButtonElement>("[data-picker]").forEach(button => {
  button.addEventListener("click", async () => {
    const fieldId = button.dataset.picker as FieldId;
    const pickers: Partial<Record<FieldId, () => Promise<string | null>>> = {
      narrationPath: desktop.chooseNarration,
      sourceDirectory: desktop.chooseSourceDirectory,
      outputDirectory: desktop.chooseOutputDirectory,
      handoffPath: desktop.chooseRenderHandoff,
      workerPath: desktop.chooseWorker,
      ffmpegPath: desktop.chooseFfmpeg,
    };
    const value = await pickers[fieldId]?.();
    if (value) fields[fieldId].value = value;
  });
});

fields.projectId.addEventListener("change", () => void loadWorkspace());
document.getElementById("save")?.addEventListener("click", async () => {
  const projectId = projectReference();
  if (!projectId) return report("Enter a local project reference first.");
  await desktop.saveLocalProjectPaths(projectId, currentPaths());
  report("Local paths saved securely for this Windows user.");
  await refreshLocalPreview(false);
});
document.getElementById("render")?.addEventListener("click", async () => {
  const paths = currentPaths();
  if (!paths.handoffPath || !paths.workerPath || !paths.sourceDirectory || !paths.outputDirectory) return report("Choose the handoff, worker, source, and output paths before rendering.");
  if (renderInProgress) return;
  renderInProgress = true;
  renderButton.disabled = true;
  renderLog.textContent = "Starting the approved local render…";
  report("Starting the approved local render…");
  try {
    await desktop.runApprovedRender({ handoffPath: paths.handoffPath, workerPath: paths.workerPath, sourceDirectory: paths.sourceDirectory, outputDirectory: paths.outputDirectory, ffmpegPath: paths.ffmpegPath });
  } catch (error) { report(error instanceof Error ? error.message : "Local render failed."); }
  finally { renderInProgress = false; renderButton.disabled = false; }
});
document.querySelectorAll<HTMLButtonElement>("[data-route]").forEach(button => button.addEventListener("click", () => void desktop.openHostedRoute(button.dataset.route as "/projects" | "/timeline" | "/preview")));
document.getElementById("refreshPreview")?.addEventListener("click", () => void refreshLocalPreview());
document.getElementById("openOutputFolder")?.addEventListener("click", async () => {
  try { await desktop.openOutputDirectory(fields.outputDirectory.value); }
  catch (error) { report(error instanceof Error ? error.message : "Could not open the output folder."); }
});
document.getElementById("openOutputVideo")?.addEventListener("click", async () => {
  const video = selectedVideo();
  if (!video) return;
  try { await desktop.openOutputVideo(video.path); }
  catch (error) { report(error instanceof Error ? error.message : "Could not open the selected MP4."); }
});
outputVideo.addEventListener("change", () => showVideo(selectedVideo()));
desktop.onRenderEvent(event => {
  const renderEvent = event as LocalRenderEvent;
  if (renderEvent.type === "output") {
    appendRenderLog(renderEvent.line.trim());
    return;
  }
  if (renderEvent.type === "started") {
    appendRenderLog("Approved local render started.");
    return;
  }
  if (renderEvent.type === "completed") {
    appendRenderLog("Render completed. Refreshing the local MP4 preview…");
    report("Render completed. Latest local MP4 is ready to preview.");
    void refreshLocalPreview(false);
    return;
  }
  appendRenderLog(renderEvent.message);
  report(renderEvent.message);
});
