import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
try {
  process.loadEnvFile(path.join(root, ".env"));
} catch {}
export default {
  output: "standalone",
  outputFileTracingRoot: root,
  outputFileTracingExcludes: {
    "*": [
      "../../data/**",
      "../../.env*",
      "../../**/.masterkey",
      "../../**/master-key.bin",
      "../../release/**",
    ],
  },
  transpilePackages: [
    "@subtitle/core",
    "@subtitle/ui",
    "@subtitle/providers",
    "@subtitle/runtime",
  ],
  serverExternalPackages: ["node:sqlite"],
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
};
