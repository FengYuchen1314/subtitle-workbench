# 字幕工作台

[![Build, verify and publish](https://github.com/FengYuchen1314/subtitle-workbench/actions/workflows/verify.yml/badge.svg)](https://github.com/FengYuchen1314/subtitle-workbench/actions/workflows/verify.yml)
[![GitHub Releases](https://img.shields.io/github/v/release/FengYuchen1314/subtitle-workbench?include_prereleases&label=development%20build)](https://github.com/FengYuchen1314/subtitle-workbench/releases)

自托管网页、Windows/macOS 桌面客户端、安卓原生客户端。中文界面，使用自己的模型账号；不需要注册平台账号，不做项目同步。

三个运行端共用标准 Ant Design 6 界面，采用默认组件样式与中文语言包。项目、字幕表格、模型配置、任务队列和确认弹窗均使用 Ant Design 组件。

**这是 0.1 开发预览版，不是已完成全部厂商和设备验收的正式发行版。** 已有实际处理代码和安装构建，不是界面演示。内置 22 家云 ASR、2 种自定义 ASR、12 种翻译 / AI 配置和 4 种对象存储。云服务均标记为“未联调”，首次使用前请测试配置并用短片核对账号、地区、模型、时间戳和费用。详见 [验收记录](docs/VERIFICATION.md) 与 [厂商接入表](docs/PROVIDERS.md)。

## 下载与安装

每次 push 通过测试后，GitHub 会创建一个与该提交对应的[预发行版本](https://github.com/FengYuchen1314/subtitle-workbench/releases)。下载最新构建中适合系统的文件：

| 系统              | 下载文件              | 安装方式                                   |
| ----------------- | --------------------- | ------------------------------------------ |
| Windows 10/11 x64 | `*-Windows-x64.exe`   | 运行安装器并选择安装目录                   |
| Apple Silicon Mac | `*-macOS-arm64.dmg`   | 打开 DMG，把应用拖入“应用程序”             |
| Intel Mac         | `*-macOS-x64.dmg`     | 打开 DMG，把应用拖入“应用程序”             |
| Android 8.0+      | `*-Android-debug.apk` | 允许浏览器或文件管理器“安装未知应用”后安装 |

同时下载 `SHA256SUMS.txt`，在安装前核对文件：

```powershell
# Windows PowerShell
Get-FileHash .\Subtitle-Workbench-*.exe -Algorithm SHA256
```

```sh
# macOS / Linux
shasum -a 256 Subtitle-Workbench-*.dmg
```

这些是自动构建的开发预览包，尚无 Windows 商业代码签名、Apple Developer ID 公证或 Android 正式签名。只从本仓库下载并核对校验值；macOS 若拦截，可在“系统设置 → 隐私与安全性”中检查发布者信息并选择是否打开。客户端不会自动更新，升级时重新下载安装包；已有工作区数据不会随安装包自动同步到其他设备。

## 第一次使用

1. 打开“模型与存储”，在“语音识别”中添加自己的 ASR 配置。选择服务商、当前模型、地区或地址并填写凭据。
2. 保存后点击“测试服务”。测试会发送一个很小的真实请求，可能产生少量费用；需要 URL / S3 / GCS 的 ASR 要先配置兼容的临时存储。
3. 如需译文、AI 断句或按提示修改字幕，在“字幕翻译”中添加独立配置。ASR 与翻译可以使用不同厂商；只有标有“AI 断句 / 改写”的通用模型可执行这两类任务。
4. 导入视频，选择语音识别配置生成原文；也可以直接导入 SRT/VTT 跳过识别。
5. 校对文字和时间，必要时拆分、合并、查找替换，或在“AI 优化”中调整字幕长度。修改原文后，对应译文会标记为过期。
6. 选择原文、译文或双语模式，导出 SRT/VTT/ASS；需要成片时再单独执行“烧录视频”。导出字幕不会重新编码视频，烧录也不会隐式调用 ASR 或翻译。

桌面和安卓版本直接处理本机文件，不需要自托管服务器。桌面凭据由系统安全存储保护；安卓凭据由 Keystore 保护。服务商字段说明见[厂商配置文档](docs/PROVIDERS.md)。

## 使用流程

选择视频 → 提取音频并识别 → 编辑原文 → 翻译并校对 → 导出字幕或单独烧录视频。

- 可导入 SRT/VTT，跳过识别。原文、译文、双语均可导出 SRT/VTT/ASS。
- 支持时间与文本修改、拆分、合并、查找替换、虚拟滚动列表和自动保存。
- 翻译按字幕 ID 校验，不改时间轴；原文修改后，对应译文会过期。
- AI 智能断句只决定语义边界，必须完整保留原字符；时间由本地程序计算和校验。生成字幕后可输入自然语言要求，批量修改原文或指定语言的译文。
- 识别、翻译、AI 断句、AI 修改和烧录是独立任务。烧录使用创建任务时的字幕和样式快照，**不调用 ASR、翻译或 AI 修改**，不覆盖原视频。
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

`main` 每次 push 后会把通过测试的镜像发布为 `ghcr.io/fengyuchen1314/subtitle-workbench:latest`，每个提交另有不可变的 `sha-<提交前12位>` 标签。

```sh
git clone https://github.com/FengYuchen1314/subtitle-workbench.git
cd subtitle-workbench
node scripts/init-env.mjs
mkdir media
docker compose pull
docker compose up -d
```

打开 http://localhost:3000，在初始化页输入 `.env` 里的 `SUBTITLE_SETUP_TOKEN`，再设置至少 12 位的管理员密码。默认只监听本机；查看运行状态和日志：

```sh
docker compose ps
docker compose logs -f web worker
```

要使用当前源码在本机重新构建镜像：

```sh
# 仅当 .env 尚不存在时执行
node scripts/init-env.mjs
docker compose up -d --build
```

如果已经有 `.env`，不要再次运行初始化命令。管理员挂载媒体目录由 `.env` 的 `SUBTITLE_MEDIA_DIR` 指定；网页上传的视频保存在 Docker 数据卷中。

需要家庭网络访问时，配置 `SUBTITLE_BIND_ADDRESS` 和 `SUBTITLE_PUBLIC_ORIGIN`；公网使用 HTTPS 反向代理，同时设置 `SUBTITLE_COOKIE_SECURE=true`。SQLite 与文件均在 `subtitle-data` 卷中；媒体挂载只读。不要把该卷放在 NFS 上，也不要横向扩容多个网页实例。

**备份必须包含数据库、视频文件和主密钥。遗失主密钥将无法解密供应商凭据。**

## 桌面客户端

普通使用者直接安装 GitHub Releases 中的 EXE 或对应架构 DMG。以下命令仅供从源码开发和打包：

```sh
npm run desktop
npm run desktop:package
```

安装包输出到 `release/`。打包脚本从本机 PATH 或 `MEDIA_BIN_DIR` 收集 FFmpeg/ffprobe；macOS 会收集其非系统动态库。请在对应系统和架构打包。

桌面版在本机运行 SQLite、处理进程和模型请求，不依赖 Next.js 服务。凭据由 Electron `safeStorage` 保护；渲染界面关闭 Node.js 权限，通过受限 IPC 访问本地能力。Electron 44 需要 Windows 10+、macOS 13+，提供 64 位构建。

## 安卓客户端

普通使用者直接安装 GitHub Releases 中的 Debug APK。以下命令仅供从源码构建：

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

| 目录                 | 内容                                                           |
| -------------------- | -------------------------------------------------------------- |
| `packages/core`      | 毫秒字幕协议、版本、SRT/VTT/ASS、校验                          |
| `packages/providers` | 22 家云 ASR、2 种自定义 ASR、12 种翻译 / AI 配置、4 种对象存储 |
| `packages/runtime`   | Node SQLite、加密、FFmpeg、持久化任务                          |
| `packages/ui`        | 三端共用 React 界面与运行端网关                                |
| `apps/web`           | Next.js 页面与 `/api/v1`                                       |
| `apps/desktop`       | Electron 主进程、预加载桥接、独立 worker                       |
| `apps/android`       | Capacitor 页面及 Kotlin 原生引擎                               |
| `tests`              | 契约、字幕、任务、媒体测试及 TS/Kotlin 共用样本                |

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

每次 push 都会运行 Linux 网页/Docker、Windows、macOS Intel/Apple Silicon 和 Android 构建；全部成功后才会创建预发行版本。每个构建的实际结果以 [GitHub Actions](https://github.com/FengYuchen1314/subtitle-workbench/actions/workflows/verify.yml) 为准，不能用工作流配置本身代替验收结果。
