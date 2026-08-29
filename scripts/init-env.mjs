import { randomBytes } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";
if (existsSync(".env")) throw new Error(".env 已存在，拒绝覆盖");
writeFileSync(
  ".env",
  `SUBTITLE_MASTER_KEY=${randomBytes(32).toString("hex")}\nSUBTITLE_SETUP_TOKEN=${randomBytes(32).toString("hex")}\nSUBTITLE_PUBLIC_ORIGIN=http://localhost:3000\n`,
  { mode: 0o600 },
);
console.log(
  "已生成 .env。首次访问需要其中的 SUBTITLE_SETUP_TOKEN；请妥善保管，不要提交到 Git。",
);
