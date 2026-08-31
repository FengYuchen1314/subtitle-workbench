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

test("subtitle mutations reject blank replacement, preserve no-ops and guard stale revisions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subtitle-edits-"));
  const store = new Store(dir);
  try {
    const api = new Service(store),
      p = store.createProject("edit");
    await api.call("subtitle.import", {
      id: p.id,
      text: "1\n00:00:00,000 --> 00:00:01,000\nhello world",
    });
    const current = store.project(p.id),
      c = current.document.cues[0];
    c.words = [{ text: "hello", startMs: 0, endMs: 500 }];
    c.translations.en = {
      text: "hello world",
      sourceRevision: c.revision,
      provider: "manual",
    };
    store.saveProject(current);
    await api.call("subtitle.replace", {
      id: p.id,
      search: "hello",
      replacement: "hello",
    });
    assert.deepEqual(
      store.project(p.id).document,
      current.document,
      "no-op replacement retains revisions and translations",
    );
    await assert.rejects(
      api.call("subtitle.replace", {
        id: p.id,
        search: "hello world",
        replacement: "",
      }),
      /字幕文字/,
    );
    assert.deepEqual(
      store.project(p.id).document,
      current.document,
      "invalid replacement is not persisted",
    );
    await api.call("subtitle.replace", {
      id: p.id,
      search: "hello",
      replacement: "new",
    });
    const edited = store.project(p.id).document.cues[0];
    assert.equal(edited.text, "new world");
    assert.equal(edited.words, undefined);
    assert.notEqual(edited.revision, edited.translations.en.sourceRevision);
    for (const method of [
      "subtitle.edit",
      "subtitle.split",
      "subtitle.merge",
      "subtitle.replace",
    ])
      await assert.rejects(
        api.call(method, {
          id: p.id,
          cueId: c.id,
          at: 500,
          search: "new",
          expectedRevision: current.document.revision,
        }),
        /其他窗口/,
      );
    await api.call("subtitle.edit", {
      id: p.id,
      cueId: c.id,
      language: "en",
      translation: " ",
    });
    assert.equal(
      store.project(p.id).document.cues[0].translations.en,
      undefined,
    );
    await assert.rejects(
      api.call("subtitle.export", {
        id: p.id,
        format: "srt",
        mode: "bilingual",
        language: "en",
      }),
      /缺失或过期/,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("completed jobs cannot be cancelled or retried, and safe retry keeps uncertain requests", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subtitle-jobs-"));
  const store = new Store(dir);
  try {
    const api = new Service(store),
      p = store.createProject("jobs"),
      job = store.createJob(p.id, "transcribe", {});
    store.updateJob(job.id, { status: "completed" });
    await assert.rejects(api.call("job.cancel", { id: job.id }), /已结束/);
    await assert.rejects(api.call("job.retry", { id: job.id }), /可以重试/);
    assert.equal(store.job(job.id).status, "completed");
    store.updateJob(job.id, { status: "attention" });
    store.saveCheckpoint(job.id, {
      chunks: [{ state: "submitting" }],
      batches: { 0: { state: "submitting" } },
    });
    await api.call("job.retry", { id: job.id });
    assert.equal(store.checkpoint(job.id).chunks[0].state, "submitting");
    assert.equal(store.checkpoint(job.id).batches[0].state, "submitting");
    store.updateJob(job.id, { status: "attention" });
    await api.call("job.retry", { id: job.id, confirmPaidRetry: true });
    assert.equal(store.checkpoint(job.id).chunks[0].state, "new");
    assert.deepEqual(store.checkpoint(job.id).batches, {});
    store.updateJob(job.id, { status: "running" });
    await api.call("job.cancel", { id: job.id });
    await assert.rejects(api.call("job.retry", { id: job.id }), /正在取消/);
    store.updateJob(job.id, { phase: "已取消" });
    await api.call("job.retry", { id: job.id });
    assert.equal(store.job(job.id).status, "queued");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("changing provider cannot carry saved secrets to another vendor", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subtitle-secrets-"));
  const store = new Store(dir);
  try {
    const api = new Service(store);
    const args = {
      name: "account",
      provider: "openai",
      model: "whisper-1",
      options: {},
      secrets: { apiKey: "fixture-only" },
      allowPrivateEndpoint: false,
    };
    const p = (await api.call("profile.save", args)) as { id: string };
    await assert.rejects(
      api.call("profile.save", {
        ...args,
        id: p.id,
        provider: "groq",
        secrets: {},
      }),
      /供应商/,
    );
    assert.equal(store.profile(p.id).provider, "openai");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
