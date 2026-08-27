function requireDesktopBridge() {
  const bridge = window.visualSyncDesktop;
  if (!bridge) throw new Error("VisualSync Desktop bridge is unavailable.");
  return bridge;
}

const desktop = requireDesktopBridge();
const outputVideo = document.getElementById("outputVideo") as HTMLVideoElement;
const emptyState = document.getElementById("emptyState") as HTMLDivElement;
const videoTransport = document.getElementById("videoTransport") as HTMLDivElement;
const playPauseButton = document.getElementById("playPauseButton") as HTMLButtonElement;
const playbackTime = document.getElementById("playbackTime") as HTMLOutputElement;
const playbackSeek = document.getElementById("playbackSeek") as HTMLInputElement;
const renderButton = document.getElementById("renderButton") as HTMLButtonElement;
const cancelRenderButton = document.getElementById("cancelRenderButton") as HTMLButtonElement;
const renderProgress = document.getElementById("renderProgress") as HTMLDivElement;
const renderProgressTitle = document.getElementById("renderProgressTitle") as HTMLElement;
const renderProgressBar = document.getElementById("renderProgressBar") as HTMLSpanElement;
const renderProgressMeta = document.getElementById("renderProgressMeta") as HTMLSpanElement;
const fullscreenButton = document.getElementById("fullscreenButton") as HTMLButtonElement;
const projectSelect = document.getElementById("projectSelect") as HTMLSelectElement;
const videoSummary = document.getElementById("videoSummary") as HTMLSpanElement;
const status = document.getElementById("status") as HTMLDivElement;
let canRender = false;
let refreshVersion = 0;
let renderStartedAt = 0;
let renderEncodeStartedAt = 0;
let renderDurationSeconds = 0;
let preparationGeneratedFrames = 0;
let preparationExpectedFrames = 0;
let renderProgressTimer: ReturnType<typeof setInterval> | null = null;

function setVideoStageFullscreen(active: boolean) {
  document.body.classList.toggle("video-stage-fullscreen", active);
  outputVideo.controls = !active;
  fullscreenButton.textContent = active ? "Exit fullscreen" : "Fullscreen";
  fullscreenButton.setAttribute("aria-label", active ? "Exit fullscreen" : "Enter fullscreen");
}

function formatPlaybackTime(seconds: number) {
  const wholeSeconds = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, "0")}`;
}

function syncVideoTransport() {
  const duration = Number.isFinite(outputVideo.duration) ? outputVideo.duration : 0;
  const current = Math.min(Math.max(0, outputVideo.currentTime || 0), duration || 0);
  playbackTime.value = `${formatPlaybackTime(current)} / ${formatPlaybackTime(duration)}`;
  playbackSeek.value = String(duration ? Math.round((current / duration) * 1000) : 0);
  playPauseButton.textContent = outputVideo.paused ? "Play" : "Pause";
}

function formatElapsed(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}:${String(seconds % 60).padStart(2, "0")}` : `0:${String(seconds).padStart(2, "0")}`;
}

function updatePreparingProgress() {
  if (!renderStartedAt || !renderProgress.classList.contains("is-preparing")) return;
  const elapsedMilliseconds = Date.now() - renderStartedAt;
  if (preparationExpectedFrames > 0) {
    const percent = Math.min(99, (preparationGeneratedFrames / preparationExpectedFrames) * 100);
    const framesPerSecond = preparationGeneratedFrames / Math.max(0.1, elapsedMilliseconds / 1000);
    const remainingSeconds = (preparationExpectedFrames - preparationGeneratedFrames) / Math.max(0.1, framesPerSecond);
    renderProgressTitle.textContent = `Preparing video frames · ${Math.round(percent)}%`;
    renderProgressBar.style.width = `${Math.max(3, percent).toFixed(1)}%`;
    renderProgressMeta.textContent = `Frames ${preparationGeneratedFrames.toLocaleString()} / ${preparationExpectedFrames.toLocaleString()} · about ${formatElapsed(remainingSeconds * 1000)} remaining · elapsed ${formatElapsed(elapsedMilliseconds)}`;
    return;
  }
  renderProgressMeta.textContent = `Elapsed ${formatElapsed(elapsedMilliseconds)} · calculating the first preparation estimate…`;
}

function beginRenderProgress() {
  renderStartedAt = Date.now();
  renderEncodeStartedAt = 0;
  renderDurationSeconds = 0;
  preparationGeneratedFrames = 0;
  preparationExpectedFrames = 0;
  renderProgress.hidden = false;
  renderProgress.classList.add("is-preparing");
  renderProgress.classList.remove("is-completed");
  renderProgressTitle.textContent = "Preparing local render…";
  renderProgressBar.style.width = "3%";
  updatePreparingProgress();
  if (renderProgressTimer) clearInterval(renderProgressTimer);
  renderProgressTimer = setInterval(updatePreparingProgress, 1000);
}

function updatePreparationProgress(generatedFrames: number, expectedFrames: number) {
  preparationGeneratedFrames = Math.max(0, generatedFrames);
  preparationExpectedFrames = Math.max(0, expectedFrames);
  updatePreparingProgress();
}

function renderTimeToSeconds(value: string) {
  const parts = value.split(":").map(Number);
  return parts.length === 3 && parts.every(Number.isFinite) ? parts[0] * 3600 + parts[1] * 60 + parts[2] : 0;
}

function updateEncodeProgress(line: string) {
  const durationMatch = line.match(/Duration:\s*(\d{2}:\d{2}:\d{2}(?:\.\d+)?)/);
  if (durationMatch) renderDurationSeconds = renderTimeToSeconds(durationMatch[1]);
  const timeMatch = line.match(/time=(\d{2}:\d{2}:\d{2}(?:\.\d+)?)/);
  if (!timeMatch || !renderDurationSeconds) return;
  const encodedSeconds = Math.min(renderTimeToSeconds(timeMatch[1]), renderDurationSeconds);
  if (!renderEncodeStartedAt) renderEncodeStartedAt = Date.now();
  const elapsedSeconds = Math.max(0.1, (Date.now() - renderEncodeStartedAt) / 1000);
  const percent = Math.max(1, Math.min(99, (encodedSeconds / renderDurationSeconds) * 100));
  const mediaSecondsPerSecond = encodedSeconds / elapsedSeconds;
  const remainingSeconds = (renderDurationSeconds - encodedSeconds) / Math.max(0.1, mediaSecondsPerSecond);
  renderProgress.classList.remove("is-preparing");
  renderProgressTitle.textContent = "Rendering local video…";
  renderProgressBar.style.width = `${percent.toFixed(1)}%`;
  renderProgressMeta.textContent = `${Math.round(percent)}% · about ${formatElapsed(remainingSeconds * 1000)} remaining · elapsed ${formatElapsed(Date.now() - renderStartedAt)}`;
}

function finishRenderProgress(success: boolean, message?: string) {
  if (renderProgressTimer) clearInterval(renderProgressTimer);
  renderProgressTimer = null;
  renderProgress.classList.remove("is-preparing");
  renderProgress.classList.toggle("is-completed", success);
  renderProgressTitle.textContent = success ? "Local render completed · final video ready" : "Local render needs attention";
  renderProgressBar.style.width = "100%";
  renderProgressMeta.textContent = success ? `Completed in ${formatElapsed(Date.now() - renderStartedAt)} · the final video is ready in this Preview` : message ?? "Render did not complete. Please review the message above.";
  if (success) status.textContent = "Local render completed. The final video is ready in Preview.";
  cancelRenderButton.hidden = true;
  cancelRenderButton.disabled = false;
  cancelRenderButton.textContent = "Cancel render";
}

function applyProjectOptions(projects: Awaited<ReturnType<typeof desktop.listDesktopPreviewProjects>>, selectedProjectId: number | null) {
  projectSelect.replaceChildren();
  if (!projects.length) {
    projectSelect.append(new Option("No approved projects available", ""));
    projectSelect.disabled = true;
    return;
  }
  for (const project of projects) projectSelect.append(new Option(project.name, String(project.id)));
  const selected = selectedProjectId && projects.some(project => project.id === selectedProjectId) ? String(selectedProjectId) : projectSelect.options[0]?.value;
  if (selected) projectSelect.value = selected;
  projectSelect.disabled = false;
}

async function refreshPreview(previewOverride?: Awaited<ReturnType<typeof desktop.getDesktopPreview>>) {
  const version = ++refreshVersion;
  document.body.classList.add("is-loading");
  try {
    const [preview, projects] = await Promise.all([previewOverride ?? desktop.getDesktopPreview(), desktop.listDesktopPreviewProjects()]);
    if (version !== refreshVersion) return;
    applyProjectOptions(projects, preview.projectId);
    canRender = preview.canRender;
    renderButton.disabled = !canRender;
    if (preview.video) {
      outputVideo.src = preview.video.fileUrl;
      outputVideo.hidden = false;
      videoTransport.hidden = false;
      fullscreenButton.hidden = false;
      emptyState.hidden = true;
      videoSummary.textContent = "Latest final video ready";
      status.textContent = `Selected project: ${preview.projectName ?? "approved project"}.`;
    } else {
      outputVideo.removeAttribute("src");
      outputVideo.load();
      outputVideo.hidden = true;
      videoTransport.hidden = true;
      fullscreenButton.hidden = true;
      emptyState.hidden = false;
      videoSummary.textContent = "No final video on this computer yet";
      emptyState.textContent = preview.message;
      status.textContent = preview.message;
    }
  } catch (error) {
    if (version !== refreshVersion) return;
    canRender = false;
    renderButton.disabled = true;
    projectSelect.disabled = true;
    status.textContent = error instanceof Error ? error.message : "Preview is unavailable.";
  } finally {
    if (version === refreshVersion) document.body.classList.remove("is-loading");
  }
}

projectSelect.addEventListener("change", async () => {
  const projectId = Number(projectSelect.value);
  if (!Number.isInteger(projectId) || projectId <= 0) return;
  renderProgress.hidden = true;
  projectSelect.disabled = true;
  status.textContent = "Loading selected approved project…";
  try { await refreshPreview(await desktop.selectDesktopPreviewProject(projectId)); }
  catch (error) {
    status.textContent = error instanceof Error ? error.message : "The selected approved project could not be loaded.";
    await refreshPreview();
  }
});

fullscreenButton.addEventListener("click", async () => {
  try { setVideoStageFullscreen(await desktop.toggleDesktopPreviewFullscreen()); }
  catch (error) { status.textContent = error instanceof Error ? error.message : "Fullscreen is unavailable."; }
});

playPauseButton.addEventListener("click", async () => {
  if (outputVideo.paused) await outputVideo.play();
  else outputVideo.pause();
});

playbackSeek.addEventListener("input", () => {
  if (!Number.isFinite(outputVideo.duration) || outputVideo.duration <= 0) return;
  outputVideo.currentTime = (Number(playbackSeek.value) / 1000) * outputVideo.duration;
});

outputVideo.addEventListener("loadedmetadata", syncVideoTransport);
outputVideo.addEventListener("timeupdate", syncVideoTransport);
outputVideo.addEventListener("play", syncVideoTransport);
outputVideo.addEventListener("pause", syncVideoTransport);
outputVideo.addEventListener("ended", syncVideoTransport);
document.addEventListener("fullscreenchange", () => {
  if (document.fullscreenElement === outputVideo) {
    void desktop.setDesktopPreviewFullscreen(true);
    return;
  }
  if (document.fullscreenElement === null) {
    setTimeout(() => {
      if (document.fullscreenElement === null && !document.body.classList.contains("video-stage-fullscreen")) void desktop.setDesktopPreviewFullscreen(false);
    }, 260);
  }
});
outputVideo.addEventListener("webkitbeginfullscreen", () => { void desktop.setDesktopPreviewFullscreen(true); });
outputVideo.addEventListener("webkitendfullscreen", () => { void desktop.setDesktopPreviewFullscreen(false); });
desktop.onDesktopPreviewFullscreenChanged(setVideoStageFullscreen);
desktop.onDesktopPreviewProjectChanged(() => { void refreshPreview(); });

renderButton.addEventListener("click", async () => {
  if (!canRender) return;
  renderButton.disabled = true;
  renderButton.textContent = "Rendering…";
  cancelRenderButton.hidden = false;
  cancelRenderButton.disabled = false;
  document.body.classList.add("is-loading");
  beginRenderProgress();
  status.textContent = "Local render started for the selected approved project.";
  try { await desktop.renderDesktopPreview(); }
  catch (error) {
    const message = error instanceof Error ? error.message : "Local render failed.";
    status.textContent = message;
    finishRenderProgress(false, message);
  } finally {
    renderButton.textContent = "Render video";
    await refreshPreview();
  }
});

cancelRenderButton.addEventListener("click", async () => {
  cancelRenderButton.disabled = true;
  cancelRenderButton.textContent = "Cancelling…";
  try {
    const cancelled = await desktop.cancelDesktopPreviewRender();
    if (!cancelled) finishRenderProgress(false, "No active local render was found to cancel.");
  } catch (error) {
    finishRenderProgress(false, error instanceof Error ? error.message : "The local render could not be cancelled.");
  }
});

desktop.onRenderEvent(event => {
  if (typeof event !== "object" || !event || !("type" in event)) return;
  const renderEvent = event as { type?: string; line?: string; message?: string; generatedFrames?: number; expectedFrames?: number };
  if (renderEvent.type === "preparing" && typeof renderEvent.generatedFrames === "number" && typeof renderEvent.expectedFrames === "number") updatePreparationProgress(renderEvent.generatedFrames, renderEvent.expectedFrames);
  if (renderEvent.type === "output" && renderEvent.line) updateEncodeProgress(renderEvent.line);
  if (renderEvent.type === "completed") { finishRenderProgress(true); void refreshPreview(); }
  if (renderEvent.type === "cancelled") finishRenderProgress(false, renderEvent.message);
  if (renderEvent.type === "failed") finishRenderProgress(false, renderEvent.message);
});

void refreshPreview();
