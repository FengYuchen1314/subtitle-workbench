import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { FfmpegEngine, runProcess } from "@subtitle/runtime";
import { cue, defaultStyle, emptyDocument } from "@subtitle/core";

test(
  "three-hour synthetic video: absolute subtitle times, audio, and all three output modes",
  { timeout: 600000 },
  async () => {
    const dir = resolve("data/qa/three-hour");
    await mkdir(dir, { recursive: true });
    const input = join(dir, "三小时 测试.mp4");
    await runProcess("ffmpeg", [
      "-hide_banner",
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=0x173d36:size=320x180:rate=1:duration=10800",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=16000:duration=10800",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-tune",
      "stillimage",
      "-c:a",
      "aac",
      "-b:a",
      "24k",
      "-shortest",
      input,
    ]);
    const sourceSize = (await stat(input)).size;
    const doc = emptyDocument();
    doc.language = "zh";
    doc.cues = [
      cue("开场 · First", 1000, 4000),
      cue("中段 · Middle", 5400000, 5403000),
      cue("片尾 · End", 10796000, 10799000),
    ];
    for (const c of doc.cues)
      c.translations.en = {
        text: "Subtitles stay on time.",
        sourceRevision: c.revision,
        provider: "manual",
      };
    const engine = new FfmpegEngine();
    const info = await engine.probe(input);
    assert.ok(Math.abs(info.durationMs - 10800000) < 1000);
    for (const mode of ["source", "translation", "bilingual"] as const) {
      const output = join(dir, mode + ".mp4");
      await engine.render(input, output, doc, defaultStyle, {
        mode,
        targetLanguage: "en",
      });
      const result = await engine.probe(output);
      assert.equal(result.audioCodec, "aac");
      assert.ok(Math.abs(result.durationMs - info.durationMs) < 1000);
    }
    for (const [name, time] of [
      ["first", "2"],
      ["middle", "5401"],
      ["last", "10797"],
    ] as const) {
      const output = join(dir, name + ".png");
      const blank = join(dir, name + "-original.png");
      for (const [video, png] of [
        [join(dir, "bilingual.mp4"), output],
        [input, blank],
      ])
        await runProcess("ffmpeg", [
          "-v",
          "error",
          "-y",
          "-ss",
          time,
          "-i",
          video,
          "-frames:v",
          "1",
          png,
        ]);
      assert.notDeepEqual(
        await readFile(output),
        await readFile(blank),
        `${name}: subtitle must be present`,
      );
    }
    assert.equal((await stat(input)).size, sourceSize);
    await writeFile(
      join(dir, "result.json"),
      JSON.stringify(
        {
          durationMs: info.durationMs,
          modes: ["source", "translation", "bilingual"],
          verifiedFramesSeconds: [2, 5401, 10797],
          audio: "aac",
          note: "Synthetic 320x180 1 fps fixture; not a real speech-recognition accuracy benchmark.",
        },
        null,
        2,
      ),
    );
  },
);
