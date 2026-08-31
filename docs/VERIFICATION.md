# 验证记录

日期：2026-08-29。版本：0.1.0 开发预览。执行环境：Windows x64、Node 24、FFmpeg 8.1.1、JDK 21、Android SDK 36。

**尚未完成实施方案的全部验收。** 以下区分实际执行的测试、构建产物和仍需外部环境完成的项目。不将合成响应当作厂商真实联调，也不将模拟器结果当作安卓真机验收。

## 2026-08-31：Ant Design 界面回归

共享界面改为 Ant Design 6 默认主题与中文组件；Next.js 使用样式注册器，Electron 和 Capacitor 复用相同组件。本轮使用独立的 `data/ant-review` 测试目录，没有访问真实厂商账号。

- TypeScript 类型检查、50 项单元/契约测试、3 项 FFmpeg 集成测试、1 项 HTTP API 集成测试通过。
- Next.js 生产构建、Electron 构建、Android 前端同步及 Debug APK 编译通过；Kotlin JUnit 6 项通过。
- Windows Electron 开发构建通过隐藏窗口启动、受限桥接及独立 worker 双语烧录，记录在 `data/ant-review/electron/smoke-result.json`。
- 浏览器实测登录、字幕原文/译文自动保存、非法时间报错、输出前等待保存、字体样式保存、双语烧录、配置必填校验与切换厂商清空密钥草稿。手机页头适配已修正。
- 新增回归覆盖：空白原文替换拒绝保存、清空译文后禁止双语导出、修改文字/时间后清除过期词级时间戳、字幕版本冲突、已结束任务不可取消/重复重试、未知付费请求默认安全恢复、跨厂商凭据隔离。
- Android 仪器测试中的旧欢迎文案断言已更新为 Ant Design 表格就绪检查，并已编译；本轮未重跑模拟器和真机测试。下面的安装、三小时素材及模拟器记录属于 8 月 29 日的基线验收，不表示本轮重新执行。

## 已实际通过

| 项目                  | 结果               | 范围                                                                                         |
| --------------------- | ------------------ | -------------------------------------------------------------------------------------------- |
| TypeScript 类型检查   | 通过               | `npm run typecheck`                                                                          |
| 单元与契约测试        | 45 项通过          | 16 家 ASR 请求/查询/解析/错误；4 种存储；9 个翻译配置；字幕、加密、任务持久化                |
| FFmpeg 集成测试       | 3 项通过           | 横竖屏、特殊字符路径、无音轨、音频延迟起点、第二音轨转 AAC、取消、独立烧录                   |
| 本地 HTTP 模型协议    | 通过               | 真实 multipart 传输与 worker 流程，返回的是测试字幕；识别→翻译→烧录仅两次模型请求            |
| 断网与恢复            | 通过               | 模拟提交后连接断开、关闭数据库再恢复；未知状态停在 attention，不自动重复提交                 |
| 网页 API 集成         | 1 项通过           | 登录、拒绝跨站写请求、扩展名校验、分块 SHA-256、错误偏移、断点恢复、Range、退出              |
| 三小时视频            | 通过               | 10800 秒合成素材，原文/译文/双语均编码；2、5401、10797 秒画面有字幕；AAC 音轨存在            |
| 网页浏览器操作        | 通过               | 登录、上传、导入、原文/译文编辑与保存、双语烧录、设置页；390×844 响应式检查                  |
| Next.js 生产构建      | 通过               | 页面、API、standalone 输出；独立 worker CJS 构建                                             |
| Electron 包内运行     | 通过               | Windows x64，包内 FFmpeg/ffprobe、本地 SQLite、独立处理进程、双语输出；界面没有 Node.js 权限 |
| Windows NSIS 闭环     | 通过               | 隔离目录静默安装 → 已安装程序包内媒体测试 → 静默卸载；程序和安装目录均已移除                 |
| Android Kotlin        | 5 项通过           | 共用 16 家结果样本、字幕格式、三种模式、无时间戳拒绝、跨分片偏移/去重/尾部裁剪               |
| Android Debug APK     | 编译与签名校验通过 | Capacitor 8.5 / Media3 1.11；minSdk 26、targetSdk 36；Debug 签名                             |
| Android API 36 模拟器 | 4 项通过           | React 中文界面、Capacitor 插件、Keystore 密文、内网 URL 拒绝；原生抽音频及双语烧录闭环       |

三小时素材是 320×180、1 fps 的低成本测试视频，**不是三小时真实人声的识别准确率或移动设备性能测试**。中英文字幕由测试数据提供，尚未验证真实中英混说识别、口音或语言覆盖。画面检查包括首、中、末抽帧及与无字幕原帧比较；音轨检查不等于所有多音轨容器均通过。

Android 的 Gradle 测试运行器在本机中文路径遇到 JVM 参数文件编码问题；`compileDebugUnitTestKotlin` 成功后，使用 `scripts/android-junit.ps1` 直接执行同一组已编译 JUnit 测试，结果为 `OK (5 tests)`。没有绕过断言。标准 `testDebugUnitTest` 留给 Linux CI 执行。

Android API 36 x86_64 模拟器上的 `connectedDebugAndroidTest` 结果为 `4 tests, 0 failures`。媒体用例读取 H.264/AAC 素材，调用 `NativeMedia.probe`、16 kHz WAV 提取和 Media3 双语烧录，再核对输出尺寸、时长、AAC 音轨及字幕时段的亮色像素。界面冷启动截图在 `data/qa/android-emulator.png`，HTML 报告在 `apps/android/android/app/build/reports/androidTests/connected/debug/index.html`。模拟器使用软件/虚拟编解码环境，不代表具体手机的硬件性能。

## 本地产物

| 文件                                                      | 状态                                                            |
| --------------------------------------------------------- | --------------------------------------------------------------- |
| `release/Subtitle Workbench Setup 0.1.0.exe`              | 安装、已安装程序媒体测试和卸载通过；Authenticode 状态 NotSigned |
| `release/win-unpacked/Subtitle Workbench.exe`             | 已执行包内集成测试                                              |
| `release/Subtitle-Workbench-0.1.0-debug.apk`              | 可供测试的 APK；Android Debug 签名，不是发行签名                |
| `release/SHA256SUMS.txt`                                  | 安装器和 APK 的校验值                                           |
| `data/qa/electron-packaged-final/smoke-result.json`       | 包内运行测试记录                                                |
| `data/qa/nsis-installed-smoke-20260829/smoke-result.json` | 实际安装后的包内运行测试记录                                    |
| `data/qa/android-emulator.png`                            | API 36 模拟器实际界面截图                                       |
| `data/qa/three-hour/result.json`                          | 三小时测试摘要，同目录有视频与抽帧                              |

`release/`、`data/`、SDK/JDK、媒体二进制均不提交到 Git。测试预览数据只存在本机 QA 目录，不打入安装包。桌面 ASAR 已检查，不含 node_modules、数据库、环境文件或主密钥。

## 尚未通过的验收

- **16 家云端 ASR、所有云翻译、真实对象存储：未联调。** 缺少真实账号与开通的模型/桶。契约用例覆盖基础参数和签名形态，不是每个地区、每个模型分支的完整官方签名向量与计费联调。见 [逐厂商记录](PROVIDERS.md)。
- **macOS Intel / Apple Silicon：未构建 DMG、未安装、未运行。** 已提供对应原生构建脚本和 CI 配置，本地没有 macOS 构建环境。
- **Docker / Linux：未实际运行容器。** 提供 Dockerfile、Compose、独立 worker、持久卷与 CI 启动检查；当前机器无 Docker。Windows 的 Next.js 构建不能替代 Linux 容器验收。
- **安卓真机：未连接。** API 36 模拟器已通过启动、Keystore、网络策略、抽音频和 Media3 双语烧录；系统文件选择/保存、具体设备硬件编解码、长视频、热降频、空间不足、通知权限、进程终止和后台超时仍需真机测试。
- 尚未做真实限流与配额、云端链接过期、临时对象清理权限故障、填满磁盘、真实多小时断网恢复、全字体/多语言字形、所有输入格式的验收。
- 术语文本已传给 LLM，DeepL 使用上下文；尚未集成 Google/Azure 各自的专用术语库资源。
- macOS 公证、正式安卓签名和 FFmpeg 公开分发许可材料仍待完成。见 [分发说明](DISTRIBUTION.md)。

## 安全检查范围

2026-08-31 的 `npm audit --omit=dev`：0 个已报告生产依赖漏洞。已更新 esbuild 修复其 low 级问题；完整 audit 仍报告构建依赖链 3 个 moderate（Capacitor CLI 的 xcode/uuid 链）。没有强制降级 Capacitor 或把此结果描述为“没有任何漏洞”。正式发布前应重新审计 npm、Gradle 与内嵌媒体二进制。

已测试基础路径限制、凭据加密、默认拒绝内网地址和跨站写入；这不是渗透测试报告。单管理员家庭部署不得直接当成公共多租户服务。

## 复现

```sh
npm ci
npm run typecheck
npm test
npm run test:media
npm run test:long
npm run build:worker
npm run build
npm run desktop:package
npm run android:sync
```

连接 API 36 模拟器或设备后，在 `apps/android/android` 执行 `gradlew connectedDebugAndroidTest` 可复现原生界面、安全与媒体闭环测试。测试 APK 会从 `tests/fixtures/android-media.mp4` 读取短素材，不访问云服务。

HTTP 测试需要一个专用 QA 服务和测试视频，设置 `SUBTITLE_TEST_BASE_URL`（以 `/api/v1` 结尾）、`SUBTITLE_TEST_PASSWORD`、`SUBTITLE_TEST_VIDEO` 后执行 `npm run test:web`；它会创建一个测试项目。未配置这些变量时会明确跳过，不能把跳过记录为通过。

桌面包内测试：设置隔离的 `SUBTITLE_SMOKE_DATA` 和测试视频路径 `SUBTITLE_SMOKE_MEDIA`，运行可执行文件加 `--smoke-test`；测试使用隐藏窗口，生成 JSON 记录后退出。不要指向已有用户数据目录。

GitHub Actions 基线构建已在远程通过：[26ef8a3 构建记录](https://github.com/FengYuchen1314/subtitle-workbench/actions/runs/33231882730)，包含网页/Docker、Windows、macOS Intel/Apple Silicon 与 Android。每次推送会重新执行；当前提交结果以仓库 Actions 页面为准。厂商真实联调与正式签名仍需要项目所有者的凭据及证书。
