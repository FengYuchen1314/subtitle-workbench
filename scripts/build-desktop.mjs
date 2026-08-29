import { build } from "esbuild";
import { build as viteBuild } from "vite";
import path from "node:path";
await build({
  entryPoints: {
    main: "apps/desktop/src/main.ts",
    preload: "apps/desktop/src/preload.ts",
    worker: "apps/desktop/src/worker-entry.ts",
  },
  outdir: "apps/desktop/dist",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  outExtension: { ".js": ".cjs" },
  external: ["electron", "node:sqlite"],
  sourcemap: true,
});
await viteBuild({ configFile: path.resolve("apps/desktop/vite.config.ts") });
