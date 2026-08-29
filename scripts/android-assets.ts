import { writeFileSync, mkdirSync } from "node:fs";
import { catalog } from "../packages/providers/src/catalog";
const folder = "apps/android/android/app/src/main/assets";
mkdirSync(folder, { recursive: true });
writeFileSync(`${folder}/providers.json`, JSON.stringify(catalog, null, 2));
