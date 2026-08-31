import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import "@subtitle/ui/styles.css";
export const metadata: Metadata = {
  title: "字幕工作台",
  description: "识别、翻译、编辑字幕，独立导出与视频烧录。",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <AntdRegistry>{children}</AntdRegistry>
      </body>
    </html>
  );
}
