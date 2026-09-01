package dev.subtitle.workbench

import android.app.*
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.*
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONObject

class ProcessingService : Service() {
    companion object {
        @Volatile var active = false
        @Volatile private var instance: ProcessingService? = null

        fun cancel(id: String) {
            if (instance?.current == id) NativeHttp.cancelAll()
        }
    }

    private val executor = Executors.newSingleThreadExecutor()
    private val stopped = AtomicBoolean(false)
    private lateinit var store: NativeStore
    private var current: String? = null
    private var wake: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?) = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        store = NativeStore(this)
        getSystemService(NotificationManager::class.java)
            .createNotificationChannel(
                NotificationChannel("processing", "字幕处理任务", NotificationManager.IMPORTANCE_LOW)
            )
    }

    private fun notification(text: String): Notification {
        val open =
            PendingIntent.getActivity(
                this,
                0,
                Intent(this, MainActivity::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        return Notification.Builder(this, "processing")
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentTitle("字幕工作台")
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .build()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (active) return START_NOT_STICKY
        active = true
        stopped.set(false)
        if (Build.VERSION.SDK_INT >= 35)
            startForeground(
                41,
                notification("正在处理视频和字幕"),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC or
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING,
            )
        else if (Build.VERSION.SDK_INT >= 29)
            startForeground(
                41,
                notification("正在处理视频和字幕"),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
            )
        else startForeground(41, notification("正在处理视频和字幕"))
        wake =
            (getSystemService(POWER_SERVICE) as PowerManager)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "subtitle:processing")
                .also { it.acquire(6 * 60 * 60 * 1000L) }
        executor.execute {
            try {
                while (!stopped.get()) {
                    val job =
                        store
                            .list("job")
                            .filter { it.s("status") == "queued" }
                            .minByOrNull { it.optLong("createdAt") } ?: break
                    current = job.s("id")
                    execute(job)
                    current = null
                }
            } finally {
                active = false
                runCatching { if (wake?.isHeld == true) wake?.release() }
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
        return START_NOT_STICKY
    }

    override fun onTimeout(startId: Int, fgsType: Int) {
        stopped.set(true)
        NativeHttp.cancelAll()
        current?.let { id ->
            store.update("job", id) {
                it.put("status", "attention")
                    .put("phase", "已达到系统后台时限")
                    .put("error", "请回到应用重试；已完成字幕和远端任务 ID 已保存")
            }
        }
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        stopped.set(true)
        super.onDestroy()
    }

    private fun execute(job: JSONObject) {
        val id = job.s("id")
        val params = job.o("params")
        val cp = store.get("checkpoint", id)
        val project = store.get("project", job.s("projectId"))
        val folder = File(store.root, "jobs/$id").also { it.mkdirs() }
        val media = NativeMedia(this)
        fun save() {
            store.put("checkpoint", id, cp)
        }
        fun check() {
            if (stopped.get() || store.get("job", id).s("status") == "cancelled")
                throw InterruptedException("任务已暂停或取消")
        }
        fun stage(phase: String, percent: Int) {
            check()
            store.update("job", id) {
                if (it.s("status") == "cancelled") throw InterruptedException("任务已取消")
                it.put("status", "running")
                    .put("phase", phase)
                    .put("progress", percent)
                    .put("updatedAt", System.currentTimeMillis())
            }
            getSystemService(NotificationManager::class.java)
                .notify(41, notification("$phase · $percent%"))
        }
        fun apply(doc: JSONObject) {
            check()
            cp.put("result", doc)
            save()
            val current = store.get("project", project.s("id"))
            if (current.o("document").optInt("revision") != cp.o("document").optInt("revision"))
                throw CloudFailure("任务期间字幕已修改，请手动应用保存的结果", true)
            doc.put("revision", current.o("document").optInt("revision") + 1)
            current.put("document", doc)
            try {
                store.saveProject(current, cp.o("document").optInt("revision"))
            } catch (e: IllegalArgumentException) {
                throw CloudFailure("字幕版本冲突，结果已保存，请手动应用", true)
            }
        }
        try {
            stage("准备处理", 1)
            when (job.s("kind")) {
                "render" -> {
                    val output = File(folder, "partial.mp4")
                    if (output.exists()) output.delete()
                    media.render(
                        File(project.s("mediaPath")),
                        output,
                        cp.o("document"),
                        cp.o("style"),
                        params,
                        ::check,
                    ) {
                        stage("烧录字幕", it)
                    }
                    check()
                    require(output.renameTo(File(folder, "video.mp4"))) { "无法保存视频" }
                    store.update("job", id) { it.put("outputName", "video.mp4") }
                }
                "translate",
                "segment",
                "rewrite" -> {
                    val kind = job.s("kind")
                    val profile = store.get("profile", params.s("profileId"))
                    val translator = NativeTranslation(profile)
                    val doc = cp.o("document").copy()
                    val target = params.s("targetLanguage")
                    val segmentPlan = obj()
                    val rewriteValues = obj()
                    val batches = cp.o("batches")
                    cp.put("batches", batches)
                    val groups = doc.a("cues").objects().chunked(40)
                    groups.forEachIndexed { index, group ->
                        check()
                        val key = index.toString()
                        var batch = batches.o(key)
                        if (batch.s("state") == "submitting")
                            throw CloudFailure("翻译请求状态不明；重试会产生新的请求", true)
                        if (batch.s("state") != "complete") {
                            batch = obj("state" to "submitting")
                            batches.put(key, batch)
                            save()
                            val all = doc.a("cues").objects()
                            val context =
                                all.subList(
                                        (index * 40 - 4).coerceAtLeast(0),
                                        (index * 40 + group.size + 4).coerceAtMost(all.size),
                                    )
                                    .joinToString("\n") { it.s("text") }
                            val result =
                                when (kind) {
                                    "translate" ->
                                        translator.translate(
                                            group,
                                            doc.s("language", "auto"),
                                            target,
                                            context,
                                            params.s("glossary"),
                                        )
                                    "segment" ->
                                        translator.segment(
                                            group.map {
                                                it.copy()
                                                    .put(
                                                        "durationMs",
                                                        it.getLong("endMs") -
                                                            it.getLong("startMs"),
                                                    )
                                            },
                                            doc.s("language", "auto"),
                                            params.optInt("maxCharacters", 24),
                                            params.optLong("maxDurationMs", 5000),
                                            params.s("instruction"),
                                        )
                                    else -> {
                                        val scope = params.s("scope", "source")
                                        translator.rewrite(
                                            group.map {
                                                val text =
                                                    if (scope == "translation")
                                                        it.o("translations").o(target).s("text")
                                                    else it.s("text")
                                                require(text.isNotBlank()) {
                                                    "存在缺失译文，无法执行 AI 修改"
                                                }
                                                obj("id" to it.s("id"), "text" to text)
                                            },
                                            if (scope == "translation") target
                                            else doc.s("language", "auto"),
                                            params.s("instruction"),
                                        )
                                    }
                                }
                            batch.put("state", "complete").put("result", result)
                            save()
                        }
                        when (kind) {
                            "translate" ->
                                group.forEach { c ->
                                    c.o("translations")
                                        .put(
                                            target,
                                            obj(
                                                "text" to
                                                    batch.o("result").getString(c.s("id")),
                                                "sourceRevision" to c.optInt("revision"),
                                                "provider" to profile.s("provider"),
                                            ),
                                        )
                                }
                            "segment" ->
                                batch.o("result").keys().forEach {
                                    segmentPlan.put(it, batch.o("result").get(it))
                                }
                            else ->
                                batch.o("result").keys().forEach {
                                    rewriteValues.put(it, batch.o("result").get(it))
                                }
                        }
                        stage(
                            when (kind) {
                                "translate" -> "翻译字幕"
                                "segment" -> "AI 智能断句"
                                else -> "AI 修改字幕"
                            },
                            (index + 1) * 95 / groups.size,
                        )
                    }
                    apply(
                        when (kind) {
                            "translate" -> doc
                            "segment" ->
                                Subtitles.segment(
                                    doc,
                                    segmentPlan,
                                    params.optInt("maxCharacters", 24),
                                    params.optLong("maxDurationMs", 5000),
                                    params.optInt(
                                        "minCharacters",
                                        minOf(8, params.optInt("maxCharacters", 24)),
                                    ),
                                )
                            else ->
                                Subtitles.rewrite(
                                    doc,
                                    rewriteValues,
                                    params.s("scope", "source"),
                                    target,
                                    "ai:${profile.s("provider")}",
                                )
                        }
                    )
                }
                "transcribe" -> {
                    val profile = store.get("profile", params.s("profileId"))
                    val provider = profile.s("provider")
                    val needs =
                        provider in
                            listOf(
                                "aliyun",
                                "volcengine",
                                "baidu",
                                "huawei",
                                "google",
                                "aws",
                                "soniox",
                            ) ||
                            provider == "azure" && profile.s("model") == "batch"
                    val storage =
                        if (needs) {
                            require(params.s("storageId").isNotEmpty()) { "此供应商需要音频临时存储" }
                            val config = store.get("profile", params.s("storageId"))
                            require(provider != "google" || config.s("provider") == "storage-gcs") {
                                "Google ASR 需要 GCS 存储"
                            }
                            require(provider != "aws" || config.s("provider") == "storage-s3") {
                                "AWS ASR 需要 S3 存储"
                            }
                            NativeStorage(config)
                        } else null
                    val wav = File(folder, "audio.wav")
                    if (!cp.optBoolean("audioReady")) {
                        require(
                            folder.usableSpace >
                                project.o("media").optLong("durationMs") * 32 + 256L * 1024 * 1024
                        ) {
                            "提取音频的磁盘空间不足"
                        }
                        media.extract(
                            File(project.s("mediaPath")),
                            wav,
                            params.optInt("audioTrack", -1),
                            ::check,
                        ) {
                            stage("提取音频", it / 8)
                        }
                        cp.put("audioReady", true)
                        save()
                    }
                    if (!cp.has("chunks")) {
                        cp.put(
                            "chunks",
                            arr(
                                media.chunks(wav, if (provider == "tencent") 110 else 300).map {
                                    (start, end) ->
                                    obj(
                                        "startMs" to start,
                                        "endMs" to end,
                                        "state" to "new",
                                        "requestId" to uuid(),
                                    )
                                }
                            ),
                        )
                        save()
                    }
                    val chunks = cp.a("chunks").objects()
                    val asr = NativeAsr(profile)
                    chunks.forEachIndexed { index, c ->
                        check()
                        if (c.s("state") == "submitting")
                            throw CloudFailure("上次提交状态不明；请核对供应商账单，确认后再重试", true)
                        if (c.s("state") != "complete") {
                            val part = File(folder, "chunk-$index.wav")
                            if (!part.exists())
                                media.chunk(wav, part, c.getLong("startMs"), c.getLong("endMs"))
                            if (
                                storage != null &&
                                    c.s("state") == "new" &&
                                    (!c.has("object") ||
                                        c.o("object").optLong("expiresAt") <
                                            System.currentTimeMillis() + 3600000)
                            ) {
                                c.put("object", storage.put(part, "subtitle/$id/$index.wav"))
                                save()
                            }
                            if (c.s("state") == "new") {
                                c.put("state", "submitting")
                                save()
                                val result =
                                    asr.submit(
                                        part,
                                        obj(
                                            "durationMs" to
                                                c.getLong("endMs") - c.getLong("startMs"),
                                            "language" to params.s("language", "auto"),
                                            "requestId" to c.s("requestId"),
                                            "url" to c.o("object").s("url"),
                                            "objectUri" to c.o("object").s("uri"),
                                        ),
                                    )
                                if (result.s("type") == "complete")
                                    c.put("state", "complete")
                                        .put("transcript", result.o("transcript"))
                                else c.put("state", "pending").put("remote", result)
                                save()
                            }
                            var polls = c.optInt("polls")
                            var runPolls = 0
                            while (c.s("state") == "pending") {
                                check()
                                if (++runPolls > 500 || provider == "iflytek" && polls >= 95)
                                    throw CloudFailure("远端等待过久，请稍后恢复查询", true)
                                polls++
                                try {
                                    val result = asr.poll(c.o("remote"))
                                    if (result.s("type") == "complete")
                                        c.put("state", "complete")
                                            .put("transcript", result.o("transcript"))
                                } catch (e: CloudFailure) {
                                    if (!e.retryable) throw e
                                }
                                c.put("polls", polls)
                                save()
                                if (c.s("state") == "pending") {
                                    stage(
                                        "等待远端识别 · ${index+1}/${chunks.size}",
                                        12 + index * 80 / chunks.size,
                                    )
                                    repeat(if (provider == "iflytek") 30 else 8) {
                                        check()
                                        Thread.sleep(1000)
                                    }
                                }
                            }
                            part.delete()
                        }
                        stage(
                            "识别音频 · ${index+1}/${chunks.size}",
                            12 + (index + 1) * 80 / chunks.size,
                        )
                    }
                    val doc =
                        Subtitles.combine(
                            chunks.map { it.getLong("startMs") to it.o("transcript") },
                            project.o("media").getLong("durationMs"),
                        )
                    apply(doc)
                    if (storage != null)
                        chunks.forEach { c ->
                            if (c.has("object"))
                                runCatching {
                                    storage.remove(c.o("object").s("key"))
                                    c.remove("object")
                                    save()
                                }
                        }
                    wav.delete()
                }
            }
            check()
            store.update("job", id) {
                it.put("status", "completed").put("phase", "处理完成").put("progress", 100)
                it.remove("error")
            }
        } catch (e: Exception) {
            val existing = store.get("job", id)
            if (existing.s("status") != "cancelled" && !stopped.get())
                store.update("job", id) {
                    it.put(
                            "status",
                            if (e is CloudFailure && e.uncertain || e is InterruptedException)
                                "attention"
                            else "failed",
                        )
                        .put("phase", "任务已停止")
                        .put("error", e.message ?: "处理失败")
                }
        }
    }
}
