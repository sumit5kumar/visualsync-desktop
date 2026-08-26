const desktop = window.visualSyncDesktop ?? (() => { throw new Error("VisualSync Desktop Preview is unavailable."); })();

const outputVideo = document.getElementById("outputVideo") as HTMLVideoElement;
const videoStage = document.getElementById("videoStage") as HTMLDivElement;
const emptyState = document.getElementById("emptyState") as HTMLDivElement;
const renderButton = document.getElementById("renderButton") as HTMLButtonElement;
const fullscreenButton = document.getElementById("fullscreenButton") as HTMLButtonElement;
const projectName = document.getElementById("projectName") as HTMLSpanElement;
const videoSummary = document.getElementById("videoSummary") as HTMLSpanElement;
const status = document.getElementById("status") as HTMLDivElement;
let canRender = false;

async function refreshPreview() {
  document.body.classList.add("is-loading");
  const preview = await desktop.getDesktopPreview();
  canRender = preview.canRender;
  renderButton.disabled = !canRender;
  projectName.textContent = preview.projectName ?? "No approved project";
  if (preview.video) {
    outputVideo.src = preview.video.fileUrl;
    outputVideo.hidden = false;
    fullscreenButton.hidden = false;
    emptyState.hidden = true;
    videoSummary.textContent = "Latest final video ready";
    status.textContent = "Latest local output video is ready.";
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
  document.body.classList.remove("is-loading");
}

fullscreenButton.addEventListener("click", async () => {
  try {
    const active = await desktop.toggleDesktopPreviewFullscreen();
    fullscreenButton.textContent = active ? "Exit fullscreen" : "Fullscreen";
    fullscreenButton.setAttribute("aria-label", active ? "Exit fullscreen" : "Enter fullscreen");
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Fullscreen is unavailable.";
  }
});

renderButton.addEventListener("click", async () => {
  if (!canRender) return;
  renderButton.disabled = true;
  renderButton.textContent = "Rendering…";
  document.body.classList.add("is-loading");
  status.textContent = "Local render started.";
  try { await desktop.renderDesktopPreview(); }
  catch (error) { status.textContent = error instanceof Error ? error.message : "Local render failed."; }
  finally { renderButton.textContent = "Render video"; await refreshPreview(); }
});

desktop.onRenderEvent(event => {
  if (typeof event === "object" && event && "type" in event && (event as { type?: string }).type === "completed") void refreshPreview();
});

void refreshPreview();
