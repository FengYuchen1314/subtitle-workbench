import type { CapacitorConfig } from "@capacitor/cli";
const config: CapacitorConfig = {
  appId: "dev.subtitle.workbench",
  appName: "字幕工作台",
  webDir: "dist",
  android: { allowMixedContent: false },
  server: { androidScheme: "https" },
};
export default config;
