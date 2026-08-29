package dev.subtitle.workbench

import java.io.File
import java.net.URI
import java.security.MessageDigest
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.asRequestBody
import org.json.JSONObject

class NativeStorage(private val p: JSONObject) {
    private val o = p.o("options")
    private val s = p.o("secrets")
    private val provider = p.s("provider")
    private val http = NativeHttp(p)

    private fun location(key: String): String {
        val bucket = o.s("bucket")
        require(bucket.isNotBlank())
        val path = key.split('/').joinToString("/") { enc(it) }
        return when (provider) {
            "storage-s3" ->
                o.s("endpoint", "https://s3.${o.s("region","us-east-1")}.amazonaws.com")
                    .trimEnd('/') + "/${enc(bucket)}/$path"
            "storage-oss" ->
                o.s("endpoint", "https://$bucket.${o.s("region","oss-cn-hangzhou")}.aliyuncs.com")
                    .trimEnd('/') + "/$path"
            "storage-cos" ->
                o.s("endpoint", "https://$bucket.cos.${o.s("region","ap-guangzhou")}.myqcloud.com")
                    .trimEnd('/') + "/$path"
            "storage-gcs" -> "https://storage.googleapis.com/${enc(bucket)}/$path"
            else -> error("未知对象存储")
        }
    }

    private fun cos(method: String, url: String, expires: Long): String {
        val uri = URI(url)
        val time = "${Instant.now().epochSecond-60};$expires"
        val key = hex(mac(s.s("secretKey").toByteArray(), time, "HmacSHA1"))
        val request = "${method.lowercase()}\n${uri.rawPath}\n\nhost=${enc(uri.rawAuthority)}\n"
        val digest = hex(MessageDigest.getInstance("SHA-1").digest(request.toByteArray()))
        return "q-sign-algorithm=sha1&q-ak=${s.s("accessKey")}&q-sign-time=$time&q-key-time=$time&q-header-list=host&q-url-param-list=&q-signature=${hex(mac(key.toByteArray(),"sha1\n$time\n$digest\n","HmacSHA1"))}"
    }

    private fun headers(
        method: String,
        key: String,
        bytes: ByteArray = ByteArray(0),
    ): Map<String, String> =
        when (provider) {
            "storage-s3" -> awsSign(p, location(key), "s3", bytes, method)
            "storage-gcs" -> mapOf("Authorization" to "Bearer ${http.googleToken()}")
            "storage-cos" ->
                mapOf(
                    "Authorization" to cos(method, location(key), Instant.now().epochSecond + 3600)
                ) +
                    (if (s.s("sessionToken").isNotEmpty())
                        mapOf("x-cos-security-token" to s.s("sessionToken"))
                    else emptyMap())
            else -> {
                val date =
                    DateTimeFormatter.RFC_1123_DATE_TIME.withZone(ZoneOffset.UTC)
                        .format(Instant.now())
                val sign =
                    b64(
                        mac(
                            s.s("secretKey").toByteArray(),
                            "$method\n\n${if(method=="PUT")"audio/wav" else ""}\n$date\n/${o.s("bucket")}/$key",
                            "HmacSHA1",
                        )
                    )
                mapOf("Date" to date, "Authorization" to "OSS ${s.s("accessKey")}:$sign")
            }
        }

    private fun signed(key: String, expires: Long): String {
        val url = location(key)
        val uri = URI(url)
        if (provider == "storage-oss")
            return "$url?" +
                query(
                    mapOf(
                        "OSSAccessKeyId" to s.s("accessKey"),
                        "Expires" to expires.toString(),
                        "Signature" to
                            b64(
                                mac(
                                    s.s("secretKey").toByteArray(),
                                    "GET\n\n\n$expires\n/${o.s("bucket")}/$key",
                                    "HmacSHA1",
                                )
                            ),
                    )
                )
        if (provider == "storage-cos")
            return "$url?${cos("GET",url,expires)}" +
                (if (s.s("sessionToken").isNotEmpty())
                    "&x-cos-security-token=${enc(s.s("sessionToken"))}"
                else "")
        val date =
            DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss'Z'")
                .withZone(ZoneOffset.UTC)
                .format(Instant.now())
        val day = date.take(8)
        val google = provider == "storage-gcs"
        val account = if (google) JSONObject(s.s("serviceAccount")) else obj()
        val scope =
            if (google) "$day/auto/storage/goog4_request"
            else "$day/${o.s("region","us-east-1")}/s3/aws4_request"
        val prefix = if (google) "X-Goog" else "X-Amz"
        val algorithm = if (google) "GOOG4-RSA-SHA256" else "AWS4-HMAC-SHA256"
        val params =
            mutableMapOf(
                "$prefix-Algorithm" to algorithm,
                "$prefix-Credential" to
                    "${if(google)account.s("client_email") else s.s("accessKey")}/$scope",
                "$prefix-Date" to date,
                "$prefix-Expires" to "172800",
                "$prefix-SignedHeaders" to "host",
            )
        if (!google && s.s("sessionToken").isNotEmpty())
            params["X-Amz-Security-Token"] = s.s("sessionToken")
        val q = query(params)
        val canonical =
            "GET\n${uri.rawPath}\n$q\nhost:${uri.rawAuthority}\n\nhost\nUNSIGNED-PAYLOAD"
        val signText = "$algorithm\n$date\n$scope\n${sha(canonical.toByteArray())}"
        val signature =
            if (google) rsa(account, signText)
            else
                mac(
                    mac(
                        mac(
                            mac(
                                mac(("AWS4" + s.s("secretKey")).toByteArray(), day),
                                o.s("region", "us-east-1"),
                            ),
                            "s3",
                        ),
                        "aws4_request",
                    ),
                    signText,
                )
        return "$url?$q&$prefix-Signature=${hex(signature)}"
    }

    fun put(file: File, key: String): JSONObject {
        require(Regex("[a-zA-Z0-9/_\\-.]+").matches(key))
        require(file.length() <= 25 * 1024 * 1024) { "音频分片过大" }
        http.request(
            location(key),
            "PUT",
            file.asRequestBody("audio/wav".toMediaType()),
            headers("PUT", key, file.readBytes()) + mapOf("Content-Type" to "audio/wav"),
        )
        val expires = Instant.now().epochSecond + 172800
        return obj(
            "key" to key,
            "url" to signed(key, expires),
            "uri" to "${if(provider=="storage-gcs")"gs" else "s3"}://${o.s("bucket")}/$key",
            "expiresAt" to expires * 1000,
        )
    }

    fun remove(key: String) {
        http.request(location(key), "DELETE", headers = headers("DELETE", key))
    }
}
