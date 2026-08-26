import { cp, mkdir } from "node:fs/promises";

await mkdir("dist", { recursive: true });
await cp("src/local-workspace.html", "dist/local-workspace.html");
await cp("src/desktop-preview.html", "dist/desktop-preview.html");
