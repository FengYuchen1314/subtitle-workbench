import { cue, type Cue, type Transcript, type Word } from "@subtitle/core";
import { ProviderError } from "./http";
const number = (v: unknown): number =>
  typeof v === "string" ? parseFloat(v.replace(/s$/, "")) : Number(v);
function timed(
  text: string,
  start: unknown,
  end: unknown,
  scale = 1,
  speaker?: string,
): Cue | null {
  const a = number(start) * scale,
    b = number(end) * scale;
  if (
    !text?.trim() ||
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    b <= a ||
    a < 0
  )
    return null;
  return { ...cue(text, a, b), ...(speaker ? { speaker } : {}) };
}
function fromWords(items: any[], mapper: (item: any) => Word | null): Cue[] {
  const words = items
    .map(mapper)
    .filter(
      (w): w is Word =>
        !!w &&
        Number.isFinite(w.startMs) &&
        Number.isFinite(w.endMs) &&
        w.endMs > w.startMs,
    );
  const cues: Cue[] = [];
  let group: Word[] = [];
  const flush = () => {
    if (!group.length) return;
    const text = group
      .map((w) => w.text)
      .join(" ")
      .replace(/\s+([,.!?;:，。！？、])/g, "$1")
      .replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, "$1");
    const c = cue(text, group[0].startMs, group.at(-1)!.endMs);
    c.words = group;
    c.speaker = group[0].speaker;
    cues.push(c);
    group = [];
  };
  for (const w of words) {
    if (
      group.length &&
      (w.startMs - group[0].startMs > 5500 ||
        group.map((x) => x.text).join("").length > 38 ||
        w.speaker !== group[0].speaker)
    )
      flush();
    group.push(w);
    if (/[.!?。！？]$/.test(w.text)) flush();
  }
  flush();
  return cues;
}
export function normalize(provider: string, raw: any): Transcript {
  let cues: (Cue | null)[] = [];
  let language = raw.language || raw.language_code || "auto";
  switch (provider) {
    case "openai":
    case "groq":
    case "custom-openai":
      if (raw.segments?.length)
        cues = raw.segments.map((s: any) =>
          timed(s.text, s.start, s.end, 1000, s.speaker),
        );
      else if (raw.words?.length)
        cues = fromWords(raw.words, (w: any) => ({
          text: w.word || w.text,
          startMs: number(w.start) * 1000,
          endMs: number(w.end) * 1000,
        }));
      break;
    case "custom-json":
      cues = (raw.cues || []).map((s: any) =>
        timed(s.text, s.startMs, s.endMs, 1, s.speaker),
      );
      break;
    case "aliyun":
      cues = (raw.transcripts || [raw]).flatMap((t: any) =>
        (t.sentences || []).map((s: any) =>
          timed(s.text, s.begin_time, s.end_time, 1, s.speaker_id?.toString()),
        ),
      );
      break;
    case "volcengine":
      cues = (raw.result?.utterances || raw.utterances || []).map((s: any) =>
        timed(s.text, s.start_time, s.end_time, 1, s.additions?.speaker),
      );
      break;
    case "tencent":
      cues = (raw.ResultDetail || raw.Data?.ResultDetail || []).map((s: any) =>
        timed(
          s.FinalSentence || s.SliceSentence,
          s.StartMs,
          s.EndMs,
          1,
          s.SpeakerId?.toString(),
        ),
      );
      break;
    case "baidu":
      cues = (
        raw.task_result?.detailed_result ||
        raw.result?.detailed_result ||
        raw.detailed_result ||
        []
      ).map((s: any) =>
        timed(
          Array.isArray(s.res) ? s.res[0] : s.result || s.text,
          s.begin_time,
          s.end_time,
        ),
      );
      break;
    case "huawei":
      cues = (raw.segments || []).map((s: any) =>
        timed(s.result?.text || s.text, s.start_time, s.end_time),
      );
      break;
    case "azure":
      cues = (raw.phrases || raw.recognizedPhrases || []).map((s: any) => {
        const offset = s.offsetMilliseconds ?? s.offsetInTicks / 10000;
        return timed(
          s.text || s.nBest?.[0]?.display,
          offset,
          offset + (s.durationMilliseconds ?? s.durationInTicks / 10000),
          1,
          s.speaker?.toString(),
        );
      });
      break;
    case "google": {
      const results = raw.results || [];
      cues = fromWords(
        results.flatMap((r: any) => r.alternatives?.[0]?.words || []),
        (w: any) => ({
          text: w.word,
          startMs: number(w.startOffset || w.startTime) * 1000,
          endMs: number(w.endOffset || w.endTime) * 1000,
          speaker: w.speakerLabel,
        }),
      );
      break;
    }
    case "aws":
      language = raw.results?.language_code || "auto";
      cues = fromWords(
        (raw.results?.items || []).filter(
          (w: any) => w.type === "pronunciation",
        ),
        (w: any) => ({
          text: w.alternatives?.[0]?.content,
          startMs: number(w.start_time) * 1000,
          endMs: number(w.end_time) * 1000,
          speaker: w.speaker_label,
        }),
      );
      break;
    case "ibm":
      cues = fromWords(
        (raw.results || []).flatMap(
          (r: any) => r.alternatives?.[0]?.timestamps || [],
        ),
        (w: any) => ({
          text: w[0],
          startMs: number(w[1]) * 1000,
          endMs: number(w[2]) * 1000,
        }),
      );
      break;
    case "deepgram":
      cues = fromWords(
        raw.results?.channels?.[0]?.alternatives?.[0]?.words || [],
        (w: any) => ({
          text: w.punctuated_word || w.word,
          startMs: number(w.start) * 1000,
          endMs: number(w.end) * 1000,
          speaker: w.speaker?.toString(),
        }),
      );
      break;
    case "assemblyai":
      cues = fromWords(raw.words || [], (w: any) => ({
        text: w.text,
        startMs: number(w.start),
        endMs: number(w.end),
        speaker: w.speaker,
      }));
      break;
    case "elevenlabs":
      cues = fromWords(
        (raw.words || []).filter((w: any) => w.type === "word"),
        (w: any) => ({
          text: w.text,
          startMs: number(w.start) * 1000,
          endMs: number(w.end) * 1000,
          speaker: w.speaker_id,
        }),
      );
      break;
    case "speechmatics":
      cues = fromWords(
        (raw.results || []).filter((w: any) => w.type === "word"),
        (w: any) => ({
          text: w.alternatives?.[0]?.content,
          startMs: number(w.start_time) * 1000,
          endMs: number(w.end_time) * 1000,
          speaker: w.alternatives?.[0]?.speaker,
        }),
      );
      break;
    case "iflytek": {
      let data =
        raw.orderResult || raw.content?.orderResult || raw.result || raw;
      if (typeof data === "string") data = JSON.parse(data);
      cues = (data.lattice || data.lattice2 || []).map((s: any) => {
        const j =
          typeof s.json_1best === "string"
            ? JSON.parse(s.json_1best)
            : s.json_1best || s;
        const st = j.st || j;
        return timed(
          (st.rt || [])
            .flatMap((r: any) => r.ws || [])
            .map((w: any) => w.cw?.[0]?.w || "")
            .join(""),
          st.bg,
          st.ed,
          1,
          st.rl,
        );
      });
      break;
    }
  }
  const valid = cues.filter((c): c is Cue => !!c);
  if (!valid.length)
    throw new ProviderError(
      "ASR 未返回有效的带时间戳字幕（可能为静音、无语音或不支持时间戳的模型）",
      "NO_TIMESTAMPS",
    );
  return { language, cues: valid, model: raw.model };
}
