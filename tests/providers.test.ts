import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CloudAsr,
  CloudTranslation,
  normalize,
  privateAddress,
  tencentHeaders,
  awsHeaders,
  catalog,
  type Transport,
} from "@subtitle/providers";
import type { Profile } from "@subtitle/core";
const profile = (provider: string): Profile => ({
  id: "test",
  name: "test",
  provider,
  model: "whisper-1",
  options: { region: "us-east-1" },
  secrets: { apiKey: "test", accessKey: "id", secretKey: "secret" },
  allowPrivateEndpoint: false,
  verification: "unverified",
});
test("all 16 providers normalize timed fixtures and reject pure text", () => {
  const fixtures = JSON.parse(
    readFileSync(new URL("./fixtures/asr.json", import.meta.url), "utf8"),
  );
  assert.equal(Object.keys(fixtures).length, 16);
  for (const [id, data] of Object.entries(fixtures)) {
    const c = normalize(id, data).cues[0];
    assert.equal(c.startMs, 1000, id);
    assert.equal(c.endMs, 2000, id);
    assert.equal(c.text, "hello", id);
  }
  assert.throws(() => normalize("openai", { text: "no timing" }), /时间戳/);
});
test("OpenAI request uses multipart and timestamp response; no real API traffic", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subtitle-asr-"));
  try {
    const path = join(dir, "audio.wav");
    writeFileSync(path, "fixture");
    let called = false;
    const transport: Transport = {
      async request(url, request) {
        called = true;
        assert.match(url, /audio\/transcriptions$/);
        assert.ok(request?.body instanceof FormData);
        assert.equal(request.body.get("response_format"), "verbose_json");
        return { segments: [{ text: "hello", start: 0, end: 1 }] } as any;
      },
    };
    assert.equal(
      (
        await new CloudAsr(profile("openai"), transport).submit({
          path,
          durationMs: 1000,
          language: "en",
          requestId: "id",
        })
      ).type,
      "complete",
    );
    assert.ok(called);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("native AWS and Tencent signing is deterministic and includes scoped credentials", () => {
  const p = profile("aws"),
    date = new Date("2026-08-29T00:00:00Z");
  const headers = awsHeaders(
    p,
    "https://transcribe.us-east-1.amazonaws.com/",
    "transcribe",
    "{}",
    "POST",
    date,
  );
  assert.match(
    headers.Authorization,
    /20260829\/us-east-1\/transcribe\/aws4_request/,
  );
  assert.equal(headers["x-amz-date"], "20260829T000000Z");
  assert.deepEqual(
    headers,
    awsHeaders(
      p,
      "https://transcribe.us-east-1.amazonaws.com/",
      "transcribe",
      "{}",
      "POST",
      date,
    ),
  );
  assert.match(
    tencentHeaders(p, "{}", "CreateRecTask", date).Authorization,
    /TC3-HMAC-SHA256/,
  );
});
test("private network addresses are blocked by default", () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fd00::1",
  ])
    assert.ok(privateAddress(ip), ip);
  assert.ok(!privateAddress("8.8.8.8"));
});
test("translation validates IDs before returning any edits", async () => {
  const p = profile("llm-openai");
  const transport: Transport = {
    async request() {
      return {
        choices: [
          {
            message: {
              content: '{"translations":[{"id":"wrong","text":"你好"}]}',
            },
          },
        ],
      } as any;
    },
  };
  await assert.rejects(
    new CloudTranslation(p, transport).translate(
      [{ id: "cue-1", text: "hello" }],
      "en",
      "zh",
      "",
      "",
    ),
    /未知字幕/,
  );
});
