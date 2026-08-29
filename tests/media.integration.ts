import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { defaultStyle, parseSubtitles } from "@subtitle/core";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FfmpegEngine, runProcess, Store, Service } from "@subtitle/runtime";
import { executeJob } from "../packages/runtime/src/worker";
test("real FFmpeg: video -> import bilingual subtitles -> independent render -> probe", async () => {
  const dir = await mkdtemp(join(tmpdir(), "字幕 media test "));
  const store = new Store(join(dir, "store"));
  try {
    const input = join(dir, "source 视频.mp4");
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=640x360:rate=25",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000",
      "-t",
      "3",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      input,
    ]);
    const api = new Service(store),
      p = await api.importVideo(input);
    await api.call("subtitle.import", {
      id: p.id,
      text: "1\n00:00:00,200 --> 00:00:01,600\n你好，字幕\n\n2\n00:00:01,800 --> 00:00:02,900\n第二句",
    });
    let updated = store.project(p.id);
    for (const c of updated.document.cues)
      c.translations.en = {
        text: "Real subtitles",
        sourceRevision: c.revision,
        provider: "manual",
      };
    store.saveProject(updated);
    const sourceStat = await stat(input);
    const job = store.createJob(p.id, "render", {
      mode: "bilingual",
      targetLanguage: "en",
    });
    store.claim();
    await executeJob(store, job);
    assert.equal(
      store.job(job.id).status,
      "completed",
      store.job(job.id).error,
    );
    assert.equal((await stat(input)).size, sourceStat.size);
    const output = await new FfmpegEngine().probe(
      join(store.root, "jobs", job.id, "video.mp4"),
    );
    assert.equal(output.width, 640);
    assert.ok(Math.abs(output.durationMs - 3000) < 100);
    assert.equal(output.audioCodec, "aac");
    assert.equal(store.profiles().length, 0);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("portrait, absent audio, delayed audio, alternate codec track and cancellation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "字幕 edge "));
  const engine = new FfmpegEngine();
  const document = parseSubtitles(
    "1\n00:00:00,100 --> 00:00:01,900\n中文 English",
  );
  try {
    const silent = join(dir, "无音轨 [竖屏] '视频'.mp4");
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=160x288:r=10",
      "-t",
      "2",
      "-c:v",
      "libx264",
      silent,
    ]);
    assert.equal((await engine.probe(silent)).audioTracks.length, 0);
    await engine.render(
      silent,
      join(dir, "silent-output.mp4"),
      document,
      defaultStyle,
      { mode: "source" },
    );
    assert.equal(
      (await engine.probe(join(dir, "silent-output.mp4"))).height,
      288,
    );
    await assert.rejects(
      engine.extract(silent, join(dir, "missing.wav")),
      /媒体处理失败/,
    );

    const delayed = join(dir, "delayed.mp4");
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=160x90:r=10",
      "-itsoffset",
      "1",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=880:sample_rate=16000",
      "-t",
      "4",
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      delayed,
    ]);
    await engine.extract(delayed, join(dir, "delayed.wav"));
    const wav = await readFile(join(dir, "delayed.wav")),
      start = wav.indexOf(Buffer.from("data")) + 8;
    const peak = (from: number, to: number) => {
      let max = 0;
      for (let i = from; i < to; i++)
        max = Math.max(max, Math.abs(wav.readInt16LE(start + i * 2)));
      return max;
    };
    assert.equal(
      peak(0, 8000),
      0,
      "nonzero input audio start is padded with silence",
    );
    assert.ok(peak(24000, 32000) > 100, "later audio is preserved");

    const multi = join(dir, "two-tracks.mkv");
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=160x90:r=10",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=880",
      "-map",
      "0:v",
      "-map",
      "1:a",
      "-map",
      "2:a",
      "-t",
      "2",
      "-c:v",
      "libx264",
      "-c:a:0",
      "aac",
      "-c:a:1",
      "pcm_s16le",
      multi,
    ]);
    assert.equal((await engine.probe(multi)).audioTracks[1].codec, "pcm_s16le");
    await engine.render(
      multi,
      join(dir, "selected.mp4"),
      document,
      defaultStyle,
      { mode: "source", audioTrack: 1 },
    );
    assert.equal(
      (await engine.probe(join(dir, "selected.mp4"))).audioCodec,
      "aac",
    );
    const controller = new AbortController();
    const running = runProcess(
      "ffmpeg",
      [
        "-nostdin",
        "-v",
        "error",
        "-re",
        "-f",
        "lavfi",
        "-i",
        "anullsrc",
        "-f",
        "null",
        "-",
      ],
      controller.signal,
    );
    const timer = setTimeout(() => controller.abort(), 200);
    await assert.rejects(running, /取消/);
    clearTimeout(timer);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("native worker uses real multipart HTTP, checkpoints uncertain submissions, and keeps render independent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "字幕 worker "));
  let store = new Store(join(dir, "db"));
  let calls = 0,
    disconnect = false;
  const server = createServer(async (req, res) => {
    calls++;
    const parts: Buffer[] = [];
    for await (const part of req) parts.push(Buffer.from(part));
    const body = Buffer.concat(parts);
    if (disconnect) {
      req.socket.destroy();
      return;
    }
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/asr") {
      assert.match(req.headers["content-type"] || "", /multipart\/form-data/);
      assert.ok(body.includes(Buffer.from("RIFF")));
      res.end(
        JSON.stringify({
          language: "en",
          cues: [{ startMs: 100, endMs: 1900, text: "fixture speech" }],
        }),
      );
    } else {
      const request = JSON.parse(body.toString()),
        data = JSON.parse(request.messages[1].content);
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  translations: data.subtitles.map((c: any) => ({
                    id: c.id,
                    text: "测试译文",
                  })),
                }),
              },
            },
          ],
        }),
      );
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number },
    base = `http://127.0.0.1:${address.port}`;
  try {
    const input = join(dir, "input.mp4");
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=160x90:r=10",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440",
      "-t",
      "2",
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      input,
    ]);
    const service = new Service(store),
      p = await service.importVideo(input);
    for (const [id, provider, endpoint] of [
      ["asr", "custom-json", base + "/asr"],
      ["translation", "llm-openai", base],
    ])
      store.saveProfile({
        id,
        name: "local contract fixture",
        provider,
        model: "fixture",
        options: { endpoint },
        secrets: {},
        allowPrivateEndpoint: true,
        verification: "unverified",
      });
    for (const [kind, params] of [
      ["transcribe", { profileId: "asr", language: "en" }],
      ["translate", { profileId: "translation", targetLanguage: "zh" }],
      ["render", { mode: "bilingual", targetLanguage: "zh" }],
    ] as const) {
      const job = store.createJob(p.id, kind, params);
      store.claim();
      await executeJob(store, job);
      assert.equal(
        store.job(job.id).status,
        "completed",
        store.job(job.id).error,
      );
    }
    assert.equal(calls, 2, "render must make no model request");
    assert.equal(
      store.project(p.id).document.cues[0].translations.zh.text,
      "测试译文",
    );
    disconnect = true;
    const interrupted = store.createJob(p.id, "transcribe", {
      profileId: "asr",
    });
    store.claim();
    await executeJob(store, interrupted);
    assert.equal(store.job(interrupted.id).status, "attention");
    const count = calls;
    store.close();
    store = new Store(join(dir, "db"));
    await new Service(store).call("job.retry", { id: interrupted.id });
    store.claim();
    await executeJob(store, interrupted);
    assert.equal(
      calls,
      count,
      "restart must not blindly resubmit an uncertain paid request",
    );
    assert.equal(store.job(interrupted.id).status, "attention");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
