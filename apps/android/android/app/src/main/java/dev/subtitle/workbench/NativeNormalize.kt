package dev.subtitle.workbench

import org.json.JSONArray
import org.json.JSONObject

object NativeNormalize {
    private fun num(v: Any?) = v?.toString()?.removeSuffix("s")?.toDoubleOrNull() ?: Double.NaN

    fun normalize(provider: String, raw: JSONObject): JSONObject {
        val output = mutableListOf<JSONObject>()
        fun timed(text: String, start: Any?, end: Any?, scale: Double = 1.0, speaker: String = "") {
            val a = num(start) * scale
            val b = num(end) * scale
            if (text.isNotBlank() && a.isFinite() && b.isFinite() && a >= 0 && b > a) {
                output.add(
                    cue(text, a.toLong(), b.toLong()).also {
                        if (speaker.isNotEmpty()) it.put("speaker", speaker)
                    }
                )
            }
        }
        fun words(items: List<Any>, map: (Any) -> JSONObject) {
            var group = mutableListOf<JSONObject>()
            fun flush() {
                if (group.isEmpty()) return
                val text =
                    group
                        .joinToString(" ") { it.s("text") }
                        .replace(Regex("\\s+([,.!?;:，。！？、])"), "$1")
                        .replace(Regex("([\\u3400-\\u9fff])\\s+(?=[\\u3400-\\u9fff])"), "$1")
                timed(
                    text,
                    group.first().get("startMs"),
                    group.last().get("endMs"),
                    1.0,
                    group.first().s("speaker"),
                )
                output.lastOrNull()?.put("words", arr(group))
                group = mutableListOf()
            }
            items
                .map(map)
                .filter {
                    it.optDouble("endMs") > it.optDouble("startMs") && it.optDouble("startMs") >= 0
                }
                .forEach { w ->
                    if (
                        group.isNotEmpty() &&
                            (w.optLong("startMs") - group.first().optLong("startMs") > 5500 ||
                                group.sumOf { it.s("text").length } > 38 ||
                                w.s("speaker") != group.first().s("speaker"))
                    )
                        flush()
                    group.add(w)
                    if (Regex("[.!?。！？]$").containsMatchIn(w.s("text"))) flush()
                }
            flush()
        }
        fun word(
            w: JSONObject,
            text: String,
            start: String,
            end: String,
            scale: Double = 1000.0,
            speaker: String = "",
        ) =
            obj(
                "text" to text,
                "startMs" to num(w.opt(start)) * scale,
                "endMs" to num(w.opt(end)) * scale,
                "speaker" to speaker,
            )
        when (provider) {
            "openai",
            "groq",
            "mistral",
            "xai",
            "custom-openai" ->
                if (raw.a("segments").length() > 0)
                    raw.a("segments").objects().forEach {
                        timed(it.s("text"), it.opt("start"), it.opt("end"), 1000.0, it.s("speaker"))
                    }
                else
                    words(raw.a("words").values()) {
                        val w = it as JSONObject
                        word(w, w.s("word", w.s("text")), "start", "end")
                    }
            "cloudflare" -> {
                val result = raw.optJSONObject("result") ?: raw
                val data = result.optJSONObject("transcription_info") ?: result
                if (data.a("segments").length() > 0)
                    data.a("segments").objects().forEach {
                        timed(it.s("text"), it.opt("start"), it.opt("end"), 1000.0, it.s("speaker"))
                    }
                else
                    if (data.a("words").length() > 0)
                        words(data.a("words").values()) {
                            val w = it as JSONObject
                            word(w, w.s("word", w.s("text")), "start", "end")
                        }
                    else if (data.s("vtt").isNotBlank()) {
                        fun stamp(value: String): Double {
                            val parts = value.replace(',', '.').split(':').map { it.toDouble() }
                            return if (parts.size == 3)
                                parts[0] * 3600 + parts[1] * 60 + parts[2]
                            else parts[0] * 60 + parts[1]
                        }
                        data.s("vtt")
                            .replace("\r", "")
                            .split(Regex("\n\\s*\n"))
                            .forEach { block ->
                                val lines = block.lines()
                                val index = lines.indexOfFirst { it.contains("-->") }
                                if (index >= 0) {
                                    val range = lines[index].split("-->")
                                    if (range.size == 2)
                                        timed(
                                            lines.drop(index + 1).joinToString("\n").trim(),
                                            stamp(range[0].trim()),
                                            stamp(range[1].trim().substringBefore(' ')),
                                            1000.0,
                                        )
                                }
                            }
                    }
            }
            "soniox" ->
                words(raw.a("tokens").values()) {
                    val w = it as JSONObject
                    word(
                        w,
                        w.s("text"),
                        "start_ms",
                        "end_ms",
                        1.0,
                        w.s("speaker"),
                    )
                }
            "gladia" -> {
                val transcript =
                    raw.o("result").optJSONObject("transcription")
                        ?: raw.optJSONObject("transcription")
                        ?: obj()
                transcript.a("utterances").objects().forEach {
                    timed(
                        it.s("text"),
                        it.opt("start"),
                        it.opt("end"),
                        1000.0,
                        it.s("speaker"),
                    )
                }
            }
            "revai" ->
                words(
                    raw.a("monologues").objects().flatMap { monologue ->
                        monologue.a("elements").objects()
                            .filter { it.s("type") == "text" }
                            .map { it.put("speaker", monologue.s("speaker")) }
                    }
                ) {
                    val w = it as JSONObject
                    word(w, w.s("value"), "ts", "end_ts", 1000.0, w.s("speaker"))
                }
            "custom-json" ->
                raw.a("cues").objects().forEach {
                    timed(it.s("text"), it.opt("startMs"), it.opt("endMs"), 1.0, it.s("speaker"))
                }
            "aliyun" ->
                (raw.optJSONArray("transcripts")?.objects() ?: listOf(raw))
                    .flatMap { it.a("sentences").objects() }
                    .forEach {
                        timed(
                            it.s("text"),
                            it.opt("begin_time"),
                            it.opt("end_time"),
                            1.0,
                            it.s("speaker_id"),
                        )
                    }
            "volcengine" ->
                (raw.o("result").optJSONArray("utterances") ?: raw.a("utterances"))
                    .objects()
                    .forEach {
                        timed(
                            it.s("text"),
                            it.opt("start_time"),
                            it.opt("end_time"),
                            1.0,
                            it.o("additions").s("speaker"),
                        )
                    }
            "tencent" ->
                (raw.optJSONArray("ResultDetail") ?: raw.o("Data").a("ResultDetail"))
                    .objects()
                    .forEach {
                        timed(
                            it.s("FinalSentence", it.s("SliceSentence")),
                            it.opt("StartMs"),
                            it.opt("EndMs"),
                            1.0,
                            it.s("SpeakerId"),
                        )
                    }
            "baidu" ->
                (raw.o("task_result").optJSONArray("detailed_result")
                        ?: raw.o("result").optJSONArray("detailed_result")
                        ?: raw.a("detailed_result"))
                    .objects()
                    .forEach {
                        timed(
                            it.a("res").optString(0, it.s("result", it.s("text"))),
                            it.opt("begin_time"),
                            it.opt("end_time"),
                        )
                    }
            "huawei" ->
                raw.a("segments").objects().forEach {
                    timed(
                        it.o("result").s("text", it.s("text")),
                        it.opt("start_time"),
                        it.opt("end_time"),
                    )
                }
            "azure" ->
                (raw.optJSONArray("phrases") ?: raw.a("recognizedPhrases")).objects().forEach {
                    val a =
                        if (it.has("offsetMilliseconds")) it.optDouble("offsetMilliseconds")
                        else it.optDouble("offsetInTicks") / 10000
                    val b =
                        if (it.has("durationMilliseconds")) it.optDouble("durationMilliseconds")
                        else it.optDouble("durationInTicks") / 10000
                    timed(
                        it.s("text", it.a("nBest").optJSONObject(0)?.s("display") ?: ""),
                        a,
                        a + b,
                        1.0,
                        it.s("speaker"),
                    )
                }
            "google" ->
                words(
                    raw.a("results").objects().flatMap {
                        it.a("alternatives").optJSONObject(0)?.a("words")?.values() ?: emptyList()
                    }
                ) {
                    val w = it as JSONObject
                    word(
                        w,
                        w.s("word"),
                        if (w.has("startOffset")) "startOffset" else "startTime",
                        if (w.has("endOffset")) "endOffset" else "endTime",
                        1000.0,
                        w.s("speakerLabel"),
                    )
                }
            "aws" ->
                words(
                    raw.o("results").a("items").objects().filter { it.s("type") == "pronunciation" }
                ) {
                    val w = it as JSONObject
                    word(
                        w,
                        w.a("alternatives").optJSONObject(0)?.s("content") ?: "",
                        "start_time",
                        "end_time",
                        1000.0,
                        w.s("speaker_label"),
                    )
                }
            "ibm" ->
                words(
                    raw.a("results").objects().flatMap {
                        it.a("alternatives").optJSONObject(0)?.a("timestamps")?.values()
                            ?: emptyList()
                    }
                ) {
                    val w = it as JSONArray
                    obj(
                        "text" to w.getString(0),
                        "startMs" to w.getDouble(1) * 1000,
                        "endMs" to w.getDouble(2) * 1000,
                    )
                }
            "deepgram" ->
                words(
                    raw.o("results")
                        .a("channels")
                        .optJSONObject(0)
                        ?.a("alternatives")
                        ?.optJSONObject(0)
                        ?.a("words")
                        ?.values() ?: emptyList()
                ) {
                    val w = it as JSONObject
                    word(
                        w,
                        w.s("punctuated_word", w.s("word")),
                        "start",
                        "end",
                        1000.0,
                        w.s("speaker"),
                    )
                }
            "assemblyai" ->
                words(raw.a("words").values()) {
                    val w = it as JSONObject
                    word(w, w.s("text"), "start", "end", 1.0, w.s("speaker"))
                }
            "elevenlabs" ->
                words(raw.a("words").objects().filter { it.s("type") == "word" }) {
                    val w = it as JSONObject
                    word(w, w.s("text"), "start", "end", 1000.0, w.s("speaker_id"))
                }
            "speechmatics" ->
                words(raw.a("results").objects().filter { it.s("type") == "word" }) {
                    val w = it as JSONObject
                    word(
                        w,
                        w.a("alternatives").optJSONObject(0)?.s("content") ?: "",
                        "start_time",
                        "end_time",
                        1000.0,
                        w.a("alternatives").optJSONObject(0)?.s("speaker") ?: "",
                    )
                }
            "iflytek" -> {
                val item =
                    raw.opt("orderResult")
                        ?: raw.o("content").opt("orderResult")
                        ?: raw.opt("result")
                        ?: raw
                val data = if (item is String) JSONObject(item) else item as JSONObject
                (data.optJSONArray("lattice") ?: data.a("lattice2")).objects().forEach { l ->
                    val j = l.opt("json_1best")
                    val o = if (j is String) JSONObject(j) else if (j is JSONObject) j else l
                    val st = o.optJSONObject("st") ?: o
                    timed(
                        st.a("rt")
                            .objects()
                            .flatMap { it.a("ws").objects() }
                            .joinToString("") { it.a("cw").optJSONObject(0)?.s("w") ?: "" },
                        st.opt("bg"),
                        st.opt("ed"),
                        1.0,
                        st.s("rl"),
                    )
                }
            }
            else -> error("未知 ASR 协议")
        }
        require(output.isNotEmpty()) { "ASR 未返回带时间戳字幕；可能为静音或模型不支持" }
        return obj(
            "language" to raw.s("language", raw.s("language_code", "auto")),
            "model" to raw.s("model"),
            "cues" to arr(output),
        )
    }
}
