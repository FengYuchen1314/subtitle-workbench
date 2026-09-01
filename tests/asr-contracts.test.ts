import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, createHmac } from "node:crypto";
import {
  CloudAsr,
  catalog,
  ProviderError,
  type HttpRequest,
  type Transport,
} from "@subtitle/providers";
import type { Profile } from "@subtitle/core";
const fixtures = JSON.parse(
  readFileSync(new URL("./fixtures/asr.json", import.meta.url), "utf8"),
);
const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();
const responses = (id: string): any[] =>
  (
    ({
      openai: [fixtures.openai],
      groq: [fixtures.groq],
      aliyun: [
        { output: { task_id: "remote" } },
        {
          output: {
            task_status: "SUCCEEDED",
            result: {
              transcription_url: "https://results.example.test/result",
            },
          },
        },
        fixtures.aliyun,
      ],
      volcengine: [{}, fixtures.volcengine],
      tencent: [
        { Response: { Data: { TaskId: 42 } } },
        { Response: { Data: { Status: 2, ...fixtures.tencent } } },
      ],
      baidu: [
        { access_token: "fixture-token" },
        { task_id: "remote" },
        { access_token: "fixture-token" },
        { tasks_info: [{ task_status: "Success", ...fixtures.baidu }] },
      ],
      iflytek: [
        { content: { orderId: "remote" } },
        {
          content: {
            orderInfo: { status: 4 },
            orderResult: fixtures.iflytek.orderResult,
          },
        },
      ],
      huawei: [
        { job_id: "remote" },
        { status: "FINISHED", ...fixtures.huawei },
      ],
      azure: [fixtures.azure],
      google: [
        { access_token: "fixture-oauth", expires_in: 3600 },
        { name: "projects/test/locations/us/operations/remote" },
        {
          done: true,
          response: {
            results: {
              "gs://fixture/audio.wav": { transcript: fixtures.google },
            },
          },
        },
      ],
      aws: [
        {},
        {
          TranscriptionJob: {
            TranscriptionJobStatus: "COMPLETED",
            Transcript: {
              TranscriptFileUri: "https://results.example.test/result",
            },
          },
        },
        fixtures.aws,
      ],
      ibm: [{ id: "remote" }, { status: "completed", ...fixtures.ibm }],
      deepgram: [fixtures.deepgram],
      assemblyai: [
        { upload_url: "https://upload.example.test/audio" },
        { id: "remote" },
        { status: "completed", ...fixtures.assemblyai },
      ],
      elevenlabs: [fixtures.elevenlabs],
      speechmatics: [
        { id: "remote" },
        { job: { status: "done" } },
        fixtures.speechmatics,
      ],
      mistral: [{ words: [{ word: "hello", start: 1, end: 2 }] }],
      xai: [{ words: [{ text: "hello", start: 1, end: 2 }] }],
      soniox: [
        { id: "remote" },
        { status: "completed" },
        { tokens: [{ text: "hello", start_ms: 1000, end_ms: 2000 }] },
      ],
      gladia: [
        { audio_url: "https://upload.example.test/audio" },
        { id: "remote" },
        {
          status: "done",
          result: {
            transcription: {
              utterances: [{ text: "hello", start: 1, end: 2 }],
            },
          },
        },
      ],
      revai: [
        { id: "remote" },
        { status: "transcribed" },
        {
          monologues: [
            {
              speaker: 1,
              elements: [{ type: "text", value: "hello", ts: 1, end_ts: 2 }],
            },
          ],
        },
      ],
      cloudflare: [
        {
          result: {
            vtt: "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhello\n",
          },
        },
      ],
    }) as Record<string, any[]>
  )[id];
for (const def of catalog.filter(
  (p) => p.category === "asr" && !p.id.startsWith("custom"),
)) {
  test(`${def.id}: native submit, completion/poll, normalization, authentication failure`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "subtitle-contract-"));
    try {
      const file = join(dir, "audio.wav");
      writeFileSync(file, Buffer.from("fixture audio"));
      const p: Profile = {
        id: "fixture",
        name: "fixture",
        provider: def.id,
        model: def.models[0],
        options: {
          region: "us",
          projectId: "project",
          appId: "fixture-app",
          accountId: "fixture-account",
          ...(def.id === "ibm"
            ? { endpoint: "https://watson.example.test/speech" }
            : {}),
        },
        secrets: {
          apiKey: "fixture-key",
          accessKey: "fixture-access",
          secretKey: "fixture-secret",
          token: "fixture-token",
          serviceAccount: JSON.stringify({
            client_email: "fixture@example.test",
            private_key: privateKey,
          }),
        },
        verification: "unverified",
        allowPrivateEndpoint: false,
      };
      const queue = responses(def.id);
      const requests: { url: string; request: HttpRequest }[] = [];
      const transport: Transport = {
        async request(url, request = {}) {
          requests.push({ url, request });
          assert.ok(queue.length, `unexpected request: ${url}`);
          return queue.shift();
        },
      };
      const asr = new CloudAsr(p, transport);
      const input = {
        path: file,
        durationMs: 10000,
        url: "https://audio.example.test/audio.wav",
        objectUri: "gs://fixture/audio.wav",
        requestId: "12345678-1234-1234-1234-123456789012",
        language: "en",
      };
      let result = await asr.submit(input);
      if (result.type === "pending") {
        assert.ok(result.id);
        const next = await asr.poll(result);
        assert.notEqual(next.type, "waiting");
        result = next as typeof result;
      }
      assert.equal(result.type, "complete");
      if (result.type === "complete")
        assert.equal(result.transcript.cues[0].startMs, 1000);
      assert.equal(queue.length, 0);
      assert.ok(requests[0].request.headers || def.id === "baidu");
      const bodies = requests
        .map((r) => JSON.stringify(r.request.json || {}))
        .join("");
      if (def.id === "tencent") {
        assert.match(
          requests[0].request.headers!.Authorization,
          /^TC3-HMAC-SHA256/,
        );
        assert.equal(
          JSON.parse(requests[0].request.body as string).ResTextFormat,
          3,
        );
      }
      if (def.id === "aws")
        assert.match(
          requests[0].request.headers!.Authorization,
          /^AWS4-HMAC-SHA256/,
        );
      if (def.id === "iflytek") {
        const first = new URL(requests[0].url),
          second = new URL(requests[1].url);
        assert.equal(first.searchParams.get("appId"), "fixture-app");
        assert.match(
          first.searchParams.get("dateTime")!,
          /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+0000$/,
        );
        assert.equal(first.searchParams.get("signatureRandom")!.length, 16);
        assert.equal(
          first.searchParams.get("signatureRandom"),
          second.searchParams.get("signatureRandom"),
        );
        assert.deepEqual(requests[1].request.json, {});
        assert.equal(
          requests[0].request.headers!.signature,
          createHmac("sha1", "fixture-secret")
            .update(first.search.slice(1))
            .digest("base64"),
        );
      }
      if (def.id === "aliyun") assert.match(bodies, /enable_words/);
      const denied: Transport = {
        async request() {
          throw new ProviderError("Unauthorized", "401");
        },
      };
      await assert.rejects(
        new CloudAsr(p, denied).submit(input),
        (error) => error instanceof ProviderError && error.code === "401",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
test("text-only OpenAI model is rejected before network submission", async () => {
  const asr = new CloudAsr(
    {
      id: "x",
      name: "x",
      provider: "openai",
      model: "gpt-4o-transcribe",
      options: {},
      secrets: { apiKey: "fixture" },
      allowPrivateEndpoint: false,
      verification: "unverified",
    },
    {
      async request() {
        throw new Error("must not request");
      },
    },
  );
  await assert.rejects(
    asr.submit({
      path: "does-not-exist",
      durationMs: 1,
      language: "auto",
      requestId: "id",
    }),
    /时间戳/,
  );
});
