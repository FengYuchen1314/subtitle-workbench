import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  combineTranscripts,
  type Job,
  type SubtitleDocument,
} from "@subtitle/core";
import {
  CloudAsr,
  CloudStorage,
  CloudTranslation,
  FetchTransport,
  ProviderError,
  providerDefinition,
} from "@subtitle/providers";
import { Store } from "./store";
import { FfmpegEngine, planChunks } from "./media";

const pause = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      reject(new Error("任务已取消"));
    }
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
export async function executeJob(store: Store, job: Job) {
  const abort = new AbortController(),
    signal = abort.signal,
    folder = join(store.root, "jobs", job.id);
  await mkdir(folder, { recursive: true });
  let checkpoint = store.checkpoint(job.id);
  const save = () => store.saveCheckpoint(job.id, checkpoint);
  const report = (phase: string, progress: number) => {
    if (store.job(job.id).status !== "cancelled")
      store.updateJob(job.id, { phase, progress });
  };
  const heartbeat = setInterval(() => {
    if (store.job(job.id).status === "cancelled") abort.abort();
    else store.updateJob(job.id, {});
  }, 2000);
  const applyResult = (document: SubtitleDocument) => {
    if (signal.aborted || store.job(job.id).status === "cancelled")
      throw new Error("任务已取消");
    checkpoint.result = document;
    save();
    const current = store.project(job.projectId);
    if (current.document.revision !== checkpoint.document.revision)
      throw new ProviderError(
        "任务期间字幕已修改；结果已保存，可在任务页手动应用",
        "REVISION_CONFLICT",
        true,
      );
    document.revision = current.document.revision + 1;
    current.document = document;
    try {
      store.saveProject(current, checkpoint.document.revision);
    } catch {
      throw new ProviderError(
        "字幕版本冲突，结果已保存，可手动应用",
        "REVISION_CONFLICT",
        true,
      );
    }
  };
  try {
    const project = store.project(job.projectId);
    if (job.kind === "render") {
      report("正在烧录字幕", 0);
      const engine = new FfmpegEngine(signal, (n) => report("正在烧录字幕", n));
      await engine.render(
        store.mediaPath(job.projectId),
        join(folder, "video.mp4"),
        checkpoint.document,
        checkpoint.style,
        job.params,
      );
      if (signal.aborted) throw new Error("任务已取消");
      store.updateJob(job.id, { outputName: "video.mp4" });
    } else {
      const profile = store.profile(job.params.profileId || ""),
        http = new FetchTransport(profile.allowPrivateEndpoint, signal);
      if (job.kind === "translate") {
        const document: SubtitleDocument = structuredClone(checkpoint.document),
          target = job.params.targetLanguage || "";
        const engine = new CloudTranslation(profile, http);
        checkpoint.batches ||= {};
        for (let i = 0; i < document.cues.length; i += 40) {
          const batch = document.cues.slice(i, i + 40),
            key = String(i);
          report("翻译字幕", (i / document.cues.length) * 100);
          if (checkpoint.batches[key]?.state === "submitting")
            throw new ProviderError(
              "上次翻译提交结果未知；请确认可能产生的重复费用后重试",
              "UNKNOWN_SUBMISSION",
              true,
            );
          if (!checkpoint.batches[key]) {
            checkpoint.batches[key] = { state: "submitting" };
            save();
            const translated = await engine.translate(
              batch.map((c) => ({ id: c.id, text: c.text })),
              document.language,
              target,
              document.cues
                .slice(Math.max(0, i - 3), i + 43)
                .map((c) => c.text)
                .join("\n"),
              job.params.glossary || "",
            );
            checkpoint.batches[key] = { state: "complete", translated };
            save();
          }
          for (const c of batch)
            c.translations[target] = {
              text: checkpoint.batches[key].translated[c.id],
              sourceRevision: c.revision,
              provider: profile.provider,
            };
        }
        applyResult(document);
      } else {
        if (!project.media?.audioTracks.length)
          throw new Error("视频没有音轨；可导入字幕直接烧录");
        const definition = providerDefinition(profile.provider),
          engine = new FfmpegEngine(signal);
        const audio = join(folder, "audio.wav");
        if (!checkpoint.extracted) {
          report("提取音频", 1);
          await engine.extract(
            store.mediaPath(job.projectId),
            audio,
            job.params.audioTrack || 0,
          );
          checkpoint.extracted = true;
          save();
        }
        if (!checkpoint.chunks) {
          report("分析静音与分片", 3);
          const silences = await engine.silence(audio);
          checkpoint.chunks = planChunks(
            project.media.durationMs,
            definition.maxChunkSeconds || 300,
            silences,
          ).map((c) => ({ ...c, state: "new" }));
          save();
        }
        const needsStorage =
          definition.input !== "file" ||
          (profile.provider === "azure" && profile.model === "batch");
        const storageProfile = job.params.storageId
          ? store.profile(job.params.storageId)
          : undefined;
        if (needsStorage && !storageProfile)
          throw new Error("该接口需要配置音频临时存储");
        if (
          definition.input === "gcs" &&
          storageProfile?.provider !== "storage-gcs"
        )
          throw new Error("Google ASR 必须使用 GCS 存储");
        if (
          definition.input === "s3" &&
          storageProfile?.provider !== "storage-s3"
        )
          throw new Error("AWS ASR 必须使用 S3 存储");
        const storage = storageProfile
          ? new CloudStorage(
              storageProfile,
              new FetchTransport(storageProfile.allowPrivateEndpoint, signal),
            )
          : undefined;
        const asr = new CloudAsr(profile, http);
        for (let i = 0; i < checkpoint.chunks.length; i++) {
          const c = checkpoint.chunks[i];
          if (signal.aborted) throw new Error("任务已取消");
          report(
            `识别音频 ${i + 1} / ${checkpoint.chunks.length}`,
            5 + (90 * i) / checkpoint.chunks.length,
          );
          if (c.state === "complete") continue;
          if (c.state === "submitting")
            throw new ProviderError(
              "上次提交结果未知，已停止自动重发以避免重复扣费。请核对厂商订单后重试。",
              "UNKNOWN_SUBMISSION",
              true,
            );
          const path = join(folder, `audio-${i}.wav`);
          if (c.state === "new") {
            await engine.chunk(audio, path, c.startMs, c.endMs);
            if (
              needsStorage &&
              (!c.staged || c.staged.expiresAt < Date.now() + 3600000)
            ) {
              c.staged = await storage!.put(
                path,
                `subtitle/${job.id}/${i}.wav`,
              );
              save();
            }
            c.state = "submitting";
            c.requestId = crypto.randomUUID();
            save();
            const response = await asr.submit({
              path,
              durationMs: c.endMs - c.startMs,
              requestId: c.requestId,
              language: job.params.language || "auto",
              url: c.staged?.url,
              objectUri: c.staged?.uri,
            });
            if (response.type === "complete") {
              c.transcript = response.transcript;
              c.state = "complete";
            } else {
              c.remote = response;
              c.state = "pending";
              c.submittedAt = Date.now();
            }
            save();
          }
          let delay = 4000;
          while (c.state === "pending") {
            if (profile.provider === "iflytek" && (c.polls || 0) >= 95)
              throw new ProviderError(
                "讯飞查询接近次数上限，请到厂商控制台核对订单",
                "POLL_LIMIT",
                true,
              );
            if (Date.now() - c.submittedAt > 36 * 3600000)
              throw new ProviderError(
                "远端任务超过等待窗口，请核对任务状态",
                "TIMEOUT",
                true,
              );
            await pause(delay, signal);
            try {
              c.polls = (c.polls || 0) + 1;
              save();
              const response = await asr.poll(c.remote);
              if (response.type === "complete") {
                c.transcript = response.transcript;
                c.state = "complete";
                save();
              }
              delay = Math.min(60000, Math.round(delay * 1.3));
            } catch (error) {
              if (
                error instanceof ProviderError &&
                ["429", "NETWORK"].includes(error.code)
              ) {
                delay = 60000;
                continue;
              }
              throw error;
            }
          }
        }
        applyResult(
          combineTranscripts(
            checkpoint.chunks.map((c: any) => ({
              offsetMs: c.startMs,
              transcript: c.transcript,
            })),
            project.media.durationMs,
          ),
        );
      }
    }
    if (signal.aborted || store.job(job.id).status === "cancelled")
      throw new Error("任务已取消");
    store.updateJob(job.id, {
      status: "completed",
      progress: 100,
      phase: "已完成",
      error: undefined,
    });
  } catch (error) {
    const cancelled =
      signal.aborted || store.job(job.id).status === "cancelled";
    const message = error instanceof Error ? error.message : "任务失败";
    store.updateJob(job.id, {
      status: cancelled
        ? "cancelled"
        : error instanceof ProviderError && error.uncertain
          ? "attention"
          : "failed",
      phase: cancelled ? "已取消" : "需要处理",
      error: message.slice(0, 1000),
    });
  } finally {
    clearInterval(heartbeat);
  }
}
export async function cleanStaged(store: Store) {
  for (const job of store.jobs()) {
    if (job.status === "running" || job.status === "queued") continue;
    const checkpoint = store.checkpoint(job.id);
    let changed = false;
    for (const c of checkpoint.chunks || []) {
      if (
        !c.staged ||
        c.cleaned ||
        (job.status !== "completed" && c.staged.expiresAt > Date.now())
      )
        continue;
      try {
        const profile = store.profile(job.params.storageId || "");
        await new CloudStorage(profile).remove(c.staged.key);
        c.cleaned = true;
        changed = true;
      } catch {
        checkpoint.cleanupWarning = "临时音频清理失败，将重试；请检查存储配置";
        changed = true;
      }
    }
    if (changed) store.saveCheckpoint(job.id, checkpoint);
  }
}
export async function runWorker(store: Store, signal: AbortSignal) {
  let ticks = 0;
  while (!signal.aborted) {
    const job = store.claim();
    if (job) await executeJob(store, job);
    else await pause(1000, signal).catch(() => {});
    if (++ticks % 30 === 0) await cleanStaged(store);
  }
}
