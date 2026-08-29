import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  chmodSync,
  realpathSync,
} from "node:fs";
import { resolve, join, basename, dirname } from "node:path";
const root = resolve("assets/media-bin");
mkdirSync(root, { recursive: true });
const copied = new Map();
const destinations = new Map();

function dylibReferences(source) {
  return execFileSync("otool", ["-L", source], { encoding: "utf8" })
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(" (")[0])
    .filter(Boolean);
}

function dylibRpaths(source, executableDir) {
  const lines = execFileSync("otool", ["-l", source], {
    encoding: "utf8",
  }).split("\n");
  const result = [];
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].trim() !== "cmd LC_RPATH") continue;
    for (
      let cursor = index + 1;
      cursor < Math.min(index + 6, lines.length);
      cursor++
    ) {
      const match = lines[cursor].trim().match(/^path (.+) \(offset \d+\)$/);
      if (!match) continue;
      result.push(
        match[1]
          .replace(/^@loader_path/, dirname(source))
          .replace(/^@executable_path/, executableDir),
      );
      break;
    }
  }
  return result;
}

function resolveDylib(reference, source, executableDir, rootRpaths) {
  if (reference.startsWith("/System/") || reference.startsWith("/usr/lib/"))
    return undefined;
  const loaderDir = dirname(source);
  let candidates;
  if (reference.startsWith("@loader_path/")) {
    candidates = [join(loaderDir, reference.slice("@loader_path/".length))];
  } else if (reference.startsWith("@executable_path/")) {
    candidates = [
      join(executableDir, reference.slice("@executable_path/".length)),
    ];
  } else if (reference.startsWith("@rpath/")) {
    const suffix = reference.slice("@rpath/".length);
    candidates = [
      ...dylibRpaths(source, executableDir),
      ...rootRpaths,
      loaderDir,
    ].map((path) => join(path, suffix));
  } else {
    candidates = [
      reference.startsWith("/") ? reference : join(loaderDir, reference),
    ];
  }
  const match = candidates.find(existsSync);
  if (!match)
    throw new Error(
      `无法解析 ${basename(source)} 的动态库 ${reference}；检查 Homebrew bottle 的 rpath`,
    );
  return realpathSync(match);
}

function bundle(sourcePath, dest, executableDir, rootRpaths) {
  const source = realpathSync(sourcePath);
  if (copied.has(source)) return;
  const previous = destinations.get(dest);
  if (previous && previous !== source)
    throw new Error(
      `动态库文件名冲突：${previous} 与 ${source} 都映射到 ${dest}`,
    );
  copied.set(source, dest);
  destinations.set(dest, source);
  copyFileSync(source, dest);
  chmodSync(dest, 0o755);
  if (process.platform !== "darwin") return;
  for (const reference of dylibReferences(source)) {
    const lib = resolveDylib(reference, source, executableDir, rootRpaths);
    if (!lib || lib === source) continue;
    const target = join(root, "lib", basename(lib));
    mkdirSync(dirname(target), { recursive: true });
    bundle(lib, target, executableDir, rootRpaths);
    execFileSync("install_name_tool", [
      "-change",
      reference,
      `${dirname(dest) === root ? "@loader_path/lib/" : "@loader_path/"}${basename(lib)}`,
      dest,
    ]);
  }
  if (dest.endsWith(".dylib"))
    execFileSync("install_name_tool", [
      "-id",
      `@loader_path/${basename(dest)}`,
      dest,
    ]);
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
  const resolvedSource = realpathSync(source);
  const executableDir = dirname(resolvedSource);
  bundle(
    resolvedSource,
    join(root, name + ext),
    executableDir,
    process.platform === "darwin"
      ? dylibRpaths(resolvedSource, executableDir)
      : [],
  );
}
const ffmpeg = join(
  root,
  process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
);
let filters;
try {
  filters = execFileSync(ffmpeg, ["-hide_banner", "-filters"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (error) {
  throw new Error(
    `打包后的 FFmpeg 无法启动：${error.stderr?.toString().trim() || error.message}`,
    { cause: error },
  );
}
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
