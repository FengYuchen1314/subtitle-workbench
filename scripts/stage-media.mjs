import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  chmodSync,
} from "node:fs";
import { resolve, join, basename, dirname } from "node:path";
const root = resolve("assets/media-bin");
mkdirSync(root, { recursive: true });
const copied = new Map();
function bundle(source, dest) {
  if (copied.has(source)) return;
  copied.set(source, dest);
  copyFileSync(source, dest);
  chmodSync(dest, 0o755);
  if (process.platform !== "darwin") return;
  const linked = execFileSync("otool", ["-L", source], { encoding: "utf8" })
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(" (")[0])
    .filter(
      (x) =>
        x.startsWith("/") &&
        !x.startsWith("/System/") &&
        !x.startsWith("/usr/lib/"),
    );
  for (const lib of linked) {
    const target = join(root, "lib", basename(lib));
    mkdirSync(dirname(target), { recursive: true });
    bundle(lib, target);
    execFileSync("install_name_tool", [
      "-change",
      lib,
      `${dirname(dest) === root ? "@loader_path/lib/" : "@loader_path/"}${basename(lib)}`,
      dest,
    ]);
  }
  execFileSync("codesign", ["--force", "--sign", "-", dest], {
    stdio: "ignore",
  });
}
for (const name of ["ffmpeg", "ffprobe"]) {
  const ext = process.platform === "win32" ? ".exe" : "";
  const source = process.env.MEDIA_BIN_DIR
    ? join(process.env.MEDIA_BIN_DIR, name + ext)
    : execFileSync(
        process.platform === "win32" ? "where.exe" : "which",
        [name],
        { encoding: "utf8" },
      )
        .trim()
        .split(/\r?\n/)[0];
  if (!existsSync(source))
    throw new Error(`未找到 ${name}，请安装 FFmpeg 或指定 MEDIA_BIN_DIR`);
  bundle(source, join(root, name + ext));
}
const ffmpeg = join(
  root,
  process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
);
const filters = execFileSync(ffmpeg, ["-hide_banner", "-filters"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
});
if (!filters.includes(" subtitles "))
  throw new Error("打包的 FFmpeg 必须包含 libass/subtitles");
writeFileSync(
  join(root, "FFMPEG-LICENSE.txt"),
  execFileSync(ffmpeg, ["-L"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }),
);
writeFileSync(
  join(root, "BUILD-CONFIG.txt"),
  execFileSync(ffmpeg, ["-version"], { encoding: "utf8" }),
);
writeFileSync(
  join(root, "SOURCE-NOTICE.txt"),
  "FFmpeg and linked libraries retain their original licenses.\nFFmpeg source: https://ffmpeg.org/releases/\nWindows build source/configuration: https://www.gyan.dev/ffmpeg/builds/\nmacOS formula and dependency sources: https://github.com/Homebrew/homebrew-core/tree/master/Formula/f\nSee docs/DISTRIBUTION.md before redistributing installers.\n",
);
console.log(`已准备 ${process.platform}/${process.arch} 媒体工具：${root}`);
