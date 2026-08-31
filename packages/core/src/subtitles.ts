import {
  defaultStyle,
  type Cue,
  type OutputMode,
  type SubtitleDocument,
  type SubtitleStyle,
  type Transcript,
} from "./types";

export function emptyDocument(): SubtitleDocument {
  return { schemaVersion: 1, revision: 0, language: "auto", cues: [] };
}
export function cue(
  text: string,
  startMs: number,
  endMs: number,
  id = crypto.randomUUID(),
): Cue {
  return {
    id,
    text,
    startMs: Math.round(startMs),
    endMs: Math.round(endMs),
    revision: 1,
    translations: {},
  };
}
export function validateDocument(
  doc: SubtitleDocument,
  durationMs = Infinity,
): void {
  if (doc.schemaVersion !== 1 || !Array.isArray(doc.cues))
    throw new Error("不支持的字幕格式");
  const ids = new Set<string>();
  for (const c of doc.cues) {
    if (ids.has(c.id) || !c.id) throw new Error("字幕 ID 重复或缺失");
    ids.add(c.id);
    if (
      !Number.isFinite(c.startMs) ||
      !Number.isFinite(c.endMs) ||
      c.startMs < 0 ||
      c.endMs <= c.startMs ||
      c.endMs > durationMs + 100
    )
      throw new Error("字幕起止时间无效或超出视频");
    if (typeof c.text !== "string" || !c.text.trim() || c.text.length > 20000)
      throw new Error("字幕文字无效");
  }
}
export function timestamp(ms: number, separator = ","): string {
  const n = Math.max(0, Math.round(ms));
  return `${Math.floor(n / 3600000)
    .toString()
    .padStart(
      2,
      "0",
    )}:${Math.floor(n / 60000) % 60 < 10 ? "0" : ""}${Math.floor(n / 60000) % 60}:${(Math.floor(n / 1000) % 60).toString().padStart(2, "0")}${separator}${(n % 1000).toString().padStart(3, "0")}`;
}
export function parseTimestamp(value: string): number {
  const m = value.trim().match(/^(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{1,3})$/);
  if (!m || +m[2] > 59 || +m[3] > 59) throw new Error(`无效时间：${value}`);
  return (
    ((+(m[1] || 0) * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4].padEnd(3, "0")
  );
}
export function parseSubtitles(text: string): SubtitleDocument {
  const doc = emptyDocument();
  const blocks = text
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "")
    .split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split("\n");
    if (/^(WEBVTT|NOTE|STYLE|REGION)/.test(lines[0])) continue;
    const idx = lines.findIndex((l) => l.includes("-->"));
    if (idx < 0) continue;
    const m = lines[idx].match(/([\d:.,]+)\s+-->\s+([\d:.,]+)/);
    if (!m) throw new Error("字幕时间行格式错误");
    const content = lines
      .slice(idx + 1)
      .join("\n")
      .trimEnd()
      .replace(/<[^>]*>/g, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
    doc.cues.push(cue(content, parseTimestamp(m[1]), parseTimestamp(m[2])));
  }
  if (!doc.cues.length) throw new Error("文件中没有有效的 SRT / VTT 字幕");
  doc.cues.sort((a, b) => a.startMs - b.startMs);
  doc.revision = 1;
  validateDocument(doc);
  return doc;
}
export function cueLines(
  c: Cue,
  mode: OutputMode,
  language: string,
  translationFirst = false,
): string[] {
  if (mode === "source") return [c.text];
  const translated = c.translations[language];
  if (!translated || translated.sourceRevision !== c.revision)
    throw new Error("存在缺失或过期译文，请先翻译或选择原文输出");
  if (mode === "translation") return [translated.text];
  return translationFirst
    ? [translated.text, c.text]
    : [c.text, translated.text];
}
function assColor(hex: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error("无效字幕颜色");
  return `&H00${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}&`;
}
function assTime(ms: number) {
  return timestamp(Math.floor(ms / 10) * 10, ".")
    .replace(/^(\d{2}):/, (_, h) => `${+h}:`)
    .slice(0, -1);
}
function assEscape(text: string) {
  return text
    .replace(/\\/g, "\\u200b")
    .replace(/{/g, "｛")
    .replace(/}/g, "｝")
    .replace(/\r?\n/g, "\\N");
}
export function exportSubtitles(
  doc: SubtitleDocument,
  format: "srt" | "vtt" | "ass",
  mode: OutputMode,
  language = "",
  style: SubtitleStyle = defaultStyle,
): string {
  validateDocument(doc);
  const cues = [...doc.cues].sort((a, b) => a.startMs - b.startMs);
  if (format !== "ass") {
    const esc = (t: string) =>
      format === "vtt"
        ? t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        : t;
    return (
      (format === "vtt" ? "WEBVTT\n\n" : "") +
      cues
        .map(
          (c, i) =>
            `${i + 1}\n${timestamp(c.startMs, format === "vtt" ? "." : ",")} --> ${timestamp(c.endMs, format === "vtt" ? "." : ",")}\n${esc(cueLines(c, mode, language, style.translationFirst).join("\n"))}\n`,
        )
        .join("\n")
    );
  }
  const font = style.font.replace(/[,\r\n]/g, "");
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${font},${style.fontSize},${assColor(style.color)},${assColor(style.translationColor)},${assColor(style.outlineColor)},&H80000000,0,0,0,0,100,100,0,0,${style.background ? 3 : 1},${style.outlineWidth},0,${style.position === "bottom" ? 2 : 8},80,80,${style.margin},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  return (
    header +
    cues
      .map((c) => {
        const lines = cueLines(c, mode, language, style.translationFirst);
        const content = lines
          .map(
            (l, i) =>
              `{\\c${assColor(mode === "translation" || (mode === "bilingual" && i === (style.translationFirst ? 0 : 1)) ? style.translationColor : style.color)}}${assEscape(l)}`,
          )
          .join("\\N");
        return `Dialogue: 0,${assTime(c.startMs)},${assTime(c.endMs)},Default,,0,0,0,,${content}\n`;
      })
      .join("")
  );
}
export function editCue(
  doc: SubtitleDocument,
  id: string,
  patch: Partial<Pick<Cue, "text" | "startMs" | "endMs">>,
): SubtitleDocument {
  const next = structuredClone(doc);
  const c = next.cues.find((c) => c.id === id);
  if (!c) throw new Error("字幕不存在");
  if (patch.text !== undefined && patch.text !== c.text) c.revision++;
  if (
    Object.entries(patch).some(([key, value]) => c[key as keyof Cue] !== value)
  )
    delete c.words;
  Object.assign(c, patch);
  next.revision++;
  validateDocument(next);
  return next;
}
export function splitCue(
  doc: SubtitleDocument,
  id: string,
  at: number,
): SubtitleDocument {
  const next = structuredClone(doc);
  const i = next.cues.findIndex((c) => c.id === id);
  const c = next.cues[i];
  if (!c || !Number.isFinite(at) || at <= c.startMs || at >= c.endMs)
    throw new Error("拆分点必须位于字幕内部");
  const ratio = (at - c.startMs) / (c.endMs - c.startMs);
  const chars = [...c.text];
  if (chars.length < 2) throw new Error("字幕文字不足以拆分");
  const pivot = Math.max(
    1,
    Math.min(chars.length - 1, Math.round(chars.length * ratio)),
  );
  next.cues.splice(
    i,
    1,
    cue(chars.slice(0, pivot).join(""), c.startMs, at),
    cue(chars.slice(pivot).join(""), at, c.endMs),
  );
  next.revision++;
  validateDocument(next);
  return next;
}
export function mergeCues(doc: SubtitleDocument, id: string): SubtitleDocument {
  const next = structuredClone(doc);
  const i = next.cues.findIndex((c) => c.id === id);
  const a = next.cues[i],
    b = next.cues[i + 1];
  if (!a || !b) throw new Error("没有下一条字幕");
  next.cues.splice(
    i,
    2,
    cue(`${a.text} ${b.text}`, a.startMs, Math.max(a.endMs, b.endMs)),
  );
  next.revision++;
  validateDocument(next);
  return next;
}
export function combineTranscripts(
  parts: { offsetMs: number; transcript: Transcript }[],
  durationMs: number,
): SubtitleDocument {
  const doc = emptyDocument();
  doc.revision = 1;
  doc.language =
    parts.find((p) => p.transcript.language !== "auto")?.transcript.language ||
    "auto";
  for (const part of parts)
    for (const item of part.transcript.cues) {
      const c = structuredClone(item);
      c.id = crypto.randomUUID();
      c.startMs = Math.max(0, Math.round(c.startMs + part.offsetMs));
      c.endMs = Math.min(durationMs, Math.round(c.endMs + part.offsetMs));
      if (c.words)
        c.words = c.words.map((w) => ({
          ...w,
          startMs: Math.round(w.startMs + part.offsetMs),
          endMs: Math.round(w.endMs + part.offsetMs),
        }));
      const previous = doc.cues.at(-1);
      if (c.endMs <= c.startMs || !c.text.trim()) continue;
      if (
        previous &&
        previous.text.replace(/\s/g, "") === c.text.replace(/\s/g, "") &&
        c.startMs < previous.endMs + 300
      ) {
        previous.endMs = Math.max(previous.endMs, c.endMs);
        continue;
      }
      doc.cues.push(c);
    }
  doc.cues.sort((a, b) => a.startMs - b.startMs);
  validateDocument(doc, durationMs);
  return doc;
}
export function validateTranslation(
  ids: string[],
  result: unknown,
): Record<string, string> {
  if (!Array.isArray(result)) throw new Error("翻译返回值必须为数组");
  const out: Record<string, string> = {};
  for (const item of result) {
    if (
      !item ||
      typeof item.id !== "string" ||
      typeof item.text !== "string" ||
      !item.text.trim() ||
      !ids.includes(item.id) ||
      Object.hasOwn(out, item.id)
    )
      throw new Error("翻译结果包含缺失、重复或未知字幕");
    out[item.id] = item.text;
  }
  if (Object.keys(out).length !== ids.length) throw new Error("翻译结果漏句");
  return out;
}
