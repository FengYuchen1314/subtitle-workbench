# 厂商接入与联调记录

文档核查日期：2026-08-29。下表记录源代码接入范围；“契约通过”使用本地合成响应，不表示使用真实账号调用成功。当前未配置任何真实云服务凭据，所有厂商均为 **未联调**。

## ASR

| 厂商 / 官方文档                                                                                            | 默认模型选项                                        | 音频输入 | Node 契约              | 真实账号 |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | -------- | ---------------------- | -------- |
| [阿里云百炼](https://www.alibabacloud.com/help/en/model-studio/non-realtime-speech-recognition-user-guide) | qwen3-asr-flash-filetrans / fun-asr / paraformer-v2 | url      | 请求/解析/错误测试通过 | 未联调   |
| [火山引擎 · 豆包](https://www.volcengine.com/docs/6561/1354868)                                            | standard / flash                                    | url      | 请求/解析/错误测试通过 | 未联调   |
| [腾讯云](https://cloud.tencent.com/document/api/1093/37823)                                                | 16k_zh_large / 16k_zh_en / 16k_en / 16k_ja          | file     | 请求/解析/错误测试通过 | 未联调   |
| [百度智能云](https://ai.baidu.com/ai-doc/SPEECH/Klbxern8v)                                                 | 80006 / 1737 / 8953                                 | url      | 请求/解析/错误测试通过 | 未联调   |
| [讯飞](https://www.xfyun.cn/doc/spark/asr_llm/Ifasr_llm.html)                                              | llm / standard                                      | file     | 请求/解析/错误测试通过 | 未联调   |
| [华为云 SIS](https://support.huaweicloud.com/api-sis/sis_03_0092.html)                                     | chinese_16k_general                                 | url      | 请求/解析/错误测试通过 | 未联调   |
| [OpenAI](https://developers.openai.com/api/docs/guides/speech-to-text)                                     | whisper-1 / gpt-4o-transcribe-diarize               | file     | 请求/解析/错误测试通过 | 未联调   |
| [Microsoft Azure](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-speech-to-text)  | fast / batch                                        | file     | 请求/解析/错误测试通过 | 未联调   |
| [Google Cloud](https://docs.cloud.google.com/speech-to-text/docs/models/chirp-3)                           | chirp_3 / long                                      | gcs      | 请求/解析/错误测试通过 | 未联调   |
| [Amazon Transcribe](https://docs.aws.amazon.com/transcribe/latest/dg/subtitles.html)                       | standard                                            | s3       | 请求/解析/错误测试通过 | 未联调   |
| [IBM Watson](https://cloud.ibm.com/docs/speech-to-text?topic=speech-to-text-async)                         | en-US_Multimedia / zh-CN_Telephony                  | file     | 请求/解析/错误测试通过 | 未联调   |
| [Deepgram](https://developers.deepgram.com/reference/speech-to-text/listen-pre-recorded)                   | nova-3 / nova-2                                     | file     | 请求/解析/错误测试通过 | 未联调   |
| [AssemblyAI](https://www.assemblyai.com/docs/pre-recorded-audio/api-reference/transcripts/submit)          | universal-3-pro / universal-2                       | file     | 请求/解析/错误测试通过 | 未联调   |
| [ElevenLabs](https://elevenlabs.io/docs/api-reference/speech-to-text/convert)                              | scribe_v2                                           | file     | 请求/解析/错误测试通过 | 未联调   |
| [Groq](https://console.groq.com/docs/speech-to-text)                                                       | whisper-large-v3-turbo / whisper-large-v3           | file     | 请求/解析/错误测试通过 | 未联调   |
| [Speechmatics](https://docs.speechmatics.com/speech-to-text/batch/quickstart)                              | enhanced / standard                                 | file     | 请求/解析/错误测试通过 | 未联调   |
| [自定义 · OpenAI ASR](https://developers.openai.com/api/docs/guides/speech-to-text)                        | whisper-1                                           | file     | 协议校验；待真实服务   | 未联调   |
| 自定义 · 字幕 JSON                                                                                         | default                                             | file     | 协议校验；待真实服务   | 未联调   |

`file` 直接发送音频；`url` 需要临时对象存储；`s3`/`gcs` 必须使用相应云存储。Azure Fast 直接上传，Batch 需要 URL。阿里 Qwen/Fun/Paraformer、火山标准/极速、讯飞标准/大模型分别走原生协议，不统一伪装为 OpenAI。

默认音频为 16 kHz 单声道 WAV，分片最长 300 秒；腾讯直接上传使用 110 秒以低于 5 MB 限制。时间戳优先于纯文本模型的可用性，OpenAI 仅提供 Whisper 和带时间戳的 diarize 模型选项。其他 OpenAI 兼容服务必须实际返回时间戳。

地区、模型开通状态、配额、支持语言由账号和接口决定。AWS/Azure/Google 会把常用界面语言转换为地区代码；讯飞及 Speechmatics 使用各自代码。特殊方言、语言包可以填写“API 语言代码覆盖”。

Kotlin 已实现对应请求、签名、查询及结果转换，并与 TypeScript 使用相同的 16 家结果样本测试。安卓已完成 JVM 协议测试、APK 编译和 API 36 模拟器上的本机界面/Media3 媒体闭环，尚未通过真机云端联调；不能据此声称所有移动端请求已获厂商验证。

## 翻译

| 配置                     | 模型示例          | 官方说明                                                                                                       |
| ------------------------ | ----------------- | -------------------------------------------------------------------------------------------------------------- |
| OpenAI / 兼容翻译        | gpt-4.1-mini      | [文档](https://developers.openai.com/api/docs/guides/structured-outputs)                                       |
| DeepSeek                 | deepseek-chat     | [文档](https://api-docs.deepseek.com/guides/json_mode)                                                         |
| 通义千问                 | qwen-plus         | [文档](https://www.alibabacloud.com/help/en/model-studio/structured-output)                                    |
| 豆包 / 火山方舟          | 填写已开通模型 ID | [文档](https://www.volcengine.com/docs/82379)                                                                  |
| Google Gemini            | gemini-2.5-flash  | [文档](https://ai.google.dev/api/generate-content)                                                             |
| Anthropic Claude         | claude-sonnet-4-6 | [文档](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)                               |
| DeepL                    | default           | [文档](https://developers.deepl.com/api-reference/translate/request-translation)                               |
| Google Cloud Translation | nmt               | [文档](https://docs.cloud.google.com/translate/docs/reference/rest/v3/projects/translateText)                  |
| Azure Translator         | default           | [文档](https://learn.microsoft.com/en-us/azure/ai-services/translator/text-translation/reference/v3/translate) |

Gemini 使用 responseJsonSchema，Claude 使用 output_config.format；OpenAI 兼容接口使用 JSON 模式并校验完整 ID 集合。若自定义接口不支持 JSON 模式，应明确报错，不自动改用其他厂商。

翻译引擎与 ASR 无绑定。LLM 请求携带字幕 ID、上下文和术语；传统翻译 API 通过数组映射。返回的漏句、重复 ID、未知 ID、空译文会被拒绝。程序不接收模型生成的时间轴。传统翻译 API 的术语能力有差异：当前 DeepL 使用 context，Google/Azure 未实现各自付费术语库资源。

## 对象存储

S3 兼容、阿里 OSS、腾讯 COS、Google GCS 均有上传、签名 URL 和删除实现。Node 侧已做音频内容、鉴权头、链接与删除契约测试；真实桶访问、临时凭据权限、跨区域访问与生命周期仍待账号验证。

[Amazon S3 签名](https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html) · [OSS 签名](https://www.alibabacloud.com/help/en/oss/developer-reference/include-signatures-in-urls) · [COS 签名](https://cloud.tencent.com/document/product/436/7778) · [GCS 签名 URL](https://cloud.google.com/storage/docs/access-control/signed-urls)

## 真实联调验收方式

每个账号单独配置，不自动切换。先选择 10–30 秒含明确语音的公开视频或授权素材，记录：区域、精确模型名、接口版本、任务 ID、首中末时间点、实际费用、限流/无效凭据的处理结果；不要记录密钥或完整签名 URL。然后测试长视频、断线恢复、暂存对象清理。

报告应把“已实现”“契约通过”“真实联调通过”分开，不应直接将本表改成全部通过。
