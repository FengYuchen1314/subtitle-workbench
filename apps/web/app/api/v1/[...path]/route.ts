import { NextRequest } from "next/server";
import { createReadStream } from "node:fs";
import { open, rename, stat, statfs } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import { Readable } from "node:stream";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { passwordHash, passwordMatches } from "@subtitle/runtime";
import { getService } from "../../../../server/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const attempts = new Map<string, { time: number; count: number }>();
const uploadLocks = new Set<string>();
function limited(key: string, max = 12) {
  const now = Date.now();
  let entry = attempts.get(key);
  if (!entry || now - entry.time > 60000) {
    entry = { time: now, count: 0 };
    attempts.set(key, entry);
  }
  if (++entry.count > max) throw new Error("请求过于频繁，请稍后重试");
}
async function smallJson(req: NextRequest) {
  const reader = req.body?.getReader(),
    decoder = new TextDecoder();
  let body = "",
    bytes = 0;
  if (reader)
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      body += decoder.decode(value, { stream: true });
      bytes += value.byteLength;
      if (bytes > 2 * 1024 * 1024) {
        await reader.cancel();
        throw new Error("请求超出大小限制");
      }
    }
  body += decoder.decode();
  return JSON.parse(body || "{}");
}
async function fileResponse(req: NextRequest, path: string, download = false) {
  const info = await stat(path);
  let start = 0,
    end = info.size - 1,
    status = 200;
  const range = req.headers.get("range");
  if (range) {
    const m = range.match(/^bytes=(\d+)-(\d*)$/);
    if (!m) return new Response(null, { status: 416 });
    start = +m[1];
    end = m[2] ? Math.min(+m[2], end) : end;
    if (start > end || start >= info.size)
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${info.size}` },
      });
    status = 206;
  }
  const stream = Readable.toWeb(
    createReadStream(path, { start, end }),
  ) as ReadableStream;
  return new Response(stream, {
    status,
    headers: {
      "Content-Type":
        (
          {
            ".webm": "video/webm",
            ".mov": "video/quicktime",
            ".mkv": "video/x-matroska",
            ".avi": "video/x-msvideo",
          } as Record<string, string>
        )[extname(path).toLowerCase()] || "video/mp4",
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...(status === 206
        ? { "Content-Range": `bytes ${start}-${end}/${info.size}` }
        : {}),
      ...(download
        ? {
            "Content-Disposition": `attachment; filename="subtitled-video.mp4"`,
          }
        : {}),
    },
  });
}
async function handle(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const service = getService();
  const { path } = await context.params,
    s = service.store,
    route = path.join("/");
  try {
    if (req.method !== "GET") {
      const origin = req.headers.get("origin");
      if (origin) {
        const parsed = new URL(origin);
        const allowed = process.env.SUBTITLE_PUBLIC_ORIGIN
          ? origin === process.env.SUBTITLE_PUBLIC_ORIGIN
          : ["http:", "https:"].includes(parsed.protocol) &&
            parsed.host === req.headers.get("host");
        if (!allowed) return json({ error: "跨站请求被拒绝" }, 403);
      }
    }
    const authHash = s.setting("adminHash") || process.env.SUBTITLE_ADMIN_HASH;
    if (route === "auth/status") {
      const token = req.cookies.get("subtitle_session")?.value;
      const row = token
        ? (s.db
            .prepare("SELECT expires FROM sessions WHERE token=?")
            .get(digest(token)) as any)
        : undefined;
      return json({
        configured: !!authHash,
        authenticated: !!row && row.expires > Date.now(),
        setupAllowed: !!process.env.SUBTITLE_SETUP_TOKEN,
      });
    }
    if (route === "auth/login" || route === "auth/setup") {
      if (req.method !== "POST")
        return json({ error: "Method not allowed" }, 405);
      limited("login");
      const body = await smallJson(req);
      if (route === "auth/setup") {
        if (authHash) return json({ error: "管理员已配置" }, 409);
        if (
          !process.env.SUBTITLE_SETUP_TOKEN ||
          digest(String(body.setupToken)) !==
            digest(process.env.SUBTITLE_SETUP_TOKEN)
        )
          return json({ error: "初始化令牌不正确，请运行 npm run setup" }, 403);
        if (typeof body.password !== "string" || body.password.length < 12)
          return json({ error: "密码至少需要 12 位" }, 400);
        s.setSetting("adminHash", passwordHash(body.password));
      } else if (!authHash || !passwordMatches(String(body.password), authHash))
        return json({ error: "密码不正确" }, 401);
      const token = randomBytes(32).toString("hex");
      s.db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
      s.db
        .prepare("INSERT INTO sessions VALUES (?,?)")
        .run(digest(token), Date.now() + 86400000);
      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": `subtitle_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${req.nextUrl.protocol === "https:" || process.env.SUBTITLE_COOKIE_SECURE === "true" ? "; Secure" : ""}`,
        },
      });
    }
    const token = req.cookies.get("subtitle_session")?.value,
      row = token
        ? (s.db
            .prepare("SELECT expires FROM sessions WHERE token=?")
            .get(digest(token)) as any)
        : undefined;
    if (!row || row.expires < Date.now())
      return json({ error: "请先登录" }, 401);
    if (route === "auth/logout" && req.method === "POST") {
      s.db.prepare("DELETE FROM sessions WHERE token=?").run(digest(token!));
      return new Response("{}", {
        headers: {
          "Set-Cookie":
            "subtitle_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
        },
      });
    }
    if (route === "rpc" && req.method === "POST") {
      limited("rpc", 300);
      const body = await smallJson(req);
      return json(await service.call(body.method, body.args));
    }
    if (
      req.method === "GET" &&
      ["projects", "providers", "jobs", "catalog"].includes(route)
    ) {
      const state = (await service.call("state")) as any;
      return json(
        route === "catalog"
          ? await service.call("catalog")
          : state[route === "providers" ? "profiles" : route],
      );
    }
    if (path[0] === "media" && path[1] && req.method === "GET")
      return fileResponse(req, s.mediaPath(path[1]));
    if (path[0] === "outputs" && path[1] && req.method === "GET") {
      const job = s.job(path[1]);
      if (job.status !== "completed" || !job.outputName)
        return json({ error: "输出尚未完成" }, 409);
      return fileResponse(req, join(s.root, "jobs", job.id, "video.mp4"), true);
    }
    if (route === "uploads" && req.method === "POST") {
      limited("uploads", 30);
      const body = await smallJson(req);
      if (
        !Number.isSafeInteger(body.size) ||
        body.size < 1 ||
        body.size > 30 * 1024 ** 3
      )
        throw new Error("文件大小无效（上限 30 GB）");
      const id = crypto.randomUUID();
      if (!/\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(String(body.name)))
        throw new Error("不支持的上传格式");
      const disk = await statfs(s.root);
      if (disk.bavail * disk.bsize < body.size + 64 * 1024 * 1024)
        throw new Error("服务器磁盘空间不足");
      s.db
        .prepare("INSERT INTO uploads VALUES (?,?,?,?,?)")
        .run(
          id,
          basename(String(body.name)).slice(0, 160),
          body.size,
          0,
          Date.now(),
        );
      const file = await open(join(s.root, "uploads", id), "wx");
      await file.close();
      return json({ id, offset: 0 });
    }
    if (path[0] === "uploads" && path[1]) {
      const id = path[1];
      const upload = s.db
        .prepare("SELECT * FROM uploads WHERE id=?")
        .get(id) as any;
      if (!upload) throw new Error("上传不存在");
      if (req.method === "GET")
        return json({ id, offset: upload.offset, size: upload.size });
      if (req.method === "PATCH") {
        if (uploadLocks.has(id)) return json({ error: "上传正在写入" }, 409);
        const offset = Number(req.headers.get("upload-offset"));
        if (!Number.isSafeInteger(offset) || offset !== upload.offset)
          return json({ error: "上传偏移不匹配", offset: upload.offset }, 409);
        uploadLocks.add(id);
        const file = await open(join(s.root, "uploads", id), "r+");
        let size = 0;
        const checksum = createHash("sha256");
        try {
          const reader = req.body?.getReader();
          if (reader)
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              size += value.length;
              checksum.update(value);
              if (size > 8 * 1024 * 1024 || offset + size > upload.size) {
                await reader.cancel();
                throw new Error("上传分块超限");
              }
              let written = 0;
              while (written < value.length) {
                const result = await file.write(
                  value,
                  written,
                  value.length - written,
                  offset + size - value.length + written,
                );
                if (!result.bytesWritten) throw new Error("无法写入上传文件");
                written += result.bytesWritten;
              }
            }
          if (checksum.digest("hex") !== req.headers.get("upload-checksum"))
            throw new Error("上传分块校验失败，请重试");
          await file.sync();
          s.db
            .prepare("UPDATE uploads SET offset=? WHERE id=?")
            .run(offset + size, id);
          return json({ id, offset: offset + size });
        } finally {
          await file.close();
          uploadLocks.delete(id);
        }
      }
      if (req.method === "POST" && path[2] === "complete") {
        if (upload.offset !== upload.size) throw new Error("文件尚未上传完整");
        if (uploadLocks.has(id)) throw new Error("文件仍在写入");
        uploadLocks.add(id);
        try {
          const destination = join(
            s.root,
            "media",
            `${id}${/\.[a-zA-Z0-9]+$/.exec(upload.name)?.[0] || ".video"}`,
          );
          const source = join(s.root, "uploads", id);
          await rename(source, destination);
          let project;
          try {
            project = await service.importVideo(destination, upload.name);
          } catch (error) {
            await rename(destination, source);
            throw error;
          }
          s.db.prepare("DELETE FROM uploads WHERE id=?").run(id);
          return json(project);
        } finally {
          uploadLocks.delete(id);
        }
      }
    }
    return json({ error: "接口不存在" }, 404);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "请求失败" },
      error instanceof Error && error.message.includes("请求过于频繁")
        ? 429
        : 400,
    );
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
