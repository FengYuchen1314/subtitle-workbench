# 厂商接入与联调记录

文档核查日期：2026-09-01。源代码内置 22 家云 ASR、2 种自定义 ASR、12 种翻译 / AI 配置和 4 种对象存储。表中的“契约通过”使用本地合成响应，覆盖请求、轮询、时间戳转换与错误传播，不代表真实账号调用成功。仓库没有厂商凭据，所以全部云服务仍标记为 **未联调**。

## ASR

| 厂商 / 官方文档                                                                                                  | 当前模型或模式                                                                                  | 输入       | 本地验证         | 真实账号 |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------- | ---------------- | -------- |
| [阿里云百炼](https://help.aliyun.com/zh/model-studio/model-list-speech-recognition/)                             | qwen-audio-3.0-asr-flash-filetrans / fun-asr-flash-2026-06-15 / qwen3 / fun-asr / paraformer-v2 | URL        | 契约通过         | 未联调   |
| [火山引擎 · 豆包](https://www.volcengine.com/docs/6561/1354868)                                                  | standard / flash                                                                                | URL        | 契约通过         | 未联调   |
| [腾讯云](https://cloud.tencent.com/document/api/1093/37823)                                                      | 16k_zh_large / 16k_zh_en / 16k_en / 16k_ja                                                      | 文件       | 签名与契约通过   | 未联调   |
| [百度智能云](https://ai.baidu.com/ai-doc/SPEECH/Klbxern8v)                                                       | 80006 / 8953 / 80001 / 1737                                                                     | URL        | 契约通过         | 未联调   |
| [讯飞](https://www.xfyun.cn/doc/spark/asr_llm/Ifasr_llm.html)                                                    | llm / standard                                                                                  | 文件       | 两套鉴权契约通过 | 未联调   |
| [华为云 SIS](https://support.huaweicloud.com/api-sis/sis_03_0092.html)                                           | chinese_16k_general                                                                             | URL        | 契约通过         | 未联调   |
| [OpenAI](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create) | gpt-transcribe / gpt-4o-transcribe-diarize / whisper-1                                          | 文件       | 契约通过         | 未联调   |
| [Microsoft Azure](https://learn.microsoft.com/azure/ai-services/speech-service/rest-speech-to-text)              | fast / batch                                                                                    | 文件或 URL | 契约通过         | 未联调   |
| [Google Cloud](https://docs.cloud.google.com/speech-to-text/docs/models/chirp-3)                                 | chirp_3 / long                                                                                  | GCS        | OAuth 与契约通过 | 未联调   |
| [Amazon Transcribe](https://docs.aws.amazon.com/transcribe/latest/dg/subtitles.html)                             | standard                                                                                        | S3         | SigV4 与契约通过 | 未联调   |
| [IBM Watson](https://cloud.ibm.com/docs/speech-to-text?topic=speech-to-text-async)                               | en-US_Multimedia / zh-CN_Telephony                                                              | 文件       | 契约通过         | 未联调   |
| [Deepgram](https://developers.deepgram.com/reference/speech-to-text/listen-pre-recorded)                         | nova-3 / nova-2                                                                                 | 文件       | 契约通过         | 未联调   |
| [AssemblyAI](https://www.assemblyai.com/docs/pre-recorded-audio/api-reference/transcripts/submit)                | universal-3-pro / universal-2                                                                   | 文件       | 契约通过         | 未联调   |
| [ElevenLabs](https://elevenlabs.io/docs/api-reference/speech-to-text/convert)                                    | scribe_v2                                                                                       | 文件       | 契约通过         | 未联调   |
| [Groq](https://console.groq.com/docs/speech-to-text)                                                             | whisper-large-v3-turbo / whisper-large-v3                                                       | 文件       | 契约通过         | 未联调   |
| [Speechmatics](https://docs.speechmatics.com/speech-to-text/batch/quickstart)                                    | enhanced / standard                                                                             | 文件       | 契约通过         | 未联调   |
| [Mistral Voxtral](https://docs.mistral.ai/api/endpoint/audio/transcriptions)                                     | voxtral-mini-latest                                                                             | 文件       | 契约通过         | 未联调   |
| [xAI Speech to Text](https://docs.x.ai/developers/model-capabilities/audio/speech-to-text)                       | Batch STT（接口不传模型字段）                                                                   | 文件       | 契约通过         | 未联调   |
| [Soniox](https://soniox.com/docs/stt/async/async-transcription)                                                  | stt-async-v5                                                                                    | URL        | 契约通过         | 未联调   |
| [Gladia](https://docs.gladia.io/chapters/pre-recorded-stt/quickstart)                                            | solaria-1 / solaria-3                                                                           | 文件       | 契约通过         | 未联调   |
| [Rev AI](https://docs.rev.ai/api/asynchronous/get-started)                                                       | standard                                                                                        | 文件       | 契约通过         | 未联调   |
| [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/)             | whisper-large-v3-turbo / whisper                                                                | 文件       | 契约通过         | 未联调   |
| [自定义 OpenAI ASR](https://developers.openai.com/api/docs/guides/speech-to-text)                                | 手动填写                                                                                        | 文件       | 协议校验         | 未联调   |
| 自定义字幕 JSON                                                                                                  | 手动填写                                                                                        | 文件       | 协议校验         | 未联调   |

`文件` 表示直接上传提取出的 WAV；`URL` 使用已经配置的 S3 / OSS / COS / GCS 临时对象。S3 和 GCS 接口必须使用对应存储。Azure Fast 直接上传，Batch 需要 URL。只上传识别所需的音频分片，任务结束后删除临时对象。

模型列表不是简单的兼容配置：阿里 Qwen/Fun/Paraformer、火山标准/极速、讯飞标准/大模型、各云签名协议都有独立请求和解析分支。桌面与服务器使用 TypeScript 实现；Android 使用 Kotlin 重新实现同一协议。本地测试覆盖 22 家云 ASR 的带时间戳响应，纯文本响应会被拒绝。

OpenAI 的 `gpt-4o-transcribe` 和 `gpt-4o-mini-transcribe` 当前只支持 JSON 文本输出，不能直接作为本项目的自动字幕模型；`gpt-transcribe`、`whisper-1` 和 diarize 模型按各自响应格式处理。自定义兼容接口必须实际返回 `segments` 或 `words`，程序不会根据纯文本编造时间轴。

## 翻译与字幕 AI

| 配置                     | 当前默认模型示例                            | 翻译 | AI 断句 / 指令修改 | 官方文档                                                                                          |
| ------------------------ | ------------------------------------------- | ---- | ------------------ | ------------------------------------------------------------------------------------------------- |
| OpenAI / OpenAI 兼容     | gpt-5.4-mini / gpt-5.6-luna                 | 是   | 是                 | [模型](https://developers.openai.com/api/docs/models)                                             |
| DeepSeek                 | deepseek-v4-flash / deepseek-v4-pro         | 是   | 是                 | [模型与价格](https://api-docs.deepseek.com/quick_start/pricing)                                   |
| 通义千问通用模型         | qwen-plus / qwen-max                        | 是   | 是                 | [模型](https://help.aliyun.com/zh/model-studio/getting-started/models)                            |
| Qwen-MT 专用翻译         | qwen-mt-flash / qwen-mt-plus / qwen-mt-lite | 是   | 否                 | [机器翻译](https://help.aliyun.com/zh/model-studio/machine-translation/)                          |
| 豆包 / 火山方舟          | 控制台 Endpoint ID                          | 是   | 是                 | [接口](https://www.volcengine.com/docs/82379/1799865)                                             |
| Google Gemini            | gemini-3.7-flash / gemini-3.5-flash-lite    | 是   | 是                 | [模型](https://ai.google.dev/gemini-api/docs/models)                                              |
| Anthropic Claude         | claude-sonnet-5 / claude-fable-5            | 是   | 是                 | [模型](https://docs.anthropic.com/en/docs/about-claude/models/overview)                           |
| Mistral AI               | mistral-small-2603 / mistral-medium-latest  | 是   | 是                 | [推理接口](https://docs.mistral.ai/inference)                                                     |
| xAI Grok                 | grok-4.6 / grok-4.3                         | 是   | 是                 | [模型](https://docs.x.ai/developers/models)                                                       |
| DeepL                    | default                                     | 是   | 否                 | [翻译接口](https://developers.deepl.com/api-reference/translate/request-translation)              |
| Google Cloud Translation | nmt                                         | 是   | 否                 | [translateText](https://cloud.google.com/translate/docs/reference/rest/v3/projects/translateText) |
| Azure Translator         | default                                     | 是   | 否                 | [翻译接口](https://learn.microsoft.com/azure/ai-services/translator/reference/v3-0-translate)     |

DeepSeek 的旧 `deepseek-chat` / `deepseek-reasoner` 已不再作为默认项；Qwen-MT 使用专用 `translation_options`，不套用通用 JSON 提示词。Gemini 使用 `responseJsonSchema`，Claude 使用 `output_config.format`，其余通用 LLM 使用 JSON 模式并校验完整 ID 集合。

翻译按稳定字幕 ID 映射，程序保留时间轴。AI 断句只能返回每个 ID 的文字分段，必须完整保留原字符和顺序；毫秒时间由本地算法计算。指令修改也必须返回全部原 ID，不允许模型改时间。任何漏句、重复 ID、未知 ID 或空文本都会使任务失败且不写入项目。

## 配置测试

保存配置后，在“模型与存储”列表点击“测试服务”：

- 翻译配置发送一条带固定 ID 的小型真实翻译请求，并校验返回结构。
- ASR 配置提交 0.8 秒连接测试音频；异步接口只确认厂商已接受任务，同步接口校验响应。测试音频不含语音时允许没有字幕，但鉴权、额度或参数错误仍会失败。
- 对象存储上传并删除一个很小的临时 WAV。

测试可能产生极少量费用。测试成功只证明当前凭据、地址和基本协议可用，不等于语言准确率、长视频或全部模型联调通过。需要 URL、S3 或 GCS 的 ASR 必须先保存兼容存储配置。

## 对象存储

S3 / S3 兼容、阿里 OSS、腾讯 COS、Google GCS 均实现流式上传、限时签名 URL 和删除。Node 契约覆盖音频内容、鉴权头、签名链接和删除；真实桶权限、跨区域和生命周期仍需账号验证。

[Amazon S3 签名](https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html) · [OSS 签名](https://www.alibabacloud.com/help/en/oss/developer-reference/include-signatures-in-urls) · [COS 签名](https://cloud.tencent.com/document/product/436/7778) · [GCS 签名 URL](https://cloud.google.com/storage/docs/access-control/signed-urls)

## 真实联调记录方式

每个账号单独测试，不自动切换厂商。先用 10–30 秒有明确语音的授权素材，记录区域、精确模型名、接口版本、远端任务 ID、首中末时间点、实际费用和错误处理；不要记录密钥或完整签名 URL。随后再验证长视频、断线恢复和临时对象清理。

报告必须区分“已实现”“本地契约通过”“真实账号联调通过”。没有厂商凭据时不得把前两项写成真实联调通过。
