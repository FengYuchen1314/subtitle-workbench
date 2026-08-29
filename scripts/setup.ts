import { createInterface } from "node:readline/promises";
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Store, passwordHash } from "@subtitle/runtime";
try {
  process.loadEnvFile(".env");
} catch {}
const reader = createInterface({
  input: process.stdin,
  output: process.stdout,
});
const password = await reader.question(
  "设置管理员密码（至少 12 位；输入在此终端可见）：",
);
reader.close();
if (password.length < 12) throw new Error("密码必须至少 12 位");
const store = new Store();
store.setSetting("adminHash", passwordHash(password));
store.close();
if (!existsSync(".env"))
  writeFileSync(
    ".env",
    `SUBTITLE_DATA_DIR=${resolve("data").replace(/\\/g, "/")}\nSUBTITLE_SETUP_TOKEN=${randomBytes(32).toString("hex")}\n`,
    { mode: 0o600 },
  );
console.log("管理员已配置。分别运行 npm run dev 和 npm run worker。");
