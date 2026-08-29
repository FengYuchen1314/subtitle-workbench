import { readdir, realpath, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  editCue,
  exportSubtitles,
  jobParamsSchema,
  mergeCues,
  parseSubtitles,
  profileSchema,
  splitCue,
  styleSchema,
  validateDocument,
  type JobKind,
  type Profile,
  type SubtitleDocument,
} from "@subtitle/core";
import { catalog, providerDefinition } from "@subtitle/providers";
import { Store, inside } from "./store";
import { FfmpegEngine } from "./media";
import { availableFonts } from "./fonts";
export class Service {
  constructor(readonly store: Store) {}
  async importVideo(path: string, name = basename(path)) {
    const info = await new FfmpegEngine().probe(path);
    const p = this.store.createProject(name, path);
    p.media = info;
    p.mediaName = name;
    this.store.saveProject(p);
    return p;
  }
  async call(method: string, args: Record<string, any> = {}) {
    const s = this.store;
    switch (method) {
      case "media.fonts":
        return availableFonts();
      case "state":
        return {
          projects: s.projects(),
          profiles: s.profiles(),
          jobs: s.jobs(),
        };
      case "catalog":
        return catalog;
      case "profile.save": {
        const parsed = profileSchema.parse(args),
          old = parsed.id ? s.profile(parsed.id) : undefined;
        const definition = providerDefinition(parsed.provider);
        const profile: Profile = {
          ...parsed,
          id: old?.id || crypto.randomUUID(),
          secrets: {
            ...(old?.secrets || {}),
            ...Object.fromEntries(
              Object.entries(parsed.secrets).filter(([, v]) => v),
            ),
          },
          verification: "unverified",
        };
        for (const field of definition.fields)
          if (
            !field.optional &&
            !(field.secret
              ? profile.secrets[field.key]
              : profile.options[field.key])
          )
            throw new Error(`缺少 ${field.label}`);
        s.saveProfile(profile);
        return s.profiles().find((p) => p.id === profile.id);
      }
      case "profile.delete":
        s.deleteProfile(String(args.id));
        return { ok: true };
      case "project.blank":
        return s.createProject(args.name || "字幕项目");
      case "project.rename": {
        const p = s.project(args.id);
        p.name = String(args.name).slice(0, 160);
        s.saveProject(p);
        return p;
      }
      case "subtitle.import": {
        const p = s.project(args.id),
          doc = parseSubtitles(String(args.text));
        validateDocument(doc, p.media?.durationMs);
        doc.revision = p.document.revision + 1;
        doc.language = args.language || "auto";
        p.document = doc;
        s.saveProject(p);
        return p;
      }
      case "subtitle.edit": {
        const p = s.project(args.id);
        if (
          args.expectedRevision !== undefined &&
          args.expectedRevision !== p.document.revision
        )
          throw new Error("字幕已被其他窗口修改，请刷新后重试");
        if (args.translation !== undefined) {
          const c = p.document.cues.find((c) => c.id === args.cueId);
          if (!c) throw new Error("字幕不存在");
          c.translations[args.language] = {
            text: String(args.translation),
            sourceRevision: c.revision,
            provider: "manual",
          };
          p.document.revision++;
        } else {
          const patch: { text?: string; startMs?: number; endMs?: number } = {};
          if (args.patch?.text !== undefined)
            patch.text = String(args.patch.text);
          if (args.patch?.startMs !== undefined)
            patch.startMs = Number(args.patch.startMs);
          if (args.patch?.endMs !== undefined)
            patch.endMs = Number(args.patch.endMs);
          p.document = editCue(p.document, args.cueId, patch);
        }
        validateDocument(p.document, p.media?.durationMs);
        s.saveProject(p);
        return p;
      }
      case "subtitle.split": {
        const p = s.project(args.id);
        p.document = splitCue(p.document, args.cueId, args.at);
        s.saveProject(p);
        return p;
      }
      case "subtitle.merge": {
        const p = s.project(args.id);
        p.document = mergeCues(p.document, args.cueId);
        s.saveProject(p);
        return p;
      }
      case "subtitle.replace": {
        const p = s.project(args.id);
        if (!args.search) throw new Error("查找内容不能为空");
        for (const c of p.document.cues)
          if (c.text.includes(args.search)) {
            c.text = c.text
              .split(args.search)
              .join(String(args.replacement || ""));
            c.revision++;
          }
        p.document.revision++;
        s.saveProject(p);
        return p;
      }
      case "subtitle.export": {
        const p = s.project(args.id);
        if (!["srt", "vtt", "ass"].includes(args.format))
          throw new Error("不支持的导出格式");
        return exportSubtitles(
          p.document,
          args.format,
          args.mode,
          args.language,
          p.style,
        );
      }
      case "style.save": {
        const p = s.project(args.id);
        p.style = styleSchema.parse(args.style);
        s.saveProject(p);
        return p;
      }
      case "job.create": {
        if (!["transcribe", "translate", "render"].includes(args.kind))
          throw new Error("无效任务类型");
        const params = jobParamsSchema.parse(args.params || {}),
          p = s.project(args.id);
        if (args.kind !== "render") {
          const profile = s.profile(params.profileId || ""),
            expected = args.kind === "transcribe" ? "asr" : "translation";
          if (providerDefinition(profile.provider).category !== expected)
            throw new Error("供应商类型不匹配");
        }
        if (args.kind !== "transcribe" && !p.document.cues.length)
          throw new Error("请先生成或导入字幕");
        if (args.kind === "render")
          exportSubtitles(
            p.document,
            "ass",
            params.mode || "source",
            params.targetLanguage,
            p.style,
          );
        return s.createJob(p.id, args.kind as JobKind, params);
      }
      case "job.cancel":
        return s.updateJob(args.id, {
          status: "cancelled",
          phase: "已请求取消",
        });
      case "job.retry": {
        const job = s.job(args.id);
        if (["queued", "running"].includes(job.status))
          throw new Error("任务仍在执行");
        const cp = s.checkpoint(job.id);
        if (args.confirmPaidRetry) {
          for (const c of cp.chunks || [])
            if (c.state === "submitting") c.state = "new";
          for (const [key, value] of Object.entries(cp.batches || {}))
            if ((value as any).state === "submitting") delete cp.batches[key];
        }
        s.saveCheckpoint(job.id, cp);
        return s.updateJob(job.id, {
          status: "queued",
          error: undefined,
          phase: "等待重试",
        });
      }
      case "job.apply": {
        const job = s.job(args.id),
          cp = s.checkpoint(job.id);
        if (!cp.result) throw new Error("任务没有可应用结果");
        const p = s.project(job.projectId);
        const doc = cp.result as SubtitleDocument;
        validateDocument(doc, p.media?.durationMs);
        doc.revision = p.document.revision + 1;
        p.document = doc;
        s.saveProject(p);
        s.updateJob(job.id, {
          status: "completed",
          phase: "结果已应用",
          error: undefined,
        });
        return p;
      }
      case "library.list": {
        const root = process.env.SUBTITLE_MEDIA_ROOT;
        if (!root) return [];
        const entries = await readdir(root, { withFileTypes: true });
        return entries
          .filter(
            (e) => e.isFile() && /\.(mp4|mkv|mov|webm|avi|m4v)$/i.test(e.name),
          )
          .map((e) => e.name);
      }
      case "library.import": {
        const root = process.env.SUBTITLE_MEDIA_ROOT;
        if (!root) throw new Error("未配置媒体目录");
        const actualRoot = await realpath(root),
          path = await realpath(
            inside(actualRoot, join(actualRoot, String(args.name))),
          );
        inside(actualRoot, path);
        if (!(await stat(path)).isFile()) throw new Error("不是视频文件");
        return this.importVideo(path);
      }
      default:
        throw new Error("未知操作");
    }
  }
}
