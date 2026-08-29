import React from "react";
import { createRoot } from "react-dom/client";
import { NativeGateway, Workbench, type NativeBridge } from "@subtitle/ui";
import "@subtitle/ui/styles.css";
declare global {
  interface Window {
    subtitle: NativeBridge;
  }
}
createRoot(document.getElementById("root")!).render(
  <Workbench gateway={new NativeGateway("desktop", window.subtitle)} />,
);
