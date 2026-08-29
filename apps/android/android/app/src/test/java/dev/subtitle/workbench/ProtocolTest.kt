package dev.subtitle.workbench

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ProtocolTest {
    @Test
    fun timelineRecoveryMatchesTypeScript() {
        val fixture =
            JSONObject(
                javaClass.classLoader!!
                    .getResourceAsStream("timeline.json")!!
                    .bufferedReader()
                    .use { it.readText() }
            )
        val parts =
            fixture.a("parts").objects().map {
                it.getLong("offsetMs") to
                    obj(
                        "language" to "en",
                        "cues" to
                            arr(
                                listOf(
                                    cue(it.s("text"), it.getLong("startMs"), it.getLong("endMs"))
                                )
                            ),
                    )
            }
        val actual = Subtitles.combine(parts, fixture.getLong("durationMs")).a("cues").objects()
        val expected = fixture.a("expected").objects()
        assertEquals(expected.size, actual.size)
        actual.forEachIndexed { i, c ->
            assertEquals(expected[i].getLong("startMs"), c.getLong("startMs"))
            assertEquals(expected[i].getLong("endMs"), c.getLong("endMs"))
            assertEquals(expected[i].s("text"), c.s("text"))
        }
    }

    @Test
    fun allSixteenProvidersShareTypeScriptFixtures() {
        val data =
            JSONObject(
                javaClass.classLoader!!.getResourceAsStream("asr.json")!!.bufferedReader().use {
                    it.readText()
                }
            )
        assertEquals(16, data.length())
        data.keys().forEach { provider ->
            val result =
                NativeNormalize.normalize(provider, data.getJSONObject(provider))
                    .a("cues")
                    .getJSONObject(0)
            assertEquals(provider, 1000L, result.getLong("startMs"))
            assertEquals(provider, 2000L, result.getLong("endMs"))
            assertEquals(provider, "hello", result.getString("text"))
        }
    }

    @Test
    fun srtVttAndBilingualAreIndependentOfVideo() {
        val doc = Subtitles.parse("1\n00:00:01,200 --> 00:00:03,400\n你好 &amp; world\n")
        val c = doc.a("cues").getJSONObject(0)
        assertEquals(1200L, c.getLong("startMs"))
        assertEquals("你好 & world", c.getString("text"))
        c.o("translations")
            .put(
                "en",
                obj(
                    "text" to "Hello, world",
                    "sourceRevision" to c.getInt("revision"),
                    "provider" to "manual",
                ),
            )
        val source = Subtitles.export(doc, "srt", "source", "en", defaultStyle())
        assertTrue(source.contains("你好"))
        assertFalse(source.contains("Hello,"))
        val target = Subtitles.export(doc, "srt", "translation", "en", defaultStyle())
        assertTrue(target.contains("Hello,"))
        assertFalse(target.contains("你好"))
        val bilingual = Subtitles.export(doc, "vtt", "bilingual", "en", defaultStyle())
        assertTrue(bilingual.startsWith("WEBVTT"))
        assertTrue(bilingual.contains("你好 & world\nHello, world"))
        assertEquals(3400L, Subtitles.parse(bilingual).a("cues").getJSONObject(0).getLong("endMs"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun staleTranslationCannotBeBurned() {
        val doc = emptyDocument().put("cues", arr(listOf(cue("test", 0, 1000))))
        Subtitles.export(doc, "ass", "bilingual", "en", defaultStyle())
    }

    @Test(expected = IllegalArgumentException::class)
    fun pureTextCannotInventTiming() {
        NativeNormalize.normalize("openai", obj("text" to "no timestamps"))
    }
}
