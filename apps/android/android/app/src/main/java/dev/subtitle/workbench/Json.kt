package dev.subtitle.workbench

import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

fun obj(vararg pairs: Pair<String, Any?>) =
    JSONObject().also { o -> pairs.forEach { (k, v) -> if (v != null) o.put(k, v) } }

fun arr(items: Iterable<Any?>) = JSONArray().also { a -> items.forEach { a.put(it) } }

fun JSONObject.s(key: String, fallback: String = "") = optString(key, fallback).ifEmpty { fallback }

fun JSONObject.o(key: String) = optJSONObject(key) ?: JSONObject()

fun JSONObject.a(key: String) = optJSONArray(key) ?: JSONArray()

fun JSONArray.objects() = (0 until length()).mapNotNull { optJSONObject(it) }

fun JSONArray.values() = (0 until length()).map { get(it) }

fun JSONObject.copy() = JSONObject(toString())

fun uuid() = UUID.randomUUID().toString()

fun cue(text: String, start: Long, end: Long) =
    obj(
        "id" to uuid(),
        "startMs" to start,
        "endMs" to end,
        "text" to text,
        "revision" to 1,
        "translations" to obj(),
    )

fun emptyDocument() =
    obj("schemaVersion" to 1, "revision" to 0, "language" to "auto", "cues" to arr(emptyList()))

fun defaultStyle() =
    obj(
        "font" to "Noto Sans CJK SC",
        "fontSize" to 48,
        "color" to "#ffffff",
        "translationColor" to "#a7f3d0",
        "outlineColor" to "#000000",
        "outlineWidth" to 2,
        "background" to false,
        "position" to "bottom",
        "margin" to 56,
        "translationFirst" to false,
    )

object Subtitles {
    private fun comparable(value: String) =
        java.text.Normalizer.normalize(value, java.text.Normalizer.Form.NFKC)
            .replace(Regex("[\\s\\u200b]+"), "")

    fun combine(parts: List<Pair<Long, JSONObject>>, durationMs: Long): JSONObject {
        val output = mutableListOf<JSONObject>()
        parts.forEach { (offset, transcript) ->
            transcript.a("cues").objects().forEach { source ->
                val c = source.copy().put("id", uuid())
                val start = (c.getLong("startMs") + offset).coerceAtLeast(0)
                val end = (c.getLong("endMs") + offset).coerceAtMost(durationMs)
                if (end > start && c.s("text").isNotBlank()) {
                    c.put("startMs", start).put("endMs", end)
                    c.a("words").objects().forEach { w ->
                        w.put("startMs", w.getLong("startMs") + offset)
                            .put("endMs", w.getLong("endMs") + offset)
                    }
                    val previous = output.lastOrNull()
                    if (
                        previous != null &&
                            previous.s("text").replace(Regex("\\s"), "") ==
                                c.s("text").replace(Regex("\\s"), "") &&
                            start < previous.getLong("endMs") + 300
                    )
                        previous.put("endMs", maxOf(previous.getLong("endMs"), end))
                    else output.add(c)
                }
            }
        }
        val language =
            parts.firstOrNull { it.second.s("language", "auto") != "auto" }?.second?.s("language")
                ?: "auto"
        return emptyDocument()
            .put("revision", 1)
            .put("language", language)
            .put("cues", arr(output.sortedBy { it.getLong("startMs") }))
            .also(::validate)
    }

    fun validate(doc: JSONObject) {
        require(doc.optInt("schemaVersion") == 1) { "不支持的字幕协议" }
        val ids = hashSetOf<String>()
        doc.a("cues").objects().forEach {
            require(it.s("id").isNotBlank() && ids.add(it.s("id"))) { "字幕 ID 重复" }
            require(it.optLong("startMs", -1) >= 0 && it.optLong("endMs") > it.optLong("startMs")) {
                "无效字幕时间"
            }
            require(it.s("text").isNotBlank() && it.s("text").length <= 20000) { "字幕文字为空或过长" }
        }
    }

    fun segment(
        document: JSONObject,
        plan: JSONObject,
        maxCharacters: Int,
        maxDurationMs: Long,
        minCharacters: Int,
    ): JSONObject {
        val doc = document.copy()
        val originals = doc.a("cues").objects()
        require(plan.keys().asSequence().all { id -> originals.any { it.s("id") == id } }) {
            "AI 断句返回了未知字幕 ID"
        }
        val output = mutableListOf<JSONObject>()
        originals.forEach { original ->
            val parts = plan.a(original.s("id")).values().map { it.toString() }
            require(
                parts.isNotEmpty() &&
                    parts.all { it.isNotBlank() } &&
                    comparable(parts.joinToString("")) == comparable(original.s("text"))
            ) {
                "AI 断句未完整保留字幕：${original.s("id")}"
            }
            val duration = original.getLong("endMs") - original.getLong("startMs")
            require(duration >= parts.size) { "字幕时长太短，无法应用 AI 分段" }
            val weights = parts.map { it.codePointCount(0, it.length).coerceAtLeast(1) }
            val total = weights.sum().toLong()
            var used = 0L
            parts.forEachIndexed { index, text ->
                val start =
                    if (index == 0) original.getLong("startMs")
                    else original.getLong("startMs") + duration * used / total
                used += weights[index]
                val end =
                    if (index == parts.lastIndex) original.getLong("endMs")
                    else original.getLong("startMs") + duration * used / total
                output.add(
                    cue(text.trim(), start, end)
                        .put(
                            "id",
                            if (index == 0) original.s("id") else uuid(),
                        )
                        .put("revision", original.optInt("revision") + 1)
                        .also {
                            if (original.s("speaker").isNotEmpty())
                                it.put("speaker", original.s("speaker"))
                        }
                )
            }
        }
        val merged = mutableListOf<JSONObject>()
        output.forEach { current ->
            val previous = merged.lastOrNull()
            val combined = if (previous == null) "" else previous.s("text") + current.s("text")
            val canMerge =
                previous != null &&
                    previous.s("speaker") == current.s("speaker") &&
                    current.getLong("startMs") - previous.getLong("endMs") <= 350 &&
                    current.getLong("endMs") - previous.getLong("startMs") <= maxDurationMs &&
                    combined.codePointCount(0, combined.length) <= maxCharacters &&
                    (previous.s("text").codePointCount(0, previous.s("text").length) <
                        minCharacters ||
                        current.s("text").codePointCount(0, current.s("text").length) <
                            minCharacters)
            if (canMerge) {
                val target = requireNotNull(previous)
                val join =
                    if (
                        Regex("[\\u3400-\\u9fff]$").containsMatchIn(target.s("text")) ||
                            Regex("^[\\u3400-\\u9fff，。！？、]").containsMatchIn(current.s("text"))
                    )
                        combined
                    else target.s("text") + " " + current.s("text")
                target.put("text", join)
                    .put("endMs", current.getLong("endMs"))
                    .put("revision", target.optInt("revision") + 1)
            } else merged.add(current)
        }
        return doc
            .put("cues", arr(merged))
            .put("revision", doc.optInt("revision") + 1)
            .also(::validate)
    }

    fun rewrite(
        document: JSONObject,
        values: JSONObject,
        scope: String,
        language: String,
        provider: String,
    ): JSONObject {
        val doc = document.copy()
        val cues = doc.a("cues").objects()
        val ids = cues.map { it.s("id") }.toSet()
        require(values.keys().asSequence().toSet() == ids) {
            "AI 改写结果存在漏句、重复或未知字幕"
        }
        cues.forEach { item ->
            val text = values.s(item.s("id"))
            require(text.isNotBlank()) { "AI 改写返回了空字幕" }
            if (scope == "translation")
                item.o("translations")
                    .put(
                        language,
                        obj(
                            "text" to text,
                            "sourceRevision" to item.optInt("revision"),
                            "provider" to provider,
                        ),
                    )
            else if (text != item.s("text")) {
                item.put("text", text).put("revision", item.optInt("revision") + 1)
                item.remove("words")
            }
        }
        return doc.put("revision", doc.optInt("revision") + 1).also(::validate)
    }

    private fun ms(value: String): Long {
        val p = value.replace(',', '.').split(':')
        require(p.size in 2..3)
        return ((if (p.size == 3) p[0].toDouble() * 3600 else 0.0) +
                (p[p.size - 2].toDouble() * 60) +
                p.last().toDouble())
            .times(1000)
            .toLong()
    }

    fun parse(text: String): JSONObject {
        val cues = mutableListOf<JSONObject>()
        text.replace("\r", "").removePrefix("\uFEFF").split(Regex("\n\\s*\n")).forEach { block ->
            val lines = block.lines()
            val index = lines.indexOfFirst { it.contains("-->") }
            if (index >= 0) {
                val p = lines[index].split("-->")
                val words =
                    lines
                        .drop(index + 1)
                        .joinToString("\n")
                        .replace(Regex("<[^>]*>"), "")
                        .replace("&lt;", "<")
                        .replace("&gt;", ">")
                        .replace("&amp;", "&")
                        .trim()
                cues.add(cue(words, ms(p[0].trim()), ms(p[1].trim().split(' ')[0])))
            }
        }
        require(cues.isNotEmpty()) { "没有有效 SRT/VTT 字幕" }
        return emptyDocument().put("cues", arr(cues)).also(::validate)
    }

    fun lines(cue: JSONObject, mode: String, target: String, style: JSONObject): List<String> {
        if (mode == "source") return listOf(cue.s("text"))
        val t = cue.o("translations").o(target)
        require(t.s("text").isNotBlank() && t.optInt("sourceRevision") == cue.optInt("revision")) {
            "译文缺失或已过期，请先翻译"
        }
        return if (mode == "translation") listOf(t.s("text"))
        else if (style.optBoolean("translationFirst")) listOf(t.s("text"), cue.s("text"))
        else listOf(cue.s("text"), t.s("text"))
    }

    private fun stamp(value: Long, separator: String): String =
        "%02d:%02d:%02d%s%03d"
            .format(
                java.util.Locale.ROOT,
                value / 3600000,
                value / 60000 % 60,
                value / 1000 % 60,
                separator,
                value % 1000,
            )

    fun export(
        doc: JSONObject,
        format: String,
        mode: String,
        target: String,
        style: JSONObject,
    ): String {
        validate(doc)
        val cues = doc.a("cues").objects()
        if (format != "ass")
            return (if (format == "vtt") "WEBVTT\n\n" else "") +
                cues
                    .mapIndexed { i, c ->
                        "${i+1}\n${stamp(c.getLong("startMs"),if(format=="vtt")"." else ",")} --> ${stamp(c.getLong("endMs"),if(format=="vtt")"." else ",")}\n${lines(c,mode,target,style).joinToString("\n")}\n"
                    }
                    .joinToString("\n")
        fun color(s: String): String {
            require(Regex("#[0-9a-fA-F]{6}").matches(s))
            return "&H00" + s.substring(5, 7) + s.substring(3, 5) + s.substring(1, 3)
        }
        fun assTime(ms: Long) =
            "%d:%02d:%02d.%02d"
                .format(
                    java.util.Locale.ROOT,
                    ms / 3600000,
                    ms / 60000 % 60,
                    ms / 1000 % 60,
                    ms % 1000 / 10,
                )
        fun escape(s: String) =
            s.replace("\\", "\\\u200b")
                .replace("{", "｛")
                .replace("}", "｝")
                .replace("\r", "")
                .replace("\n", "\\N")
        val alignment = if (style.s("position") == "top") 8 else 2
        val font = style.s("font").replace(Regex("[,\r\n]"), " ")
        val head =
            "[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,$font,${style.optInt("fontSize",48)},${color(style.s("color","#ffffff"))},&H00FFFFFF,${color(style.s("outlineColor","#000000"))},&H80000000,0,0,0,0,100,100,0,0,${if(style.optBoolean("background"))3 else 1},${style.optDouble("outlineWidth",2.0)},0,$alignment,40,40,${style.optInt("margin",56)},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
        return head +
            cues.joinToString("\n") { c ->
                "Dialogue: 0,${assTime(c.getLong("startMs"))},${assTime(c.getLong("endMs"))},Default,,0,0,0,,${lines(c,mode,target,style).mapIndexed { i,t -> val translated=mode=="translation" || mode=="bilingual" && (i==0)==style.optBoolean("translationFirst")
 "{\\c${color(style.s(if(translated)"translationColor" else "color","#ffffff"))}}${escape(t)}" }.joinToString("\\N")}"
            }
    }
}
