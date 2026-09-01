package dev.subtitle.workbench

import android.content.Context
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

class NativeService(private val context: Context, val store: NativeStore = NativeStore(context)) {
    private fun catalog() =
        JSONArray(context.assets.open("providers.json").bufferedReader().use { it.readText() })

    private fun definition(id: String) =
        catalog().objects().firstOrNull { it.s("id") == id } ?: error("供应商不存在")

    private fun testWav(file: File) {
        val rate = 16000
        val samples = (rate * 0.8).toInt()
        val data = ByteArray(44 + samples * 2)
        fun text(offset: Int, value: String) =
            value.toByteArray(Charsets.US_ASCII).copyInto(data, offset)
        fun le(offset: Int, value: Int, bytes: Int) {
            repeat(bytes) { data[offset + it] = (value ushr (it * 8)).toByte() }
        }
        text(0, "RIFF")
        le(4, data.size - 8, 4)
        text(8, "WAVEfmt ")
        le(16, 16, 4)
        le(20, 1, 2)
        le(22, 1, 2)
        le(24, rate, 4)
        le(28, rate * 2, 4)
        le(32, 2, 2)
        le(34, 16, 2)
        text(36, "data")
        le(40, samples * 2, 4)
        repeat(samples) { index ->
            val sample =
                (kotlin.math.sin(2.0 * Math.PI * 440.0 * index / rate) * 1200).toInt()
            le(44 + index * 2, sample, 2)
        }
        file.parentFile?.mkdirs()
        file.writeBytes(data)
    }

    fun import(file: File, name: String): JSONObject {
        val info = NativeMedia(context).probe(file)
        val id = uuid()
        val now = System.currentTimeMillis()
        val p =
            obj(
                "id" to id,
                "name" to name,
                "mediaName" to name,
                "mediaPath" to file.absolutePath,
                "media" to info,
                "createdAt" to now,
                "updatedAt" to now,
                "document" to emptyDocument(),
                "style" to defaultStyle(),
            )
        store.saveProject(p)
        return store.publicProject(p)
    }

    @Synchronized
    fun call(method: String, a: JSONObject): Any {
        when (method) {
            "media.fonts" -> {
                val names = mutableSetOf("sans-serif", "serif", "monospace")
                runCatching {
                    val file = File("/system/etc/fonts.xml")
                    val parser = android.util.Xml.newPullParser()
                    file.inputStream().use {
                        parser.setInput(it, "UTF-8")
                        while (parser.eventType != org.xmlpull.v1.XmlPullParser.END_DOCUMENT) {
                            if (
                                parser.eventType == org.xmlpull.v1.XmlPullParser.START_TAG &&
                                    parser.name == "family"
                            )
                                parser.getAttributeValue(null, "name")?.let { names.add(it) }
                            parser.next()
                        }
                    }
                }
                return obj("checked" to true, "families" to arr(names.sorted()))
            }
            "state" -> return store.state()
            "catalog" -> return catalog()
            "profile.save" -> {
                val p = a.copy()
                val id = p.s("id").ifEmpty { uuid() }
                val old = if (p.s("id").isEmpty()) null else store.get("profile", id)
                require(old == null || old.s("provider") == p.s("provider")) {
                    "不能修改已有配置的供应商，请新建配置"
                }
                val secrets = old?.o("secrets")?.copy() ?: obj()
                p.o("secrets").keys().forEach { k ->
                    if (p.o("secrets").s(k).isNotEmpty()) secrets.put(k, p.o("secrets").s(k))
                }
                p.put("secrets", secrets).put("id", id).put("verification", "unverified")
                definition(p.s("provider")).a("fields").objects().forEach { field ->
                    require(
                        field.optBoolean("optional") ||
                            (if (field.optBoolean("secret")) secrets else p.o("options"))
                                .s(field.s("key"))
                                .isNotBlank()
                    ) {
                        "缺少 ${field.s("label")}"
                    }
                }
                store.put("profile", id, p)
                return store.publicProfile(p)
            }
            "profile.delete" -> {
                store.delete("profile", a.s("id"))
                return obj("ok" to true)
            }
            "profile.test" -> {
                val profile = store.get("profile", a.s("id"))
                val def = definition(profile.s("provider"))
                val checkedAt = System.currentTimeMillis()
                val file = File(store.root, "profile-tests/${profile.s("id")}.wav")
                var storage: NativeStorage? = null
                var staged: JSONObject? = null
                return try {
                    testWav(file)
                    val message =
                        when (def.s("category")) {
                            "translation" -> {
                                NativeTranslation(profile)
                                    .translate(
                                        listOf(obj("id" to "connection-test", "text" to "Connection test.")),
                                        "en",
                                        "zh",
                                        "",
                                        "",
                                    )
                                "翻译请求成功，返回结构与字幕 ID 校验通过"
                            }
                            "storage" -> {
                                storage = NativeStorage(profile)
                                staged =
                                    storage!!.put(
                                        file,
                                        "subtitle/profile-tests/${uuid()}.wav",
                                    )
                                "临时对象上传成功，清理请求已执行"
                            }
                            else -> {
                                var url = ""
                                var uri = ""
                                if (
                                    def.s("input") != "file" ||
                                        profile.s("provider") == "azure" &&
                                            profile.s("model") == "batch"
                                ) {
                                    val candidate =
                                        store.list("profile").firstOrNull { item ->
                                            val storageDef = definition(item.s("provider"))
                                            storageDef.s("category") == "storage" &&
                                                (def.s("input") != "gcs" ||
                                                    item.s("provider") == "storage-gcs") &&
                                                (def.s("input") != "s3" ||
                                                    item.s("provider") == "storage-s3")
                                        } ?: error("该识别服务测试需要先配置兼容的临时存储")
                                    storage = NativeStorage(candidate)
                                    staged =
                                        storage!!.put(
                                            file,
                                            "subtitle/profile-tests/${uuid()}.wav",
                                        )
                                    url = staged!!.s("url")
                                    uri = staged!!.s("uri")
                                }
                                try {
                                    val result =
                                        NativeAsr(profile)
                                            .submit(
                                                file,
                                                obj(
                                                    "durationMs" to 800,
                                                    "language" to "en",
                                                    "requestId" to uuid(),
                                                    "url" to url,
                                                    "objectUri" to uri,
                                                ),
                                            )
                                    if (result.s("type") == "complete")
                                        "识别请求成功，带时间戳结果校验通过"
                                    else "识别任务已被服务接受（远端任务 ${result.s("id")}）"
                                } catch (e: IllegalArgumentException) {
                                    if (e.message?.contains("未返回带时间戳字幕") == true)
                                        "识别请求成功；连接测试音频不含语音，未产生字幕"
                                    else throw e
                                }
                            }
                        }
                    profile
                        .put("verification", "verified")
                        .put("verifiedAt", checkedAt)
                        .put("verificationMessage", message)
                    store.put("profile", profile.s("id"), profile)
                    obj("ok" to true, "checkedAt" to checkedAt, "message" to message)
                } catch (e: Exception) {
                    val message = e.message ?: "测试失败"
                    profile
                        .put("verification", "unverified")
                        .put("verifiedAt", checkedAt)
                        .put("verificationMessage", message.take(500))
                    store.put("profile", profile.s("id"), profile)
                    obj("ok" to false, "checkedAt" to checkedAt, "message" to message)
                } finally {
                    if (staged != null && storage != null)
                        runCatching { storage!!.remove(staged!!.s("key")) }
                    file.delete()
                }
            }
            "project.blank" -> {
                val id = uuid()
                val p =
                    obj(
                        "id" to id,
                        "name" to a.s("name", "字幕项目"),
                        "createdAt" to System.currentTimeMillis(),
                        "updatedAt" to System.currentTimeMillis(),
                        "document" to emptyDocument(),
                        "style" to defaultStyle(),
                    )
                store.saveProject(p)
                return store.publicProject(p)
            }
            "library.list" -> return JSONArray()
            "job.create" -> {
                val kind = a.s("kind")
                require(kind in listOf("transcribe", "translate", "segment", "rewrite", "render"))
                val project = store.get("project", a.s("id"))
                val params = a.o("params")
                if (kind != "render") {
                    val profile = store.get("profile", params.s("profileId"))
                    require(
                        definition(profile.s("provider")).s("category") ==
                            if (kind == "transcribe") "asr" else "translation"
                    ) {
                        "供应商类型不匹配"
                    }
                    if (kind in listOf("segment", "rewrite"))
                        require(definition(profile.s("provider")).optBoolean("aiOperations")) {
                            "该翻译服务不支持 AI 断句或指令修改"
                        }
                }
                if (kind != "transcribe")
                    require(project.o("document").a("cues").length() > 0) { "请先生成字幕" }
                if (kind == "transcribe")
                    require(project.o("media").a("audioTracks").length() > 0) { "视频没有音轨；可导入字幕直接烧录" }
                if (kind == "render") require(project.has("media")) { "请先导入视频" }
                if (kind == "translate")
                    require(params.s("targetLanguage").isNotBlank()) { "请选择目标语言" }
                if (kind == "rewrite") {
                    require(params.s("instruction").isNotBlank()) { "请输入 AI 修改要求" }
                    if (params.s("scope", "source") == "translation")
                        require(params.s("targetLanguage").isNotBlank()) { "请选择译文语言" }
                }
                if (kind == "segment") {
                    require(params.optInt("maxCharacters", 24) in 4..120) { "每条字幕字数无效" }
                    require(params.optLong("maxDurationMs", 5000) in 500..20000) {
                        "每条字幕时长无效"
                    }
                }
                if (kind == "render")
                    Subtitles.export(
                        project.o("document"),
                        "ass",
                        params.s("mode", "source"),
                        params.s("targetLanguage"),
                        project.o("style"),
                    )
                val id = uuid()
                val now = System.currentTimeMillis()
                val j =
                    obj(
                        "id" to id,
                        "projectId" to project.s("id"),
                        "kind" to kind,
                        "params" to params,
                        "status" to "queued",
                        "phase" to "等待执行",
                        "progress" to 0,
                        "createdAt" to now,
                        "updatedAt" to now,
                    )
                store.put(
                    "checkpoint",
                    id,
                    obj(
                        "document" to project.o("document").copy(),
                        "style" to project.o("style").copy(),
                    ),
                )
                store.put("job", id, j)
                return j
            }
            "job.cancel" -> {
                require(store.get("job", a.s("id")).s("status") in listOf("queued", "running")) {
                    "任务已结束，不能取消"
                }
                val result =
                    store.update("job", a.s("id")) {
                        it.put("status", "cancelled").put("phase", "已取消")
                    }
                ProcessingService.cancel(a.s("id"))
                return result
            }
            "job.retry" -> {
                val j = store.get("job", a.s("id"))
                require(j.s("status") in listOf("failed", "cancelled", "attention")) {
                    "仅失败、取消或待确认任务可以重试"
                }
                if (a.optBoolean("confirmPaidRetry")) {
                    store.update("checkpoint", j.s("id")) { cp ->
                        cp.a("chunks")
                            .objects()
                            .filter { it.s("state") == "submitting" }
                            .forEach { it.put("state", "new") }
                        cp.o("batches").keys().asSequence().toList().forEach { k ->
                            if (cp.o("batches").o(k).s("state") == "submitting")
                                cp.o("batches").remove(k)
                        }
                    }
                }
                return store.update("job", j.s("id")) {
                    it.put("status", "queued").put("phase", "等待恢复")
                    it.remove("error")
                }
            }
            "job.apply" -> {
                val j = store.get("job", a.s("id"))
                val doc = store.get("checkpoint", j.s("id")).getJSONObject("result").copy()
                val p = store.get("project", j.s("projectId"))
                Subtitles.validate(doc)
                doc.put("revision", p.o("document").optInt("revision") + 1)
                p.put("document", doc)
                store.saveProject(p)
                store.update("job", j.s("id")) {
                    it.put("status", "completed").put("phase", "结果已应用")
                    it.remove("error")
                }
                return store.publicProject(p)
            }
        }
        val allowed =
            listOf(
                "project.rename",
                "subtitle.import",
                "subtitle.edit",
                "subtitle.split",
                "subtitle.merge",
                "subtitle.replace",
                "subtitle.export",
                "style.save",
            )
        require(method in allowed) { "未知操作" }
        val p = store.get("project", a.s("id"))
        var doc = p.o("document")
        val expectedRevision = doc.optInt("revision")
        require(!a.has("expectedRevision") || a.optInt("expectedRevision") == expectedRevision) {
            "字幕已更新，请刷新后重试"
        }
        val list = doc.a("cues").objects().toMutableList()
        when (method) {
            "project.rename" -> {
                require(a.s("name").isNotBlank()) { "项目名称不能为空" }
                p.put("name", a.s("name").trim().take(160))
            }
            "style.save" -> {
                val style = a.o("style")
                require(style.optInt("fontSize") in 12..160 && style.optInt("margin") in 0..500)
                listOf("color", "translationColor", "outlineColor").forEach {
                    require(Regex("#[a-fA-F0-9]{6}").matches(style.s(it)))
                }
                p.put("style", style)
            }
            "subtitle.export" ->
                return Subtitles.export(
                    doc,
                    a.s("format"),
                    a.s("mode", "source"),
                    a.s("language"),
                    p.o("style"),
                )
            "subtitle.import" -> {
                val parsed = Subtitles.parse(a.s("text"))
                parsed
                    .put("revision", doc.optInt("revision") + 1)
                    .put("language", a.s("language", "auto"))
                doc = parsed
            }
            "subtitle.edit" -> {
                require(
                    !a.has("expectedRevision") ||
                        a.optInt("expectedRevision") == doc.optInt("revision")
                ) {
                    "字幕已更新，请重试"
                }
                val c = list.firstOrNull { it.s("id") == a.s("cueId") } ?: error("字幕不存在")
                if (a.has("translation")) {
                    val translations = c.o("translations")
                    require(a.s("language").isNotBlank() && a.s("language").length <= 40) {
                        "请选择译文语言"
                    }
                    require(a.s("translation").length <= 20000) { "译文过长" }
                    if (a.s("translation").isBlank()) translations.remove(a.s("language"))
                    else
                        translations.put(
                            a.s("language"),
                            obj(
                                "text" to a.s("translation"),
                                "sourceRevision" to c.optInt("revision"),
                                "provider" to "manual",
                            ),
                        )
                    c.put("translations", translations)
                } else {
                    val patch = a.o("patch")
                    if (patch.has("text") && patch.s("text") != c.s("text")) {
                        c.put("text", patch.s("text")).put("revision", c.optInt("revision") + 1)
                        c.remove("words")
                    }
                    listOf("startMs", "endMs")
                        .filter { patch.has(it) }
                        .forEach {
                            if (c.getLong(it) != patch.getLong(it)) c.remove("words")
                            c.put(it, patch.getLong(it))
                        }
                }
                doc.put("revision", doc.optInt("revision") + 1)
            }
            "subtitle.split" -> {
                val index = list.indexOfFirst { it.s("id") == a.s("cueId") }
                require(index >= 0)
                val c = list[index]
                val at = a.getLong("at")
                require(at > c.getLong("startMs") && at < c.getLong("endMs"))
                val text = c.s("text")
                val chars = text.codePoints().toArray()
                require(chars.size >= 2) { "字幕文字不足以拆分" }
                val cut =
                    ((at - c.getLong("startMs")).toDouble() /
                            (c.getLong("endMs") - c.getLong("startMs")) * chars.size)
                        .let { kotlin.math.floor(it + 0.5).toInt() }
                        .coerceIn(1, chars.size - 1)
                list[index] = cue(String(chars, 0, cut), c.getLong("startMs"), at)
                list.add(
                    index + 1,
                    cue(String(chars, cut, chars.size - cut), at, c.getLong("endMs")),
                )
                doc.put("cues", arr(list)).put("revision", doc.optInt("revision") + 1)
            }
            "subtitle.merge" -> {
                val index = list.indexOfFirst { it.s("id") == a.s("cueId") }
                require(index >= 0 && index < list.size - 1)
                val c = list[index]
                val next = list.removeAt(index + 1)
                list[index] =
                    cue(
                        c.s("text") + " " + next.s("text"),
                        c.getLong("startMs"),
                        maxOf(c.getLong("endMs"), next.getLong("endMs")),
                    )
                doc.put("cues", arr(list)).put("revision", doc.optInt("revision") + 1)
            }
            "subtitle.replace" -> {
                require(a.s("search").isNotEmpty())
                var changed = false
                list
                    .filter { it.s("text").contains(a.s("search")) }
                    .forEach {
                        val text = it.s("text").replace(a.s("search"), a.s("replacement"))
                        if (text != it.s("text")) {
                            it.put("text", text).put("revision", it.optInt("revision") + 1)
                            it.remove("words")
                            changed = true
                        }
                    }
                if (changed) doc.put("revision", doc.optInt("revision") + 1)
            }
        }
        Subtitles.validate(doc)
        p.put("document", doc)
        store.saveProject(p, expectedRevision)
        return store.publicProject(p)
    }
}
