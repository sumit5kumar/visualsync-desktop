import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("desktop-only local MP4 preview", () => {
  it("exposes only restricted output-folder preview controls through the native bridge", () => {
    const main = readFileSync(resolve(root, "src/main.ts"), "utf8");
    const preload = readFileSync(resolve(root, "src/preload.ts"), "utf8");
    const declaration = readFileSync(resolve(root, "src/global.d.ts"), "utf8");

    expect(main).toContain('"local-preview:list-output-videos"');
    expect(main).toContain("requireConfiguredOutputDirectory");
    expect(main).toContain("pathToFileURL(filePath).toString()");
    expect(preload).toContain("listOutputVideos");
    expect(preload).toContain("openOutputVideo");
    expect(declaration).toContain("LocalOutputVideo");
  });

  it("keeps local preview separate from the hosted page and never launches a render automatically", () => {
    const workspace = readFileSync(resolve(root, "src/local-workspace.html"), "utf8");
    const behavior = readFileSync(resolve(root, "src/local-workspace.ts"), "utf8");

    expect(workspace).toContain('id="localPreview"');
    expect(workspace).toContain("This does not wait for or modify the hosted Preview page.");
    expect(behavior).toContain("await desktop.runApprovedRender");
    expect(behavior).toContain('document.getElementById("render")?.addEventListener("click"');
    expect(behavior).toContain("desktop.listOutputVideos");
  });
});
