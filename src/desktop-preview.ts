function requireDesktopBridge() {
  const bridge = window.visualSyncDesktop;
  if (!bridge) throw new Error("VisualSync Desktop bridge is unavailable.");
  return bridge;
}

const desktop = requireDesktopBridge();

const outputVideo = document.getElementById("outputVideo") as HTMLVideoElement;
const videoStage = document.getElementById("videoStage") as HTMLDivElement;
const emptyState = document.getElementById("emptyState") as HTMLDivElement;
const renderButton = document.getElementById("renderButton") as HTMLButtonElement;
const fullscreenButton = document.getElementById("fullscreenButton") as HTMLButtonElement;
const projectSelect = document.getElementById("projectSelect") as HTMLSelectElement;
const videoSummary = document.getElementById("videoSummary") as HTMLSpanElement;
const status = document.getElementById("status") as HTMLDivElement;
let canRender = false;
let refreshVersion = 0;

function setVideoStageFullscreen(active: boolean) {
  document.body.classList.toggle("video-stage-fullscreen", active);
  fullscreenButton.textContent = active ? "Exit fullscreen" : "Fullscreen";
  fullscreenButton.setAttribute("aria-label", active ? "Exit fullscreen" : "Enter fullscreen");
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
      fullscreenButton.hidden = false;
      emptyState.hidden = true;
      videoSummary.textContent = "Latest final video ready";
      status.textContent = `Selected project: ${preview.projectName ?? "approved project"}.`;
    } else {
      outputVideo.removeAttribute("src");
      outputVideo.load();
      outputVideo.hidden = true;
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
  projectSelect.disabled = true;
  status.textContent = "Loading selected approved project…";
  try {
    await refreshPreview(await desktop.selectDesktopPreviewProject(projectId));
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "The selected approved project could not be loaded.";
    await refreshPreview();
  }
});

fullscreenButton.addEventListener("click", async () => {
  try { setVideoStageFullscreen(await desktop.toggleDesktopPreviewFullscreen()); }
  catch (error) { status.textContent = error instanceof Error ? error.message : "Fullscreen is unavailable."; }
});

desktop.onDesktopPreviewFullscreenChanged(setVideoStageFullscreen);
desktop.onDesktopPreviewProjectChanged(() => { void refreshPreview(); });

renderButton.addEventListener("click", async () => {
  if (!canRender) return;
  renderButton.disabled = true;
  renderButton.textContent = "Rendering…";
  document.body.classList.add("is-loading");
  status.textContent = "Local render started for the selected approved project.";
  try { await desktop.renderDesktopPreview(); }
  catch (error) { status.textContent = error instanceof Error ? error.message : "Local render failed."; }
  finally { renderButton.textContent = "Render video"; await refreshPreview(); }
});

desktop.onRenderEvent(event => {
  if (typeof event === "object" && event && "type" in event && (event as { type?: string }).type === "completed") void refreshPreview();
});

void refreshPreview();
