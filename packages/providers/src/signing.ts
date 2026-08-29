import { createHash, createHmac, createSign } from "node:crypto";
import type { Profile } from "@subtitle/core";
import type { Transport } from "./http";
export const hash = (text: string | Buffer) =>
  createHash("sha256").update(text).digest("hex");
export const hmac = (key: string | Buffer, text: string, alg = "sha256") =>
  createHmac(alg, key).update(text).digest();
export function awsHeaders(
  profile: Profile,
  url: string,
  service: string,
  payload: string | Buffer,
  method = "POST",
  now = new Date(),
): Record<string, string> {
  const u = new URL(url),
    date = now.toISOString().replace(/[:-]|\.\d{3}/g, ""),
    day = date.slice(0, 8),
    region = profile.options.region || "us-east-1";
  const digest = hash(payload),
    token = profile.secrets.sessionToken;
  const headers: Record<string, string> = {
    host: u.host,
    "x-amz-content-sha256": digest,
    "x-amz-date": date,
  };
  if (token) headers["x-amz-security-token"] = token;
  const names = Object.keys(headers).sort();
  const signed = names.join(";");
  const query = [...u.searchParams]
    .sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const canonical = [
    method,
    u.pathname || "/",
    query,
    names.map((k) => `${k}:${headers[k]}\n`).join(""),
    signed,
    digest,
  ].join("\n");
  const scope = `${day}/${region}/${service}/aws4_request`;
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${profile.secrets.secretKey}`, day), region), service),
    "aws4_request",
  );
  const signature = hmac(
    signingKey,
    `AWS4-HMAC-SHA256\n${date}\n${scope}\n${hash(canonical)}`,
  ).toString("hex");
  delete headers.host;
  return {
    ...headers,
    Authorization: `AWS4-HMAC-SHA256 Credential=${profile.secrets.accessKey}/${scope}, SignedHeaders=${signed}, Signature=${signature}`,
  };
}
export function tencentHeaders(
  profile: Profile,
  payload: string,
  action: string,
  now = new Date(),
): Record<string, string> {
  const seconds = Math.floor(now.getTime() / 1000),
    day = now.toISOString().slice(0, 10);
  const canonical = `POST\n/\n\ncontent-type:application/json; charset=utf-8\nhost:asr.tencentcloudapi.com\n\ncontent-type;host\n${hash(payload)}`;
  const scope = `${day}/asr/tc3_request`;
  const key = hmac(
    hmac(hmac(`TC3${profile.secrets.secretKey}`, day), "asr"),
    "tc3_request",
  );
  const sig = hmac(
    key,
    `TC3-HMAC-SHA256\n${seconds}\n${scope}\n${hash(canonical)}`,
  ).toString("hex");
  return {
    "Content-Type": "application/json; charset=utf-8",
    "X-TC-Action": action,
    "X-TC-Version": "2019-06-14",
    "X-TC-Timestamp": String(seconds),
    "X-TC-Region": profile.options.region || "ap-shanghai",
    Authorization: `TC3-HMAC-SHA256 Credential=${profile.secrets.accessKey}/${scope}, SignedHeaders=content-type;host, Signature=${sig}`,
    ...(profile.secrets.sessionToken
      ? { "X-TC-Token": profile.secrets.sessionToken }
      : {}),
  };
}
const tokenCache = new Map<string, { token: string; expires: number }>();
export async function googleToken(
  profile: Profile,
  http: Transport,
): Promise<string> {
  const account = JSON.parse(profile.secrets.serviceAccount || "{}");
  if (!account.client_email || !account.private_key)
    throw new Error("Service Account JSON 缺少 client_email / private_key");
  const key = hash(profile.secrets.serviceAccount),
    cached = tokenCache.get(key);
  if (cached && cached.expires > Date.now() + 60000) return cached.token;
  const seconds = Math.floor(Date.now() / 1000),
    enc = (x: unknown) => Buffer.from(JSON.stringify(x)).toString("base64url");
  const content = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({ iss: account.client_email, scope: "https://www.googleapis.com/auth/cloud-platform", aud: "https://oauth2.googleapis.com/token", iat: seconds, exp: seconds + 3600 })}`;
  const signer = createSign("RSA-SHA256");
  signer.update(content);
  const assertion = `${content}.${signer.sign(account.private_key).toString("base64url")}`;
  const result = await http.request("https://oauth2.googleapis.com/token", {
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  if (!result.access_token) throw new Error("Google OAuth 未返回访问令牌");
  tokenCache.set(key, {
    token: result.access_token,
    expires: Date.now() + result.expires_in * 1000,
  });
  return result.access_token;
}
