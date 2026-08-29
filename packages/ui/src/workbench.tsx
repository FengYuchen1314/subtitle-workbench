"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Captions,
  Check,
  ChevronRight,
  CircleHelp,
  Film,
  FolderOpen,
  Globe2,
  Languages,
  LoaderCircle,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Split,
  Upload,
  X,
  ListVideo,
  Play,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { catalog } from "@subtitle/providers/catalog";
import {
  cueLines,
  parseTimestamp,
  timestamp,
  type AppState,
  type Cue,
  type Gateway,
  type JobParams,
  type OutputMode,
  type Project,
  type PublicProfile,
} from "@subtitle/core";
import { selectFile } from "./gateway";
const initial: AppState = { projects: [], profiles: [], jobs: [] };
const duration = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
const languages = [
  ["zh-CN", "简体中文"],
  ["zh-TW", "繁體中文"],
  ["en", "English"],
  ["ja", "日本語"],
  ["ko", "한국어"],
  ["fr", "Français"],
  ["de", "Deutsch"],
  ["es", "Español"],
  ["pt", "Português"],
  ["ru", "Русский"],
  ["ar", "العربية"],
  ["hi", "हिन्दी"],
];
export function Workbench({ gateway }: { gateway: Gateway }) {
  const [auth, setAuth] = useState<{
      authenticated: boolean;
      configured: boolean;
      setupAllowed?: boolean;
    } | null>(null),
    [state, setState] = useState<AppState>(initial);
  const [page, setPage] = useState<"projects" | "settings" | "jobs">(
      "projects",
    ),
    [active, setActive] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(""),
    [upload, setUpload] = useState(0);
  const [showProfile, setShowProfile] = useState<PublicProfile | "new" | null>(
      null,
    ),
    [query, setQuery] = useState("");
  const project = state.projects.find((p) => p.id === active);
  const refresh = useCallback(async () => {
    const next = await gateway.call<AppState>("state");
    setState(next);
  }, [gateway]);
  useEffect(() => {
    gateway
      .call<any>("auth.status")
      .then(setAuth)
      .catch((e) => setMessage(e.message));
  }, [gateway]);
  useEffect(() => {
    if (!auth?.authenticated) return;
    refresh().catch((e) => setMessage(e.message));
    const timer = setInterval(() => refresh().catch(() => {}), 4000);
    return () => clearInterval(timer);
  }, [auth, refresh]);
  async function run<T>(
    label: string,
    fn: () => Promise<T>,
  ): Promise<T | undefined> {
    setBusy(label);
    setMessage("");
    try {
      const result = await fn();
      await refresh();
      return result;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy("");
    }
  }
  async function importVideo() {
    const p = await run("import", () => gateway.pickVideo(setUpload));
    if (p) {
      setActive(p.id);
      setPage("projects");
    }
  }
  const call = (method: string, args: Record<string, unknown>) =>
    run(method, () => gateway.call(method, args));
  if (!auth?.authenticated)
    return (
      <div className="login">
        <div className="login-brand">
          <Captions size={42} />
          <h1>字幕工作台</h1>
          <p>你的视频，你的字幕。</p>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            setBusy("login");
            try {
              await gateway.call(
                auth?.configured ? "auth.login" : "auth.setup",
                {
                  password: data.get("password"),
                  setupToken: data.get("token"),
                },
              );
              setAuth({ authenticated: true, configured: true });
              setMessage("");
            } catch (error) {
              setMessage((error as Error).message);
            } finally {
              setBusy("");
            }
          }}
        >
          <h2>{auth?.configured ? "欢迎回来" : "初始化工作台"}</h2>
          <p className="muted">
            {auth?.configured
              ? "输入管理员密码，继续处理字幕。"
              : "先在终端运行 npm run setup 设置管理员；或使用部署时配置的初始化令牌。"}
          </p>
          {!auth?.configured && (
            <label>
              初始化令牌
              <input name="token" type="password" required autoComplete="off" />
            </label>
          )}
          <label>
            管理员密码
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              minLength={auth?.configured ? 1 : 12}
              required
            />
          </label>
          <button
            className="primary"
            disabled={!!busy || (!auth?.configured && !auth?.setupAllowed)}
          >
            {busy ? <LoaderCircle className="spin" size={18} /> : null}
            {auth?.configured ? "登录工作台" : "创建管理员"}
          </button>
          {message && <p className="error">{message}</p>}
          <div className="privacy">
            <ShieldCheck size={15} /> 数据保存在你自己的设备或服务器
          </div>
        </form>
      </div>
    );
  return (
    <div className="app">
      <aside className="sidebar">
        <a
          className="brand"
          onClick={() => {
            setActive("");
            setPage("projects");
          }}
        >
          <span className="brand-icon">
            <Captions size={24} />
          </span>
          <span>
            字幕工作台<small>SUBTITLE WORKBENCH</small>
          </span>
        </a>
        <div className="workspace-label">我的工作空间</div>
        <nav>
          <button
            className={page === "projects" ? "selected" : ""}
            onClick={() => {
              setPage("projects");
              setActive("");
            }}
          >
            <Film size={19} />
            视频项目<span>{state.projects.length}</span>
          </button>
          <button
            className={page === "jobs" ? "selected" : ""}
            onClick={() => setPage("jobs")}
          >
            <ListVideo size={19} />
            任务队列
            {state.jobs.some((j) =>
              ["running", "queued"].includes(j.status),
            ) && <i className="status-dot" />}
          </button>
          <button
            className={page === "settings" ? "selected" : ""}
            onClick={() => setPage("settings")}
          >
            <Settings2 size={19} />
            模型与存储
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="local-card">
            <ShieldCheck size={21} />
            <div>
              由你掌控
              <small>
                {gateway.platform === "web"
                  ? "自托管 · 数据在服务器"
                  : "独立运行 · 原视频留在本机"}
              </small>
            </div>
          </div>
          <div className="version">
            <span>工作台 v0.1</span>
            <span>{gateway.platform.toUpperCase()}</span>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <span className="breadcrumb">工作空间</span>
            <ChevronRight size={14} />
            {page === "settings"
              ? "模型与存储"
              : page === "jobs"
                ? "任务队列"
                : project
                  ? project.name
                  : "视频项目"}
          </div>
          <div className="topbar-right">
            <span className="connection">
              <i />
              {gateway.platform === "web" ? "自托管服务" : "本机工作台"}
            </span>
            {gateway.platform === "web" && (
              <button
                className="text-button"
                onClick={async () => {
                  await gateway.call("auth.logout");
                  setAuth({ ...auth, authenticated: false });
                }}
              >
                退出
              </button>
            )}
          </div>
        </header>
        {message && (
          <div role="alert" className="notice error">
            <CircleHelp size={18} />
            <span>{message}</span>
            <button aria-label="关闭提示" onClick={() => setMessage("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {page === "projects" && !project && (
          <section className="dashboard">
            <div className="page-heading">
              <div>
                <div className="eyebrow">CREATE WITH CLARITY</div>
                <h1>
                  给视频，加上好字幕<span>。</span>
                </h1>
                <p>识别原声，翻译语言。先把字幕做好，再决定如何呈现。</p>
              </div>
              <button
                className="primary"
                onClick={importVideo}
                disabled={!!busy}
              >
                <Plus size={18} />
                新建视频项目
              </button>
            </div>
            <div className="hero">
              <div className="hero-copy">
                <span className="pill">一个流程，三种表达</span>
                <h2>
                  跨过语言，
                  <br />
                  保留每句话的温度。
                </h2>
                <p>原文字幕 · 译文字幕 · 双语字幕</p>
                <button onClick={importVideo} disabled={!!busy}>
                  {busy === "import" ? (
                    <LoaderCircle className="spin" size={19} />
                  ) : (
                    <Upload size={19} />
                  )}{" "}
                  {busy === "import"
                    ? `正在导入 ${upload}%`
                    : "选择视频，开始制作"}
                  <ArrowRight size={18} />
                </button>
                <small>
                  {gateway.platform === "web"
                    ? "支持大文件分块上传，断线后重新选择同一文件即可继续"
                    : "直接读取本机视频，只将音频发送给你选择的模型"}
                </small>
              </div>
              <div className="hero-art" aria-hidden="true">
                <div className="frame-note">THE POWER OF A FEW WORDS</div>
                <div className="art-orb" />
                <div className="art-orb second" />
                <div className="sample-caption">
                  <span>世界很大，故事值得被听见。</span>
                  <small>A world of stories, ready to be heard.</small>
                </div>
                <div className="frame-timeline">
                  <Play size={12} fill="currentColor" />
                  <span />
                  <b>00:24</b>
                </div>
              </div>
            </div>
            <div className="section-heading">
              <h2>
                最近的项目 <span>{state.projects.length}</span>
              </h2>
              <div className="search">
                <Search size={16} />
                <input
                  aria-label="搜索项目"
                  placeholder="搜索项目"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </div>
            <div className="project-grid">
              {state.projects
                .filter((p) =>
                  p.name.toLowerCase().includes(query.toLowerCase()),
                )
                .map((p) => (
                  <button
                    className="project-card"
                    key={p.id}
                    onClick={() => setActive(p.id)}
                  >
                    <div className="project-thumb">
                      <Film size={36} />
                      <span>{duration(p.media?.durationMs || 0)}</span>
                    </div>
                    <div className="project-card-body">
                      <strong>{p.name}</strong>
                      <small>
                        {p.document.cues.length
                          ? `${p.document.cues.length} 条字幕`
                          : "等待识别或导入字幕"}
                        <span>
                          {new Date(p.updatedAt).toLocaleDateString("zh-CN")}
                        </span>
                      </small>
                    </div>
                  </button>
                ))}
              <button
                className="new-card"
                onClick={importVideo}
                disabled={!!busy}
              >
                <span>
                  <Plus size={24} />
                </span>
                <strong>添加一个视频</strong>
                <small>MP4、MOV、MKV 等视频格式</small>
              </button>
            </div>
            <div className="workflow-hint">
              <span>01 识别与编辑</span>
              <ChevronRight size={15} />
              <span>02 翻译与校对</span>
              <ChevronRight size={15} />
              <span>03 导出字幕或烧录视频</span>
            </div>
            {gateway.platform === "web" && (
              <button
                className="text-button"
                onClick={async () => {
                  const files = await run("library", () =>
                    gateway.call<string[]>("library.list"),
                  );
                  if (!files?.length) {
                    setMessage("媒体目录为空或未配置 SUBTITLE_MEDIA_ROOT");
                    return;
                  }
                  const name = prompt(
                    "选择媒体目录中的文件（输入完整文件名）：\n" +
                      files.join("\n"),
                  );
                  if (name) {
                    const p = await run("library", () =>
                      gateway.call<Project>("library.import", { name }),
                    );
                    if (p) setActive(p.id);
                  }
                }}
              >
                <FolderOpen size={16} />
                从服务器媒体目录选择
              </button>
            )}
          </section>
        )}
        {page === "projects" && project && (
          <Editor
            key={project.id}
            project={project}
            profiles={state.profiles}
            gateway={gateway}
            busy={!!busy}
            onBack={() => setActive("")}
            call={call}
            onError={setMessage}
            onJobs={() => setPage("jobs")}
          />
        )}
        {page === "settings" && (
          <section className="dashboard">
            <div className="page-heading">
              <div>
                <div className="eyebrow">YOUR MODELS, YOUR CHOICE</div>
                <h1>模型与存储</h1>
                <p>识别、翻译分别配置。密钥只保存在当前设备或自托管服务中。</p>
              </div>
              <button className="primary" onClick={() => setShowProfile("new")}>
                <Plus size={18} />
                添加配置
              </button>
            </div>
            <div className="info-banner">
              <ShieldCheck size={20} />
              <span>
                所有云服务均使用你自己的账号。新配置标记为「未联调」，不会自动调用收费接口，也不会自动切换厂商。
              </span>
            </div>
            {["asr", "translation", "storage"].map((category) => (
              <section key={category} className="settings-group">
                <h2>
                  {category === "asr"
                    ? "语音识别 ASR"
                    : category === "translation"
                      ? "字幕翻译"
                      : "音频临时存储"}
                </h2>
                <div className="profile-grid">
                  {state.profiles
                    .filter(
                      (p) =>
                        catalog.find((d) => d.id === p.provider)?.category ===
                        category,
                    )
                    .map((p) => (
                      <div className="profile-card" key={p.id}>
                        <div className="profile-card-heading">
                          <span className="profile-icon">
                            {category === "asr" ? (
                              <Captions />
                            ) : category === "translation" ? (
                              <Languages />
                            ) : (
                              <Globe2 />
                            )}
                          </span>
                          <button
                            title="删除配置"
                            onClick={() =>
                              confirm(
                                "删除这项配置？正在执行的任务可能受影响。",
                              ) && call("profile.delete", { id: p.id })
                            }
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                        <h3>{p.name}</h3>
                        <p>
                          {catalog.find((d) => d.id === p.provider)?.name} ·{" "}
                          {p.model}
                        </p>
                        <footer>
                          <span className="badge">未联调</span>
                          <button onClick={() => setShowProfile(p)}>
                            编辑配置
                            <ArrowRight size={14} />
                          </button>
                        </footer>
                      </div>
                    ))}
                  <button
                    className="profile-add"
                    onClick={() => setShowProfile("new")}
                  >
                    <Plus size={20} />
                    添加
                    {category === "asr"
                      ? "识别"
                      : category === "translation"
                        ? "翻译"
                        : "存储"}
                    配置
                  </button>
                </div>
              </section>
            ))}
            <div className="provider-wall">
              <h3>已提供独立适配的服务</h3>
              <p>
                {catalog
                  .filter(
                    (p) => p.category === "asr" && !p.id.startsWith("custom"),
                  )
                  .map((p) => p.name)
                  .join(" / ")}
              </p>
              <small>
                模型语言、时间戳及区域能力以厂商和账号权限为准。自定义接口须返回真实时间戳。
              </small>
            </div>
          </section>
        )}
        {page === "jobs" && (
          <section className="dashboard">
            <div className="page-heading">
              <div>
                <div className="eyebrow">ONE STEP AT A TIME</div>
                <h1>任务队列</h1>
                <p>
                  每个阶段独立执行。关闭页面后，服务器或原生处理服务继续工作。
                </p>
              </div>
              <button className="secondary" onClick={() => refresh()}>
                <RefreshCw size={17} />
                刷新
              </button>
            </div>
            {!state.jobs.length ? (
              <div className="empty">
                <ListVideo size={42} />
                <h3>还没有任务</h3>
                <p>打开一个视频项目，开始识别、翻译或烧录。</p>
              </div>
            ) : (
              state.jobs.map((job) => (
                <article className="job-card" key={job.id}>
                  <div className="job-icon">
                    {job.kind === "transcribe" ? (
                      <Captions />
                    ) : job.kind === "translate" ? (
                      <Languages />
                    ) : (
                      <Film />
                    )}
                  </div>
                  <div className="job-details">
                    <h3>
                      {job.kind === "transcribe"
                        ? "生成原文字幕"
                        : job.kind === "translate"
                          ? "翻译字幕"
                          : "烧录字幕视频"}
                      <span className={`badge ${job.status}`}>
                        {job.status === "completed"
                          ? "已完成"
                          : job.status === "running"
                            ? "处理中"
                            : job.status === "queued"
                              ? "排队中"
                              : job.status === "cancelled"
                                ? "已取消"
                                : job.status === "attention"
                                  ? "待确认"
                                  : "失败"}
                      </span>
                    </h3>
                    <p>
                      {state.projects.find((p) => p.id === job.projectId)?.name}
                    </p>
                    <div className="progress">
                      <i style={{ width: `${job.progress}%` }} />
                    </div>
                    <small>
                      {job.phase} · {Math.round(job.progress)}%
                    </small>
                    {job.error && <p className="error">{job.error}</p>}
                  </div>
                  <div className="job-actions">
                    {["queued", "running"].includes(job.status) ? (
                      <button
                        className="secondary"
                        onClick={() => call("job.cancel", { id: job.id })}
                      >
                        取消
                      </button>
                    ) : ["attention", "failed", "cancelled"].includes(
                        job.status,
                      ) ? (
                      <>
                        <button
                          className="secondary"
                          onClick={() => {
                            if (
                              confirm(
                                "将从保存的进度重试。若上次提交结果未知，重新提交可能再次扣费；请先检查厂商订单。",
                              )
                            )
                              call("job.retry", {
                                id: job.id,
                                confirmPaidRetry: true,
                              });
                          }}
                        >
                          重试
                        </button>
                        {job.kind !== "render" && (
                          <button
                            className="text-button"
                            onClick={() =>
                              confirm("使用此任务保存的结果覆盖当前字幕？") &&
                              call("job.apply", { id: job.id })
                            }
                          >
                            应用字幕结果
                          </button>
                        )}
                      </>
                    ) : job.outputName ? (
                      <a
                        className="primary"
                        href={gateway.outputUrl(job.id)}
                        onClick={
                          gateway.platform === "web"
                            ? undefined
                            : (event) => {
                                event.preventDefault();
                                void call("output.save", { id: job.id });
                              }
                        }
                        download
                      >
                        <ArrowDownToLine size={16} />
                        保存视频
                      </a>
                    ) : (
                      <button
                        className="secondary"
                        onClick={() => {
                          setActive(job.projectId);
                          setPage("projects");
                        }}
                      >
                        查看字幕
                      </button>
                    )}
                  </div>
                </article>
              ))
            )}
          </section>
        )}
      </main>
      {showProfile && (
        <ProfileDialog
          profile={showProfile === "new" ? undefined : showProfile}
          close={() => setShowProfile(null)}
          save={async (args) => {
            const result = await call("profile.save", args);
            if (result) setShowProfile(null);
          }}
        />
      )}
    </div>
  );
}

function Editor({
  project,
  profiles,
  gateway,
  busy,
  onBack,
  call,
  onError,
  onJobs,
}: {
  project: Project;
  profiles: PublicProfile[];
  gateway: Gateway;
  busy: boolean;
  onBack: () => void;
  call: (method: string, args: Record<string, unknown>) => Promise<unknown>;
  onError: (message: string) => void;
  onJobs: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [fonts, setFonts] = useState<{ checked: boolean; families: string[] }>({
    checked: false,
    families: [],
  });
  useEffect(() => {
    let active = true;
    gateway
      .call<{ checked: boolean; families: string[] }>("media.fonts")
      .then((result) => {
        if (active) setFonts(result);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [gateway]);
  const [time, setTime] = useState(0),
    [target, setTarget] = useState("en"),
    [source, setSource] = useState("auto"),
    [mode, setMode] = useState<OutputMode>("bilingual"),
    [asr, setAsr] = useState(""),
    [translator, setTranslator] = useState(""),
    [storage, setStorage] = useState(""),
    [format, setFormat] = useState("srt"),
    [tab, setTab] = useState<"process" | "style">("process"),
    [scroll, setScroll] = useState(0),
    [glossary, setGlossary] = useState(""),
    [track, setTrack] = useState(0),
    [resolution, setResolution] = useState(
      gateway.platform === "android" ? "720" : "",
    );
  const activeCue = project.document.cues.find(
    (c) => c.startMs <= time && c.endMs > time,
  );
  let preview: string[] = [];
  if (activeCue)
    try {
      preview = cueLines(
        activeCue,
        mode,
        target,
        project.style.translationFirst,
      );
    } catch {
      preview = [activeCue.text, "（译文尚未生成或已过期）"];
    }
  const choices = (category: string) =>
    profiles.filter(
      (p) => catalog.find((d) => d.id === p.provider)?.category === category,
    );
  const start = Math.max(0, Math.floor(scroll / 152) - 2),
    visible = project.document.cues.slice(start, start + 12);
  const job = async (kind: string) => {
    const params: JobParams = {
      profileId: kind === "transcribe" ? asr : translator,
      storageId: storage || undefined,
      language: source,
      targetLanguage: target,
      mode,
      glossary,
      audioTrack: track,
      resolution: resolution ? Number(resolution) : undefined,
    };
    const result = await call("job.create", { id: project.id, kind, params });
    if (result) onJobs();
  };
  const field = (
    category: string,
    value: string,
    setter: (value: string) => void,
  ) => (
    <select value={value} onChange={(e) => setter(e.target.value)}>
      <option value="">
        选择
        {category === "asr"
          ? "识别"
          : category === "translation"
            ? "翻译"
            : "存储"}
        配置
      </option>
      {choices(category).map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
  async function importText() {
    try {
      const file = await selectFile(".srt,.vtt");
      if (file)
        await call("subtitle.import", {
          id: project.id,
          text: await file.text(),
          language: source,
        });
    } catch (error) {
      onError((error as Error).message);
    }
  }
  return (
    <section className="editor">
      <div className="editor-heading">
        <div>
          <button className="back" onClick={onBack}>
            <ArrowLeft size={16} />
            全部项目
          </button>
          <h1>{project.name}</h1>
          <p>
            {project.media
              ? `${project.media.width} × ${project.media.height} · ${duration(project.media.durationMs)}`
              : "字幕文档"}
            <span>修订 {project.document.revision}</span>
          </p>
        </div>
        <div className="heading-actions">
          <button className="secondary" onClick={importText}>
            <Upload size={16} />
            导入字幕
          </button>
          <select
            aria-label="字幕导出格式"
            value={format}
            onChange={(e) => setFormat(e.target.value)}
          >
            {["srt", "vtt", "ass"].map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
          <button
            className="primary"
            disabled={!project.document.cues.length || busy}
            onClick={async () => {
              const text = await call("subtitle.export", {
                id: project.id,
                format,
                mode,
                language: target,
              });
              if (typeof text === "string")
                await gateway.saveText(`${project.name}.${format}`, text);
            }}
          >
            <ArrowDownToLine size={17} />
            导出字幕
          </button>
        </div>
      </div>
      <div className="editor-grid">
        <div className="editing-main">
          <div className="video-stage">
            {project.media ? (
              <video
                ref={video}
                src={gateway.mediaUrl(project.id)}
                controls
                onTimeUpdate={() =>
                  setTime((video.current?.currentTime || 0) * 1000)
                }
                onError={() =>
                  onError(
                    "当前播放器无法解码此视频；可尝试常见的 H.264 MP4 格式。",
                  )
                }
              />
            ) : (
              <div className="video-placeholder">
                <Film size={54} />
                当前项目未关联视频
              </div>
            )}
            <div
              className={`preview-captions ${project.style.position}`}
              style={{
                fontSize: `clamp(14px, ${project.style.fontSize / 24}vw, ${project.style.fontSize}px)`,
                color: project.style.color,
                marginBottom: project.style.margin / 4,
                background: project.style.background ? "#0009" : undefined,
                textShadow: `0 1px ${project.style.outlineWidth * 2}px ${project.style.outlineColor}`,
              }}
            >
              {preview.map((line, i) => (
                <div
                  key={i}
                  style={{
                    color:
                      mode === "translation" ||
                      (mode === "bilingual" &&
                        (i === 0) === project.style.translationFirst)
                        ? project.style.translationColor
                        : project.style.color,
                  }}
                >
                  {line}
                </div>
              ))}
            </div>
          </div>
          <div className="caption-toolbar">
            <div className="segmented">
              {(
                [
                  ["source", "原文"],
                  ["translation", "译文"],
                  ["bilingual", "双语"],
                ] as const
              ).map(([key, label]) => (
                <button
                  className={mode === key ? "active" : ""}
                  key={key}
                  onClick={() => setMode(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <span>
              <i className="status-dot" />
              实时预览 · 烧录前请核对换行
            </span>
          </div>
          <div className="cue-heading">
            <h2>
              字幕编辑 <span>{project.document.cues.length} 条</span>
            </h2>
            <button
              className="text-button"
              onClick={() => {
                const search = prompt("查找原文");
                if (search) {
                  const replacement = prompt("替换为");
                  if (replacement !== null)
                    call("subtitle.replace", {
                      id: project.id,
                      search,
                      replacement,
                    });
                }
              }}
            >
              <Search size={15} />
              查找替换
            </button>
          </div>
          {!project.document.cues.length ? (
            <div className="empty caption-empty">
              <Captions size={34} />
              <h3>字幕从这里开始</h3>
              <p>选择 ASR 配置生成字幕，或导入已有 SRT / VTT 文件。</p>
              <button className="secondary" onClick={importText}>
                导入已有字幕
                <ArrowRight size={16} />
              </button>
            </div>
          ) : (
            <div
              className="cue-list"
              onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
            >
              <div
                style={{
                  height: project.document.cues.length * 152,
                  position: "relative",
                }}
              >
                {visible.map((c, i) => (
                  <div
                    key={c.id}
                    style={{
                      position: "absolute",
                      top: (start + i) * 152,
                      left: 0,
                      right: 0,
                      height: 152,
                    }}
                  >
                    <CueRow
                      c={c}
                      index={start + i}
                      target={target}
                      active={activeCue?.id === c.id}
                      seek={() => {
                        if (video.current)
                          video.current.currentTime = c.startMs / 1000;
                      }}
                      save={(args) =>
                        call("subtitle.edit", {
                          id: project.id,
                          cueId: c.id,
                          ...args,
                        })
                      }
                      split={() =>
                        call("subtitle.split", {
                          id: project.id,
                          cueId: c.id,
                          at: Math.round((c.startMs + c.endMs) / 2),
                        })
                      }
                      merge={() =>
                        call("subtitle.merge", { id: project.id, cueId: c.id })
                      }
                      onError={onError}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <aside className="inspector">
          <div className="inspector-tabs">
            <button
              className={tab === "process" ? "active" : ""}
              onClick={() => setTab("process")}
            >
              <Sparkles size={16} />
              字幕流程
            </button>
            <button
              className={tab === "style" ? "active" : ""}
              onClick={() => setTab("style")}
            >
              <SlidersHorizontal size={16} />
              字幕样式
            </button>
          </div>
          {tab === "process" ? (
            <>
              <div className="step">
                <div className="step-title">
                  <b>1</b>
                  <h3>识别原声</h3>
                </div>
                <label>语音识别服务{field("asr", asr, setAsr)}</label>
                <label>
                  原声语言
                  <select
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                  >
                    <option value="auto">自动识别（若模型支持）</option>
                    {languages.map(([v, l]) => (
                      <option value={v} key={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                {(project.media?.audioTracks.length || 0) > 1 && (
                  <label>
                    音轨
                    <select
                      value={track}
                      onChange={(e) => setTrack(+e.target.value)}
                    >
                      {project.media?.audioTracks.map((t) => (
                        <option value={t.index} key={t.index}>
                          {t.title || `音轨 ${t.index + 1}`} {t.language}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  临时音频存储（按接口需要）
                  {field("storage", storage, setStorage)}
                </label>
                <button
                  className="secondary full"
                  disabled={!asr || busy || !project.media}
                  onClick={() => job("transcribe")}
                >
                  <Captions size={17} />
                  生成原文字幕
                </button>
              </div>
              <div className="step">
                <div className="step-title">
                  <b>2</b>
                  <h3>翻译字幕</h3>
                </div>
                <label>
                  翻译服务{field("translation", translator, setTranslator)}
                </label>
                <label>
                  目标语言
                  <select
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                  >
                    {languages.map(([v, l]) => (
                      <option value={v} key={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <details>
                  <summary>术语与翻译说明</summary>
                  <textarea
                    value={glossary}
                    onChange={(e) => setGlossary(e.target.value)}
                    placeholder="例如：Workbench 统一译为 工作台"
                  />
                </details>
                <button
                  className="secondary full"
                  disabled={
                    !translator || busy || !project.document.cues.length
                  }
                  onClick={() => job("translate")}
                >
                  <Languages size={17} />
                  翻译到目标语言
                </button>
              </div>
              <div className="step last">
                <div className="step-title">
                  <b>3</b>
                  <h3>制作成片</h3>
                </div>
                <p>将当前选定的原文、译文或双语字幕固定在画面中，保留原声。</p>
                <label>
                  输出分辨率
                  <select
                    value={resolution}
                    onChange={(event) => setResolution(event.target.value)}
                  >
                    <option value="">保持原尺寸</option>
                    <option value="480">480p</option>
                    <option value="720">720p</option>
                    <option value="1080">1080p</option>
                  </select>
                </label>
                <button
                  className="primary full"
                  disabled={
                    busy || !project.document.cues.length || !project.media
                  }
                  onClick={() => job("render")}
                >
                  <Film size={17} />
                  单独烧录视频
                </button>
                <small>不会重新调用识别或翻译服务</small>
              </div>
            </>
          ) : (
            <div className="style-panel">
              <p>
                样式按 1920 × 1080
                基准缩放。字体由运行设备提供；请核对输出样片，避免缺字。
              </p>
              {fonts.checked &&
                !fonts.families.some(
                  (name) =>
                    name.toLowerCase() === project.style.font.toLowerCase(),
                ) && (
                  <p role="status">
                    未检测到「{project.style.font}
                    」，输出可能回退到其他字体。请从下方列表选择已安装字体。
                  </p>
                )}
              <datalist id="subtitle-font-list">
                {fonts.families.map((name) => (
                  <option value={name} key={name} />
                ))}
              </datalist>
              {(["font", "fontSize", "margin", "outlineWidth"] as const).map(
                (key) => (
                  <label key={key}>
                    {
                      {
                        font: "字体名称",
                        fontSize: "字号",
                        margin: "垂直边距",
                        outlineWidth: "描边宽度",
                      }[key]
                    }
                    <input
                      type={key === "font" ? "text" : "number"}
                      list={key === "font" ? "subtitle-font-list" : undefined}
                      defaultValue={project.style[key]}
                      key={`${key}-${project.style[key]}`}
                      onBlur={(e) =>
                        call("style.save", {
                          id: project.id,
                          style: {
                            ...project.style,
                            [key]:
                              key === "font" ? e.target.value : +e.target.value,
                          },
                        })
                      }
                    />
                  </label>
                ),
              )}
              {(["color", "translationColor", "outlineColor"] as const).map(
                (key) => (
                  <label key={key}>
                    {
                      {
                        color: "原文字色",
                        translationColor: "译文字色",
                        outlineColor: "描边颜色",
                      }[key]
                    }
                    <input
                      type="color"
                      value={project.style[key]}
                      onChange={(e) =>
                        call("style.save", {
                          id: project.id,
                          style: { ...project.style, [key]: e.target.value },
                        })
                      }
                    />
                  </label>
                ),
              )}
              <label>
                位置
                <select
                  value={project.style.position}
                  onChange={(e) =>
                    call("style.save", {
                      id: project.id,
                      style: { ...project.style, position: e.target.value },
                    })
                  }
                >
                  <option value="bottom">底部居中</option>
                  <option value="top">顶部居中</option>
                </select>
              </label>
              {(["background", "translationFirst"] as const).map((key) => (
                <label className="checkbox" key={key}>
                  <input
                    type="checkbox"
                    checked={project.style[key]}
                    onChange={(e) =>
                      call("style.save", {
                        id: project.id,
                        style: { ...project.style, [key]: e.target.checked },
                      })
                    }
                  />
                  {key === "background" ? "半透明背景" : "译文显示在上方"}
                </label>
              ))}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
function CueRow({
  c,
  index,
  target,
  active,
  seek,
  save,
  split,
  merge,
  onError,
}: {
  c: Cue;
  index: number;
  target: string;
  active: boolean;
  seek: () => void;
  save: (args: Record<string, unknown>) => Promise<unknown>;
  split: () => unknown;
  merge: () => unknown;
  onError: (s: string) => void;
}) {
  const [text, setText] = useState(c.text),
    [translation, setTranslation] = useState(
      c.translations[target]?.text || "",
    );
  useEffect(() => setText(c.text), [c.text]);
  useEffect(
    () => setTranslation(c.translations[target]?.text || ""),
    [c.translations[target]?.text, target],
  );
  const stale =
    c.translations[target] &&
    c.translations[target].sourceRevision !== c.revision;
  return (
    <div className={`cue-row ${active ? "current" : ""}`}>
      <div className="cue-index">
        <button onClick={seek}>{String(index + 1).padStart(2, "0")}</button>
        <button title="拆分字幕" onClick={split}>
          <Split size={13} />
        </button>
        <button title="合并下一条" onClick={merge}>
          合并
        </button>
      </div>
      <div className="cue-content">
        <div className="cue-timing">
          {(["startMs", "endMs"] as const).map((key, i) => (
            <React.Fragment key={key}>
              {i > 0 && <span>→</span>}
              <input
                aria-label={i ? "结束时间" : "开始时间"}
                key={`${key}-${c[key]}`}
                defaultValue={timestamp(c[key], ".")}
                onBlur={(e) => {
                  try {
                    const value = parseTimestamp(e.target.value);
                    if (value !== c[key]) save({ patch: { [key]: value } });
                  } catch (error) {
                    onError((error as Error).message);
                  }
                }}
              />
            </React.Fragment>
          ))}
          {stale && <span className="stale">译文待更新</span>}
        </div>
        <textarea
          aria-label={`第 ${index + 1} 条原文`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => text !== c.text && save({ patch: { text } })}
        />
        <textarea
          className="translated"
          aria-label={`第 ${index + 1} 条译文`}
          value={translation}
          placeholder="译文将在这里显示，也可以直接输入"
          onChange={(e) => setTranslation(e.target.value)}
          onBlur={() =>
            translation !== (c.translations[target]?.text || "") &&
            save({ translation, language: target })
          }
        />
      </div>
    </div>
  );
}
function ProfileDialog({
  profile,
  close,
  save,
}: {
  profile?: PublicProfile;
  close: () => void;
  save: (args: Record<string, unknown>) => Promise<void>;
}) {
  const [provider, setProvider] = useState(profile?.provider || "openai"),
    [model, setModel] = useState(profile?.model || "whisper-1"),
    [saving, setSaving] = useState(false);
  const definition = catalog.find((p) => p.id === provider)!;
  return (
    <div className="modal-backdrop" onClick={close}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget),
            options: Record<string, string> = {},
            secrets: Record<string, string> = {};
          for (const f of definition.fields)
            (f.secret ? secrets : options)[f.key] = String(
              data.get(f.key) || "",
            );
          setSaving(true);
          try {
            await save({
              id: profile?.id,
              name: String(data.get("name")),
              provider,
              model,
              options,
              secrets,
              allowPrivateEndpoint: data.get("private") === "on",
            });
          } finally {
            setSaving(false);
          }
        }}
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">CONNECTION SETTINGS</span>
            <h2>{profile ? "编辑配置" : "添加模型或存储"}</h2>
          </div>
          <button type="button" onClick={close} aria-label="关闭">
            <X size={21} />
          </button>
        </div>
        <label>
          配置名称
          <input
            name="name"
            required
            defaultValue={profile?.name}
            placeholder="例如：我的中文识别"
          />
        </label>
        <label>
          服务商
          <select
            value={provider}
            disabled={!!profile}
            onChange={(e) => {
              setProvider(e.target.value);
              setModel(catalog.find((p) => p.id === e.target.value)!.models[0]);
            }}
          >
            {["asr", "translation", "storage"].map((c) => (
              <optgroup
                key={c}
                label={
                  c === "asr"
                    ? "语音识别"
                    : c === "translation"
                      ? "翻译"
                      : "存储"
                }
              >
                {catalog
                  .filter((p) => p.category === c)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label>
          模型 / 接口模式
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            list="models"
            required
          />
          <datalist id="models">
            {definition.models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
        <div key={provider}>
          {definition.fields.map((f) => (
            <label key={f.key}>
              {f.label}
              {f.optional && <small>可选</small>}
              {f.key === "serviceAccount" ? (
                <textarea
                  name={f.key}
                  placeholder={
                    profile?.secretFields.includes(f.key)
                      ? "已保存，留空保持不变"
                      : "粘贴 Service Account JSON"
                  }
                  required={
                    !f.optional && !profile?.secretFields.includes(f.key)
                  }
                />
              ) : (
                <input
                  name={f.key}
                  type={f.secret ? "password" : "text"}
                  autoComplete="off"
                  defaultValue={f.secret ? "" : profile?.options[f.key]}
                  required={
                    !f.optional && !profile?.secretFields.includes(f.key)
                  }
                  placeholder={
                    f.secret && profile?.secretFields.includes(f.key)
                      ? "已保存，留空保持不变"
                      : f.placeholder
                  }
                />
              )}
            </label>
          ))}
        </div>
        {definition.note && <p className="info-banner">{definition.note}</p>}
        <label className="checkbox">
          <input
            type="checkbox"
            name="private"
            defaultChecked={profile?.allowPrivateEndpoint}
          />
          <span>
            允许此配置访问内网 / HTTP 地址
            <small>仅在连接自己信任的本地服务时开启</small>
          </span>
        </label>
        <div className="modal-footer">
          {definition.docs ? (
            <a href={definition.docs} target="_blank" rel="noreferrer">
              官方接口文档 ↗
            </a>
          ) : (
            <span>保存不会产生模型调用费用</span>
          )}
          <button className="primary" disabled={saving}>
            {saving ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Check size={16} />
            )}
            保存配置
          </button>
        </div>
      </form>
    </div>
  );
}
