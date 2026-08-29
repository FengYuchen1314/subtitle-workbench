package dev.subtitle.workbench

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

class NativeStore(context: Context) {
    val root = File(context.filesDir, "workspace").also { it.mkdirs() }
    private val db =
        SQLiteDatabase.openOrCreateDatabase(File(root, "subtitle.sqlite"), null).also {
            it.enableWriteAheadLogging()
            it.execSQL(
                "CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id))"
            )
        }

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val alias = "subtitle.credentials.v1"
        if (!ks.containsAlias(alias)) {
            val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            gen.init(
                KeyGenParameterSpec.Builder(
                        alias,
                        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                    )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .build()
            )
            gen.generateKey()
        }
        return ks.getKey(alias, null) as SecretKey
    }

    @Synchronized
    fun put(kind: String, id: String, data: JSONObject) {
        var text = data.toString()
        if (kind == "profile") {
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.ENCRYPT_MODE, key())
            text =
                Base64.encodeToString(
                    c.iv + c.doFinal(text.toByteArray(Charsets.UTF_8)),
                    Base64.NO_WRAP,
                )
        }
        db.execSQL(
            "INSERT OR REPLACE INTO records(kind,id,data) VALUES(?,?,?)",
            arrayOf(kind, id, text),
        )
    }

    private fun decode(kind: String, text: String): JSONObject {
        if (kind != "profile") return JSONObject(text)
        val b = Base64.decode(text, Base64.NO_WRAP)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, b.copyOfRange(0, 12)))
        return JSONObject(String(c.doFinal(b.copyOfRange(12, b.size)), Charsets.UTF_8))
    }

    @Synchronized
    fun get(kind: String, id: String): JSONObject =
        db.rawQuery("SELECT data FROM records WHERE kind=? AND id=?", arrayOf(kind, id)).use {
            require(it.moveToFirst()) { "记录不存在" }
            decode(kind, it.getString(0))
        }

    @Synchronized
    fun list(kind: String): List<JSONObject> =
        db.rawQuery("SELECT data FROM records WHERE kind=?", arrayOf(kind)).use { c ->
            buildList { while (c.moveToNext()) add(decode(kind, c.getString(0))) }
        }

    @Synchronized
    fun delete(kind: String, id: String) {
        db.delete("records", "kind=? AND id=?", arrayOf(kind, id))
    }

    @Synchronized
    fun update(kind: String, id: String, edit: (JSONObject) -> Unit): JSONObject {
        db.beginTransactionNonExclusive()
        try {
            val o = get(kind, id)
            edit(o)
            put(kind, id, o)
            db.setTransactionSuccessful()
            return o
        } finally {
            db.endTransaction()
        }
    }

    fun publicProject(p: JSONObject) = p.copy().also { it.remove("mediaPath") }

    fun publicProfile(p: JSONObject) =
        p.copy().also {
            it.put("secretFields", arr(it.o("secrets").keys().asSequence().toList()))
            it.remove("secrets")
        }

    fun state() =
        obj(
            "projects" to
                arr(
                    list("project")
                        .sortedByDescending { it.optLong("updatedAt") }
                        .map(::publicProject)
                ),
            "profiles" to arr(list("profile").map(::publicProfile)),
            "jobs" to arr(list("job").sortedByDescending { it.optLong("createdAt") }),
        )

    fun mediaPaths(): JSONObject {
        val out = obj()
        list("project").forEach { out.put(it.s("id"), it.s("mediaPath")) }
        list("job")
            .filter { it.s("status") == "completed" && it.s("kind") == "render" }
            .forEach {
                out.put(
                    "output:${it.s("id")}",
                    File(root, "jobs/${it.s("id")}/video.mp4").absolutePath,
                )
            }
        return out
    }

    @Synchronized
    fun saveProject(p: JSONObject, expectedRevision: Int? = null) {
        db.beginTransactionNonExclusive()
        try {
            if (expectedRevision != null)
                require(
                    get("project", p.s("id")).o("document").optInt("revision") == expectedRevision
                ) {
                    "字幕版本冲突，请刷新后重试"
                }
            p.put("updatedAt", System.currentTimeMillis())
            put("project", p.s("id"), p)
            put("revision", "${p.s("id")}:${p.o("document").optInt("revision")}", p.o("document"))
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }
}
