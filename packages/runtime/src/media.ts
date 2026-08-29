import { spawn } from "node:child_process";
import {
  mkdir,
  writeFile,
  stat,
  rename,
  unlink,
  statfs,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  exportSubtitles,
  type JobParams,
  type MediaInfo,
  type SubtitleDocument,
  type SubtitleStyle,
} from "@subtitle/core";

export function runProcess(
  command: string,
  args: string[],
  signal?: AbortSignal,
  cwd?: string,
  onLine?: (line: string) => void,
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      shell: false,
      cwd,
    });
    let result = "",
      error = "",
      pending = "";
    let finished = false;
    let aborted = signal?.aborted ?? false;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (forceKillTimer) clearTimeout(forceKillTimer);
      signal?.removeEventListener("abort", abort);
    };
    const succeed = () => {
      if (finished) return;
      finished = true;
      cleanup();
      resolvePromise(result);
    };
    const fail = (reason: Error) => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(reason);
    };
    const terminate = () => {
      aborted = true;
      if (child.exitCode !== null) return;
      if (process.platform === "win32" && child.pid) {
        // Package managers commonly expose FFmpeg through a shim process. Kill
        // the whole tree so the real ffmpeg.exe cannot inherit our stdio pipes
        // and keep Node alive after the shim exits.
        const killer = spawn(
          "taskkill.exe",
          ["/PID", String(child.pid), "/T", "/F"],
          { windowsHide: true, shell: false, stdio: "ignore" },
        );
        killer.once("error", () => {
          try {
            child.kill("SIGKILL");
          } catch {}
        });
        return;
      }
      try {
        child.kill("SIGTERM");
      } catch {}
      forceKillTimer = setTimeout(() => {
        if (child.exitCode === null) {
          try {
            child.kill("SIGKILL");
          } catch {}
        }
      }, 2000);
      forceKillTimer.unref();
    };
    const abort = () => terminate();
    signal?.addEventListener("abort", abort, { once: true });
    if (aborted) terminate();

    child.stdout.on("data", (data) => {
      result += data.toString();
      if (result.length > 4 * 1024 * 1024) {
        terminate();
        fail(new Error("媒体工具输出超限"));
      }
    });
    child.stderr.on("data", (data) => {
      const text = data.toString();
      error = (error + text).slice(-4000);
      pending += text;
      const lines = pending.split(/[\r\n]/);
      pending = lines.pop() || "";
      for (const line of lines) onLine?.(line);
    });
    child.on("error", () =>
      fail(
        aborted
          ? new Error("任务已取消")
          : new Error(`无法启动 ${command}，请安装媒体工具或配置路径`),
      ),
    );
    child.on("close", (code) => {
      if (aborted) fail(new Error("任务已取消"));
      else if (code === 0) succeed();
      else fail(new Error(`媒体处理失败（${code}）：${error.slice(-600)}`));
    });
  });
}
export class FfmpegEngine {
  constructor(
    private signal?: AbortSignal,
    private progress?: (percent: number) => void,
  ) {}
  private ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
  private ffprobe = process.env.FFPROBE_PATH || "ffprobe";
  async probe(path: string): Promise<MediaInfo> {
    const data = JSON.parse(
      await runProcess(
        this.ffprobe,
        [
          "-v",
          "error",
          "-protocol_whitelist",
          "file,pipe",
          "-format_whitelist",
          "mov,matroska,webm,avi,mpegts,mpeg,wav,mp3,flac",
          "-show_format",
          "-show_streams",
          "-of",
          "json",
          path,
        ],
        this.signal,
      ),
    );
    const video = data.streams.find((s: any) => s.codec_type === "video");
    if (!video) throw new Error("文件不含视频轨道");
    const duration = Number(data.format.duration || video.duration);
    if (!Number.isFinite(duration) || duration <= 0)
      throw new Error("无法获取视频时长");
    const [num, den] = (video.avg_frame_rate || "25/1").split("/").map(Number);
    return {
      durationMs: Math.round(duration * 1000),
      width: video.width,
      height: video.height,
      fps: den ? num / den : 25,
      audioCodec: data.streams.find((s: any) => s.codec_type === "audio")
        ?.codec_name,
      audioTracks: data.streams
        .filter((s: any) => s.codec_type === "audio")
        .map((s: any, i: number) => ({
          index: i,
          language: s.tags?.language,
          title: s.tags?.title,
          codec: s.codec_name,
        })),
    };
  }
  async extract(input: string, output: string, track = 0) {
    await mkdir(dirname(output), { recursive: true });
    const info = await this.probe(input),
      disk = await statfs(dirname(output));
    if (disk.bavail * disk.bsize < info.durationMs * 32 + 64 * 1024 * 1024)
      throw new Error("提取音频所需磁盘空间不足");
    await runProcess(
      this.ffmpeg,
      [
        "-nostdin",
        "-y",
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        input,
        "-map",
        `0:a:${track}`,
        "-vn",
        "-af",
        "aresample=async=1:first_pts=0",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        output,
      ],
      this.signal,
    );
  }
  async silence(path: string): Promise<number[]> {
    const points: number[] = [];
    await runProcess(
      this.ffmpeg,
      [
        "-nostdin",
        "-i",
        path,
        "-af",
        "silencedetect=n=-35dB:d=0.3",
        "-f",
        "null",
        "-",
      ],
      this.signal,
      undefined,
      (line) => {
        const m = line.match(/silence_end: ([\d.]+)/);
        if (m) points.push(+m[1] * 1000);
      },
    );
    return points;
  }
  async chunk(input: string, output: string, startMs: number, endMs: number) {
    await runProcess(
      this.ffmpeg,
      [
        "-nostdin",
        "-y",
        "-ss",
        String(startMs / 1000),
        "-i",
        input,
        "-t",
        String((endMs - startMs) / 1000),
        "-c:a",
        "pcm_s16le",
        output,
      ],
      this.signal,
    );
  }
  async render(
    input: string,
    output: string,
    document: SubtitleDocument,
    style: SubtitleStyle,
    params: JobParams,
  ) {
    const info = await this.probe(input),
      folder = dirname(output);
    await mkdir(folder, { recursive: true });
    const disk = await statfs(folder);
    if (
      disk.bavail * disk.bsize <
      Math.max((await stat(input)).size * 2, 64 * 1024 * 1024)
    )
      throw new Error("烧录视频所需磁盘空间不足");
    const ass = exportSubtitles(
      document,
      "ass",
      params.mode || "source",
      params.targetLanguage || "",
      style,
    );
    await writeFile(join(folder, "captions.ass"), ass, "utf8");
    const filter = `subtitles=filename=captions.ass${params.resolution ? `,scale=-2:${params.resolution}` : ""}`;
    const temp = join(folder, "render.partial.mp4");
    try {
      await runProcess(
        this.ffmpeg,
        [
          "-nostdin",
          "-y",
          "-protocol_whitelist",
          "file,pipe",
          "-i",
          resolve(input),
          "-map",
          "0:v:0",
          "-map",
          `0:a:${params.audioTrack || 0}?`,
          "-vf",
          filter,
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "20",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          info.audioTracks[params.audioTrack || 0]?.codec === "aac"
            ? "copy"
            : "aac",
          "-movflags",
          "+faststart",
          "-progress",
          "pipe:2",
          "-nostats",
          temp,
        ],
        this.signal,
        folder,
        (line) => {
          const m = line.match(/^out_time_us=(\d+)/);
          if (m) this.progress?.(Math.min(99, +m[1] / (info.durationMs * 10)));
        },
      );
      const result = await stat(temp);
      if (!result.size) throw new Error("输出视频为空");
      await rename(temp, output);
    } catch (error) {
      await unlink(temp).catch(() => {});
      throw error;
    }
  }
}
export function planChunks(
  durationMs: number,
  maxSeconds: number,
  silences: number[],
) {
  const chunks: { startMs: number; endMs: number }[] = [];
  let startMs = 0;
  while (startMs < durationMs) {
    const cap = Math.min(durationMs, startMs + maxSeconds * 1000);
    const near = silences
      .filter((t) => t > cap - 10000 && t <= cap && t > startMs + 1000)
      .at(-1);
    const endMs = cap === durationMs ? cap : near || cap;
    chunks.push({ startMs, endMs });
    startMs = endMs;
  }
  return chunks;
}
