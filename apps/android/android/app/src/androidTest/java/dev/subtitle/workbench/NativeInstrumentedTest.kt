package dev.subtitle.workbench

import android.media.MediaMetadataRetriever
import android.os.SystemClock
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import org.json.JSONObject
import org.json.JSONTokener
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeInstrumentedTest {
    @Test
    fun appLoadsBundledWorkbenchInWebView() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            val deadline = SystemClock.elapsedRealtime() + 15_000
            var state: JSONObject? = null
            while (state?.optBoolean("text") != true && SystemClock.elapsedRealtime() < deadline) {
                val result = AtomicReference<String>()
                val evaluated = CountDownLatch(1)
                scenario.onActivity { activity ->
                    val web = activity.findViewById<WebView>(com.getcapacitor.android.R.id.webview)
                    web.evaluateJavascript(
                        "JSON.stringify({text:document.title==='字幕工作台'&&document.body.innerText.includes('视频项目')&&!!document.querySelector('.ant-table'),native:window.Capacitor?.isNativePlatform?.(),plugin:window.Capacitor?.isPluginAvailable?.('SubtitleEngine')})"
                    ) {
                        result.set(it)
                        evaluated.countDown()
                    }
                }
                assertTrue("WebView JavaScript 未返回", evaluated.await(2, TimeUnit.SECONDS))
                state = JSONObject(JSONTokener(result.get()).nextValue() as String)
                if (!state.optBoolean("text")) SystemClock.sleep(250)
            }
            assertTrue("共享 React 页面未在 15 秒内加载", state?.getBoolean("text") == true)
            assertTrue("Capacitor 未处于原生环境", state?.getBoolean("native") == true)
            assertTrue("SubtitleEngine 原生插件未注册", state?.getBoolean("plugin") == true)
        }
    }

    @Test
    fun keystoreProtectsProfileSecretsAtRest() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assertEquals("dev.subtitle.workbench", context.packageName)
        val store = NativeStore(context)
        val id = "instrumented-secret"
        val marker = "never-store-this-api-key-in-plaintext"
        store.delete("profile", id)
        store.put(
            "profile",
            id,
            obj(
                "id" to id,
                "name" to "instrumented",
                "provider" to "custom-json",
                "model" to "default",
                "options" to obj("endpoint" to "https://example.invalid/asr"),
                "secrets" to obj("apiKey" to marker),
                "allowPrivateEndpoint" to false,
                "verification" to "unverified",
            ),
        )
        assertEquals(marker, store.get("profile", id).o("secrets").s("apiKey"))
        assertTrue(
            store
                .publicProfile(store.get("profile", id))
                .a("secretFields")
                .values()
                .contains("apiKey")
        )
        val files =
            File(store.root, ".").listFiles().orEmpty().filter {
                it.name.startsWith("subtitle.sqlite")
            }
        assertFalse(files.any { String(it.readBytes(), Charsets.ISO_8859_1).contains(marker) })
        store.delete("profile", id)
    }

    @Test
    fun publicNetworkPolicyRejectsLoopback() {
        val profile =
            JSONObject(
                """{"provider":"custom-json","options":{},"secrets":{},"allowPrivateEndpoint":false}"""
            )
        val error =
            runCatching { NativeHttp(profile).request("http://127.0.0.1/private") }
                .exceptionOrNull()
        assertTrue(error is IllegalArgumentException)
    }

    @Test
    fun nativeMediaExtractsAudioAndBurnsBilingualCaptions() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val testContext = InstrumentationRegistry.getInstrumentation().context
        val work = File(context.cacheDir, "instrumented-media").also { it.mkdirs() }
        val input = File(work, "input.mp4")
        testContext.assets.open("android-media.mp4").use { source ->
            input.outputStream().use(source::copyTo)
        }

        val media = NativeMedia(context)
        val sourceInfo = media.probe(input)
        assertEquals(640, sourceInfo.getInt("width"))
        assertEquals(360, sourceInfo.getInt("height"))
        assertTrue(sourceInfo.getLong("durationMs") in 3_900..4_100)
        assertEquals(1, sourceInfo.getJSONArray("audioTracks").length())

        val wav = File(work, "audio.wav")
        media.extract(input, wav, 0, {}, {})
        assertTrue("原生抽取的 WAV 为空", wav.length() > 44)
        assertEquals("RIFF", wav.readBytes().copyOfRange(0, 4).toString(Charsets.US_ASCII))

        val subtitle = cue("安卓字幕测试", 500, 2_500)
        subtitle
            .getJSONObject("translations")
            .put("en", obj("text" to "Android subtitle test", "sourceRevision" to 1))
        val document =
            emptyDocument()
                .put("revision", 1)
                .put("language", "zh")
                .put("cues", arr(listOf(subtitle)))
        val output = File(work, "bilingual.mp4").also { it.delete() }
        media.render(
            input,
            output,
            document,
            defaultStyle(),
            obj("mode" to "bilingual", "targetLanguage" to "en", "resolution" to 360),
            {},
            {},
        )

        val renderedInfo = media.probe(output)
        assertEquals(640, renderedInfo.getInt("width"))
        assertEquals(360, renderedInfo.getInt("height"))
        assertTrue(renderedInfo.getLong("durationMs") in 3_800..4_200)
        assertEquals(1, renderedInfo.getJSONArray("audioTracks").length())

        val retriever = MediaMetadataRetriever()
        try {
            retriever.setDataSource(output.absolutePath)
            val frame =
                requireNotNull(
                    retriever.getFrameAtTime(1_500_000, MediaMetadataRetriever.OPTION_CLOSEST)
                )
            var brightPixels = 0
            for (y in frame.height / 2 until frame.height) {
                for (x in 0 until frame.width) {
                    val pixel = frame.getPixel(x, y)
                    if (
                        android.graphics.Color.red(pixel) > 190 ||
                            android.graphics.Color.green(pixel) > 190 ||
                            android.graphics.Color.blue(pixel) > 190
                    ) {
                        brightPixels++
                    }
                }
            }
            assertTrue("烧录成品帧中未检测到字幕像素", brightPixels > 100)
        } finally {
            retriever.release()
            work.deleteRecursively()
        }
    }
}
