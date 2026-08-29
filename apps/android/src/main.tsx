import React from "react";
import { createRoot } from "react-dom/client";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { Workbench, NativeGateway } from "@subtitle/ui";
import "@subtitle/ui/styles.css";
import type { Project } from "@subtitle/core";
interface NativePlugin {
  command(options: {
    method: string;
    args: Record<string, unknown>;
  }): Promise<{ value: any; mediaPaths?: Record<string, string> }>;
  pickVideo(): Promise<{
    value: Project | null;
    mediaPaths?: Record<string, string>;
  }>;
  saveText(options: { name: string; text: string }): Promise<void>;
}
const plugin = registerPlugin<NativePlugin>("SubtitleEngine");
const paths: Record<string, string> = {};
function unwrap(result: { value: any; mediaPaths?: Record<string, string> }) {
  Object.assign(paths, result.mediaPaths || {});
  return result.value;
}
const gateway = new NativeGateway("android", {
  command: async (method, args) =>
    unwrap(await plugin.command({ method, args })),
  pickVideo: async () => unwrap(await plugin.pickVideo()),
  saveText: (name, text) => plugin.saveText({ name, text }),
  mediaUrl: (id) => (paths[id] ? Capacitor.convertFileSrc(paths[id]) : ""),
  outputUrl: (id) =>
    paths[`output:${id}`]
      ? Capacitor.convertFileSrc(paths[`output:${id}`])
      : "",
});
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Workbench gateway={gateway} />
  </React.StrictMode>,
);
