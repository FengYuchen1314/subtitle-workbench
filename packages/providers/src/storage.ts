import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Profile, StagedObject, StorageProvider } from "@subtitle/core";
import {
  FetchTransport,
  audioBlob,
  base,
  requireValue,
  type Transport,
} from "./http";
import { awsHeaders, googleToken, hash, hmac } from "./signing";

const encodePath = (key: string) =>
  key.split("/").map(encodeURIComponent).join("/");
const queryString = (entries: Record<string, string>) =>
  Object.keys(entries)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(entries[k])}`)
    .join("&");
export class CloudStorage implements StorageProvider {
  constructor(
    private profile: Profile,
    private http: Transport = new FetchTransport(profile.allowPrivateEndpoint),
  ) {}
  private location(key: string) {
    const p = this.profile,
      o = p.options,
      bucket = requireValue(o.bucket, "Bucket"),
      path = encodePath(key);
    if (p.provider === "storage-s3")
      return `${base(o.endpoint, `https://s3.${o.region || "us-east-1"}.amazonaws.com`)}/${encodeURIComponent(bucket)}/${path}`;
    if (p.provider === "storage-oss")
      return `${base(o.endpoint, `https://${bucket}.${o.region || "oss-cn-hangzhou"}.aliyuncs.com`)}/${path}`;
    if (p.provider === "storage-cos")
      return `${base(o.endpoint, `https://${bucket}.cos.${o.region || "ap-guangzhou"}.myqcloud.com`)}/${path}`;
    return `https://storage.googleapis.com/${bucket}/${path}`;
  }
  private cosAuth(method: string, url: string, expires: number) {
    const p = this.profile,
      u = new URL(url),
      start = Math.floor(Date.now() / 1000) - 60,
      signTime = `${start};${expires}`;
    const signKey = hmac(p.secrets.secretKey, signTime, "sha1").toString("hex");
    const httpString = `${method.toLowerCase()}\n${u.pathname}\n\nhost=${encodeURIComponent(u.host)}\n`;
    const sha1 = (str: string) => hmacHash(str);
    const signature = hmac(
      signKey,
      `sha1\n${signTime}\n${sha1(httpString)}\n`,
      "sha1",
    ).toString("hex");
    return `q-sign-algorithm=sha1&q-ak=${p.secrets.accessKey}&q-sign-time=${signTime}&q-key-time=${signTime}&q-header-list=host&q-url-param-list=&q-signature=${signature}`;
  }
  private async headers(
    method: string,
    key: string,
    body?: Buffer,
  ): Promise<Record<string, string>> {
    const p = this.profile,
      url = this.location(key),
      date = new Date().toUTCString();
    if (p.provider === "storage-s3")
      return awsHeaders(p, url, "s3", body || "", method);
    if (p.provider === "storage-gcs")
      return { Authorization: `Bearer ${await googleToken(p, this.http)}` };
    if (p.provider === "storage-cos")
      return {
        Authorization: this.cosAuth(
          method,
          url,
          Math.floor(Date.now() / 1000) + 3600,
        ),
        ...(p.secrets.sessionToken
          ? { "x-cos-security-token": p.secrets.sessionToken }
          : {}),
      };
    const signature = hmac(
      p.secrets.secretKey,
      `${method}\n\n${method === "PUT" ? "audio/wav" : ""}\n${date}\n/${p.options.bucket}/${key}`,
      "sha1",
    ).toString("base64");
    return {
      Date: date,
      Authorization: `OSS ${p.secrets.accessKey}:${signature}`,
    };
  }
  private signedUrl(key: string, expiresAt: number) {
    const p = this.profile,
      o = p.options,
      s = p.secrets,
      url = this.location(key),
      u = new URL(url),
      expires = Math.floor(expiresAt / 1000);
    if (p.provider === "storage-oss") {
      const signature = hmac(
        s.secretKey,
        `GET\n\n\n${expires}\n/${o.bucket}/${key}`,
        "sha1",
      ).toString("base64");
      return `${url}?${new URLSearchParams({ OSSAccessKeyId: s.accessKey, Expires: String(expires), Signature: signature })}`;
    }
    if (p.provider === "storage-cos")
      return `${url}?${this.cosAuth("GET", url, expires)}${s.sessionToken ? `&x-cos-security-token=${encodeURIComponent(s.sessionToken)}` : ""}`;
    const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, ""),
      day = date.slice(0, 8);
    if (p.provider === "storage-gcs") {
      const account = JSON.parse(s.serviceAccount),
        scope = `${day}/auto/storage/goog4_request`;
      const params = {
        "X-Goog-Algorithm": "GOOG4-RSA-SHA256",
        "X-Goog-Credential": `${account.client_email}/${scope}`,
        "X-Goog-Date": date,
        "X-Goog-Expires": "172800",
        "X-Goog-SignedHeaders": "host",
      };
      const query = queryString(params),
        canonical = `GET\n${u.pathname}\n${query}\nhost:${u.host}\n\nhost\nUNSIGNED-PAYLOAD`;
      const signer = createSign("RSA-SHA256");
      signer.update(`GOOG4-RSA-SHA256\n${date}\n${scope}\n${hash(canonical)}`);
      return `${url}?${query}&X-Goog-Signature=${signer.sign(account.private_key).toString("hex")}`;
    }
    const region = o.region || "us-east-1",
      scope = `${day}/${region}/s3/aws4_request`;
    const params: Record<string, string> = {
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${s.accessKey}/${scope}`,
      "X-Amz-Date": date,
      "X-Amz-Expires": "172800",
      "X-Amz-SignedHeaders": "host",
    };
    if (s.sessionToken) params["X-Amz-Security-Token"] = s.sessionToken;
    const query = queryString(params),
      canonical = `GET\n${u.pathname}\n${query}\nhost:${u.host}\n\nhost\nUNSIGNED-PAYLOAD`;
    const signingKey = hmac(
      hmac(hmac(hmac(`AWS4${s.secretKey}`, day), region), "s3"),
      "aws4_request",
    );
    return `${url}?${query}&X-Amz-Signature=${hmac(signingKey, `AWS4-HMAC-SHA256\n${date}\n${scope}\n${hash(canonical)}`).toString("hex")}`;
  }
  async put(path: string, key: string): Promise<StagedObject> {
    if (!/^[a-zA-Z0-9/_\-.]+$/.test(key)) throw new Error("无效存储对象名");
    const p = this.profile,
      url = this.location(key);
    // Audio is bounded by the ASR chunk limit, never the original video size.
    const bytes = await readFile(path),
      headers = await this.headers("PUT", key, bytes);
    await this.http.request(url, {
      method: "PUT",
      body: await audioBlob(path),
      headers: { ...headers, "Content-Type": "audio/wav" },
    });
    const expiresAt = Date.now() + 172800000;
    return {
      key,
      url: this.signedUrl(key, expiresAt),
      uri: `${p.provider === "storage-gcs" ? "gs" : "s3"}://${p.options.bucket}/${key}`,
      expiresAt,
    };
  }
  async remove(key: string) {
    await this.http.request(this.location(key), {
      method: "DELETE",
      headers: await this.headers("DELETE", key),
    });
  }
}
import { createHash } from "node:crypto";
const hmacHash = (text: string) =>
  createHash("sha1").update(text).digest("hex");
