type FieldId = "projectId" | "narrationPath" | "sourceDirectory" | "outputDirectory" | "handoffPath" | "workerPath" | "ffmpegPath";

const bridge = window.visualSyncDesktop;
if (!bridge) throw new Error("VisualSync Desktop bridge is unavailable.");
const desktop = bridge;

const fields = Object.fromEntries(([
  "projectId", "narrationPath", "sourceDirectory", "outputDirectory", "handoffPath", "workerPath", "ffmpegPath",
] as FieldId[]).map(id => [id, document.getElementById(id) as HTMLInputElement])) as Record<FieldId, HTMLInputElement>;
const status = document.getElementById("status") as HTMLDivElement;

function report(message: string) { status.textContent = message; }
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
});
document.getElementById("render")?.addEventListener("click", async () => {
  const paths = currentPaths();
  if (!paths.handoffPath || !paths.workerPath || !paths.sourceDirectory || !paths.outputDirectory) return report("Choose the handoff, worker, source, and output paths before rendering.");
  report("Starting the approved local render…");
  try {
    await desktop.runApprovedRender({ handoffPath: paths.handoffPath, workerPath: paths.workerPath, sourceDirectory: paths.sourceDirectory, outputDirectory: paths.outputDirectory, ffmpegPath: paths.ffmpegPath });
  } catch (error) { report(error instanceof Error ? error.message : "Local render failed."); }
});
document.querySelectorAll<HTMLButtonElement>("[data-route]").forEach(button => button.addEventListener("click", () => void desktop.openHostedRoute(button.dataset.route as "/projects" | "/timeline" | "/preview")));
desktop.onRenderEvent(event => report(typeof event === "object" && event ? JSON.stringify(event) : String(event)));
