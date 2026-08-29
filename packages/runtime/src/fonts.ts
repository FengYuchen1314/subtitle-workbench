import { runProcess } from "./media";
let cache: Promise<{ checked: boolean; families: string[] }> | undefined;
export function availableFonts() {
  return (cache ||= (async () => {
    try {
      const raw =
        process.platform === "win32"
          ? await runProcess("powershell.exe", [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); Add-Type -AssemblyName System.Drawing; $fonts=[System.Drawing.Text.InstalledFontCollection]::new(); @($fonts.Families.Name) | ConvertTo-Json -Compress; $fonts.Dispose()",
            ])
          : await runProcess("fc-list", ["-f", "%{family}\n"]);
      const families: string[] =
        process.platform === "win32"
          ? JSON.parse(raw)
          : raw
              .split(/[\n,]/)
              .map((s) => s.trim())
              .filter(Boolean);
      return { checked: true, families: [...new Set(families)].sort() };
    } catch {
      return { checked: false, families: [] };
    }
  })());
}
