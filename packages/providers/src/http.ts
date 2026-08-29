import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { openAsBlob } from "node:fs";
import { Agent } from "undici";
import { lookup as dnsLookup } from "node:dns";
// Validate the addresses used by the actual connection as well as the URL preflight.
const publicAgent = new Agent({
  connect: {
    lookup(host, options, callback) {
      dnsLookup(host, { all: true }, (error, addresses) => {
        if (error) return callback(error, "", 4);
        if (
          !addresses.length ||
          addresses.some((a) => privateAddress(a.address))
        )
          return callback(new Error("受保护的网络地址"), "", 4);
        if (options.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      });
    },
  },
});
export class ProviderError extends Error {
  constructor(
    message: string,
    public code = "PROVIDER_ERROR",
    public uncertain = false,
  ) {
    super(message);
  }
}
export function privateAddress(ip: string): boolean {
  const s = ip.replace(/^\[|\]$/g, "").toLowerCase();
  if (s.includes(":"))
    return (
      s === "::" ||
      s === "::1" ||
      /^(fc|fd|fe[89ab])/.test(s) ||
      s.startsWith("::ffff:")
    );
  const p = s.split(".").map(Number);
  return (
    p[0] === 0 ||
    p[0] === 10 ||
    p[0] === 127 ||
    p[0] >= 224 ||
    (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127)
  );
}
export async function assertUrl(
  raw: string,
  allowPrivate = false,
): Promise<URL> {
  const url = new URL(raw);
  if (
    url.username ||
    url.password ||
    !["https:", "http:"].includes(url.protocol)
  )
    throw new ProviderError("不允许的 API 地址");
  if (!allowPrivate && url.protocol !== "https:")
    throw new ProviderError("公网接口必须使用 HTTPS");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true });
  if (!allowPrivate && addresses.some((a) => privateAddress(a.address)))
    throw new ProviderError("接口地址指向受保护网络");
  if (!addresses.length) throw new ProviderError("接口域名无法解析");
  return url;
}
export interface HttpRequest {
  method?: string;
  headers?: Record<string, string>;
  json?: unknown;
  body?: BodyInit;
  timeoutMs?: number;
}
export interface Transport {
  request<T = any>(url: string, request?: HttpRequest): Promise<T>;
}
export class FetchTransport implements Transport {
  constructor(
    private allowPrivate = false,
    private signal?: AbortSignal,
  ) {}
  async request<T = any>(url: string, request: HttpRequest = {}): Promise<T> {
    await assertUrl(url, this.allowPrivate);
    const method =
      request.method ||
      (request.json !== undefined || request.body !== undefined
        ? "POST"
        : "GET");
    const timeout = AbortSignal.timeout(request.timeoutMs || 600000);
    const signal = this.signal
      ? AbortSignal.any([timeout, this.signal])
      : timeout;
    let response: Response;
    try {
      response = await fetch(url, {
        ...(!this.allowPrivate ? { dispatcher: publicAgent } : {}),
        method,
        headers: {
          ...(request.json !== undefined
            ? { "Content-Type": "application/json" }
            : {}),
          ...request.headers,
        },
        body:
          request.json !== undefined
            ? JSON.stringify(request.json)
            : request.body,
        redirect: "error",
        signal,
      });
    } catch {
      throw new ProviderError(
        signal.aborted
          ? "请求取消或超时"
          : "网络请求失败；请核对服务地址与网络",
        "NETWORK",
        method !== "GET",
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ProviderError(
        `服务返回 HTTP ${response.status}${response.status === 429 ? "（限流，请稍后重试）" : ""}`,
        String(response.status),
        method !== "GET" && response.status >= 500,
      );
    }
    const status = response.headers.get("x-api-status-code");
    if (status && !["20000000", "20000001", "20000002"].includes(status))
      throw new ProviderError("ASR 服务拒绝请求", "ASR_STATUS");
    if (response.status === 204) return {} as T;
    const size = +(response.headers.get("content-length") || 0);
    if (size > 32 * 1024 * 1024) {
      await response.body?.cancel();
      throw new ProviderError("服务响应超出限制");
    }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (reader)
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > 32 * 1024 * 1024) {
          await reader.cancel();
          throw new ProviderError("服务响应超出限制");
        }
        chunks.push(value);
      }
    const raw = Buffer.concat(chunks).toString("utf8");
    if (!raw) return {} as T;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as T;
    }
  }
}
export async function audioBlob(path: string) {
  return openAsBlob(path, { type: "audio/wav" });
}
export function requireValue(value: string | undefined, name: string): string {
  if (!value) throw new ProviderError(`缺少配置：${name}`);
  return value;
}
export function base(endpoint: string | undefined, fallback: string) {
  return (endpoint || fallback).replace(/\/$/, "");
}
