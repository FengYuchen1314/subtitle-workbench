import type { ProviderDefinition, ProviderField } from "@subtitle/core";
const key: ProviderField = { key: "apiKey", label: "API Key", secret: true };
const endpoint: ProviderField = {
  key: "endpoint",
  label: "服务地址",
  optional: true,
  placeholder: "HTTPS API base URL",
};
const region: ProviderField = { key: "region", label: "区域", optional: true };
const access: ProviderField[] = [
  { key: "accessKey", label: "Access Key / Secret ID", secret: true },
  { key: "secretKey", label: "Secret Key", secret: true },
];
const serviceAccount: ProviderField = {
  key: "serviceAccount",
  label: "Service Account JSON",
  secret: true,
};
const def = (
  id: string,
  name: string,
  models: string[],
  input: ProviderDefinition["input"],
  fields: ProviderField[],
  docs: string,
  note = "",
): ProviderDefinition => ({
  id,
  name,
  models,
  input,
  fields,
  docs,
  note,
  category: "asr",
  timestamps: "word",
  maxChunkSeconds: 300,
});
export const catalog: ProviderDefinition[] = [
  def(
    "aliyun",
    "阿里云百炼",
    ["qwen3-asr-flash-filetrans", "fun-asr", "paraformer-v2"],
    "url",
    [key, endpoint],
    "https://www.alibabacloud.com/help/en/model-studio/non-realtime-speech-recognition-user-guide",
    "需音频临时存储；地区必须与密钥一致",
  ),
  def(
    "volcengine",
    "火山引擎 · 豆包",
    ["standard", "flash"],
    "url",
    [
      { key: "appId", label: "App ID" },
      { key: "apiKey", label: "Access Token", secret: true },
      { key: "resourceId", label: "Resource ID", optional: true },
      endpoint,
    ],
    "https://www.volcengine.com/docs/6561/1354868",
  ),
  {
    ...def(
      "tencent",
      "腾讯云",
      ["16k_zh_large", "16k_zh_en", "16k_en", "16k_ja"],
      "file",
      [...access, region],
      "https://cloud.tencent.com/document/api/1093/37823",
    ),
    maxChunkSeconds: 110,
  },
  def(
    "baidu",
    "百度智能云",
    ["80006", "1737", "8953"],
    "url",
    [key, { key: "secretKey", label: "Secret Key", secret: true }],
    "https://ai.baidu.com/ai-doc/SPEECH/Klbxern8v",
  ),
  def(
    "iflytek",
    "讯飞",
    ["llm", "standard"],
    "file",
    [
      { key: "appId", label: "App ID" },
      { key: "accessKey", label: "Access Key ID / API Key", secret: true },
      {
        key: "secretKey",
        label: "Access Key Secret / Secret Key",
        secret: true,
      },
    ],
    "https://www.xfyun.cn/doc/spark/asr_llm/Ifasr_llm.html",
  ),
  {
    ...def(
      "huawei",
      "华为云 SIS",
      ["chinese_16k_general"],
      "url",
      [
        { key: "token", label: "IAM X-Auth-Token", secret: true },
        { key: "projectId", label: "Project ID" },
        region,
        endpoint,
      ],
      "https://support.huaweicloud.com/api-sis/sis_03_0092.html",
      "使用有有效期的 IAM Token；过期后需要更新",
    ),
    timestamps: "segment",
  },
  def(
    "openai",
    "OpenAI",
    ["whisper-1", "gpt-4o-transcribe-diarize"],
    "file",
    [key, endpoint],
    "https://developers.openai.com/api/docs/guides/speech-to-text",
    "字幕模式只提供原生返回时间戳的模型",
  ),
  def(
    "azure",
    "Microsoft Azure",
    ["fast", "batch"],
    "file",
    [key, region, endpoint],
    "https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-speech-to-text",
    "Batch 模式需要音频临时存储",
  ),
  def(
    "google",
    "Google Cloud",
    ["chirp_3", "long"],
    "gcs",
    [serviceAccount, { key: "projectId", label: "Project ID" }, region],
    "https://docs.cloud.google.com/speech-to-text/docs/models/chirp-3",
    "需同项目 GCS 存储配置",
  ),
  def(
    "aws",
    "Amazon Transcribe",
    ["standard"],
    "s3",
    [
      ...access,
      {
        key: "sessionToken",
        label: "Session Token",
        secret: true,
        optional: true,
      },
      region,
    ],
    "https://docs.aws.amazon.com/transcribe/latest/dg/subtitles.html",
    "需同区域 S3 存储",
  ),
  def(
    "ibm",
    "IBM Watson",
    ["en-US_Multimedia", "zh-CN_Telephony"],
    "file",
    [key, { ...endpoint, optional: false }],
    "https://cloud.ibm.com/docs/speech-to-text?topic=speech-to-text-async",
  ),
  def(
    "deepgram",
    "Deepgram",
    ["nova-3", "nova-2"],
    "file",
    [key, endpoint],
    "https://developers.deepgram.com/reference/speech-to-text/listen-pre-recorded",
  ),
  def(
    "assemblyai",
    "AssemblyAI",
    ["universal-3-pro", "universal-2"],
    "file",
    [key, endpoint],
    "https://www.assemblyai.com/docs/pre-recorded-audio/api-reference/transcripts/submit",
  ),
  def(
    "elevenlabs",
    "ElevenLabs",
    ["scribe_v2"],
    "file",
    [key, endpoint],
    "https://elevenlabs.io/docs/api-reference/speech-to-text/convert",
  ),
  def(
    "groq",
    "Groq",
    ["whisper-large-v3-turbo", "whisper-large-v3"],
    "file",
    [key, endpoint],
    "https://console.groq.com/docs/speech-to-text",
  ),
  def(
    "speechmatics",
    "Speechmatics",
    ["enhanced", "standard"],
    "file",
    [key, endpoint],
    "https://docs.speechmatics.com/speech-to-text/batch/quickstart",
  ),
  def(
    "custom-openai",
    "自定义 · OpenAI ASR",
    ["whisper-1"],
    "file",
    [
      { ...key, optional: true },
      { ...endpoint, optional: false },
    ],
    "https://developers.openai.com/api/docs/guides/speech-to-text",
    "必须返回真实 segments 或 words，纯文本返回会报错",
  ),
  def(
    "custom-json",
    "自定义 · 字幕 JSON",
    ["default"],
    "file",
    [
      { ...key, optional: true },
      { ...endpoint, optional: false },
    ],
    "",
    "POST multipart file；返回 language 和 cues（毫秒时间戳）",
  ),
  ...[
    ["llm-openai", "OpenAI / 兼容翻译", ["gpt-4.1-mini"]],
    ["llm-deepseek", "DeepSeek", ["deepseek-chat"]],
    ["llm-qwen", "通义千问", ["qwen-plus"]],
    ["llm-doubao", "豆包 / 火山方舟", ["填写已开通模型 ID"]],
    ["llm-gemini", "Google Gemini", ["gemini-2.5-flash"]],
    ["llm-claude", "Anthropic Claude", ["claude-sonnet-4-6"]],
    ["deepl", "DeepL", ["default"]],
    ["translate-google", "Google Cloud Translation", ["nmt"]],
    ["translate-azure", "Azure Translator", ["default"]],
  ].map(
    ([id, name, models]) =>
      ({
        id,
        name,
        models,
        category: "translation",
        fields:
          id === "translate-google"
            ? [serviceAccount, { key: "projectId", label: "Project ID" }]
            : id === "translate-azure"
              ? [key, region, endpoint]
              : [key, endpoint],
        docs: "",
      }) as ProviderDefinition,
  ),
  ...(["s3", "oss", "cos", "gcs"] as const).map(
    (id) =>
      ({
        id: `storage-${id}`,
        name: {
          s3: "S3 / S3 兼容",
          oss: "阿里云 OSS",
          cos: "腾讯云 COS",
          gcs: "Google Cloud Storage",
        }[id],
        models: ["default"],
        category: "storage",
        fields:
          id === "gcs"
            ? [serviceAccount, { key: "bucket", label: "Bucket" }]
            : [
                ...access,
                {
                  key: "sessionToken",
                  label: "Session Token",
                  secret: true,
                  optional: true,
                },
                { key: "bucket", label: "Bucket" },
                region,
                { ...endpoint, optional: id !== "s3" },
              ],
        docs: "",
      }) as ProviderDefinition,
  ),
];
for (const entry of catalog)
  if (entry.category === "asr")
    entry.fields.push({
      key: "languageCode",
      label: "API 语言代码覆盖（可选）",
      optional: true,
      placeholder: "留空按原声语言转换；特定方言/语言包可手动填写",
    });
export function providerDefinition(id: string): ProviderDefinition {
  const p = catalog.find((x) => x.id === id);
  if (!p) throw new Error(`未知供应商：${id}`);
  return p;
}
