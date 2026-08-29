import { catalog } from "../packages/providers/src/catalog";
import { mkdirSync, writeFileSync } from "node:fs";
mkdirSync("docs", { recursive: true });
let doc =
  "# 厂商接入与联调记录\n\n文档核查日期：2026-08-29。下表记录源代码接入范围；“契约通过”使用本地合成响应，不表示使用真实账号调用成功。当前未配置任何真实云服务凭据，所有厂商均为 **未联调**。\n\n## ASR\n\n| 厂商 / 官方文档 | 默认模型选项 | 音频输入 | Node 契约 | 真实账号 |\n| --- | --- | --- | --- | --- |\n";
for (const p of catalog.filter((p) => p.category === "asr"))
  doc += `| ${p.docs ? `[${p.name}](${p.docs})` : p.name} | ${p.models.join(" / ")} | ${p.input} | ${p.id.startsWith("custom") ? "协议校验；待真实服务" : "请求/解析/错误测试通过"} | 未联调 |\n`;
doc +=
  "\n`file` 直接发送音频；`url` 需要临时对象存储；`s3`/`gcs` 必须使用相应云存储。Azure Fast 直接上传，Batch 需要 URL。阿里 Qwen/Fun/Paraformer、火山标准/极速、讯飞标准/大模型分别走原生协议，不统一伪装为 OpenAI。\n\n默认音频为 16 kHz 单声道 WAV，分片最长 300 秒；腾讯直接上传使用 110 秒以低于 5 MB 限制。时间戳优先于纯文本模型的可用性，OpenAI 仅提供 Whisper 和带时间戳的 diarize 模型选项。其他 OpenAI 兼容服务必须实际返回时间戳。\n\n地区、模型开通状态、配额、支持语言由账号和接口决定。AWS/Azure/Google 会把常用界面语言转换为地区代码；讯飞及 Speechmatics 使用各自代码。特殊方言、语言包可以填写“API 语言代码覆盖”。\n\nKotlin 已实现对应请求、签名、查询及结果转换，并与 TypeScript 使用相同的 16 家结果样本测试。安卓当前只完成 JVM 协议测试和 APK 编译，尚未通过真机云端联调；不能据此声称所有移动端请求已获厂商验证。\n\n## 翻译\n\n| 配置 | 模型示例 | 官方说明 |\n| --- | --- | --- |\n";
const translationDocs: Record<string, string> = {
  "llm-openai":
    "https://developers.openai.com/api/docs/guides/structured-outputs",
  "llm-deepseek": "https://api-docs.deepseek.com/guides/json_mode",
  "llm-qwen":
    "https://www.alibabacloud.com/help/en/model-studio/structured-output",
  "llm-doubao": "https://www.volcengine.com/docs/82379",
  "llm-gemini": "https://ai.google.dev/api/generate-content",
  "llm-claude":
    "https://platform.claude.com/docs/en/build-with-claude/structured-outputs",
  deepl:
    "https://developers.deepl.com/api-reference/translate/request-translation",
  "translate-google":
    "https://docs.cloud.google.com/translate/docs/reference/rest/v3/projects/translateText",
  "translate-azure":
    "https://learn.microsoft.com/en-us/azure/ai-services/translator/text-translation/reference/v3/translate",
};
for (const p of catalog.filter((p) => p.category === "translation"))
  doc += `| ${p.name} | ${p.models.join(" / ")} | [文档](${p.docs || translationDocs[p.id]}) |\n`;
doc +=
  "\nGemini 使用 responseJsonSchema，Claude 使用 output_config.format；OpenAI 兼容接口使用 JSON 模式并校验完整 ID 集合。若自定义接口不支持 JSON 模式，应明确报错，不自动改用其他厂商。\n";
doc +=
  "\n翻译引擎与 ASR 无绑定。LLM 请求携带字幕 ID、上下文和术语；传统翻译 API 通过数组映射。返回的漏句、重复 ID、未知 ID、空译文会被拒绝。程序不接收模型生成的时间轴。传统翻译 API 的术语能力有差异：当前 DeepL 使用 context，Google/Azure 未实现各自付费术语库资源。\n\n## 对象存储\n\nS3 兼容、阿里 OSS、腾讯 COS、Google GCS 均有上传、签名 URL 和删除实现。Node 侧已做音频内容、鉴权头、链接与删除契约测试；真实桶访问、临时凭据权限、跨区域访问与生命周期仍待账号验证。\n\n[Amazon S3 签名](https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html) · [OSS 签名](https://www.alibabacloud.com/help/en/oss/developer-reference/include-signatures-in-urls) · [COS 签名](https://cloud.tencent.com/document/product/436/7778) · [GCS 签名 URL](https://cloud.google.com/storage/docs/access-control/signed-urls)\n\n## 真实联调验收方式\n\n每个账号单独配置，不自动切换。先选择 10–30 秒含明确语音的公开视频或授权素材，记录：区域、精确模型名、接口版本、任务 ID、首中末时间点、实际费用、限流/无效凭据的处理结果；不要记录密钥或完整签名 URL。然后测试长视频、断线恢复、暂存对象清理。\n\n报告应把“已实现”“契约通过”“真实联调通过”分开，不应直接将本表改成全部通过。\n";
writeFileSync("docs/PROVIDERS.md", doc);
