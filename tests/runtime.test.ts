import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Store,
  Service,
  passwordHash,
  passwordMatches,
  inside,
  planChunks,
} from "@subtitle/runtime";
test("encrypted credentials, lease claims and restart checkpoints", () => {
  const dir = mkdtempSync(join(tmpdir(), "subtitle-store-"));
  let store = new Store(dir, "ab".repeat(32));
  try {
    store.saveProfile({
      id: "p",
      name: "test",
      provider: "openai",
      model: "whisper-1",
      options: {},
      secrets: { apiKey: "never-in-plaintext" },
      allowPrivateEndpoint: false,
      verification: "unverified",
    });
    assert.equal(store.profile("p").secrets.apiKey, "never-in-plaintext");
    assert.ok(!JSON.stringify(store.profiles()).includes("never-in-plaintext"));
    const p = store.createProject("Video");
    const job = store.createJob(p.id, "transcribe", { profileId: "p" });
    assert.equal(store.claim()?.id, job.id);
    assert.equal(store.claim(), undefined);
    store.saveCheckpoint(job.id, {
      remote: { id: "existing-task" },
      state: "pending",
    });
    store.close();
    store = new Store(dir, "ab".repeat(32));
    assert.equal(store.checkpoint(job.id).remote.id, "existing-task");
    const bytes = readFileSync(join(dir, "subtitle.sqlite"));
    assert.ok(!bytes.includes(Buffer.from("never-in-plaintext")));
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("password verification and confinement", () => {
  const hash = passwordHash("long password");
  assert.ok(passwordMatches("long password", hash));
  assert.ok(!passwordMatches("wrong", hash));
  assert.throws(() => inside(join(tmpdir(), "safe"), join(tmpdir(), "escape")));
});
test("chunks cover three hours without compressing time or exceeding limits", () => {
  const chunks = planChunks(10800000, 110, [105000, 214000]);
  assert.equal(chunks[0].endMs, 105000);
  assert.equal(chunks.at(-1)?.endMs, 10800000);
  chunks.forEach((c, i) => {
    assert.ok(c.endMs - c.startMs <= 110000);
    if (i) assert.equal(c.startMs, chunks[i - 1].endMs);
  });
});
test("service refuses rendering absent translations without creating a task", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subtitle-service-"));
  const store = new Store(dir);
  try {
    const api = new Service(store),
      project = store.createProject("字幕");
    await api.call("subtitle.import", {
      id: project.id,
      text: "1\n00:00:00,000 --> 00:00:01,000\nhello",
    });
    await assert.rejects(
      api.call("job.create", {
        id: project.id,
        kind: "render",
        params: { mode: "bilingual", targetLanguage: "zh-CN" },
      }),
    );
    assert.equal(store.jobs().length, 0);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
