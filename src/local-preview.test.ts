import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("desktop Preview-only local MP4 preview", () => {
  it("opens a native Preview window and restricts output access to saved local directories", () => {
    const main = readFileSync(resolve(root, "src/main.ts"), "utf8");
    const preload = readFileSync(resolve(root, "src/preload.ts"), "utf8");
    const declaration = readFileSync(resolve(root, "src/global.d.ts"), "utf8");

    expect(main).toContain("function openDesktopPreview()");
    expect(main).toContain('new URL(url).pathname === "/preview"');
    expect(main).toContain('window.webContents.on("did-navigate-in-page"');
    expect(main).toContain("new WebContentsView");
    expect(main).toContain("window.contentView.addChildView(desktopPreviewView)");
    expect(main).toContain("desktopPreviewView.setBounds");
    expect(main).toContain("desktopPreviewView.setVisible(true)");
    expect(main).toContain("sandbox: false");
    expect(main).toContain("window.webContents.goBack()");
    expect(main).toContain("host in-page route=");
    expect(main).toContain("restoringHostedRouteAfterPreview");
    expect(main).toContain("retained preview after route restore=");
    expect(main).toContain("VISUALSYNC_AUTO_PREVIEW");
    expect(main).toContain("--visualsync-auto-preview");
    expect(main).toContain('ipcMain.handle("desktop-preview:open"');
    expect(main).toContain('ipcMain.handle("desktop-preview:close"');
    expect(main).toContain("close requested view=");
    expect(main).toContain("requireConfiguredOutputDirectory");
    expect(main).toContain("async function choosePreviewFolders");
    expect(main).toContain("store[String(handoff.projectId)] = saved");
    expect(main).toContain("pathToFileURL(filePath).toString()");
    expect(main).toContain('url.searchParams.set("batch", "1")');
    expect(main).toContain("JSON.stringify({ 0: { json: input ?? null } })");
    expect(preload).toContain("getDesktopPreview");
    expect(preload).toContain("renderDesktopPreview");
    expect(preload).toContain("const isHostedPage = () => window.location.origin === hostedOrigin");
    expect(preload).toContain('ipcRenderer.invoke("desktop-preview:open")');
    expect(preload).toContain('ipcRenderer.invoke("desktop-preview:close")');
    expect(preload).toContain('document.addEventListener("pointerdown"');
    expect(preload).toContain('document.addEventListener("keydown"');
    expect(declaration).toContain("DesktopPreviewState");
  });

  it("keeps preview UI to final video and a user-clicked render action while silently refreshing local render files", () => {
    const preview = readFileSync(resolve(root, "src/desktop-preview.html"), "utf8");
    const behavior = readFileSync(resolve(root, "src/desktop-preview.ts"), "utf8");
    const main = readFileSync(resolve(root, "src/main.ts"), "utf8");

    expect(preview).toContain('id="outputVideo"');
    expect(preview).toContain('id="renderButton"');
    expect(preview).toContain("max-height: calc(100vh - 340px)");
    expect(preview).toContain("@media (prefers-reduced-motion: reduce)");
    expect(behavior).toContain('renderButton.addEventListener("click"');
    expect(behavior).toContain("desktop.renderDesktopPreview");
    expect(main).toContain("prepareRenderFiles");
    expect(main).toContain("localPathsForRender(handoff)");
    expect(main).toContain('path.join(outputDirectory, "render-approved-handoff.ps1")');
    expect(main).toContain("latestApprovedHandoff");
  });
});
