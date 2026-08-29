import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const base = process.env.SUBTITLE_TEST_BASE_URL;
const password = process.env.SUBTITLE_TEST_PASSWORD;
const video = process.env.SUBTITLE_TEST_VIDEO;
test(
  "HTTP login, CSRF, resumable checksummed upload, media range and logout",
  { skip: !base || !password || !video },
  async () => {
    const origin = new URL(base!).origin;
    const request = (path: string, init: RequestInit = {}) =>
      fetch(base + path, init);
    assert.equal((await request("/projects")).status, 401);
    const login = await request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ password }),
    });
    assert.equal(login.status, 200, await login.text());
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const headers = { Cookie: cookie, Origin: origin };
    const post = (path: string, body: unknown) =>
      request(path, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const csrf = await request("/rpc", {
      method: "POST",
      headers: {
        ...headers,
        Origin: "https://attacker.invalid",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ method: "state" }),
    });
    assert.equal(csrf.status, 403);
    assert.equal(
      (await post("/uploads", { name: "bad.txt", size: 8 })).status,
      400,
    );
    const data = await readFile(video!);
    const created = await post("/uploads", {
      name: "自动测试 upload.mp4",
      size: data.length,
    });
    assert.equal(created.status, 200);
    const { id } = await created.json(),
      half = Math.floor(data.length / 2);
    const patch = (
      offset: number,
      bytes: Buffer,
      checksum = createHash("sha256").update(bytes).digest("hex"),
    ) =>
      request("/uploads/" + id, {
        method: "PATCH",
        headers: {
          ...headers,
          "Upload-Offset": String(offset),
          "Upload-Checksum": checksum,
        },
        body: new Uint8Array(bytes),
      });
    assert.equal((await patch(0, data.subarray(0, half), "wrong")).status, 400);
    assert.equal(
      (await (await request("/uploads/" + id, { headers })).json()).offset,
      0,
    );
    assert.equal((await patch(0, data.subarray(0, half))).status, 200);
    assert.equal((await patch(0, data.subarray(0, half))).status, 409);
    assert.equal(
      (await (await request("/uploads/" + id, { headers })).json()).offset,
      half,
    );
    assert.equal((await patch(half, data.subarray(half))).status, 200);
    const completed = await post("/uploads/" + id + "/complete", {});
    assert.equal(completed.status, 200);
    const project = await completed.json();
    assert.equal(project.name, "自动测试 upload.mp4");
    const partial = await request("/media/" + project.id, {
      headers: { ...headers, Range: "bytes=0-99" },
    });
    assert.equal(partial.status, 206);
    assert.deepEqual(
      Buffer.from(await partial.arrayBuffer()),
      data.subarray(0, 100),
    );
    assert.equal((await post("/auth/logout", {})).status, 200);
    assert.equal((await request("/projects", { headers })).status, 401);
  },
);
