package dev.subtitle.workbench

import java.io.File
import java.security.MessageDigest
import java.time.Instant
import okhttp3.FormBody
import org.json.JSONObject

class NativeAsr(private val p: JSONObject) {
    private val o = p.o("options")
    private val s = p.o("secrets")
    private val model = p.s("model")
    private val provider = p.s("provider")
    private val http = NativeHttp(p)

    private fun base(fallback: String) = o.s("endpoint", fallback).trimEnd('/')

    private fun bearer() = mapOf("Authorization" to "Bearer ${s.s("apiKey")}")

    private fun pending(id: String) =
        obj("type" to "pending", "id" to id.also { require(it.isNotBlank()) { "服务没有返回任务 ID" } })

    private fun complete(raw: JSONObject) =
        obj("type" to "complete", "transcript" to NativeNormalize.normalize(provider, raw))

    private fun waiting() = obj("type" to "waiting")

    private fun volc(id: String) =
        mapOf(
            "X-Api-App-Key" to o.s("appId"),
            "X-Api-Access-Key" to s.s("apiKey"),
            "X-Api-Resource-Id" to
                o.s(
                    "resourceId",
                    if (model == "flash") "volc.bigasr.auc_turbo" else "volc.bigasr.auc",
                ),
            "X-Api-Request-Id" to id,
            "X-Api-Sequence" to "-1",
        )

    private fun tencent(action: String, data: JSONObject): JSONObject {
        val r =
            http
                .json(
                    "https://asr.tencentcloudapi.com/",
                    data,
                    tencentSign(p, data.toString(), action),
                )
                .o("Response")
        require(!r.has("Error")) { "腾讯云拒绝请求，请检查凭据、模型和额度" }
        return r.o("Data")
    }

    private fun baiduToken() =
        (http.request(
                "https://aip.baidubce.com/oauth/2.0/token",
                "POST",
                FormBody.Builder()
                    .add("grant_type", "client_credentials")
                    .add("client_id", s.s("apiKey"))
                    .add("client_secret", s.s("secretKey"))
                    .build(),
            ) as JSONObject)
            .getString("access_token")

    private fun ifly(path: String, extra: Map<String, String>): Pair<String, Map<String, String>> {
        if (model == "standard") {
            val ts = Instant.now().epochSecond.toString()
            val digest =
                hex(MessageDigest.getInstance("MD5").digest((o.s("appId") + ts).toByteArray()))
            return "https://raasr.xfyun.cn/v2/api/$path?" +
                query(
                    mapOf(
                        "appId" to o.s("appId"),
                        "ts" to ts,
                        "signa" to b64(mac(s.s("secretKey").toByteArray(), digest, "HmacSHA1")),
                    ) + extra
                ) to emptyMap()
        }
        val q =
            (mapOf(
                    "appId" to o.s("appId"),
                    "accessKeyId" to s.s("accessKey"),
                    "dateTime" to
                        java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ssZ")
                            .withZone(java.time.ZoneOffset.UTC)
                            .format(Instant.now()),
                ) + extra)
                .toSortedMap()
                .filterValues { it.isNotEmpty() }
                .entries
                .joinToString("&") { "${it.key}=${java.net.URLEncoder.encode(it.value,"UTF-8")}" }
        return "https://office-api-ist-dx.iflyaisol.com/v2/$path?$q" to
            mapOf("signature" to b64(mac(s.s("secretKey").toByteArray(), q, "HmacSHA1")))
    }

    fun submit(file: File, input: JSONObject): JSONObject {
        val selected = input.s("language", "auto")
        val locales =
            mapOf(
                "zh" to "zh-CN",
                "zh-Hant" to "zh-TW",
                "en" to "en-US",
                "ja" to "ja-JP",
                "ko" to "ko-KR",
                "fr" to "fr-FR",
                "de" to "de-DE",
                "es" to "es-ES",
                "pt" to "pt-BR",
                "ru" to "ru-RU",
                "ar" to "ar-SA",
                "hi" to "hi-IN",
            )
        val language =
            if (o.s("languageCode").isNotEmpty()) o.s("languageCode")
            else
                when {
                    provider == "iflytek" ->
                        if (model == "standard") {
                            if (selected == "auto" || selected.startsWith("zh")) "cn" else selected
                        } else if (selected in listOf("auto", "zh", "zh-Hant", "en")) "autodialect"
                        else "autominor"
                    provider in listOf("azure", "aws", "google") -> locales[selected] ?: selected
                    provider == "speechmatics" && selected.startsWith("zh") -> "cmn"
                    selected == "zh-Hant" -> "zh"
                    else -> selected
                }
        val lang = if (language == "auto") emptyMap() else mapOf("language" to language)
        val id = input.s("requestId")
        fun url(): String = input.s("url").also { require(it.isNotEmpty()) { "该供应商需要音频临时存储" } }
        return when (provider) {
            "openai",
            "groq",
            "custom-openai",
            "custom-json" -> {
                require(
                    provider != "openai" ||
                        model in
                            listOf(
                                "whisper-1",
                                "gpt-transcribe",
                                "gpt-4o-transcribe-diarize",
                            )
                ) {
                    "此模型不提供字幕所需时间戳"
                }
                val fields = mutableMapOf("model" to model)
                fields.putAll(lang)
                if (provider != "custom-json") {
                    fields["response_format"] =
                        if (model.contains("diarize")) "diarized_json" else "verbose_json"
                    if (model.contains("diarize")) fields["chunking_strategy"] = "auto"
                    else fields["timestamp_granularities[]"] = "segment"
                }
                complete(
                    http.multipart(
                        base(
                            if (provider == "groq") "https://api.groq.com/openai/v1"
                            else "https://api.openai.com/v1"
                        ) + if (provider == "custom-json") "" else "/audio/transcriptions",
                        file,
                        "file",
                        fields,
                        bearer(),
                    )
                )
            }
            "mistral" ->
                complete(
                    http.multipart(
                        base("https://api.mistral.ai/v1") + "/audio/transcriptions",
                        file,
                        "file",
                        mapOf(
                            "model" to model,
                            "timestamp_granularities" to "word",
                            "diarize" to "true",
                        ) + lang,
                        bearer(),
                    )
                )
            "xai" ->
                complete(
                    http.multipart(
                        base("https://api.x.ai/v1") + "/stt",
                        file,
                        "file",
                        mapOf("format" to "true", "diarize" to "true") + lang,
                        bearer(),
                        fileLast = true,
                    )
                )
            "cloudflare" ->
                complete(
                    http.json(
                        base("https://api.cloudflare.com/client/v4") +
                            "/accounts/${enc(o.s("accountId"))}/ai/run/$model",
                        obj(
                            "audio" to b64(file.readBytes()),
                            "task" to "transcribe",
                            "vad_filter" to true,
                        ).also {
                            if (language != "auto") it.put("language", language)
                        },
                        bearer(),
                    )
                )
            "soniox" -> {
                val data =
                    obj(
                        "model" to model,
                        "audio_url" to url(),
                        "enable_speaker_diarization" to true,
                        "enable_language_identification" to (language == "auto"),
                        "client_reference_id" to id,
                    )
                if (language != "auto") data.put("language_hints", arr(listOf(language)))
                pending(
                    http
                        .json(
                            base("https://api.soniox.com/v1") + "/transcriptions",
                            data,
                            bearer(),
                        )
                        .s("id")
                )
            }
            "gladia" -> {
                val root = base("https://api.gladia.io/v2")
                val headers = mapOf("x-gladia-key" to s.s("apiKey"))
                val upload = http.multipart("$root/upload", file, "audio", emptyMap(), headers)
                val languageConfig =
                    obj(
                        "languages" to
                            arr(if (language == "auto") emptyList<String>() else listOf(language)),
                        "code_switching" to (language == "auto" && model != "solaria-3"),
                    )
                pending(
                    http
                        .json(
                            "$root/pre-recorded",
                            obj(
                                "audio_url" to upload.s("audio_url"),
                                "model" to model,
                                "diarization" to true,
                                "sentences" to true,
                                "language_config" to languageConfig,
                            ),
                            headers,
                        )
                        .s("id")
                )
            }
            "revai" ->
                pending(
                    http
                        .multipart(
                            base("https://api.rev.ai/speechtotext/v1") + "/jobs",
                            file,
                            "media",
                            mapOf(
                                "options" to
                                    obj("metadata" to id).also {
                                            if (language != "auto") it.put("language", language)
                                        }
                                        .toString()
                            ),
                            bearer(),
                        )
                        .s("id")
                )
            "aliyun" -> {
                val qwen = model.startsWith("qwen")
                val parameters =
                    if (qwen) obj("enable_words" to true)
                    else if (model.contains("paraformer"))
                        obj("timestamp_alignment_enabled" to true)
                    else obj()
                if (language != "auto") {
                    if (qwen) parameters.put("language", language)
                    else parameters.put("language_hints", arr(listOf(language)))
                }
                val r =
                    http.json(
                        base("https://dashscope.aliyuncs.com/api/v1") +
                            "/services/audio/asr/transcription",
                        obj(
                            "model" to model,
                            "input" to
                                if (qwen) obj("file_url" to url())
                                else obj("file_urls" to arr(listOf(url()))),
                            "parameters" to parameters,
                        ),
                        bearer() + mapOf("X-DashScope-Async" to "enable"),
                    )
                pending(r.o("output").s("task_id"))
            }
            "volcengine" -> {
                val r =
                    http.json(
                        base("https://openspeech.bytedance.com/api/v3/auc/bigmodel") +
                            if (model == "flash") "/recognize/flash" else "/submit",
                        obj(
                            "user" to obj("uid" to o.s("appId")),
                            "audio" to obj("url" to url()),
                            "request" to
                                obj(
                                    "model_name" to "bigmodel",
                                    "enable_itn" to true,
                                    "enable_punc" to true,
                                    "show_utterances" to true,
                                ),
                        ),
                        volc(id),
                    )
                if (model == "flash") complete(r) else pending(id)
            }
            "tencent" -> {
                require(file.length() <= 5 * 1024 * 1024) { "腾讯音频超过 5 MB" }
                pending(
                    tencent(
                            "CreateRecTask",
                            obj(
                                "EngineModelType" to model,
                                "ChannelNum" to 1,
                                "ResTextFormat" to 3,
                                "SourceType" to 1,
                                "Data" to b64(file.readBytes()),
                                "DataLen" to file.length(),
                            ),
                        )
                        .s("TaskId")
                )
            }
            "baidu" ->
                pending(
                    http
                        .json(
                            "https://aip.baidubce.com/rpc/2.0/aasr/v1/create?access_token=${enc(baiduToken())}",
                            obj(
                                "speech_url" to url(),
                                "format" to "wav",
                                "pid" to model.toInt(),
                                "rate" to 16000,
                            ),
                        )
                        .s("task_id")
                )
            "iflytek" -> {
                val random = id.replace("-", "").take(16)
                val (endpoint, headers) =
                    ifly(
                        "upload",
                        mapOf(
                            "fileName" to "audio.wav",
                            "fileSize" to file.length().toString(),
                            "duration" to input.s("durationMs"),
                        ) +
                            lang +
                            (if (model == "standard") emptyMap()
                            else mapOf("signatureRandom" to random)),
                    )
                val r =
                    http.binary(
                        endpoint,
                        file,
                        headers + mapOf("Content-Type" to "application/octet-stream"),
                    )
                pending(r.o("content").s("orderId", r.s("orderId")))
                    .put("context", obj("signatureRandom" to random))
            }
            "huawei" ->
                pending(
                    http
                        .json(
                            base(
                                "https://sis-ext.${o.s("region","cn-north-4")}.myhuaweicloud.com"
                            ) + "/v1/${o.s("projectId")}/asr/transcriber/jobs",
                            obj(
                                "config" to
                                    obj(
                                        "audio_format" to "wav",
                                        "property" to model,
                                        "add_punc" to "yes",
                                        "digit_norm" to "yes",
                                    ),
                                "data_url" to url(),
                            ),
                            mapOf("X-Auth-Token" to s.s("token")),
                        )
                        .s("job_id")
                )
            "azure" -> {
                val root = base("https://${o.s("region")}.api.cognitive.microsoft.com")
                val headers = mapOf("Ocp-Apim-Subscription-Key" to s.s("apiKey"))
                if (model == "batch")
                    pending(
                        http
                            .json(
                                "$root/speechtotext/transcriptions:submit?api-version=2024-11-15",
                                obj(
                                    "displayName" to id,
                                    "locale" to if (language == "auto") "zh-CN" else language,
                                    "contentUrls" to arr(listOf(url())),
                                    "properties" to obj("wordLevelTimestampsEnabled" to true),
                                ),
                                headers,
                            )
                            .s("self")
                    )
                else
                    complete(
                        http.multipart(
                            "$root/speechtotext/transcriptions:transcribe?api-version=2024-11-15",
                            file,
                            "audio",
                            mapOf(
                                "definition" to
                                    obj(
                                            "locales" to
                                                arr(
                                                    if (language == "auto") listOf("zh-CN", "en-US")
                                                    else listOf(language)
                                                ),
                                            "profanityFilterMode" to "None",
                                        )
                                        .toString()
                            ),
                            headers,
                        )
                    )
            }
            "google" -> {
                val region = o.s("region", "us")
                pending(
                    http
                        .json(
                            "https://$region-speech.googleapis.com/v2/projects/${o.s("projectId")}/locations/$region/recognizers/_:batchRecognize",
                            obj(
                                "config" to
                                    obj(
                                        "autoDecodingConfig" to obj(),
                                        "model" to model,
                                        "languageCodes" to arr(listOf(language)),
                                        "features" to
                                            obj(
                                                "enableWordTimeOffsets" to true,
                                                "enableAutomaticPunctuation" to true,
                                            ),
                                    ),
                                "files" to arr(listOf(obj("uri" to input.s("objectUri")))),
                                "recognitionOutputConfig" to obj("inlineResponseConfig" to obj()),
                            ),
                            mapOf("Authorization" to "Bearer ${http.googleToken()}"),
                        )
                        .s("name")
                )
            }
            "aws" -> {
                val endpoint = "https://transcribe.${o.s("region","us-east-1")}.amazonaws.com/"
                val data =
                    obj(
                        "TranscriptionJobName" to id,
                        "Media" to obj("MediaFileUri" to input.s("objectUri")),
                        "MediaFormat" to "wav",
                    )
                if (language == "auto") data.put("IdentifyLanguage", true)
                else data.put("LanguageCode", language)
                http.json(
                    endpoint,
                    data,
                    awsSign(p, endpoint, "transcribe", data.toString().toByteArray()) +
                        mapOf(
                            "Content-Type" to "application/x-amz-json-1.1",
                            "X-Amz-Target" to "Transcribe.StartTranscriptionJob",
                        ),
                )
                pending(id)
            }
            "ibm" ->
                pending(
                    http
                        .binary(
                            base("") +
                                "/v1/recognitions?model=${enc(model)}&timestamps=true&inactivity_timeout=-1",
                            file,
                            mapOf(
                                "Authorization" to
                                    "Basic ${b64(("apikey:"+s.s("apiKey")).toByteArray())}"
                            ),
                        )
                        .s("id")
                )
            "deepgram" ->
                complete(
                    http.binary(
                        base("https://api.deepgram.com/v1") +
                            "/listen?" +
                            query(
                                mapOf(
                                    "model" to model,
                                    "smart_format" to "true",
                                    "punctuate" to "true",
                                ) +
                                    if (language == "auto") mapOf("detect_language" to "true")
                                    else lang
                            ),
                        file,
                        mapOf("Authorization" to "Token ${s.s("apiKey")}"),
                    )
                )
            "assemblyai" -> {
                val root = base("https://api.assemblyai.com/v2")
                val headers = mapOf("authorization" to s.s("apiKey"))
                val upload = http.binary("$root/upload", file, headers)
                val data =
                    obj(
                        "audio_url" to upload.s("upload_url"),
                        "speech_models" to arr(listOf(model)),
                    )
                if (language == "auto") data.put("language_detection", true)
                else data.put("language_code", language)
                pending(http.json("$root/transcript", data, headers).s("id"))
            }
            "elevenlabs" ->
                complete(
                    http.multipart(
                        base("https://api.elevenlabs.io/v1") + "/speech-to-text",
                        file,
                        "file",
                        mapOf(
                            "model_id" to model,
                            "timestamps_granularity" to "word",
                            "tag_audio_events" to "false",
                        ) +
                            if (language == "auto") emptyMap()
                            else mapOf("language_code" to language),
                        mapOf("xi-api-key" to s.s("apiKey")),
                    )
                )
            "speechmatics" ->
                pending(
                    http
                        .multipart(
                            base("https://asr.api.speechmatics.com/v2") + "/jobs",
                            file,
                            "data_file",
                            mapOf(
                                "config" to
                                    obj(
                                            "type" to "transcription",
                                            "transcription_config" to
                                                obj(
                                                    "language" to language,
                                                    "operating_point" to model,
                                                ),
                                        )
                                        .toString()
                            ),
                            bearer(),
                        )
                        .s("id")
                )
            else -> error("未知 ASR 供应商")
        }
    }

    fun poll(task: JSONObject): JSONObject {
        val id = task.s("id")
        return when (provider) {
            "aliyun" -> {
                val r =
                    http
                        .json(
                            base("https://dashscope.aliyuncs.com/api/v1") + "/tasks/${enc(id)}",
                            headers = bearer(),
                        )
                        .o("output")
                require(r.s("task_status") !in listOf("FAILED", "CANCELED")) { "阿里云转写失败" }
                if (r.s("task_status") != "SUCCEEDED") waiting()
                else
                    complete(
                        http.json(
                            (r.optJSONObject("result") ?: r.a("results").getJSONObject(0))
                                .getString("transcription_url")
                        )
                    )
            }
            "volcengine" -> {
                val r =
                    http.json(
                        base("https://openspeech.bytedance.com/api/v3/auc/bigmodel") + "/query",
                        obj(),
                        volc(id),
                    )
                if (r.o("result").has("utterances")) complete(r) else waiting()
            }
            "tencent" -> {
                val r = tencent("DescribeTaskStatus", obj("TaskId" to id.toLong()))
                require(r.optInt("Status") != 3) { "腾讯转写失败" }
                if (r.optInt("Status") == 2) complete(r) else waiting()
            }
            "baidu" -> {
                val r =
                    http
                        .json(
                            "https://aip.baidubce.com/rpc/2.0/aasr/v1/query?access_token=${enc(baiduToken())}",
                            obj("task_ids" to arr(listOf(id))),
                        )
                        .a("tasks_info")
                        .getJSONObject(0)
                require(r.s("task_status") != "Failure") { "百度转写失败" }
                if (r.s("task_status") == "Success") complete(r) else waiting()
            }
            "iflytek" -> {
                val (url, headers) =
                    ifly(
                        "getResult",
                        mapOf("orderId" to id, "resultType" to "transfer") +
                            (if (model == "standard") emptyMap()
                            else mapOf("signatureRandom" to task.o("context").s("signatureRandom"))),
                    )
                val r =
                    http.json(
                        url,
                        if (model == "standard") null else obj(),
                        headers = headers,
                        method = if (model == "standard") "GET" else "POST",
                    )
                require(r.s("code") in listOf("", "0", "000000")) { "讯飞查询被拒绝" }
                if (r.s("orderResult").isNotEmpty() || r.o("content").s("orderResult").isNotEmpty())
                    complete(r)
                else waiting()
            }
            "huawei" -> {
                val r =
                    http.json(
                        base("https://sis-ext.${o.s("region","cn-north-4")}.myhuaweicloud.com") +
                            "/v1/${o.s("projectId")}/asr/transcriber/jobs/$id",
                        headers = mapOf("X-Auth-Token" to s.s("token")),
                    )
                require(r.s("status") != "ERROR") { "华为云转写失败" }
                if (r.s("status") == "FINISHED") complete(r) else waiting()
            }
            "azure" -> {
                val headers = mapOf("Ocp-Apim-Subscription-Key" to s.s("apiKey"))
                val r = http.json(id, headers = headers)
                require(r.s("status") != "Failed") { "Azure 转写失败" }
                if (r.s("status") != "Succeeded") waiting()
                else {
                    val result =
                        http
                            .json(r.o("links").getString("files"), headers = headers)
                            .a("values")
                            .objects()
                            .first { it.s("kind") == "Transcription" }
                    complete(http.json(result.o("links").getString("contentUrl")))
                }
            }
            "google" -> {
                val r =
                    http.json(
                        "https://${o.s("region","us")}-speech.googleapis.com/v2/$id",
                        headers = mapOf("Authorization" to "Bearer ${http.googleToken()}"),
                    )
                require(!r.has("error")) { "Google 转写失败" }
                if (!r.optBoolean("done")) waiting()
                else {
                    val results = r.o("response").o("results")
                    val item = results.getJSONObject(results.keys().next())
                    require(!item.has("error")) { "Google 文件转写失败" }
                    complete(
                        item.optJSONObject("transcript")
                            ?: item.o("inlineResult").optJSONObject("transcript")
                            ?: item
                    )
                }
            }
            "aws" -> {
                val url = "https://transcribe.${o.s("region","us-east-1")}.amazonaws.com/"
                val body = obj("TranscriptionJobName" to id)
                val r =
                    http
                        .json(
                            url,
                            body,
                            awsSign(p, url, "transcribe", body.toString().toByteArray()) +
                                mapOf(
                                    "Content-Type" to "application/x-amz-json-1.1",
                                    "X-Amz-Target" to "Transcribe.GetTranscriptionJob",
                                ),
                        )
                        .o("TranscriptionJob")
                require(r.s("TranscriptionJobStatus") != "FAILED") { "AWS 转写失败" }
                if (r.s("TranscriptionJobStatus") == "COMPLETED")
                    complete(http.json(r.o("Transcript").getString("TranscriptFileUri")))
                else waiting()
            }
            "ibm" -> {
                val r =
                    http.json(
                        base("") + "/v1/recognitions/${enc(id)}",
                        headers =
                            mapOf(
                                "Authorization" to
                                    "Basic ${b64(("apikey:"+s.s("apiKey")).toByteArray())}"
                            ),
                    )
                require(r.s("status") != "failed") { "IBM 转写失败" }
                if (r.s("status") == "completed")
                    complete(
                        obj(
                            "results" to
                                arr(
                                    r.a("results").objects().flatMap {
                                        it.optJSONArray("results")?.objects() ?: listOf(it)
                                    }
                                )
                        )
                    )
                else waiting()
            }
            "assemblyai" -> {
                val r =
                    http.json(
                        base("https://api.assemblyai.com/v2") + "/transcript/$id",
                        headers = mapOf("authorization" to s.s("apiKey")),
                    )
                require(r.s("status") != "error") { "AssemblyAI 转写失败" }
                if (r.s("status") == "completed") complete(r) else waiting()
            }
            "speechmatics" -> {
                val root = base("https://asr.api.speechmatics.com/v2")
                val r = http.json("$root/jobs/$id", headers = bearer())
                require(r.o("job").s("status") != "rejected") { "Speechmatics 转写失败" }
                if (r.o("job").s("status") == "done")
                    complete(
                        http.json("$root/jobs/$id/transcript?format=json-v2", headers = bearer())
                    )
                else waiting()
            }
            "soniox" -> {
                val root = base("https://api.soniox.com/v1")
                val r = http.json("$root/transcriptions/${enc(id)}", headers = bearer())
                require(r.s("status") != "error") {
                    r.s("error_message", "Soniox 转写失败")
                }
                if (r.s("status") != "completed") waiting()
                else complete(http.json("$root/transcriptions/${enc(id)}/transcript", headers = bearer()))
            }
            "gladia" -> {
                val r =
                    http.json(
                        base("https://api.gladia.io/v2") + "/pre-recorded/${enc(id)}",
                        headers = mapOf("x-gladia-key" to s.s("apiKey")),
                    )
                require(r.s("status") != "error") {
                    r.s("error_message", r.s("error_code", "Gladia 转写失败"))
                }
                if (r.s("status") == "done") complete(r) else waiting()
            }
            "revai" -> {
                val root = base("https://api.rev.ai/speechtotext/v1")
                val r = http.json("$root/jobs/${enc(id)}", headers = bearer())
                require(r.s("status") != "failed") {
                    r.s("failure_detail", "Rev AI 转写失败")
                }
                if (r.s("status") != "transcribed") waiting()
                else
                    complete(
                        http.json(
                            "$root/jobs/${enc(id)}/transcript",
                            headers =
                                bearer() +
                                    mapOf("Accept" to "application/vnd.rev.transcript.v1.0+json"),
                        )
                    )
            }
            else -> error("同步接口无远端任务")
        }
    }
}
