import type { ProviderDefinition, ProviderField } from "@subtitle/core";
const key: ProviderField = {
  key: "apiKey",
  label: "API Key",
  secret: true,
  section: "credentials",
};
const endpoint: ProviderField = {
  key: "endpoint",
  label: "服务地址",
  optional: true,
  placeholder: "HTTPS API base URL",
  section: "endpoint",
};
const region: ProviderField = {
  key: "region",
  label: "区域",
  optional: true,
  section: "endpoint",
};
const access: ProviderField[] = [
  {
    key: "accessKey",
    label: "Access Key / Secret ID",
    secret: true,
    section: "credentials",
  },
  {
    key: "secretKey",
    label: "Secret Key",
    secret: true,
    section: "credentials",
  },
];
const serviceAccount: ProviderField = {
  key: "serviceAccount",
  label: "Service Account JSON",
  secret: true,
  section: "credentials",
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
  checkedAt: "2026-09-01",
  modelDetails: models.map((id, index) => ({
    id,
    status: index === 0 ? "recommended" : "current",
    subtitleTiming: true,
  })),
});
const translation = (
  id: string,
  name: string,
  models: string[],
  fields: ProviderField[],
  docs: string,
  aiOperations = false,
  note = "",
): ProviderDefinition => ({
  id,
  name,
  models,
  modelDetails: models.map((model, index) => ({
    id: model,
    status: index === 0 ? "recommended" : "current",
  })),
  category: "translation",
  fields,
  docs,
  note,
  aiOperations,
  checkedAt: "2026-09-01",
});
export const catalog: ProviderDefinition[] = [
  def(
    "aliyun",
    "阿里云百炼",
    [
      "qwen-audio-3.0-asr-flash-filetrans",
      "fun-asr-flash-2026-06-15",
      "qwen3-asr-flash-filetrans",
      "fun-asr",
      "paraformer-v2",
    ],
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
    ["80006", "8953", "80001", "1737"],
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
    ["gpt-transcribe", "gpt-4o-transcribe-diarize", "whisper-1"],
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
  {
    ...def(
      "mistral",
      "Mistral · Voxtral",
      ["voxtral-mini-latest"],
      "file",
      [key, endpoint],
      "https://docs.mistral.ai/api/endpoint/audio/transcriptions",
      "Voxtral Mini Transcribe 2；支持词级时间戳和说话人分离",
    ),
    speakerDiarization: true,
    maxChunkSeconds: 10800,
  },
  {
    ...def(
      "xai",
      "xAI · Speech to Text",
      ["batch"],
      "file",
      [key, endpoint],
      "https://docs.x.ai/developers/model-capabilities/audio/speech-to-text",
      "Batch STT 无需填写模型 ID；返回词级时间戳",
    ),
    speakerDiarization: true,
  },
  {
    ...def(
      "soniox",
      "Soniox",
      ["stt-async-v5"],
      "url",
      [key, endpoint],
      "https://soniox.com/docs/stt/async/async-transcription",
      "异步文件识别；时间戳默认随 token 返回",
    ),
    speakerDiarization: true,
    maxChunkSeconds: 18000,
  },
  {
    ...def(
      "gladia",
      "Gladia",
      ["solaria-1", "solaria-3"],
      "file",
      [key, endpoint],
      "https://docs.gladia.io/chapters/pre-recorded-stt/quickstart",
      "Solaria 3 仅支持英、法、德、西、意单语；通用多语种请选择 Solaria 1",
    ),
    speakerDiarization: true,
  },
  {
    ...def(
      "revai",
      "Rev AI",
      ["standard"],
      "file",
      [key, endpoint],
      "https://docs.rev.ai/api/asynchronous/get-started",
      "异步文件识别；JSON transcript 返回逐词时间戳和说话人",
    ),
    speakerDiarization: true,
  },
  def(
    "cloudflare",
    "Cloudflare Workers AI",
    ["@cf/openai/whisper-large-v3-turbo", "@cf/openai/whisper"],
    "file",
    [
      key,
      { key: "accountId", label: "Account ID", section: "endpoint" },
      endpoint,
    ],
    "https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/",
    "使用 Workers AI REST API；返回带时间轴的 VTT/segments",
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
  translation(
    "llm-openai",
    "OpenAI / OpenAI 兼容",
    ["gpt-5.4-mini", "gpt-5.6-luna", "gpt-5.4-nano"],
    [key, endpoint],
    "https://developers.openai.com/api/docs/models",
    true,
    "兼容服务可覆盖服务地址并手动填写模型；需支持 JSON 输出",
  ),
  translation(
    "llm-deepseek",
    "DeepSeek",
    ["deepseek-v4-flash", "deepseek-v4-pro"],
    [key, endpoint],
    "https://api-docs.deepseek.com/quick_start/pricing",
    true,
    "deepseek-chat / reasoner 已于 2026-07-24 弃用，不再作为默认项",
  ),
  translation(
    "llm-qwen",
    "通义千问 · 通用模型",
    ["qwen-plus", "qwen-max"],
    [key, endpoint],
    "https://help.aliyun.com/zh/model-studio/getting-started/models",
    true,
  ),
  translation(
    "qwen-mt",
    "通义千问 · Qwen-MT 专用翻译",
    ["qwen-mt-flash", "qwen-mt-plus", "qwen-mt-lite"],
    [key, { ...endpoint, optional: false }],
    "https://help.aliyun.com/zh/model-studio/machine-translation/",
    false,
    "专用翻译模型不支持 AI 断句或指令改写；建议使用工作空间专属 API Host",
  ),
  translation(
    "llm-doubao",
    "豆包 / 火山方舟",
    ["填写已开通的 Endpoint ID"],
    [key, endpoint],
    "https://www.volcengine.com/docs/82379/1799865",
    true,
    "方舟调用填写控制台创建的推理接入点 ID",
  ),
  translation(
    "llm-gemini",
    "Google Gemini",
    ["gemini-3.7-flash", "gemini-3.5-flash-lite", "gemini-3.6-flash"],
    [key, endpoint],
    "https://ai.google.dev/gemini-api/docs/models",
    true,
  ),
  translation(
    "llm-claude",
    "Anthropic Claude",
    ["claude-sonnet-5", "claude-fable-5", "claude-haiku-4-5-20251001"],
    [key, endpoint],
    "https://docs.anthropic.com/en/docs/about-claude/models/overview",
    true,
  ),
  translation(
    "llm-mistral",
    "Mistral AI",
    ["mistral-small-2603", "mistral-medium-latest"],
    [key, endpoint],
    "https://docs.mistral.ai/inference",
    true,
  ),
  translation(
    "llm-xai",
    "xAI · Grok",
    ["grok-4.6", "grok-4.3"],
    [key, endpoint],
    "https://docs.x.ai/developers/models",
    true,
  ),
  translation(
    "deepl",
    "DeepL",
    ["default"],
    [key, endpoint],
    "https://developers.deepl.com/api-reference/translate/request-translation",
  ),
  translation(
    "translate-google",
    "Google Cloud Translation",
    ["nmt"],
    [serviceAccount, { key: "projectId", label: "Project ID" }],
    "https://cloud.google.com/translate/docs/reference/rest/v3/projects/translateText",
  ),
  translation(
    "translate-azure",
    "Azure Translator",
    ["default"],
    [key, region, endpoint],
    "https://learn.microsoft.com/azure/ai-services/translator/reference/v3-0-translate",
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
const modelNotes: Record<
  string,
  Record<
    string,
    Partial<NonNullable<ProviderDefinition["modelDetails"]>[number]>
  >
> = {
  openai: {
    "gpt-transcribe": {
      label: "gpt-transcribe（推荐）",
      note: "当前通用转写模型；本项目请求 verbose_json 与原生时间戳。",
    },
    "gpt-4o-transcribe-diarize": {
      label: "gpt-4o-transcribe-diarize（说话人）",
      note: "返回带说话人标签的分段时间轴，不发送 timestamp_granularities。",
    },
    "whisper-1": {
      label: "whisper-1（兼容）",
      note: "保留用于已有账号和兼容服务，支持 verbose_json 时间戳。",
    },
  },
  mistral: {
    "voxtral-mini-latest": {
      label: "Voxtral Mini Transcribe 2",
      note: "官方 latest 别名；支持词级时间戳、说话人分离及最长三小时音频。",
    },
  },
  xai: {
    batch: {
      label: "Batch STT（无需模型 ID）",
      note: "xAI 当前接口不接收 model 字段；这里的值只用于保存配置。",
    },
  },
  gladia: {
    "solaria-1": {
      note: "多语种和自动语言识别场景的默认选择。",
    },
    "solaria-3": {
      note: "当前仅用于英、法、德、西、意单语；不启用代码切换。",
    },
  },
  "qwen-mt": {
    "qwen-mt-flash": {
      label: "qwen-mt-flash（推荐通用）",
      note: "官方推荐的通用机器翻译型号。",
    },
    "qwen-mt-plus": {
      label: "qwen-mt-plus（质量优先）",
      note: "质量优先；通常比 Flash 成本和延迟更高。",
    },
  },
};
for (const entry of catalog)
  entry.modelDetails = entry.modelDetails?.map((model) => ({
    ...model,
    ...(modelNotes[entry.id]?.[model.id] || {}),
  }));
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
