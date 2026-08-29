import { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join, relative, isAbsolute } from "node:path";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import {
  defaultStyle,
  emptyDocument,
  type Project,
  type Profile,
  type PublicProfile,
  type Job,
  type JobKind,
  type JobParams,
} from "@subtitle/core";
export function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 32).toString("hex")}`;
}
export function passwordMatches(password: string, encoded: string) {
  try {
    const [salt, digest] = encoded.split(":");
    return timingSafeEqual(
      scryptSync(password, salt, 32),
      Buffer.from(digest, "hex"),
    );
  } catch {
    return false;
  }
}
export function inside(root: string, path: string) {
  const rel = relative(resolve(root), resolve(path));
  if (rel.startsWith("..") || isAbsolute(rel))
    throw new Error("文件路径超出授权目录");
  return resolve(path);
}
export class Store {
  readonly db: DatabaseSync;
  readonly root: string;
  private key: Buffer;
  constructor(
    root = process.env.SUBTITLE_DATA_DIR || "./data",
    masterKey = process.env.SUBTITLE_MASTER_KEY,
  ) {
    this.root = resolve(root);
    mkdirSync(this.root, { recursive: true });
    for (const dir of ["media", "jobs", "uploads"])
      mkdirSync(join(/*turbopackIgnore: true*/ this.root, dir), {
        recursive: true,
      });
    const keyPath = join(this.root, ".masterkey");
    if (!masterKey && !existsSync(keyPath)) {
      try {
        writeFileSync(keyPath, randomBytes(32).toString("hex"), {
          mode: 0o600,
          flag: "wx",
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    this.key = Buffer.from(
      masterKey || readFileSync(keyPath, "utf8").trim(),
      "hex",
    );
    if (this.key.length !== 32) throw new Error("主密钥必须为 64 位十六进制");
    this.db = new DatabaseSync(join(this.root, "subtitle.sqlite"));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, json TEXT NOT NULL, media_path TEXT);
      CREATE TABLE IF NOT EXISTS revisions (project_id TEXT NOT NULL,revision INTEGER NOT NULL,json TEXT NOT NULL,PRIMARY KEY(project_id,revision));
      CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, json TEXT NOT NULL, encrypted TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,status TEXT NOT NULL,updated_at INTEGER NOT NULL,json TEXT NOT NULL,checkpoint TEXT NOT NULL DEFAULT '{}');
      CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status,updated_at);
      CREATE TABLE IF NOT EXISTS uploads (id TEXT PRIMARY KEY,name TEXT NOT NULL,size INTEGER NOT NULL,offset INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY,expires INTEGER NOT NULL);
      PRAGMA user_version=1;`);
  }
  setting(key: string): string | undefined {
    return (
      this.db.prepare("SELECT value FROM settings WHERE key=?").get(key) as any
    )?.value;
  }
  setSetting(key: string, value: string) {
    this.db
      .prepare("INSERT OR REPLACE INTO settings VALUES (?,?)")
      .run(key, value);
  }
  encrypt(value: unknown): string {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const body = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
  }
  decrypt(value: string) {
    const data = Buffer.from(value, "base64"),
      cipher = createDecipheriv("aes-256-gcm", this.key, data.subarray(0, 12));
    cipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([
        cipher.update(data.subarray(28)),
        cipher.final(),
      ]).toString("utf8"),
    );
  }
  projects(): Project[] {
    return (this.db.prepare("SELECT json FROM projects").all() as any[])
      .map((r) => JSON.parse(r.json))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }
  project(id: string): Project {
    const row = this.db
      .prepare("SELECT json FROM projects WHERE id=?")
      .get(id) as any;
    if (!row) throw new Error("项目不存在");
    return JSON.parse(row.json);
  }
  mediaPath(id: string): string {
    const row = this.db
      .prepare("SELECT media_path FROM projects WHERE id=?")
      .get(id) as any;
    if (!row?.media_path) throw new Error("项目没有关联视频");
    return row.media_path;
  }
  createProject(name: string, mediaPath?: string): Project {
    const now = Date.now(),
      p: Project = {
        id: crypto.randomUUID(),
        name: name.slice(0, 160),
        createdAt: now,
        updatedAt: now,
        document: emptyDocument(),
        style: { ...defaultStyle },
      };
    this.db
      .prepare("INSERT INTO projects VALUES (?,?,?)")
      .run(p.id, JSON.stringify(p), mediaPath || null);
    return p;
  }
  saveProject(project: Project, expectedRevision?: number) {
    project.updatedAt = Date.now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const changed =
        expectedRevision === undefined
          ? this.db
              .prepare("UPDATE projects SET json=? WHERE id=?")
              .run(JSON.stringify(project), project.id)
          : this.db
              .prepare(
                "UPDATE projects SET json=? WHERE id=? AND json_extract(json,'$.document.revision')=?",
              )
              .run(JSON.stringify(project), project.id, expectedRevision);
      if (changed.changes !== 1) throw new Error("字幕版本冲突，请刷新后重试");
      this.db
        .prepare("INSERT OR REPLACE INTO revisions VALUES (?,?,?)")
        .run(
          project.id,
          project.document.revision,
          JSON.stringify(project.document),
        );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  profile(id: string): Profile {
    const row = this.db
      .prepare("SELECT * FROM profiles WHERE id=?")
      .get(id) as any;
    if (!row) throw new Error("供应商配置不存在");
    return { ...JSON.parse(row.json), secrets: this.decrypt(row.encrypted) };
  }
  profiles(): PublicProfile[] {
    return (this.db.prepare("SELECT id FROM profiles").all() as any[]).map(
      (r) => {
        const { secrets, ...publicData } = this.profile(r.id);
        return { ...publicData, secretFields: Object.keys(secrets) };
      },
    );
  }
  saveProfile(profile: Profile) {
    const { secrets, ...data } = profile;
    this.db
      .prepare("INSERT OR REPLACE INTO profiles VALUES (?,?,?)")
      .run(profile.id, JSON.stringify(data), this.encrypt(secrets));
  }
  deleteProfile(id: string) {
    this.db.prepare("DELETE FROM profiles WHERE id=?").run(id);
  }
  jobs(): Job[] {
    return (
      this.db
        .prepare("SELECT json FROM jobs ORDER BY updated_at DESC LIMIT 200")
        .all() as any[]
    ).map((r) => JSON.parse(r.json));
  }
  job(id: string): Job {
    const row = this.db
      .prepare("SELECT json FROM jobs WHERE id=?")
      .get(id) as any;
    if (!row) throw new Error("任务不存在");
    return JSON.parse(row.json);
  }
  createJob(projectId: string, kind: JobKind, params: JobParams): Job {
    const project = this.project(projectId),
      now = Date.now(),
      job: Job = {
        id: crypto.randomUUID(),
        projectId,
        kind,
        params,
        status: "queued",
        progress: 0,
        phase: "等待处理",
        createdAt: now,
        updatedAt: now,
      };
    this.db
      .prepare("INSERT INTO jobs VALUES (?,?,?,?,?,?)")
      .run(
        job.id,
        projectId,
        job.status,
        now,
        JSON.stringify(job),
        JSON.stringify({ document: project.document, style: project.style }),
      );
    return job;
  }
  updateJob(id: string, patch: Partial<Job>) {
    const ownTransaction = !this.db.isTransaction;
    if (ownTransaction) this.db.exec("BEGIN IMMEDIATE");
    try {
      const job = { ...this.job(id), ...patch, updatedAt: Date.now() };
      this.db
        .prepare("UPDATE jobs SET status=?,updated_at=?,json=? WHERE id=?")
        .run(job.status, job.updatedAt, JSON.stringify(job), id);
      if (ownTransaction) this.db.exec("COMMIT");
      return job;
    } catch (error) {
      if (ownTransaction) this.db.exec("ROLLBACK");
      throw error;
    }
  }
  checkpoint(id: string): any {
    const row = this.db
      .prepare("SELECT checkpoint FROM jobs WHERE id=?")
      .get(id) as any;
    return JSON.parse(row?.checkpoint || "{}");
  }
  saveCheckpoint(id: string, data: unknown) {
    this.db
      .prepare("UPDATE jobs SET checkpoint=? WHERE id=?")
      .run(JSON.stringify(data), id);
  }
  claim(): Job | undefined {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare(
          "SELECT json FROM jobs WHERE status='queued' OR (status='running' AND updated_at<?) ORDER BY updated_at LIMIT 1",
        )
        .get(Date.now() - 90000) as any;
      const job = row ? (JSON.parse(row.json) as Job) : undefined;
      if (job) this.updateJob(job.id, { status: "running", phase: "准备处理" });
      this.db.exec("COMMIT");
      return job;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  close() {
    this.db.close();
  }
}
