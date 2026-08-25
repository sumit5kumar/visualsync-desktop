import { cp, mkdir } from "node:fs/promises";

await mkdir("dist", { recursive: true });
await cp("src/local-workspace.html", "dist/local-workspace.html");
