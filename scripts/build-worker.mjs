import { build } from "esbuild";
await build({
  entryPoints: ["packages/runtime/src/worker-cli.ts"],
  outfile: "dist/worker.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  external: ["node:sqlite"],
  sourcemap: true,
});
