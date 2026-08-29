import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("subtitle", {
  command: (method: string, args: Record<string, unknown>) =>
    ipcRenderer.invoke("subtitle:command", method, args),
  pickVideo: () => ipcRenderer.invoke("subtitle:pick"),
  saveText: (name: string, text: string) =>
    ipcRenderer.invoke("subtitle:save", name, text),
  mediaUrl: (id: string) => `app://media/${encodeURIComponent(id)}`,
  outputUrl: (id: string) => `app://output/${encodeURIComponent(id)}`,
});
