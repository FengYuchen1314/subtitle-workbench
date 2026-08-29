# 字幕工作台

自托管网页、Windows/macOS 桌面客户端、安卓原生客户端。中文界面，使用自己的模型账号；不需要注册平台账号，不做项目同步。

**这是 0.1 开发预览版，不是已完成全部厂商和设备验收的正式发行版。** 已有实际处理代码和安装构建，不是界面演示。云服务均标记为“未联调”，首次使用前请用短片核对账号、地区、模型和费用。详见 [验收记录](docs/VERIFICATION.md) 与 [厂商接入表](docs/PROVIDERS.md)。

## 使用流程

选择视频 → 提取音频并识别 → 编辑原文 → 翻译并校对 → 导出字幕或单独烧录视频。

- 可导入 SRT/VTT，跳过识别。原文、译文、双语均可导出 SRT/VTT/ASS。
- 支持时间与文本修改、拆分、合并、查找替换、虚拟滚动列表和自动保存。
- 翻译按字幕 ID 校验，不改时间轴；原文修改后，对应译文会过期。
- 识别、翻译、烧录是三个独立任务。烧录使用创建任务时的字幕和样式快照，**不调用 ASR 或翻译**，不覆盖原视频。
- 大文件采用可恢复上传、分块校验；长音频按时长与静音边界分片，保留绝对时间。
- 远端任务 ID 与分片结果保存在数据库。提交状态不明时暂停，避免盲目重复付费。

## 本地开发

需要 Node.js 24、npm，以及包含 libass、libx264 的 FFmpeg/ffprobe。Windows 可用 WinGet 安装 FFmpeg；macOS 可使用 Homebrew。确认 `ffmpeg -version`、`ffprobe -version` 正常。

```sh
npm ci
npm run setup
```

分别启动两个终端：

```sh
npm run dev
npm run worker
```

打开 http://127.0.0.1:3000，使用刚设置的管理员密码登录。网页和 worker 必须使用相同的数据目录和主密钥。

生产运行：`npm run build` 后执行 `npm start`，另一个进程运行 `npm run worker`。`.env.example` 列出了配置项。不要把 `next dev` 暴露到公网。

## Docker 自托管

```sh
npm run init:env
docker compose up -d --build
```

先创建一个空的 `media` 目录，或在 `.env` 设置 `SUBTITLE_MEDIA_DIR`。默认仅绑定本机 3000 端口。打开 http://localhost:3000，使用 `.env` 内的 `SUBTITLE_SETUP_TOKEN` 初始化管理员。

需要家庭网络访问时，配置 `SUBTITLE_BIND_ADDRESS` 和 `SUBTITLE_PUBLIC_ORIGIN`；公网使用 HTTPS 反向代理，同时设置 `SUBTITLE_COOKIE_SECURE=true`。SQLite 与文件均在 `subtitle-data` 卷中；媒体挂载只读。不要把该卷放在 NFS 上，也不要横向扩容多个网页实例。

**备份必须包含数据库、视频文件和主密钥。遗失主密钥将无法解密供应商凭据。**

## 桌面客户端

```sh
npm run desktop
npm run desktop:package
```

安装包输出到 `release/`。打包脚本从本机 PATH 或 `MEDIA_BIN_DIR` 收集 FFmpeg/ffprobe；macOS 会收集其非系统动态库。请在对应系统和架构打包。

桌面版在本机运行 SQLite、处理进程和模型请求，不依赖 Next.js 服务。凭据由 Electron `safeStorage` 保护；渲染界面关闭 Node.js 权限，通过受限 IPC 访问本地能力。Electron 44 需要 Windows 10+、macOS 13+，提供 64 位构建。

## 安卓客户端

需要 JDK 21、Android SDK 36，设置 `JAVA_HOME`、`ANDROID_HOME`。

```sh
npm run android:sync
# macOS / Linux
apps/android/android/gradlew -p apps/android/android assembleDebug
# Windows PowerShell
.\apps\android\android\gradlew.bat -p apps/android/android assembleDebug
```

APK：`apps/android/android/app/build/outputs/apk/debug/app-debug.apk`。支持 Android 8.0+。Debug APK 仅供测试；正式签名由项目所有者提供。

Kotlin 原生层负责文件流、Keystore、网络、SQLite 和前台任务。MediaCodec 提取音频，Media3 烧录字幕，不依赖 WebView 持续运行。分辨率和编解码支持取决于设备；进程被终止后回到任务页手动恢复。系统后台限额不能通过本项目绕过。

## 项目结构

| 目录 | 内容 |
| --- | --- |
| `packages/core` | 毫秒字幕协议、版本、SRT/VTT/ASS、校验 |
| `packages/providers` | 16 家 ASR、自定义协议、9 个翻译配置类型、4 种对象存储 |
| `packages/runtime` | Node SQLite、加密、FFmpeg、持久化任务 |
| `packages/ui` | 三端共用 React 界面与运行端网关 |
| `apps/web` | Next.js 页面与 `/api/v1` |
| `apps/desktop` | Electron 主进程、预加载桥接、独立 worker |
| `apps/android` | Capacitor 页面及 Kotlin 原生引擎 |
| `tests` | 契约、字幕、任务、媒体测试及 TS/Kotlin 共用样本 |

## 检查与文档

```sh
npm run typecheck
npm test
npm run test:media
npm run test:long
```

`test:long` 会生成三小时的低帧率合成视频，以及三种字幕成片，产物在 `data/qa/three-hour/`。它检查时间轴和编码，不测试真实语音识别准确率。

- [部署、备份与安全](docs/SECURITY.md)
- [供应商配置与研究来源](docs/PROVIDERS.md)
- [API、自定义 ASR 协议](docs/API.md)
- [验证结果与仍需完成的验收](docs/VERIFICATION.md)
- [安装包、签名与第三方许可](docs/DISTRIBUTION.md)

CI 提供 Linux 网页/Docker、Windows、macOS Intel/Apple Silicon 和安卓构建。工作流配置本身不代表已经在这些系统执行通过。
