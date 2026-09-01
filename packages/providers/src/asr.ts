import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import type {
  AsrProvider,
  AsrSubmission,
  AsrPoll,
  AudioInput,
  Profile,
} from "@subtitle/core";
import {
  FetchTransport,
  audioBlob,
  base,
  requireValue,
  ProviderError,
  type Transport,
} from "./http";
import { awsHeaders, tencentHeaders, googleToken, hmac } from "./signing";
import { normalize } from "./normalize";
import { asrLanguage } from "./language";
import { providerDefinition } from "./catalog";

type Pending = Extract<AsrSubmission, { type: "pending" }>;
export class CloudAsr implements AsrProvider {
  capabilities() {
    return providerDefinition(this.profile.provider);
  }
  constructor(
    readonly profile: Profile,
    readonly http: Transport = new FetchTransport(profile.allowPrivateEndpoint),
  ) {}
  private complete(data: any): AsrSubmission {
    return {
      type: "complete",
      transcript: normalize(this.profile.provider, data),
    };
  }
  private pending(id: string, context?: Record<string, string>): Pending {
    if (!id) throw new ProviderError("服务未返回任务 ID");
    return { type: "pending", id, context };
  }
  private auth(): Record<string, string> {
    return this.profile.secrets.apiKey
      ? { Authorization: `Bearer ${this.profile.secrets.apiKey}` }
      : {};
  }
  private async tc(action: string, data: unknown) {
    const body = JSON.stringify(data);
    const r = await this.http.request("https://asr.tencentcloudapi.com/", {
      method: "POST",
      body,
      headers: tencentHeaders(this.profile, body, action),
    });
    if (r.Response?.Error)
      throw new ProviderError(
        "腾讯云拒绝请求，请检查凭据、模型及额度",
        r.Response.Error.Code,
      );
    return r.Response?.Data;
  }
  private volcHeaders(id: string) {
    const p = this.profile;
    return {
      "X-Api-App-Key": p.options.appId,
      "X-Api-Access-Key": p.secrets.apiKey,
      "X-Api-Resource-Id":
        p.options.resourceId ||
        (p.model === "flash" ? "volc.bigasr.auc_turbo" : "volc.bigasr.auc"),
      "X-Api-Request-Id": id,
      "X-Api-Sequence": "-1",
    };
  }
  private async baiduToken() {
    const r = await this.http.request(
      "https://aip.baidubce.com/oauth/2.0/token",
      {
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: this.profile.secrets.apiKey,
          client_secret: this.profile.secrets.secretKey,
        }),
      },
    );
    return requireValue(r.access_token, "百度 Access Token");
  }
  private async iflyUrl(path: string, extra: Record<string, string> = {}) {
    const p = this.profile;
    if (p.model === "standard") {
      const ts = String(Math.floor(Date.now() / 1000));
      const digest = createHash("md5")
        .update(p.options.appId + ts)
        .digest("hex");
      const signa = hmac(
        p.secrets.secretKey || p.secrets.accessKey,
        digest,
        "sha1",
      ).toString("base64");
      return {
        url: `https://raasr.xfyun.cn/v2/api/${path}?${new URLSearchParams({ appId: p.options.appId, ts, signa, ...extra })}`,
        headers: {} as Record<string, string>,
      };
    }
    const params = {
      appId: p.options.appId,
      accessKeyId: p.secrets.accessKey,
      dateTime: new Date().toISOString().replace(/\.\d{3}Z$/, "+0000"),
      ...extra,
    };
    const sorted = Object.entries(params)
      .filter(([, v]) => v)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => new URLSearchParams({ [k]: v }).toString())
      .join("&");
    return {
      url: `https://office-api-ist-dx.iflyaisol.com/v2/${path}?${sorted}`,
      headers: {
        signature: hmac(p.secrets.secretKey, sorted, "sha1").toString("base64"),
      },
    };
  }
  async submit(input: AudioInput): Promise<AsrSubmission> {
    const p = this.profile,
      o = p.options,
      s = p.secrets,
      file = () => audioBlob(input.path),
      lang = asrLanguage(p, input.language);
    switch (p.provider) {
      case "openai":
      case "groq":
      case "custom-openai":
      case "custom-json": {
        if (
          p.provider === "openai" &&
          ![
            "whisper-1",
            "gpt-transcribe",
            "gpt-4o-transcribe-diarize",
          ].includes(p.model)
        )
          throw new ProviderError("此模型没有本项目所需的原生字幕时间戳");
        const form = new FormData();
        form.set("file", await file(), "audio.wav");
        form.set("model", p.model);
        if (lang) form.set("language", lang);
        if (p.provider !== "custom-json") {
          form.set(
            "response_format",
            p.model.includes("diarize") ? "diarized_json" : "verbose_json",
          );
          if (p.model.includes("diarize"))
            form.set("chunking_strategy", "auto");
          else form.append("timestamp_granularities[]", "segment");
        }
        const endpoint = base(
          o.endpoint,
          p.provider === "groq"
            ? "https://api.groq.com/openai/v1"
            : "https://api.openai.com/v1",
        );
        return this.complete(
          await this.http.request(
            `${endpoint}${p.provider === "custom-json" ? "" : "/audio/transcriptions"}`,
            { body: form, headers: this.auth() },
          ),
        );
      }
      case "mistral": {
        const form = new FormData();
        form.set("file", await file(), "audio.wav");
        form.set("model", p.model);
        form.append("timestamp_granularities", "word");
        form.set("diarize", "true");
        if (lang) form.set("language", lang);
        return this.complete(
          await this.http.request(
            `${base(o.endpoint, "https://api.mistral.ai/v1")}/audio/transcriptions`,
            { body: form, headers: this.auth() },
          ),
        );
      }
      case "xai": {
        const form = new FormData();
        form.set("format", "true");
        form.set("diarize", "true");
        if (lang) form.set("language", lang);
        // xAI requires the file field to be appended after all other fields.
        form.set("file", await file(), "audio.wav");
        return this.complete(
          await this.http.request(
            `${base(o.endpoint, "https://api.x.ai/v1")}/stt`,
            { body: form, headers: this.auth() },
          ),
        );
      }
      case "cloudflare": {
        const bytes = await readFile(input.path);
        const root = base(o.endpoint, "https://api.cloudflare.com/client/v4");
        return this.complete(
          await this.http.request(
            `${root}/accounts/${encodeURIComponent(requireValue(o.accountId, "Account ID"))}/ai/run/${p.model}`,
            {
              headers: this.auth(),
              json: {
                audio: bytes.toString("base64"),
                task: "transcribe",
                vad_filter: true,
                ...(lang ? { language: lang } : {}),
              },
            },
          ),
        );
      }
      case "soniox": {
        const root = base(o.endpoint, "https://api.soniox.com/v1");
        const response = await this.http.request(`${root}/transcriptions`, {
          headers: this.auth(),
          json: {
            model: p.model,
            audio_url: requireValue(input.url, "音频临时存储"),
            enable_speaker_diarization: true,
            enable_language_identification: !lang,
            ...(lang ? { language_hints: [lang] } : {}),
            client_reference_id: input.requestId,
          },
        });
        return this.pending(response.id);
      }
      case "gladia": {
        const root = base(o.endpoint, "https://api.gladia.io/v2");
        const form = new FormData();
        form.set("audio", await file(), "audio.wav");
        const uploaded = await this.http.request(`${root}/upload`, {
          body: form,
          headers: { "x-gladia-key": s.apiKey },
        });
        const response = await this.http.request(`${root}/pre-recorded`, {
          headers: { "x-gladia-key": s.apiKey },
          json: {
            audio_url: requireValue(uploaded.audio_url, "Gladia 文件 URL"),
            model: p.model,
            diarization: true,
            sentences: true,
            language_config: {
              languages: lang ? [lang] : [],
              code_switching: !lang && p.model !== "solaria-3",
            },
          },
        });
        return this.pending(response.id);
      }
      case "revai": {
        const form = new FormData();
        form.set("media", await file(), "audio.wav");
        form.set(
          "options",
          JSON.stringify({
            metadata: input.requestId,
            ...(lang ? { language: lang } : {}),
          }),
        );
        const response = await this.http.request(
          `${base(o.endpoint, "https://api.rev.ai/speechtotext/v1")}/jobs`,
          { body: form, headers: this.auth() },
        );
        return this.pending(response.id);
      }
      case "aliyun": {
        const qwen = p.model.startsWith("qwen"),
          url = requireValue(input.url, "音频临时存储");
        const parameters = qwen
          ? { enable_words: true }
          : p.model.includes("paraformer")
            ? { timestamp_alignment_enabled: true }
            : {};
        const r = await this.http.request(
          `${base(o.endpoint, "https://dashscope.aliyuncs.com/api/v1")}/services/audio/asr/transcription`,
          {
            headers: { ...this.auth(), "X-DashScope-Async": "enable" },
            json: {
              model: p.model,
              input: qwen ? { file_url: url } : { file_urls: [url] },
              parameters: {
                ...parameters,
                ...(lang
                  ? qwen
                    ? { language: lang }
                    : { language_hints: [lang] }
                  : {}),
              },
            },
          },
        );
        return this.pending(r.output?.task_id);
      }
      case "volcengine": {
        const prefix = base(
          o.endpoint,
          "https://openspeech.bytedance.com/api/v3/auc/bigmodel",
        );
        const r = await this.http.request(
          `${prefix}/${p.model === "flash" ? "recognize/flash" : "submit"}`,
          {
            headers: this.volcHeaders(input.requestId),
            json: {
              user: { uid: o.appId },
              audio: { url: requireValue(input.url, "音频临时存储") },
              request: {
                model_name: "bigmodel",
                enable_itn: true,
                enable_punc: true,
                show_utterances: true,
              },
            },
          },
        );
        return p.model === "flash"
          ? this.complete(r)
          : this.pending(input.requestId);
      }
      case "tencent": {
        const bytes = await readFile(input.path);
        if (bytes.length > 5 * 1024 * 1024)
          throw new ProviderError("腾讯直接上传音频超过 5 MB");
        const r = await this.tc("CreateRecTask", {
          EngineModelType: p.model,
          ChannelNum: 1,
          ResTextFormat: 3,
          SourceType: 1,
          Data: bytes.toString("base64"),
          DataLen: bytes.length,
        });
        return this.pending(String(r?.TaskId || ""));
      }
      case "baidu": {
        const token = await this.baiduToken();
        const r = await this.http.request(
          `https://aip.baidubce.com/rpc/2.0/aasr/v1/create?access_token=${encodeURIComponent(token)}`,
          {
            json: {
              speech_url: requireValue(input.url, "音频临时存储"),
              format: "wav",
              pid: Number(p.model),
              rate: 16000,
            },
          },
        );
        return this.pending(r.task_id);
      }
      case "iflytek": {
        const info = await stat(input.path);
        const signatureRandom = input.requestId
          .replaceAll("-", "")
          .slice(0, 16);
        const { url, headers } = await this.iflyUrl("upload", {
          fileName: "audio.wav",
          fileSize: String(info.size),
          duration: String(input.durationMs),
          ...(p.model === "standard" ? {} : { signatureRandom }),
          ...(lang ? { language: lang } : {}),
        });
        const r = await this.http.request(url, {
          body: await file(),
          headers: { ...headers, "Content-Type": "application/octet-stream" },
        });
        return this.pending(r.content?.orderId || r.orderId, {
          signatureRandom,
        });
      }
      case "huawei": {
        const root = base(
          o.endpoint,
          `https://sis-ext.${o.region || "cn-north-4"}.myhuaweicloud.com`,
        );
        const r = await this.http.request(
          `${root}/v1/${o.projectId}/asr/transcriber/jobs`,
          {
            headers: { "X-Auth-Token": s.token },
            json: {
              config: {
                audio_format: "wav",
                property: p.model,
                add_punc: "yes",
                digit_norm: "yes",
              },
              data_url: requireValue(input.url, "音频临时存储"),
            },
          },
        );
        return this.pending(r.job_id);
      }
      case "azure": {
        const root = base(
          o.endpoint,
          `https://${requireValue(o.region, "Azure 区域")}.api.cognitive.microsoft.com`,
        );
        if (p.model === "batch") {
          const r = await this.http.request(
            `${root}/speechtotext/transcriptions:submit?api-version=2024-11-15`,
            {
              headers: { "Ocp-Apim-Subscription-Key": s.apiKey },
              json: {
                displayName: input.requestId,
                locale: lang || "zh-CN",
                contentUrls: [requireValue(input.url, "Batch 音频临时存储")],
                properties: { wordLevelTimestampsEnabled: true },
              },
            },
          );
          return this.pending(r.self);
        }
        const form = new FormData();
        form.set("audio", await file(), "audio.wav");
        form.set(
          "definition",
          JSON.stringify({
            locales: lang ? [lang] : ["zh-CN", "en-US"],
            profanityFilterMode: "None",
          }),
        );
        return this.complete(
          await this.http.request(
            `${root}/speechtotext/transcriptions:transcribe?api-version=2024-11-15`,
            { body: form, headers: { "Ocp-Apim-Subscription-Key": s.apiKey } },
          ),
        );
      }
      case "google": {
        const token = await googleToken(p, this.http),
          location = o.region || "us",
          project = requireValue(o.projectId, "Project ID");
        const r = await this.http.request(
          `https://${location}-speech.googleapis.com/v2/projects/${project}/locations/${location}/recognizers/_:batchRecognize`,
          {
            headers: { Authorization: `Bearer ${token}` },
            json: {
              config: {
                autoDecodingConfig: {},
                model: p.model,
                languageCodes: [lang || "auto"],
                features: {
                  enableWordTimeOffsets: true,
                  enableAutomaticPunctuation: true,
                },
              },
              files: [{ uri: requireValue(input.objectUri, "GCS 对象") }],
              recognitionOutputConfig: { inlineResponseConfig: {} },
            },
          },
        );
        return this.pending(r.name, { location });
      }
      case "aws": {
        const url = `https://transcribe.${o.region || "us-east-1"}.amazonaws.com/`;
        const body = JSON.stringify({
          TranscriptionJobName: input.requestId,
          Media: { MediaFileUri: requireValue(input.objectUri, "S3 对象") },
          MediaFormat: "wav",
          ...(lang ? { LanguageCode: lang } : { IdentifyLanguage: true }),
        });
        await this.http.request(url, {
          method: "POST",
          body,
          headers: {
            ...awsHeaders(p, url, "transcribe", body),
            "Content-Type": "application/x-amz-json-1.1",
            "X-Amz-Target": "Transcribe.StartTranscriptionJob",
          },
        });
        return this.pending(input.requestId);
      }
      case "ibm": {
        const url = `${base(o.endpoint, "")}/v1/recognitions?model=${encodeURIComponent(p.model)}&timestamps=true&inactivity_timeout=-1`;
        const r = await this.http.request(url, {
          body: await file(),
          headers: {
            Authorization: `Basic ${Buffer.from(`apikey:${s.apiKey}`).toString("base64")}`,
            "Content-Type": "audio/wav",
          },
        });
        return this.pending(r.id);
      }
      case "deepgram": {
        const query = new URLSearchParams({
          model: p.model,
          smart_format: "true",
          punctuate: "true",
          ...(lang ? { language: lang } : { detect_language: "true" }),
        });
        return this.complete(
          await this.http.request(
            `${base(o.endpoint, "https://api.deepgram.com/v1")}/listen?${query}`,
            {
              body: await file(),
              headers: {
                Authorization: `Token ${s.apiKey}`,
                "Content-Type": "audio/wav",
              },
            },
          ),
        );
      }
      case "assemblyai": {
        const root = base(o.endpoint, "https://api.assemblyai.com/v2"),
          headers = { authorization: s.apiKey };
        const upload = await this.http.request(`${root}/upload`, {
          headers,
          body: await file(),
        });
        const response = await this.http.request(`${root}/transcript`, {
          headers,
          json: {
            audio_url: upload.upload_url,
            speech_models: [p.model],
            ...(lang ? { language_code: lang } : { language_detection: true }),
          },
        });
        return this.pending(response.id);
      }
      case "elevenlabs": {
        const form = new FormData();
        form.set("file", await file(), "audio.wav");
        form.set("model_id", p.model);
        form.set("timestamps_granularity", "word");
        form.set("tag_audio_events", "false");
        if (lang) form.set("language_code", lang);
        return this.complete(
          await this.http.request(
            `${base(o.endpoint, "https://api.elevenlabs.io/v1")}/speech-to-text`,
            { body: form, headers: { "xi-api-key": s.apiKey } },
          ),
        );
      }
      case "speechmatics": {
        const form = new FormData();
        form.set("data_file", await file(), "audio.wav");
        form.set(
          "config",
          JSON.stringify({
            type: "transcription",
            transcription_config: {
              language: lang || "auto",
              operating_point: p.model,
            },
          }),
        );
        const response = await this.http.request(
          `${base(o.endpoint, "https://asr.api.speechmatics.com/v2")}/jobs`,
          { body: form, headers: this.auth() },
        );
        return this.pending(response.id);
      }
      default:
        throw new ProviderError("ASR 供应商未注册");
    }
  }
  async poll(task: Pending): Promise<AsrPoll> {
    const p = this.profile,
      o = p.options,
      s = p.secrets;
    switch (p.provider) {
      case "aliyun": {
        const response = await this.http.request(
          `${base(o.endpoint, "https://dashscope.aliyuncs.com/api/v1")}/tasks/${encodeURIComponent(task.id)}`,
          { headers: this.auth() },
        );
        if (["FAILED", "CANCELED"].includes(response.output?.task_status))
          throw new ProviderError("阿里云转写失败");
        if (response.output?.task_status !== "SUCCEEDED")
          return { type: "waiting" };
        const result = response.output.result || response.output.results?.[0];
        return this.complete(
          await this.http.request(
            requireValue(result?.transcription_url, "转写结果 URL"),
          ),
        );
      }
      case "volcengine": {
        const response = await this.http.request(
          `${base(o.endpoint, "https://openspeech.bytedance.com/api/v3/auc/bigmodel")}/query`,
          { method: "POST", json: {}, headers: this.volcHeaders(task.id) },
        );
        return response.result?.utterances
          ? this.complete(response)
          : { type: "waiting" };
      }
      case "tencent": {
        const response = await this.tc("DescribeTaskStatus", {
          TaskId: Number(task.id),
        });
        if (response?.Status === 3) throw new ProviderError("腾讯云转写失败");
        return response?.Status === 2
          ? this.complete(response)
          : { type: "waiting" };
      }
      case "baidu": {
        const token = await this.baiduToken();
        const response = await this.http.request(
          `https://aip.baidubce.com/rpc/2.0/aasr/v1/query?access_token=${encodeURIComponent(token)}`,
          { json: { task_ids: [task.id] } },
        );
        const item = response.tasks_info?.[0];
        if (item?.task_status === "Failure")
          throw new ProviderError("百度转写失败");
        return item?.task_status === "Success"
          ? this.complete(item)
          : { type: "waiting" };
      }
      case "iflytek": {
        const { url, headers } = await this.iflyUrl("getResult", {
          orderId: task.id,
          resultType: "transfer",
          ...(p.model === "standard"
            ? {}
            : { signatureRandom: task.context?.signatureRandom || "" }),
        });
        const response = await this.http.request(url, {
          method: p.model === "standard" ? "GET" : "POST",
          ...(p.model === "standard" ? {} : { json: {} }),
          headers,
        });
        const state = response.content?.orderInfo?.status;
        if (
          state === -1 ||
          (response.code &&
            String(response.code) !== "000000" &&
            String(response.code) !== "0")
        )
          throw new ProviderError("讯飞转写失败或查询被拒绝");
        return response.content?.orderResult || response.orderResult
          ? this.complete(response)
          : { type: "waiting" };
      }
      case "huawei": {
        const response = await this.http.request(
          `${base(o.endpoint, `https://sis-ext.${o.region || "cn-north-4"}.myhuaweicloud.com`)}/v1/${o.projectId}/asr/transcriber/jobs/${task.id}`,
          { headers: { "X-Auth-Token": s.token } },
        );
        if (response.status === "ERROR")
          throw new ProviderError("华为云转写失败");
        return response.status === "FINISHED"
          ? this.complete(response)
          : { type: "waiting" };
      }
      case "azure": {
        const headers = { "Ocp-Apim-Subscription-Key": s.apiKey };
        const response = await this.http.request(task.id, { headers });
        if (response.status === "Failed")
          throw new ProviderError("Azure 转写失败");
        if (response.status !== "Succeeded") return { type: "waiting" };
        const list = await this.http.request(response.links.files, { headers });
        const result = list.values?.find(
          (x: any) => x.kind === "Transcription",
        );
        return this.complete(
          await this.http.request(
            requireValue(result?.links?.contentUrl, "Azure 结果 URL"),
          ),
        );
      }
      case "google": {
        const token = await googleToken(p, this.http),
          location = task.context?.location || o.region || "us";
        const response = await this.http.request(
          `https://${location}-speech.googleapis.com/v2/${task.id}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (response.error) throw new ProviderError("Google 转写失败");
        if (!response.done) return { type: "waiting" };
        const result = Object.values(
          response.response?.results || {},
        )[0] as any;
        if (result?.error) throw new ProviderError("Google 文件转写失败");
        return this.complete(
          result?.transcript || result?.inlineResult?.transcript || result,
        );
      }
      case "aws": {
        const url = `https://transcribe.${o.region || "us-east-1"}.amazonaws.com/`,
          body = JSON.stringify({ TranscriptionJobName: task.id });
        const response = await this.http.request(url, {
          method: "POST",
          body,
          headers: {
            ...awsHeaders(p, url, "transcribe", body),
            "Content-Type": "application/x-amz-json-1.1",
            "X-Amz-Target": "Transcribe.GetTranscriptionJob",
          },
        });
        const item = response.TranscriptionJob;
        if (item?.TranscriptionJobStatus === "FAILED")
          throw new ProviderError("AWS 转写失败");
        return item?.TranscriptionJobStatus === "COMPLETED"
          ? this.complete(
              await this.http.request(item.Transcript.TranscriptFileUri),
            )
          : { type: "waiting" };
      }
      case "ibm": {
        const response = await this.http.request(
          `${base(o.endpoint, "")}/v1/recognitions/${encodeURIComponent(task.id)}`,
          {
            headers: {
              Authorization: `Basic ${Buffer.from(`apikey:${s.apiKey}`).toString("base64")}`,
            },
          },
        );
        if (response.status === "failed")
          throw new ProviderError("IBM 转写失败");
        return response.status === "completed"
          ? this.complete({
              results: (response.results || []).flatMap(
                (r: any) => r.results || [r],
              ),
            })
          : { type: "waiting" };
      }
      case "assemblyai": {
        const response = await this.http.request(
          `${base(o.endpoint, "https://api.assemblyai.com/v2")}/transcript/${task.id}`,
          { headers: { authorization: s.apiKey } },
        );
        if (response.status === "error")
          throw new ProviderError("AssemblyAI 转写失败");
        return response.status === "completed"
          ? this.complete(response)
          : { type: "waiting" };
      }
      case "speechmatics": {
        const root = base(o.endpoint, "https://asr.api.speechmatics.com/v2");
        const response = await this.http.request(`${root}/jobs/${task.id}`, {
          headers: this.auth(),
        });
        if (response.job?.status === "rejected")
          throw new ProviderError("Speechmatics 转写失败");
        return response.job?.status === "done"
          ? this.complete(
              await this.http.request(
                `${root}/jobs/${task.id}/transcript?format=json-v2`,
                { headers: this.auth() },
              ),
            )
          : { type: "waiting" };
      }
      case "soniox": {
        const root = base(o.endpoint, "https://api.soniox.com/v1");
        const response = await this.http.request(
          `${root}/transcriptions/${encodeURIComponent(task.id)}`,
          { headers: this.auth() },
        );
        if (response.status === "error")
          throw new ProviderError(response.error_message || "Soniox 转写失败");
        if (response.status !== "completed") return { type: "waiting" };
        return this.complete(
          await this.http.request(
            `${root}/transcriptions/${encodeURIComponent(task.id)}/transcript`,
            { headers: this.auth() },
          ),
        );
      }
      case "gladia": {
        const root = base(o.endpoint, "https://api.gladia.io/v2");
        const response = await this.http.request(
          `${root}/pre-recorded/${encodeURIComponent(task.id)}`,
          { headers: { "x-gladia-key": s.apiKey } },
        );
        if (response.status === "error")
          throw new ProviderError(
            response.error_message || response.error_code || "Gladia 转写失败",
          );
        return response.status === "done"
          ? this.complete(response)
          : { type: "waiting" };
      }
      case "revai": {
        const root = base(o.endpoint, "https://api.rev.ai/speechtotext/v1");
        const response = await this.http.request(
          `${root}/jobs/${encodeURIComponent(task.id)}`,
          { headers: this.auth() },
        );
        if (response.status === "failed")
          throw new ProviderError(response.failure_detail || "Rev AI 转写失败");
        if (response.status !== "transcribed") return { type: "waiting" };
        return this.complete(
          await this.http.request(
            `${root}/jobs/${encodeURIComponent(task.id)}/transcript`,
            {
              headers: {
                ...this.auth(),
                Accept: "application/vnd.rev.transcript.v1.0+json",
              },
            },
          ),
        );
      }
      default:
        throw new ProviderError("同步供应商没有可轮询任务");
    }
  }
}
