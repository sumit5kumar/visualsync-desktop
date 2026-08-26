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
    expect(main).toContain("requireConfiguredOutputDirectory");
    expect(main).toContain("handoff.nativePaths.sourceDirectory && handoff.nativePaths.outputDirectory");
    expect(main).toContain("pathToFileURL(filePath).toString()");
    expect(main).toContain('url.searchParams.set("batch", "1")');
    expect(main).toContain("JSON.stringify({ 0: { json: input ?? null } })");
    expect(preload).toContain("getDesktopPreview");
    expect(preload).toContain("renderDesktopPreview");
    expect(declaration).toContain("DesktopPreviewState");
  });

  it("keeps preview UI to final video and a user-clicked render action while silently refreshing local render files", () => {
    const preview = readFileSync(resolve(root, "src/desktop-preview.html"), "utf8");
    const behavior = readFileSync(resolve(root, "src/desktop-preview.ts"), "utf8");
    const main = readFileSync(resolve(root, "src/main.ts"), "utf8");

    expect(preview).toContain('id="outputVideo"');
    expect(preview).toContain('id="renderButton"');
    expect(behavior).toContain('renderButton.addEventListener("click"');
    expect(behavior).toContain("desktop.renderDesktopPreview");
    expect(main).toContain("prepareRenderFiles");
    expect(main).toContain('path.join(outputDirectory, "render-approved-handoff.ps1")');
    expect(main).toContain("latestApprovedHandoff");
  });
});
