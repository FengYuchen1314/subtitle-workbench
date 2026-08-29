import { app, type BrowserWindow } from "electron";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Service, FfmpegEngine } from "@subtitle/runtime";
import type { Job } from "@subtitle/core";
export async function runSmoke(
  service: Service,
  window: BrowserWindow,
  root: string,
  loaded: Promise<void>,
) {
  await loaded;
  const input = process.env.SUBTITLE_SMOKE_MEDIA;
  if (!input) throw new Error("SUBTITLE_SMOKE_MEDIA required");
  const p = await service.importVideo(input, "Electron 集成验证");
  await service.call("subtitle.import", {
    id: p.id,
    text: "1\n00:00:00,500 --> 00:00:02,500\n桌面字幕测试\n",
  });
  const project = service.store.project(p.id);
  project.document.cues[0].translations.en = {
    text: "Desktop subtitles",
    sourceRevision: 1,
    provider: "manual",
  };
  service.store.saveProject(project);
  const job = (await service.call("job.create", {
    id: p.id,
    kind: "render",
    params: { mode: "bilingual", targetLanguage: "en" },
  })) as Job;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const current = service.store.job(job.id);
    if (current.status === "failed" || current.status === "attention")
      throw new Error(current.error);
    if (current.status === "completed") break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (service.store.job(job.id).status !== "completed")
    throw new Error("Native worker did not finish in 60 seconds");
  const output = await new FfmpegEngine().probe(
    join(root, "jobs", job.id, "video.mp4"),
  );
  const renderer = await window.webContents.executeJavaScript(
    "({text:document.body.innerText,node:typeof window.require,bridge:typeof window.subtitle})",
  );
  if (
    renderer.node !== "undefined" ||
    renderer.bridge !== "object" ||
    !renderer.text.includes("视频项目")
  )
    throw new Error("Renderer isolation or UI startup failed");
  writeFileSync(
    join(app.getPath("userData"), "smoke-result.json"),
    JSON.stringify(
      {
        ok: true,
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        node: process.versions.node,
        rendererIsolated: true,
        workerRender: true,
        durationMs: output.durationMs,
        audioCodec: output.audioCodec,
        profiles: service.store.profiles().length,
      },
      null,
      2,
    ),
  );
}
