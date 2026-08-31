"use client";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Alert,
  App,
  AutoComplete,
  Button,
  Card,
  Checkbox,
  ColorPicker,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
} from "antd";
import {
  ArrowLeftOutlined,
  DownloadOutlined,
  EditOutlined,
  ScissorOutlined,
  SearchOutlined,
  UploadOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import {
  cueLines,
  parseTimestamp,
  timestamp,
  type Cue,
  type Gateway,
  type JobKind,
  type JobParams,
  type OutputMode,
  type Project,
  type PublicProfile,
  type SubtitleStyle,
} from "@subtitle/core";
import { catalog } from "@subtitle/providers/catalog";
import { duration, errorText, languages, quiet, type Command } from "./shared";

type FlushDraft = () => Promise<unknown>;
const DraftsContext = createContext<Set<FlushDraft> | null>(null);
// These actions flush drafts themselves. A blur save must not disable or move
// the clicked button between pointer-down and click.
const keepDraftFocus = (event: React.MouseEvent<HTMLButtonElement>) => {
  if (event.button === 0) event.preventDefault();
};

// Keep a draft during polling and flush it when virtualization unmounts a row.
function AutosaveInput({
  value: remote,
  label,
  save,
  multiline = false,
}: {
  value: string;
  label: string;
  save: (value: string) => Promise<unknown>;
  multiline?: boolean;
}) {
  const drafts = useContext(DraftsContext);
  const [value, setValue] = useState(remote);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const current = useRef(remote),
    dirty = useRef(false),
    saveRef = useRef(save);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const submitted = useRef<string | null>(null);
  const inFlight = useRef<Promise<unknown> | null>(null);
  saveRef.current = save;
  useEffect(() => {
    if (!dirty.current) {
      current.current = remote;
      setValue(remote);
    }
  }, [remote]);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    if (!dirty.current) return Promise.resolve();
    if (submitted.current === current.current && inFlight.current)
      return inFlight.current;
    const next = current.current;
    submitted.current = next;
    setStatus("保存中");
    setError("");
    const task = Promise.resolve()
      .then(() => saveRef.current(next))
      .then(() => {
        if (current.current === next) {
          dirty.current = false;
          setStatus("已保存");
        }
      })
      .catch((e) => {
        setError(errorText(e));
        setStatus("");
        throw e;
      })
      .finally(() => {
        if (submitted.current === next) {
          submitted.current = null;
          inFlight.current = null;
        }
      });
    inFlight.current = task;
    return task;
  }, []);
  useEffect(() => {
    drafts?.add(flush);
    return () => {
      drafts?.delete(flush);
      quiet(flush());
    };
  }, [drafts, flush]);
  const inputProps = {
    value,
    "aria-label": label,
    status: error ? ("error" as const) : undefined,
    onChange: (
      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      current.current = e.target.value;
      dirty.current = true;
      setValue(e.target.value);
      setStatus("待保存");
      setError("");
      clearTimeout(timer.current);
      if (multiline) timer.current = setTimeout(() => quiet(flush()), 800);
    },
    onBlur: () => quiet(flush()),
  };
  return (
    <div className="wb-autosave">
      {multiline ? (
        <Input.TextArea {...inputProps} rows={2} maxLength={20000} />
      ) : (
        <Input {...inputProps} className="wb-mono" size="small" />
      )}
      {error ? (
        <Typography.Text type="danger" className="wb-autosave-error">
          {error}{" "}
          <Typography.Link onClick={() => quiet(flush())}>重试</Typography.Link>
        </Typography.Text>
      ) : (
        status && (
          <Typography.Text type="secondary" className="wb-autosave-error">
            {status}
          </Typography.Text>
        )
      )}
    </div>
  );
}

export function Editor({
  project,
  profiles,
  gateway,
  command,
  busy,
  onBack,
  onError,
  onJobs,
}: {
  project: Project;
  profiles: PublicProfile[];
  gateway: Gateway;
  command: Command;
  busy: boolean;
  onBack: () => void;
  onError: (error: string) => void;
  onJobs: () => void;
}) {
  const { message } = App.useApp();
  const drafts = useRef(new Set<FlushDraft>()).current;
  const flushDrafts = async () => {
    await Promise.all([...drafts].map((flush) => flush()));
  };
  const editCommand: Command = async (method, args) => {
    await flushDrafts();
    return command(method, args);
  };
  const video = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const [mode, setMode] = useState<OutputMode>("source");
  const [target, setTarget] = useState("en");
  const [source, setSource] = useState(project.document.language || "auto");
  const [asr, setAsr] = useState<string>();
  const [translator, setTranslator] = useState<string>();
  const [storage, setStorage] = useState<string>();
  const [track, setTrack] = useState(0);
  const [resolution, setResolution] = useState<number | undefined>(
    gateway.platform === "android" ? 720 : undefined,
  );
  const [glossary, setGlossary] = useState("");
  const [format, setFormat] = useState<"srt" | "vtt" | "ass">("srt");
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [name, setName] = useState(project.name);
  const [style, setStyle] = useState(project.style);
  const [fonts, setFonts] = useState<{ checked: boolean; families: string[] }>({
    checked: false,
    families: [],
  });
  const savedStyle = JSON.stringify(project.style);
  const styleDirty = JSON.stringify(style) !== savedStyle;
  const lastSavedStyle = useRef(savedStyle);
  useEffect(() => {
    if (lastSavedStyle.current !== savedStyle) {
      setStyle(project.style);
      lastSavedStyle.current = savedStyle;
    }
  }, [savedStyle, project.style]);
  useEffect(() => {
    let mounted = true;
    gateway
      .call<typeof fonts>("media.fonts")
      .then((next) => {
        if (mounted) setFonts(next);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [gateway]);
  const choices = (category: string) =>
    profiles
      .filter(
        (p) => catalog.find((d) => d.id === p.provider)?.category === category,
      )
      .map((p) => ({ value: p.id, label: p.name }));
  const activeCue = project.document.cues.find(
    (c) => c.startMs <= time && c.endMs > time,
  );
  let preview: string[] = [];
  if (activeCue)
    try {
      preview = cueLines(activeCue, mode, target, style.translationFirst);
    } catch {
      preview =
        mode === "translation"
          ? ["（译文缺失或过期）"]
          : style.translationFirst
            ? ["（译文缺失或过期）", activeCue.text]
            : [activeCue.text, "（译文缺失或过期）"];
    }
  const missingTranslations = project.document.cues.filter(
    (c) =>
      !c.translations[target] ||
      c.translations[target].sourceRevision !== c.revision,
  ).length;
  const outputReady =
    !!project.document.cues.length &&
    (mode === "source" || missingTranslations === 0);
  async function job(kind: JobKind) {
    const params: JobParams = {
      profileId:
        kind === "transcribe"
          ? asr
          : kind === "translate"
            ? translator
            : undefined,
      storageId: storage,
      language: source,
      targetLanguage: target,
      mode,
      glossary,
      audioTrack: track,
      resolution,
    };
    try {
      await editCommand("job.create", { id: project.id, kind, params });
      onJobs();
    } catch (e) {
      onError(errorText(e));
    }
  }
  async function exportText() {
    try {
      const text = await editCommand("subtitle.export", {
        id: project.id,
        format,
        mode,
        language: target,
      });
      await gateway.saveText(`${project.name}.${format}`, text);
      message.success("字幕文件已导出");
    } catch (e) {
      onError(errorText(e));
    }
  }
  const selection = (
    label: string,
    category: string,
    value: string | undefined,
    onChange: (value: string | undefined) => void,
  ) => (
    <Form.Item label={label}>
      <Select
        aria-label={label}
        allowClear
        placeholder="选择配置"
        value={value}
        onChange={onChange}
        options={choices(category)}
        notFoundContent="请先在模型与存储中添加配置"
      />
    </Form.Item>
  );
  return (
    <DraftsContext.Provider value={drafts}>
      <div className="wb-page-heading">
        <Space orientation="vertical" size={4}>
          <Button
            type="link"
            icon={<ArrowLeftOutlined />}
            onMouseDown={keepDraftFocus}
            onClick={() =>
              quiet(
                flushDrafts()
                  .then(onBack)
                  .catch((e) => onError(errorText(e))),
              )
            }
          >
            全部项目
          </Button>
          <Space wrap>
            <Typography.Title level={3}>{project.name}</Typography.Title>
            <Button
              aria-label="重命名项目"
              size="small"
              icon={<EditOutlined />}
              onClick={() => {
                setName(project.name);
                setRenameOpen(true);
              }}
            />
          </Space>
          <Typography.Text type="secondary">
            {project.media
              ? `${project.media.width} × ${project.media.height} · ${duration(project.media.durationMs)}`
              : "纯字幕文档"}{" "}
            · 修订 {project.document.revision}
          </Typography.Text>
        </Space>
        <Space wrap>
          <Button
            icon={<UploadOutlined />}
            disabled={busy}
            onClick={() => {
              setImportText("");
              setImportError("");
              setImportOpen(true);
            }}
          >
            导入字幕
          </Button>
          <Select
            aria-label="字幕导出格式"
            value={format}
            onChange={setFormat}
            options={["srt", "vtt", "ass"].map((f) => ({
              value: f,
              label: f.toUpperCase(),
            }))}
          />
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            onMouseDown={keepDraftFocus}
            disabled={busy || !outputReady || (format === "ass" && styleDirty)}
            onClick={exportText}
          >
            导出字幕
          </Button>
        </Space>
      </div>
      <div className="wb-editor-grid">
        <div className="wb-editor-main">
          <Card
            title="视频预览"
            className="wb-gap"
            styles={{ body: { padding: 0 } }}
          >
            {project.media ? (
              <div className="wb-video">
                <video
                  ref={video}
                  src={gateway.mediaUrl(project.id)}
                  controls
                  onTimeUpdate={() =>
                    setTime((video.current?.currentTime || 0) * 1000)
                  }
                  onError={() =>
                    onError(
                      "播放器无法解码此视频。建议使用 H.264 MP4 格式；字幕文档仍可编辑与导出。",
                    )
                  }
                />
                <div
                  className="wb-preview"
                  style={{
                    [style.position === "top" ? "top" : "bottom"]:
                      `${Math.max(style.position === "bottom" ? 12 : 2, (style.margin / 1080) * 100)}%`,
                    fontFamily: style.font,
                    fontSize: `clamp(12px, ${style.fontSize / 24}vw, ${style.fontSize}px)`,
                    textShadow: `0 1px ${style.outlineWidth * 2}px ${style.outlineColor}`,
                  }}
                >
                  {preview.map((line, index) => (
                    <div key={index}>
                      <span
                        style={{
                          background: style.background ? "#0009" : undefined,
                          color:
                            mode === "translation" ||
                            (mode === "bilingual" &&
                              (index === 0) === style.translationFirst)
                              ? style.translationColor
                              : style.color,
                        }}
                      >
                        {line}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="wb-video-empty">
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="纯字幕文档，没有关联视频"
                />
              </div>
            )}
          </Card>
          <Card className="wb-gap" size="small">
            <Space wrap>
              <Typography.Text>输出模式</Typography.Text>
              <Segmented<OutputMode>
                aria-label="输出模式"
                value={mode}
                onChange={setMode}
                options={[
                  { value: "source", label: "原文" },
                  { value: "translation", label: "译文" },
                  { value: "bilingual", label: "双语" },
                ]}
              />
              <Select
                aria-label="编辑与输出的目标语言"
                value={target}
                onChange={setTarget}
                options={languages}
              />
            </Space>
            {mode !== "source" && missingTranslations > 0 && (
              <Alert
                className="wb-gap"
                type="warning"
                showIcon
                title={`${missingTranslations} 条译文缺失或过期，请补齐后导出，也可切换为原文输出。`}
              />
            )}
          </Card>
          <Card
            title={`字幕编辑（${project.document.cues.length} 条）`}
            extra={
              <Button
                icon={<SearchOutlined />}
                disabled={!project.document.cues.length || busy}
                onClick={() => setReplaceOpen(true)}
              >
                查找替换
              </Button>
            }
          >
            <Typography.Paragraph type="secondary">
              文字停止输入后自动保存；时间在离开输入框后保存。拆分、合并和改动原文会使对应译文过期。
            </Typography.Paragraph>
            <Table<Cue>
              rowKey="id"
              className="wb-cue-table"
              virtual
              pagination={false}
              scroll={{ x: 960, y: 480 }}
              dataSource={project.document.cues}
              rowClassName={(c) =>
                activeCue?.id === c.id ? "wb-cue-active" : ""
              }
              locale={{
                emptyText: (
                  <Empty description="暂无字幕。请选择语音识别服务，或导入已有字幕。" />
                ),
              }}
              columns={[
                {
                  title: "序号",
                  width: 70,
                  render: (_, c, index) => (
                    <Button
                      type="link"
                      size="small"
                      aria-label={`定位第 ${index + 1} 条字幕`}
                      onClick={() => {
                        setTime(c.startMs);
                        if (video.current)
                          video.current.currentTime = c.startMs / 1000;
                      }}
                    >
                      {index + 1}
                    </Button>
                  ),
                },
                {
                  title: "时间",
                  width: 170,
                  render: (_, c, index) => (
                    <div className="wb-cue-timing">
                      {(["startMs", "endMs"] as const).map((key) => (
                        <AutosaveInput
                          key={`${c.id}:${key}`}
                          value={timestamp(c[key], ".")}
                          label={`第 ${index + 1} 条${key === "startMs" ? "开始" : "结束"}时间`}
                          save={async (value) =>
                            command("subtitle.edit", {
                              id: project.id,
                              cueId: c.id,
                              patch: { [key]: parseTimestamp(value) },
                            })
                          }
                        />
                      ))}
                    </div>
                  ),
                },
                {
                  title: "原文",
                  width: 280,
                  render: (_, c, index) => (
                    <AutosaveInput
                      key={`${c.id}:source`}
                      multiline
                      value={c.text}
                      label={`第 ${index + 1} 条原文`}
                      save={(text) =>
                        command("subtitle.edit", {
                          id: project.id,
                          cueId: c.id,
                          patch: { text },
                        })
                      }
                    />
                  ),
                },
                {
                  title: "译文",
                  width: 280,
                  render: (_, c, index) => (
                    <>
                      {c.translations[target] &&
                        c.translations[target].sourceRevision !==
                          c.revision && <Tag color="warning">译文待更新</Tag>}
                      <AutosaveInput
                        key={`${c.id}:${target}`}
                        multiline
                        value={c.translations[target]?.text || ""}
                        label={`第 ${index + 1} 条译文`}
                        save={(translation) =>
                          command("subtitle.edit", {
                            id: project.id,
                            cueId: c.id,
                            translation,
                            language: target,
                          })
                        }
                      />
                    </>
                  ),
                },
                {
                  title: "操作",
                  width: 160,
                  render: (_, c, index) => (
                    <Space orientation="vertical" size={4}>
                      <Button
                        size="small"
                        icon={<ScissorOutlined />}
                        onMouseDown={keepDraftFocus}
                        disabled={
                          busy ||
                          c.endMs - c.startMs < 2 ||
                          Array.from(c.text).length < 2
                        }
                        onClick={() =>
                          quiet(
                            editCommand("subtitle.split", {
                              id: project.id,
                              cueId: c.id,
                              at: Math.round((c.startMs + c.endMs) / 2),
                            }).catch((e) => onError(errorText(e))),
                          )
                        }
                      >
                        拆分
                      </Button>
                      <Popconfirm
                        title="与下一条合并？"
                        description="合并后需要重新翻译这条字幕。"
                        onConfirm={() =>
                          editCommand("subtitle.merge", {
                            id: project.id,
                            cueId: c.id,
                          })
                        }
                      >
                        <Button
                          size="small"
                          disabled={
                            busy || index === project.document.cues.length - 1
                          }
                        >
                          合并下一条
                        </Button>
                      </Popconfirm>
                    </Space>
                  ),
                },
              ]}
            />
          </Card>
        </div>
        <Card>
          <Tabs
            items={[
              {
                key: "process",
                label: "字幕流程",
                children: (
                  <Form layout="vertical">
                    <Typography.Title level={5}>1. 识别原声</Typography.Title>
                    {selection("语音识别服务", "asr", asr, setAsr)}
                    <Form.Item label="原声语言">
                      <Select
                        aria-label="原声语言"
                        value={source}
                        onChange={setSource}
                        options={[
                          { value: "auto", label: "自动识别（若模型支持）" },
                          ...languages,
                        ]}
                      />
                    </Form.Item>
                    {!!project.media?.audioTracks.length && (
                      <Form.Item label="音轨">
                        <Select
                          value={track}
                          onChange={setTrack}
                          options={project.media.audioTracks.map((t) => ({
                            value: t.index,
                            label: `${t.title || `音轨 ${t.index + 1}`} ${t.language || ""}`,
                          }))}
                        />
                      </Form.Item>
                    )}
                    {selection(
                      "临时音频存储（按接口需要）",
                      "storage",
                      storage,
                      setStorage,
                    )}
                    {project.media && !project.media.audioTracks.length && (
                      <Alert
                        className="wb-gap"
                        type="warning"
                        title="视频没有音轨，可导入字幕后烧录。"
                      />
                    )}
                    <Button
                      block
                      disabled={
                        !asr || busy || !project.media?.audioTracks.length
                      }
                      onClick={() => job("transcribe")}
                      onMouseDown={keepDraftFocus}
                    >
                      生成原文字幕
                    </Button>
                    <Typography.Title level={5}>2. 翻译字幕</Typography.Title>
                    {selection(
                      "翻译服务",
                      "translation",
                      translator,
                      setTranslator,
                    )}
                    <Form.Item label="目标语言">
                      <Select
                        aria-label="翻译目标语言"
                        value={target}
                        onChange={setTarget}
                        options={languages}
                      />
                    </Form.Item>
                    <Form.Item label="术语与翻译说明">
                      <Input.TextArea
                        value={glossary}
                        onChange={(e) => setGlossary(e.target.value)}
                        rows={3}
                        maxLength={12000}
                        placeholder="例如：Workbench 统一译为 工作台"
                      />
                    </Form.Item>
                    <Button
                      block
                      disabled={
                        !translator || busy || !project.document.cues.length
                      }
                      onClick={() => job("translate")}
                      onMouseDown={keepDraftFocus}
                    >
                      翻译到目标语言
                    </Button>
                    <Typography.Title level={5}>3. 制作成片</Typography.Title>
                    <Form.Item label="输出分辨率">
                      <Select
                        aria-label="输出分辨率"
                        value={resolution || 0}
                        onChange={(value) => setResolution(value || undefined)}
                        options={[
                          { value: 0, label: "保持原尺寸" },
                          ...[480, 720, 1080].map((value) => ({
                            value,
                            label: `${value}p`,
                          })),
                        ]}
                      />
                    </Form.Item>
                    {styleDirty && (
                      <Alert
                        className="wb-gap"
                        type="warning"
                        title="请先在字幕样式中保存更改。"
                      />
                    )}
                    <Button
                      block
                      type="primary"
                      icon={<VideoCameraOutlined />}
                      onMouseDown={keepDraftFocus}
                      disabled={
                        busy || !outputReady || !project.media || styleDirty
                      }
                      onClick={() => job("render")}
                    >
                      单独烧录视频
                    </Button>
                    <Typography.Paragraph type="secondary">
                      只读取当前字幕与样式，不会重新调用识别或翻译服务。
                    </Typography.Paragraph>
                  </Form>
                ),
              },
              {
                key: "style",
                label: "字幕样式",
                children: (
                  <StylePanel
                    style={style}
                    setStyle={setStyle}
                    fonts={fonts}
                    busy={busy}
                    dirty={styleDirty}
                    reset={() => setStyle(project.style)}
                    save={async () => {
                      await command("style.save", { id: project.id, style });
                      message.success("字幕样式已保存");
                    }}
                  />
                ),
              },
            ]}
          />
        </Card>
      </div>
      <Modal
        title="导入 SRT / VTT 字幕"
        open={importOpen}
        width={640}
        okText="导入字幕"
        confirmLoading={busy}
        okButtonProps={{ disabled: !importText.trim() }}
        onCancel={() => !busy && setImportOpen(false)}
        onOk={async () => {
          setImportError("");
          try {
            await command("subtitle.import", {
              id: project.id,
              text: importText,
              language: source,
            });
            setImportOpen(false);
          } catch (e) {
            setImportError(errorText(e));
          }
        }}
      >
        <Alert
          className="wb-gap"
          showIcon
          type="info"
          title="导入将替换当前字幕与译文。原视频不会被修改。"
        />
        {importError && (
          <Alert className="wb-gap" type="error" showIcon title={importError} />
        )}
        <Upload
          accept=".srt,.vtt"
          showUploadList={false}
          beforeUpload={async (file) => {
            if (file.size > 8 * 1024 * 1024)
              setImportError("字幕文件不能超过 8 MB");
            else
              try {
                setImportText(await file.text());
                setImportError("");
              } catch (e) {
                setImportError(errorText(e));
              }
            return Upload.LIST_IGNORE;
          }}
        >
          <Button className="wb-gap" icon={<UploadOutlined />}>
            选择字幕文件
          </Button>
        </Upload>
        <Input.TextArea
          aria-label="SRT 或 VTT 字幕内容"
          rows={10}
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder="也可直接粘贴 SRT / VTT 内容"
        />
      </Modal>
      <Modal
        title="查找替换原文"
        open={replaceOpen}
        footer={null}
        onCancel={() => setReplaceOpen(false)}
        destroyOnHidden
      >
        <Form
          layout="vertical"
          onFinish={async (values) => {
            try {
              await editCommand("subtitle.replace", {
                id: project.id,
                ...values,
              });
              setReplaceOpen(false);
            } catch (e) {
              onError(errorText(e));
            }
          }}
        >
          <Form.Item label="查找" name="search" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="替换为" name="replacement">
            <Input />
          </Form.Item>
          <Typography.Paragraph type="secondary">
            受影响字幕的译文会标记为过期。
          </Typography.Paragraph>
          <Button htmlType="submit" type="primary" loading={busy}>
            全部替换
          </Button>
        </Form>
      </Modal>
      <Modal
        title="重命名项目"
        open={renameOpen}
        okButtonProps={{ disabled: !name.trim() }}
        onCancel={() => setRenameOpen(false)}
        confirmLoading={busy}
        onOk={async () => {
          try {
            await command("project.rename", {
              id: project.id,
              name: name.trim(),
            });
            setRenameOpen(false);
          } catch {}
        }}
      >
        <Input
          aria-label="项目名称"
          maxLength={160}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Modal>
    </DraftsContext.Provider>
  );
}

function StylePanel({
  style,
  setStyle,
  fonts,
  busy,
  dirty,
  reset,
  save,
}: {
  style: SubtitleStyle;
  setStyle: (style: SubtitleStyle) => void;
  fonts: { checked: boolean; families: string[] };
  busy: boolean;
  dirty: boolean;
  reset: () => void;
  save: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  const update = <K extends keyof SubtitleStyle>(
    key: K,
    value: SubtitleStyle[K],
  ) => setStyle({ ...style, [key]: value });
  return (
    <Form
      layout="vertical"
      onFinish={async () => {
        try {
          await save();
          setError("");
        } catch (e) {
          setError(errorText(e));
        }
      }}
    >
      <Typography.Paragraph type="secondary">
        以 1920 × 1080 为基准缩放。预览仅作参考，修改后请保存样式再烧录。
      </Typography.Paragraph>
      {error && <Alert className="wb-gap" type="error" title={error} />}
      {fonts.checked &&
        !fonts.families.some(
          (font) => font.toLowerCase() === style.font.toLowerCase(),
        ) && (
          <Alert
            className="wb-gap"
            type="warning"
            showIcon
            title={`未检测到「${style.font}」，请选用已安装字体，避免缺字。`}
          />
        )}
      <Form.Item label="字体名称" required>
        <AutoComplete
          aria-label="字体名称"
          value={style.font}
          onChange={(value) => update("font", value)}
          options={fonts.families.map((value) => ({ value }))}
          filterOption={(input, option) =>
            !!option?.value.toLowerCase().includes(input.toLowerCase())
          }
        />
      </Form.Item>
      <div className="wb-form-grid">
        {(
          [
            ["fontSize", "字号", 12, 160],
            ["margin", "垂直边距", 0, 500],
            ["outlineWidth", "描边宽度", 0, 12],
          ] as const
        ).map(([key, label, min, max]) => (
          <Form.Item key={key} label={label}>
            <InputNumber
              className="wb-full"
              aria-label={label}
              min={min}
              max={max}
              value={style[key]}
              onChange={(value) => {
                if (value !== null) update(key, value);
              }}
            />
          </Form.Item>
        ))}
      </div>
      {(
        [
          ["color", "原文字色"],
          ["translationColor", "译文字色"],
          ["outlineColor", "描边颜色"],
        ] as const
      ).map(([key, label]) => (
        <Form.Item key={key} label={label}>
          <ColorPicker
            aria-label={label}
            value={style[key]}
            disabledAlpha
            format="hex"
            showText
            onChange={(color) => update(key, color.toHexString())}
          />
        </Form.Item>
      ))}
      <Form.Item label="字幕位置">
        <Select
          aria-label="字幕位置"
          value={style.position}
          onChange={(value) => update("position", value)}
          options={[
            { value: "bottom", label: "底部居中" },
            { value: "top", label: "顶部居中" },
          ]}
        />
      </Form.Item>
      <Space orientation="vertical" className="wb-gap">
        <Checkbox
          checked={style.background}
          onChange={(e) => update("background", e.target.checked)}
        >
          半透明背景
        </Checkbox>
        <Checkbox
          checked={style.translationFirst}
          onChange={(e) => update("translationFirst", e.target.checked)}
        >
          译文显示在上方
        </Checkbox>
      </Space>
      <Space>
        <Button
          type="primary"
          htmlType="submit"
          loading={busy}
          disabled={!dirty || !style.font.trim()}
        >
          保存样式
        </Button>
        <Button disabled={!dirty || busy} onClick={reset}>
          还原
        </Button>
      </Space>
    </Form>
  );
}
