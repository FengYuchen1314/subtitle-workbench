package dev.subtitle.workbench

import android.content.Context
import android.graphics.*
import android.media.*
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.Size
import androidx.media3.effect.BitmapOverlay
import androidx.media3.effect.OverlayEffect
import androidx.media3.effect.Presentation
import androidx.media3.transformer.*
import com.google.common.collect.ImmutableList
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.json.JSONObject

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class NativeMedia(private val context: Context) {
    fun probe(file: File): JSONObject {
        val ex = MediaExtractor()
        try {
            ex.setDataSource(file.absolutePath)
            var video: MediaFormat? = null
            val tracks = mutableListOf<JSONObject>()
            var codec = ""
            var duration = 0L
            for (i in 0 until ex.trackCount) {
                val f = ex.getTrackFormat(i)
                val mime = f.getString(MediaFormat.KEY_MIME) ?: ""
                if (f.containsKey(MediaFormat.KEY_DURATION))
                    duration = maxOf(duration, f.getLong(MediaFormat.KEY_DURATION) / 1000)
                if (mime.startsWith("video/") && video == null) {
                    video = f
                    require(
                        MediaCodecList(MediaCodecList.ALL_CODECS).findDecoderForFormat(f) != null
                    ) {
                        "本机不支持此视频编码：$mime"
                    }
                }
                if (mime.startsWith("audio/")) {
                    tracks.add(
                        obj(
                            "index" to tracks.size,
                            "language" to
                                (if (f.containsKey(MediaFormat.KEY_LANGUAGE))
                                    f.getString(MediaFormat.KEY_LANGUAGE)
                                else "und"),
                        )
                    )
                    if (codec.isEmpty()) codec = mime
                }
            }
            require(video != null) { "未发现支持的视频轨道" }
            return obj(
                "durationMs" to duration,
                "width" to video!!.getInteger(MediaFormat.KEY_WIDTH),
                "height" to video!!.getInteger(MediaFormat.KEY_HEIGHT),
                "fps" to
                    if (video!!.containsKey(MediaFormat.KEY_FRAME_RATE))
                        video!!.getInteger(MediaFormat.KEY_FRAME_RATE)
                    else 30,
                "audioCodec" to codec,
                "audioTracks" to arr(tracks),
            )
        } finally {
            ex.release()
        }
    }

    private fun wavHeader(
        file: RandomAccessFile,
        samples: Long,
        rate: Int = 16000,
        channels: Int = 1,
    ) {
        val size = samples * channels * 2
        require(size < 0xffffffffL - 36) { "WAV 超过 4 GB" }
        val b = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
        b.put("RIFF".toByteArray())
            .putInt((size + 36).toInt())
            .put("WAVEfmt ".toByteArray())
            .putInt(16)
            .putShort(1)
            .putShort(channels.toShort())
            .putInt(rate)
            .putInt(rate * channels * 2)
            .putShort((channels * 2).toShort())
            .putShort(16)
            .put("data".toByteArray())
            .putInt(size.toInt())
        file.seek(0)
        file.write(b.array())
    }

    fun extract(
        input: File,
        output: File,
        track: Int,
        cancel: () -> Unit,
        progress: (Int) -> Unit,
    ) {
        val ex = MediaExtractor()
        var decoder: MediaCodec? = null
        output.parentFile?.mkdirs()
        try {
            ex.setDataSource(input.absolutePath)
            val audios =
                (0 until ex.trackCount).filter {
                    ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") ==
                        true
                }
            require(audios.isNotEmpty()) { "视频没有音轨" }
            val chosen = audios.getOrNull(track) ?: audios.first()
            ex.selectTrack(chosen)
            var format = ex.getTrackFormat(chosen)
            val duration =
                if (format.containsKey(MediaFormat.KEY_DURATION))
                    format.getLong(MediaFormat.KEY_DURATION)
                else 1L
            val mime = format.getString(MediaFormat.KEY_MIME)!!
            val name =
                MediaCodecList(MediaCodecList.ALL_CODECS).findDecoderForFormat(format)
                    ?: error("本机不支持音频解码：$mime")
            decoder = MediaCodec.createByCodecName(name)
            decoder.configure(format, null, null, 0)
            decoder.start()
            var inputEnd = false
            var outputEnd = false
            val info = MediaCodec.BufferInfo()
            var sampleCount = 0L
            RandomAccessFile(output, "rw").use { dest ->
                dest.setLength(44)
                dest.seek(44)
                val zero = ByteArray(32000)
                var lastProgress = -1
                while (!outputEnd) {
                    cancel()
                    if (!inputEnd) {
                        val index = decoder.dequeueInputBuffer(10000)
                        if (index >= 0) {
                            val buffer = decoder.getInputBuffer(index)!!
                            val n = ex.readSampleData(buffer, 0)
                            if (n < 0) {
                                decoder.queueInputBuffer(
                                    index,
                                    0,
                                    0,
                                    0,
                                    MediaCodec.BUFFER_FLAG_END_OF_STREAM,
                                )
                                inputEnd = true
                            } else {
                                decoder.queueInputBuffer(index, 0, n, ex.sampleTime, 0)
                                ex.advance()
                            }
                        }
                    }
                    val index = decoder.dequeueOutputBuffer(info, 10000)
                    if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                        format = decoder.outputFormat
                    } else if (index >= 0) {
                        val buffer = decoder.getOutputBuffer(index)!!
                        buffer.position(info.offset)
                        buffer.limit(info.offset + info.size)
                        buffer.order(ByteOrder.LITTLE_ENDIAN)
                        val channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                        val rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                        val floating =
                            format.containsKey(MediaFormat.KEY_PCM_ENCODING) &&
                                format.getInteger(MediaFormat.KEY_PCM_ENCODING) ==
                                    AudioFormat.ENCODING_PCM_FLOAT
                        val bytesPerSample = if (floating) 4 else 2
                        val frames = info.size / (channels * bytesPerSample)
                        val pts = (info.presentationTimeUs.coerceAtLeast(0) * 16000 / 1000000)
                        val gap = (pts - sampleCount).coerceAtLeast(0)
                        if (gap > 0) {
                            var remaining = gap * 2
                            while (remaining > 0) {
                                val n = minOf(remaining, zero.size.toLong()).toInt()
                                dest.write(zero, 0, n)
                                remaining -= n
                            }
                            sampleCount += gap
                        }
                        val samples =
                            ByteBuffer.allocate((frames * 16000L / rate + 4).toInt() * 2)
                                .order(ByteOrder.LITTLE_ENDIAN)
                        val end = pts + frames * 16000L / rate
                        while (sampleCount < end) {
                            val offset =
                                ((sampleCount - pts).coerceAtLeast(0) * rate / 16000).toInt()
                            if (offset >= frames) break
                            var total = 0.0
                            for (c in 0 until channels) {
                                val pos = info.offset + (offset * channels + c) * bytesPerSample
                                total +=
                                    if (floating) buffer.getFloat(pos).toDouble() * 32767
                                    else buffer.getShort(pos).toDouble()
                            }
                            samples.putShort(
                                (total / channels).toInt().coerceIn(-32768, 32767).toShort()
                            )
                            sampleCount++
                        }
                        dest.write(samples.array(), 0, samples.position())
                        decoder.releaseOutputBuffer(index, false)
                        outputEnd = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
                        val value =
                            (info.presentationTimeUs * 100 / duration.coerceAtLeast(1))
                                .toInt()
                                .coerceIn(0, 100)
                        if (value != lastProgress) {
                            progress(value)
                            lastProgress = value
                        }
                    }
                }
                wavHeader(dest, sampleCount)
            }
        } finally {
            runCatching { decoder?.stop() }
            decoder?.release()
            ex.release()
        }
    }

    fun chunks(wav: File, maxSeconds: Int): List<Pair<Long, Long>> {
        val duration = (wav.length() - 44) / 32
        val result = mutableListOf<Pair<Long, Long>>()
        var start = 0L
        RandomAccessFile(wav, "r").use { audio ->
            while (start < duration) {
                var end = minOf(start + maxSeconds * 1000L, duration)
                if (end < duration) {
                    val search = (end - 8000).coerceAtLeast(start + 1000)
                    audio.seek(44 + search * 32)
                    val buf = ByteArray(((end - search) * 32).toInt())
                    audio.readFully(buf)
                    val samples = ByteBuffer.wrap(buf).order(ByteOrder.LITTLE_ENDIAN)
                    var silence = 0
                    var candidate = 0L
                    while (samples.remaining() >= 2) {
                        if (kotlin.math.abs(samples.short.toInt()) < 500) silence++ else silence = 0
                        if (silence >= 4800) candidate = search + samples.position() / 32
                    }
                    if (candidate > search) end = candidate
                }
                result.add(start to end)
                start = end
            }
        }
        return result
    }

    fun chunk(wav: File, out: File, start: Long, end: Long) {
        RandomAccessFile(wav, "r").use { source ->
            RandomAccessFile(out, "rw").use { dest ->
                dest.setLength(44)
                dest.seek(44)
                source.seek(44 + start * 32)
                var bytes = (end - start) * 32
                val block = ByteArray(65536)
                while (bytes > 0) {
                    val n = source.read(block, 0, minOf(bytes, block.size.toLong()).toInt())
                    if (n < 0) break
                    dest.write(block, 0, n)
                    bytes -= n
                }
                wavHeader(dest, (dest.length() - 44) / 2)
            }
        }
    }

    fun render(
        input: File,
        output: File,
        doc: JSONObject,
        style: JSONObject,
        params: JSONObject,
        cancel: () -> Unit,
        progress: (Int) -> Unit,
    ) {
        val info = probe(input)
        require(output.parentFile!!.usableSpace > maxOf(input.length() * 2, 256L * 1024 * 1024)) {
            "磁盘空间不足"
        }
        val modes = params.s("mode", "source")
        doc.a("cues").objects().forEach {
            Subtitles.lines(it, modes, params.s("targetLanguage"), style)
        }
        val selected = params.optInt("audioTrack", 0)
        val remuxed = if (selected > 0) File(output.parentFile, "selected-audio.mp4") else null
        if (remuxed != null) remuxAudio(input, remuxed, selected, cancel)
        val renderInput = remuxed ?: input
        val height =
            params.optInt("resolution", info.optInt("height")).coerceAtMost(info.optInt("height"))
        val width =
            (info.optInt("width").toDouble() * height / info.optInt("height")).toInt() / 2 * 2
        val format =
            MediaFormat.createVideoFormat("video/avc", width, height).apply {
                setInteger(MediaFormat.KEY_FRAME_RATE, 30)
                setInteger(MediaFormat.KEY_BIT_RATE, 4_000_000)
                setInteger(
                    MediaFormat.KEY_COLOR_FORMAT,
                    MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface,
                )
            }
        require(
            MediaCodecList(MediaCodecList.REGULAR_CODECS).findEncoderForFormat(format) != null
        ) {
            "设备不支持该 H.264 分辨率，请降低分辨率"
        }
        val handler = Handler(Looper.getMainLooper())
        val done = CountDownLatch(1)
        var failure: Exception? = null
        var transformer: Transformer? = null
        handler.post {
            try {
                val effects =
                    mutableListOf<androidx.media3.common.Effect>(
                        OverlayEffect(
                            ImmutableList.of<androidx.media3.effect.TextureOverlay>(
                                CaptionOverlay(doc, style, params)
                            )
                        )
                    )
                if (height != info.optInt("height"))
                    effects.add(Presentation.createForHeight(height))
                val edited =
                    EditedMediaItem.Builder(MediaItem.fromUri(Uri.fromFile(renderInput)))
                        .setEffects(Effects(emptyList(), effects))
                        .build()
                transformer =
                    Transformer.Builder(context)
                        .setVideoMimeType(MimeTypes.VIDEO_H264)
                        .setAudioMimeType(MimeTypes.AUDIO_AAC)
                        .addListener(
                            object : Transformer.Listener {
                                override fun onCompleted(
                                    composition: Composition,
                                    exportResult: ExportResult,
                                ) {
                                    done.countDown()
                                }

                                override fun onError(
                                    composition: Composition,
                                    exportResult: ExportResult,
                                    exportException: ExportException,
                                ) {
                                    failure = exportException
                                    done.countDown()
                                }
                            }
                        )
                        .build()
                transformer!!.start(edited, output.absolutePath)
            } catch (e: Exception) {
                failure = e
                done.countDown()
            }
        }
        try {
            while (!done.await(400, TimeUnit.MILLISECONDS)) {
                cancel()
                handler.post {
                    val holder = ProgressHolder()
                    if (transformer?.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE)
                        progress(holder.progress)
                }
            }
            failure?.let {
                throw IllegalStateException("本机视频编码失败，请更换分辨率或格式（${it.javaClass.simpleName}）")
            }
        } catch (e: Exception) {
            handler.post {
                transformer?.cancel()
                done.countDown()
            }
            done.await(5, TimeUnit.SECONDS)
            throw e
        } finally {
            remuxed?.delete()
        }
    }

    private fun remuxAudio(input: File, output: File, ordinal: Int, cancel: () -> Unit) {
        val ex = MediaExtractor()
        var muxer: MediaMuxer? = null
        var started = false
        try {
            ex.setDataSource(input.absolutePath)
            val video =
                (0 until ex.trackCount).firstOrNull {
                    ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("video/") ==
                        true
                } ?: error("没有视频轨道")
            val audios =
                (0 until ex.trackCount).filter {
                    ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") ==
                        true
                }
            require(ordinal in audios.indices) { "音轨不存在" }
            val selected = listOf(video, audios[ordinal])
            muxer = MediaMuxer(output.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            val mapping =
                selected.associateWith {
                    ex.selectTrack(it)
                    muxer.addTrack(ex.getTrackFormat(it))
                }
            val vf = ex.getTrackFormat(video)
            if (vf.containsKey(MediaFormat.KEY_ROTATION))
                muxer.setOrientationHint(vf.getInteger(MediaFormat.KEY_ROTATION))
            muxer.start()
            started = true
            val buffer = ByteBuffer.allocateDirect(16 * 1024 * 1024)
            val info = MediaCodec.BufferInfo()
            while (true) {
                cancel()
                buffer.clear()
                val size = ex.readSampleData(buffer, 0)
                if (size < 0) break
                require(size <= buffer.capacity()) { "视频压缩帧过大" }
                info.set(
                    0,
                    size,
                    ex.sampleTime,
                    if (ex.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0)
                        MediaCodec.BUFFER_FLAG_KEY_FRAME
                    else 0,
                )
                mapping[ex.sampleTrackIndex]?.let { muxer.writeSampleData(it, buffer, info) }
                ex.advance()
            }
        } catch (e: Exception) {
            throw IllegalStateException("该设备不能重封装选中的音轨（${e.javaClass.simpleName}）")
        } finally {
            if (started) runCatching { muxer?.stop() }
            muxer?.release()
            ex.release()
        }
    }
}

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
private class CaptionOverlay(
    private val doc: JSONObject,
    private val style: JSONObject,
    private val params: JSONObject,
) : BitmapOverlay() {
    private var width = 1920
    private var height = 1080
    private var bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    private var last = "init"
    private val cues = doc.a("cues").objects().sortedBy { it.getLong("startMs") }
    private var cursor = 0
    private var lastTime = -1L
    private val active = mutableListOf<JSONObject>()

    override fun configure(videoSize: Size) {
        super.configure(videoSize)
        width = videoSize.width
        height = videoSize.height
        bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        last = "init"
    }

    override fun getBitmap(presentationTimeUs: Long): Bitmap {
        val time = presentationTimeUs / 1000
        if (time < lastTime) {
            cursor = 0
            active.clear()
        }
        lastTime = time
        active.removeAll { it.getLong("endMs") <= time }
        while (cursor < cues.size && cues[cursor].getLong("startMs") <= time) {
            val item = cues[cursor++]
            if (item.getLong("endMs") > time) active.add(item)
        }
        val key = active.joinToString { it.s("id") }
        if (key == last) return bitmap
        last = key
        bitmap.eraseColor(Color.TRANSPARENT)
        if (active.isEmpty()) return bitmap
        val canvas = Canvas(bitmap)
        val scale = height / 1080f
        val paint =
            Paint(Paint.ANTI_ALIAS_FLAG).apply {
                textSize = this@CaptionOverlay.style.optDouble("fontSize", 48.0).toFloat() * scale
                typeface =
                    Typeface.create(
                        if (this@CaptionOverlay.style.s("font").contains("Noto")) "sans-serif"
                        else this@CaptionOverlay.style.s("font"),
                        Typeface.NORMAL,
                    )
                textAlign = Paint.Align.CENTER
            }
        val lines = mutableListOf<Pair<String, Int>>()
        active.forEach { c ->
            Subtitles.lines(c, params.s("mode", "source"), params.s("targetLanguage"), style)
                .forEachIndexed { i, line ->
                    val translated =
                        params.s("mode") == "translation" ||
                            params.s("mode") == "bilingual" &&
                                (i == 0) == style.optBoolean("translationFirst")
                    val color =
                        Color.parseColor(
                            style.s(if (translated) "translationColor" else "color", "#ffffff")
                        )
                    line.split('\n').forEach { paragraph ->
                        var remaining = paragraph
                        while (remaining.isNotEmpty()) {
                            val count =
                                paint
                                    .breakText(remaining, true, width * 0.9f, null)
                                    .coerceAtLeast(1)
                            lines.add(remaining.take(count) to color)
                            remaining = remaining.drop(count)
                        }
                    }
                }
        }
        val leading = paint.textSize * 1.35f
        var y =
            if (style.s("position") == "top") style.optInt("margin", 56) * scale + paint.textSize
            else height - style.optInt("margin", 56) * scale - leading * (lines.size - 1)
        lines.forEach { (line, color) ->
            if (style.optBoolean("background")) {
                paint.color = 0x99000000.toInt()
                val half = paint.measureText(line) / 2
                canvas.drawRect(
                    width / 2f - half - 12 * scale,
                    y - paint.textSize,
                    width / 2f + half + 12 * scale,
                    y + 8 * scale,
                    paint,
                )
            }
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = style.optDouble("outlineWidth", 2.0).toFloat() * scale * 2
            paint.color = Color.parseColor(style.s("outlineColor", "#000000"))
            canvas.drawText(line, width / 2f, y, paint)
            paint.style = Paint.Style.FILL
            paint.color = color
            canvas.drawText(line, width / 2f, y, paint)
            y += leading
        }
        return bitmap
    }
}
