import type { Gateway, Project } from "@subtitle/core";
async function response<T>(r: Response): Promise<T> {
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "请求失败");
  return data;
}
function selectFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] || null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}
export class HttpGateway implements Gateway {
  platform = "web" as const;
  async call<T = unknown>(
    method: string,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    if (method.startsWith("auth."))
      return response<T>(
        await fetch(
          `/api/v1/auth/${method.slice(5)}`,
          method === "auth.status"
            ? {}
            : {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(args),
              },
        ),
      );
    return response<T>(
      await fetch("/api/v1/rpc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, args }),
      }),
    );
  }
  async pickVideo(
    progress: (percent: number) => void,
  ): Promise<Project | null> {
    const file = await selectFile("video/*,.mkv,.avi,.mov");
    if (!file) return null;
    const fingerprint = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          await new Blob([
            file.slice(0, 65536),
            file.slice(Math.max(0, file.size - 65536)),
          ]).arrayBuffer(),
        ),
      ),
    )
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
    const key = `subtitle-upload:${file.name}:${file.size}:${file.lastModified}:${fingerprint}`;
    let upload: { id: string; offset: number } | undefined;
    const saved = localStorage.getItem(key);
    if (saved)
      try {
        upload = await response(await fetch(`/api/v1/uploads/${saved}`));
      } catch {
        localStorage.removeItem(key);
      }
    if (!upload) {
      upload = await response(
        await fetch("/api/v1/uploads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: file.name, size: file.size }),
        }),
      );
      localStorage.setItem(key, upload!.id);
    }
    while (upload!.offset < file.size) {
      const end = Math.min(file.size, upload!.offset + 4 * 1024 * 1024);
      const chunk = file.slice(upload!.offset, end);
      const checksum = Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", await chunk.arrayBuffer()),
        ),
      )
        .map((n) => n.toString(16).padStart(2, "0"))
        .join("");
      const next = await response<{ offset: number }>(
        await fetch(`/api/v1/uploads/${upload!.id}`, {
          method: "PATCH",
          headers: {
            "Upload-Offset": String(upload!.offset),
            "Upload-Checksum": checksum,
          },
          body: chunk,
        }),
      );
      upload!.offset = next.offset;
      progress(Math.round((next.offset / file.size) * 100));
    }
    const project = await response<Project>(
      await fetch(`/api/v1/uploads/${upload!.id}/complete`, { method: "POST" }),
    );
    localStorage.removeItem(key);
    return project;
  }
  mediaUrl(id: string) {
    return `/api/v1/media/${encodeURIComponent(id)}`;
  }
  outputUrl(id: string) {
    return `/api/v1/outputs/${encodeURIComponent(id)}`;
  }
  async saveText(name: string, text: string) {
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}
export { selectFile };
export interface NativeBridge {
  command(method: string, args: Record<string, unknown>): Promise<any>;
  pickVideo(): Promise<Project | null>;
  saveText(name: string, text: string): Promise<void>;
  mediaUrl(id: string): string;
  outputUrl(id: string): string;
}
export class NativeGateway implements Gateway {
  constructor(
    public platform: "desktop" | "android",
    private bridge: NativeBridge,
  ) {}
  async call<T = unknown>(
    method: string,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    if (method === "auth.status")
      return { authenticated: true, configured: true } as T;
    return this.bridge.command(method, args);
  }
  pickVideo(_progress: (n: number) => void) {
    return this.bridge.pickVideo();
  }
  mediaUrl(id: string) {
    return this.bridge.mediaUrl(id);
  }
  outputUrl(id: string) {
    return this.bridge.outputUrl(id);
  }
  saveText(name: string, text: string) {
    return this.bridge.saveText(name, text);
  }
}
