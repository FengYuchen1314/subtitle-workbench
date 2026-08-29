import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseSubtitles,
  exportSubtitles,
  editCue,
  splitCue,
  mergeCues,
  combineTranscripts,
  validateTranslation,
  timestamp,
  defaultStyle,
  cue,
} from "@subtitle/core";
test("shared Kotlin/TypeScript timeline fixture restores offsets, clamps and removes overlap", () => {
  const f = JSON.parse(
    readFileSync(new URL("./fixtures/timeline.json", import.meta.url), "utf8"),
  );
  const result = combineTranscripts(
    f.parts.map((p: any) => ({
      offsetMs: p.offsetMs,
      transcript: { language: "en", cues: [cue(p.text, p.startMs, p.endMs)] },
    })),
    f.durationMs,
  );
  assert.deepEqual(
    result.cues.map(({ text, startMs, endMs }) => ({ text, startMs, endMs })),
    f.expected,
  );
});
const sample =
  "1\n00:00:01,250 --> 00:00:03,000\n你好，world!\n\n2\n00:00:04,000 --> 00:00:05,000\n第二行";
test("SRT/VTT round trip retains real timestamps and Unicode", () => {
  const doc = parseSubtitles(sample);
  for (const f of ["srt", "vtt"] as const)
    assert.deepEqual(
      parseSubtitles(exportSubtitles(doc, f, "source")).cues.map(
        ({ text, startMs, endMs }) => ({ text, startMs, endMs }),
      ),
      doc.cues.map(({ text, startMs, endMs }) => ({ text, startMs, endMs })),
    );
  assert.equal(timestamp(10800001), "03:00:00,001");
});
test("source edit invalidates translations; time edit preserves them", () => {
  const d = parseSubtitles(sample);
  const c = d.cues[0];
  c.translations.en = {
    text: "Hello world",
    sourceRevision: 1,
    provider: "test",
  };
  d.cues[1].translations.en = {
    text: "Second",
    sourceRevision: 1,
    provider: "test",
  };
  assert.match(
    exportSubtitles(
      editCue(d, c.id, { startMs: 1000 }),
      "srt",
      "bilingual",
      "en",
    ),
    /Hello world/,
  );
  assert.throws(
    () =>
      exportSubtitles(
        editCue(d, c.id, { text: "改写" }),
        "srt",
        "bilingual",
        "en",
      ),
    /过期/,
  );
});
test("split/merge creates independent cues; ASS neutralizes tag injection", () => {
  const d = parseSubtitles(sample);
  const split = splitCue(d, d.cues[0].id, 2000);
  assert.equal(split.cues.length, 3);
  assert.equal(mergeCues(split, split.cues[0].id).cues.length, 2);
  d.cues[0].text = "{\\pos(0,0)}危险";
  const ass = exportSubtitles(d, "ass", "source", "", defaultStyle);
  assert.ok(!ass.includes("{\\pos"));
  assert.match(ass, /0:00:01.25/);
});
test("chunk offsets do not compress silence and duplicate overlap is removed", () => {
  const d = parseSubtitles(sample);
  const result = combineTranscripts(
    [{ offsetMs: 10000, transcript: { language: "zh", cues: d.cues } }],
    30000,
  );
  assert.equal(result.cues[0].startMs, 11250);
  assert.equal(result.cues[1].startMs, 14000);
});
test("translation rejects dropped, duplicated and invented IDs", () => {
  assert.throws(() =>
    validateTranslation(["a", "b"], [{ id: "a", text: "A" }]),
  );
  assert.throws(() =>
    validateTranslation(
      ["a"],
      [
        { id: "a", text: "A" },
        { id: "a", text: "B" },
      ],
    ),
  );
  assert.deepEqual(validateTranslation(["a"], [{ id: "a", text: "A" }]), {
    a: "A",
  });
});
