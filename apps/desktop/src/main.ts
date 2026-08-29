import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  safeStorage,
  shell,
  utilityProcess,
} from "electron";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { stat, realpath, copyFile } from "node:fs/promises";
import { join, basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { Service, Store, inside } from "@subtitle/runtime";
import { runSmoke } from "./smoke";
const smoke = process.argv.includes("--smoke-test");
if (smoke) {
  if (!process.env.SUBTITLE_SMOKE_DATA)
    throw new Error(
      "Smoke test requires an isolated SUBTITLE_SMOKE_DATA directory",
    );
  const folder = resolve(process.env.SUBTITLE_SMOKE_DATA);
  mkdirSync(folder, { recursive: true });
  app.setPath("userData", folder);
}
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);
let worker: ReturnType<typeof utilityProcess.fork> | undefined;
app.whenReady().then(() => {
  const root = join(app.getPath("userData"), "workspace");
  mkdirSync(root, { recursive: true });
  const keyPath = join(root, "master-key.bin");
  if (!safeStorage.isEncryptionAvailable())
    throw new Error("系统凭据保护不可用，拒绝保存明文密钥");
  if (!existsSync(keyPath))
    writeFileSync(
      keyPath,
      safeStorage.encryptString(randomBytes(32).toString("hex")),
    );
  const masterKey = safeStorage.decryptString(readFileSync(keyPath));
  const service = new Service(new Store(root, masterKey));
  async function protectOriginal(target: string) {
    const destination = await realpath(target).catch(() => resolve(target));
    const targetInfo = await stat(target).catch(() => null);
    const comparable = (value: string) =>
      process.platform === "win32" ? value.toLowerCase() : value;
    for (const project of service.store.projects()) {
      if (!project.media) continue;
      const source = service.store.mediaPath(project.id);
      const original = await realpath(source).catch(() => resolve(source));
      const info = targetInfo ? await stat(source).catch(() => null) : null;
      if (
        comparable(original) === comparable(destination) ||
        (targetInfo &&
          info &&
          targetInfo.ino === info.ino &&
          targetInfo.dev === info.dev)
      )
        throw new Error("不能覆盖原视频，请选择其他文件名");
    }
  }
  const binRoot = join(process.resourcesPath, "media-bin");
  if (app.isPackaged) {
    process.env.FFMPEG_PATH = join(
      binRoot,
      process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
    );
    process.env.FFPROBE_PATH = join(
      binRoot,
      process.platform === "win32" ? "ffprobe.exe" : "ffprobe",
    );
  }
  worker = utilityProcess.fork(join(__dirname, "worker.cjs"), [], {
    env: {
      ...process.env,
      SUBTITLE_DATA_DIR: root,
      SUBTITLE_MASTER_KEY: masterKey,
    },
    serviceName: "Subtitle processing",
  });
  protocol.handle("app", async (req) => {
    const url = new URL(req.url);
    if (url.hostname === "media") {
      const path = service.store.mediaPath(
        decodeURIComponent(url.pathname.slice(1)),
      );
      return net.fetch(pathToFileURL(path).href, { headers: req.headers });
    }
    if (url.hostname !== "studio")
      return new Response("Not found", { status: 404 });
    const folder = join(__dirname, "renderer");
    const path = inside(
      folder,
      join(
        folder,
        decodeURIComponent(
          url.pathname === "/" ? "index.html" : url.pathname.slice(1),
        ),
      ),
    );
    return net.fetch(pathToFileURL(path).href);
  });
  const valid = (event: Electron.IpcMainInvokeEvent) => {
    if (!event.senderFrame?.url.startsWith("app://studio/"))
      throw new Error("不可信的调用来源");
  };
  ipcMain.handle("subtitle:command", async (event, method, args) => {
    valid(event);
    if (method === "output.save") {
      const job = service.store.job(String(args.id));
      if (job.status !== "completed" || !job.outputName)
        throw new Error("视频未完成");
      const result = await dialog.showSaveDialog({
        defaultPath: "subtitled-video.mp4",
        filters: [{ name: "MP4", extensions: ["mp4"] }],
      });
      if (result.filePath) {
        await protectOriginal(result.filePath);
        await copyFile(
          join(root, "jobs", job.id, "video.mp4"),
          result.filePath,
        );
      }
      return { ok: true };
    }
    return service.call(method, args);
  });
  ipcMain.handle("subtitle:pick", async (event) => {
    valid(event);
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [
        {
          name: "视频",
          extensions: ["mp4", "mov", "mkv", "avi", "webm", "m4v"],
        },
      ],
    });
    return result.canceled ? null : service.importVideo(result.filePaths[0]);
  });
  ipcMain.handle("subtitle:save", async (event, name, text) => {
    valid(event);
    if (typeof text !== "string" || text.length > 32 * 1024 * 1024)
      throw new Error("字幕文件过大");
    const result = await dialog.showSaveDialog({ defaultPath: basename(name) });
    if (result.filePath) {
      await protectOriginal(result.filePath);
      writeFileSync(result.filePath, text, "utf8");
    }
  });
  function openWindow() {
    const window = new BrowserWindow({
      show: !smoke,
      width: 1440,
      height: 950,
      minWidth: 900,
      minHeight: 650,
      title: "字幕工作台",
      backgroundColor: "#f6f8f7",
      webPreferences: {
        preload: join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("https://")) shell.openExternal(url);
      return { action: "deny" };
    });
    window.webContents.on("will-navigate", (event, url) => {
      if (!url.startsWith("app://studio/")) event.preventDefault();
    });
    const loaded = window.loadURL("app://studio/");
    if (smoke)
      void runSmoke(service, window, root, loaded)
        .then(() => app.exit(0))
        .catch((error) => {
          writeFileSync(
            join(app.getPath("userData"), "smoke-result.json"),
            JSON.stringify({ ok: false, error: String(error) }),
          );
          app.exit(1);
        });
  }
  openWindow();
  app.on("activate", () => {
    if (!BrowserWindow.getAllWindows().length) openWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => worker?.kill());
