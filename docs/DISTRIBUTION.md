# 构建、签名与分发

## 产物

- Windows：`npm run desktop:package`，NSIS 安装器在 `release/`，可解包目录在 `release/win-unpacked/`。
- macOS：在 Intel 和 Apple Silicon 上分别执行相同命令，生成对应架构 DMG。当前 Windows 机器没有验证 macOS 安装与运行。
- Android：`npm run android:sync` 后用 Gradle 生成 Debug APK；API 36 x86_64 模拟器已通过界面和 Media3 短片闭环，正式 Release APK 需要配置自有 keystore，真机兼容性仍需逐设备验证。
- 自托管：Dockerfile 和 Compose 使用 Node 24、FFmpeg/libass、Noto 字体、SQLite 文件卷和两个独立进程。

`.github/workflows/verify.yml` 提供这些环境的构建步骤。没有自动创建远程仓库、上传代码或发布版本；需要项目所有者自行启用 CI。

## 正式签名

当前包没有项目所有者的发行签名。Windows 需要代码签名证书；macOS 需要 Developer ID、签名和公证；安卓需要妥善保存 Release keystore。Debug APK 的调试签名不等于正式发行签名。不要让用户关闭操作系统的安全防护来运行来源不明的安装包。

## FFmpeg 与第三方依赖

`scripts/stage-media.mjs` 收集本机 FFmpeg/ffprobe，并保存版本、构建参数、许可说明。当前 Windows 工具来自 Gyan FFmpeg 8.1.1 full build，启用了 GPL/version3；媒体二进制不提交到源码仓库。

个人测试安装包不代表完成公开分发合规准备。**公开分发前，需要按实际二进制和依赖的许可提供完整对应源码或其他符合许可的交付方式；仅附一个上游链接不够。** 不要随意更换含 nonfree 编译选项的二进制。

FFmpeg：[许可说明](https://ffmpeg.org/legal.html) · [源码发布](https://ffmpeg.org/releases/)。Electron、Chromium、React、Next.js、Capacitor、Media3、OkHttp 等依赖保留各自的许可证。桌面包包含 Electron/Chromium 的原始许可文件；安卓使用系统/Media3，不嵌入 FFmpegKit。

## Windows 中文路径的测试工具问题

APK 编译已能在当前中文工作目录完成；Gradle 的 JVM 测试执行器在此环境遇到参数文件路径编码问题。可先执行 `compileDebugUnitTestKotlin`，再运行 `scripts/android-junit.ps1` 直接启动同一组 JUnit 测试。Linux CI 仍使用标准 `testDebugUnitTest`。
