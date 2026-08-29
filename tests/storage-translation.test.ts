import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  CloudStorage,
  CloudTranslation,
  catalog,
  type Transport,
} from "@subtitle/providers";
import type { Profile } from "@subtitle/core";
const key = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ format: "pem", type: "pkcs8" })
  .toString();
const profile = (id: string): Profile => ({
  id,
  name: "fixture",
  provider: id,
  model: "fixture-model",
  options: {
    bucket: "fixture-bucket",
    region: "us-east-1",
    projectId: "fixture-project",
  },
  secrets: {
    apiKey: "fixture",
    accessKey: "fixture-id",
    secretKey: "fixture-secret",
    serviceAccount: JSON.stringify({
      client_email: "fixture@example.test",
      private_key: key,
    }),
  },
  allowPrivateEndpoint: false,
  verification: "unverified",
});
for (const def of catalog.filter((p) => p.category === "storage"))
  test(`${def.id}: authenticated bounded audio PUT, signed URL and DELETE`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "subtitle-storage-"));
    try {
      const file = join(dir, "audio.wav"),
        data = Buffer.from([0, 255, 200, 201, 1, 2]);
      writeFileSync(file, data);
      const calls: { url: string; method: string }[] = [];
      const http: Transport = {
        async request(url, request = {}) {
          if (url.includes("oauth2"))
            return { access_token: "token", expires_in: 3600 } as any;
          calls.push({ url, method: request.method || "GET" });
          if (request.method === "PUT") {
            assert.ok(request.body instanceof Blob);
            assert.deepEqual(
              Buffer.from(await request.body.arrayBuffer()),
              data,
            );
            assert.ok(request.headers?.Authorization);
            if (def.id === "storage-s3")
              assert.equal(
                request.headers?.["x-amz-content-sha256"],
                createHash("sha256").update(data).digest("hex"),
              );
          }
          return {} as any;
        },
      };
      const storage = new CloudStorage(profile(def.id), http);
      const obj = await storage.put(file, "subtitle/job/audio.wav");
      assert.match(obj.url, /Signature|signature/);
      assert.ok(obj.expiresAt > Date.now() + 24 * 3600000);
      assert.match(obj.uri, def.id === "storage-gcs" ? /^gs:/ : /^s3:/);
      await storage.remove(obj.key);
      assert.deepEqual(
        calls.map((c) => c.method),
        ["PUT", "DELETE"],
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
for (const def of catalog.filter((p) => p.category === "translation"))
  test(`${def.id}: translation preserves every cue ID`, async () => {
    const http: Transport = {
      async request(url, request) {
        if (url.includes("oauth2"))
          return { access_token: "token", expires_in: 3600 } as any;
        assert.ok(request?.headers);
        const payload = request!.json as any;
        if (def.id === "llm-gemini")
          assert.deepEqual(
            payload.generationConfig.responseJsonSchema.required,
            ["translations"],
          );
        if (def.id === "llm-claude")
          assert.equal(payload.output_config.format.type, "json_schema");
        const text = JSON.stringify({
          translations: [
            { id: "a", text: "你好" },
            { id: "b", text: "世界" },
          ],
        });
        return (
          def.id === "deepl"
            ? { translations: [{ text: "你好" }, { text: "世界" }] }
            : def.id === "translate-google"
              ? {
                  translations: [
                    { translatedText: "你好" },
                    { translatedText: "世界" },
                  ],
                }
              : def.id === "translate-azure"
                ? [
                    { translations: [{ text: "你好" }] },
                    { translations: [{ text: "世界" }] },
                  ]
                : def.id === "llm-gemini"
                  ? { candidates: [{ content: { parts: [{ text }] } }] }
                  : def.id === "llm-claude"
                    ? { content: [{ type: "text", text }] }
                    : { choices: [{ message: { content: text } }] }
        ) as any;
      },
    };
    const output = await new CloudTranslation(profile(def.id), http).translate(
      [
        { id: "a", text: "hello" },
        { id: "b", text: "world" },
      ],
      "en",
      "zh",
      "context",
      "glossary",
    );
    assert.deepEqual(output, { a: "你好", b: "世界" });
  });
