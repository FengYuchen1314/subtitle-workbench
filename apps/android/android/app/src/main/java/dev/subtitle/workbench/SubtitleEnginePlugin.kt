package dev.subtitle.workbench

import android.app.Activity
import android.content.Intent
import android.os.Build
import androidx.activity.result.ActivityResult
import androidx.core.content.ContextCompat
import com.getcapacitor.*
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.util.concurrent.Executors
import org.json.JSONObject

@CapacitorPlugin(name = "SubtitleEngine")
class SubtitleEnginePlugin : Plugin() {
    private val executor = Executors.newSingleThreadExecutor()
    private lateinit var service: NativeService

    override fun load() {
        service = NativeService(context)
        if (!ProcessingService.active) {
            service.store
                .list("job")
                .filter { it.s("status") in listOf("running", "queued") }
                .forEach { j ->
                    service.store.update("job", j.s("id")) {
                        it.put("status", "attention")
                            .put("phase", "等待手动恢复")
                            .put("error", "上次进程已终止；点击重试后优先查询已提交任务")
                    }
                }
        }
    }

    private fun reply(call: PluginCall, value: Any?) {
        call.resolve(
            JSObject()
                .put("value", value ?: JSONObject.NULL)
                .put("mediaPaths", service.store.mediaPaths())
        )
    }

    @PluginMethod
    fun command(call: PluginCall) {
        val method = call.getString("method") ?: return call.reject("缺少操作")
        val args = call.getObject("args") ?: JSObject()
        if (method == "output.save") {
            val job = service.store.get("job", args.s("id"))
            if (job.s("status") != "completed") return call.reject("视频未完成")
            call.data.put("outputJob", job.s("id"))
            startActivityForResult(
                call,
                Intent(Intent.ACTION_CREATE_DOCUMENT)
                    .addCategory(Intent.CATEGORY_OPENABLE)
                    .setType("video/mp4")
                    .putExtra(Intent.EXTRA_TITLE, "subtitled-video.mp4"),
                "saved",
            )
            return
        }
        executor.execute {
            try {
                val value = service.call(method, args)
                if (method in listOf("job.create", "job.retry")) {
                    activity.runOnUiThread {
                        if (
                            Build.VERSION.SDK_INT >= 33 &&
                                ContextCompat.checkSelfPermission(
                                    context,
                                    android.Manifest.permission.POST_NOTIFICATIONS,
                                ) != android.content.pm.PackageManager.PERMISSION_GRANTED
                        )
                            activity.requestPermissions(
                                arrayOf(android.Manifest.permission.POST_NOTIFICATIONS),
                                6102,
                            )
                        ContextCompat.startForegroundService(
                            context,
                            Intent(context, ProcessingService::class.java),
                        )
                    }
                }
                reply(call, value)
            } catch (e: Exception) {
                call.reject(e.message ?: "操作失败")
            }
        }
    }

    @PluginMethod
    fun pickVideo(call: PluginCall) {
        startActivityForResult(
            call,
            Intent(Intent.ACTION_OPEN_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType("video/*")
                .addFlags(
                    Intent.FLAG_GRANT_READ_URI_PERMISSION or
                        Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                ),
            "picked",
        )
    }

    @ActivityCallback
    private fun picked(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            reply(call, null)
            return
        }
        executor.execute {
            try {
                runCatching {
                    context.contentResolver.takePersistableUriPermission(
                        uri,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION,
                    )
                }
                var name = "video.mp4"
                var size = 0L
                context.contentResolver.query(uri, null, null, null, null)?.use { c ->
                    if (c.moveToFirst()) {
                        val n = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                        if (n >= 0) name = c.getString(n)
                        val s = c.getColumnIndex(android.provider.OpenableColumns.SIZE)
                        if (s >= 0) size = c.getLong(s)
                    }
                }
                val folder = File(service.store.root, "media").also { it.mkdirs() }
                require(folder.usableSpace > size + 256L * 1024 * 1024) { "手机存储空间不足" }
                val ext =
                    name.substringAfterLast('.', "mp4").filter { it.isLetterOrDigit() }.take(10)
                val file = File(folder, "${uuid()}.$ext")
                try {
                    context.contentResolver.openInputStream(uri)!!.use { input ->
                        file.outputStream().use { input.copyTo(it, 1024 * 1024) }
                    }
                    reply(call, service.import(file, name))
                } catch (e: Exception) {
                    file.delete()
                    throw e
                }
            } catch (e: Exception) {
                call.reject(e.message ?: "视频读取失败")
            }
        }
    }

    @PluginMethod
    fun saveText(call: PluginCall) {
        val name = File(call.getString("name") ?: "subtitles.srt").name
        val text = call.getString("text") ?: ""
        if (text.length > 32 * 1024 * 1024) return call.reject("字幕文件过大")
        startActivityForResult(
            call,
            Intent(Intent.ACTION_CREATE_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType("text/plain")
                .putExtra(Intent.EXTRA_TITLE, name),
            "saved",
        )
    }

    @ActivityCallback
    private fun saved(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            call.resolve()
            return
        }
        executor.execute {
            try {
                context.contentResolver.openOutputStream(uri)!!.use { output ->
                    val id = call.getString("outputJob")
                    if (id != null)
                        File(service.store.root, "jobs/$id/video.mp4").inputStream().use {
                            it.copyTo(output, 1024 * 1024)
                        }
                    else output.write((call.getString("text") ?: "").toByteArray(Charsets.UTF_8))
                }
                reply(call, obj("ok" to true))
            } catch (e: Exception) {
                call.reject("保存失败：${e.javaClass.simpleName}")
            }
        }
    }
}
