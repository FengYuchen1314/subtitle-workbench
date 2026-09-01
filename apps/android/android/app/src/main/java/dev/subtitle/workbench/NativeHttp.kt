package dev.subtitle.workbench

import java.io.File
import java.net.InetAddress
import java.net.URI
import java.net.URLEncoder
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.PKCS8EncodedKeySpec
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Base64
import java.util.concurrent.TimeUnit
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import org.json.JSONTokener

class CloudFailure(
    message: String,
    val uncertain: Boolean = false,
    val retryable: Boolean = false,
) : Exception(message)

fun enc(v: String) =
    URLEncoder.encode(v, "UTF-8").replace("+", "%20").replace("%7E", "~").replace("*", "%2A")

fun query(p: Map<String, String>) =
    p.toSortedMap().entries.joinToString("&") { "${enc(it.key)}=${enc(it.value)}" }

fun sha(b: ByteArray) =
    MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }

fun mac(k: ByteArray, v: String, alg: String = "HmacSHA256"): ByteArray =
    Mac.getInstance(alg).run {
        init(SecretKeySpec(k, alg))
        doFinal(v.toByteArray(Charsets.UTF_8))
    }

fun b64(b: ByteArray) = Base64.getEncoder().encodeToString(b)

fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }

fun rsa(json: JSONObject, text: String): ByteArray {
    val pem = json.s("private_key").replace(Regex("-----[^-]+-----|\\s"), "")
    val key =
        KeyFactory.getInstance("RSA")
            .generatePrivate(PKCS8EncodedKeySpec(Base64.getDecoder().decode(pem)))
    return Signature.getInstance("SHA256withRSA").run {
        initSign(key)
        update(text.toByteArray())
        sign()
    }
}

class NativeHttp(private val profile: JSONObject) {
    companion object {
        private val calls = java.util.concurrent.ConcurrentHashMap.newKeySet<Call>()

        fun cancelAll() {
            calls.forEach { it.cancel() }
        }
    }

    private val allowPrivate = profile.optBoolean("allowPrivateEndpoint")
    private val client =
        OkHttpClient.Builder()
            .followRedirects(false)
            .followSslRedirects(false)
            .callTimeout(10, TimeUnit.MINUTES)
            .connectTimeout(30, TimeUnit.SECONDS)
            .retryOnConnectionFailure(false)
            .dns(
                object : Dns {
                    override fun lookup(hostname: String): List<InetAddress> {
                        return InetAddress.getAllByName(hostname).toList().also { list ->
                            require(
                                allowPrivate ||
                                    list.none {
                                        it.isAnyLocalAddress ||
                                            it.isLoopbackAddress ||
                                            it.isSiteLocalAddress ||
                                            it.isLinkLocalAddress ||
                                            it.isMulticastAddress ||
                                            (it.address.size == 16 &&
                                                it.address[0].toInt() and 0xfe == 0xfc)
                                    }
                            ) {
                                "禁止访问内网地址，请在该配置中明确允许"
                            }
                        }
                    }
                }
            )
            .build()

    fun request(
        url: String,
        method: String = "GET",
        body: RequestBody? = null,
        headers: Map<String, String> = emptyMap(),
    ): Any {
        val uri = URI(url)
        require(
            uri.userInfo == null && (uri.scheme == "https" || allowPrivate && uri.scheme == "http")
        ) {
            "仅允许 HTTPS 或明确授权的内网服务"
        }
        val request =
            Request.Builder()
                .url(url)
                .method(
                    method,
                    if (method in listOf("POST", "PUT", "PATCH"))
                        body ?: ByteArray(0).toRequestBody()
                    else body,
                )
                .apply { headers.forEach { (k, v) -> header(k, v) } }
                .build()
        val call = client.newCall(request)
        calls.add(call)
        try {
            call.execute().use { r ->
                if (!r.isSuccessful)
                    throw CloudFailure(
                        "模型服务请求失败（HTTP ${r.code}），请检查配置、额度及权限",
                        method != "GET" && (r.code >= 500 || r.code == 408),
                        r.code == 429 || r.code >= 500,
                    )
                val volc = r.header("X-Api-Status-Code")
                if (volc != null && volc !in listOf("20000000", "20000001", "20000002"))
                    throw CloudFailure("火山引擎拒绝请求（$volc）")
                val stream = r.body?.byteStream() ?: return obj()
                val buffer = java.io.ByteArrayOutputStream()
                val block = ByteArray(8192)
                while (true) {
                    val n = stream.read(block)
                    if (n < 0) break
                    require(buffer.size() + n <= 32 * 1024 * 1024) { "模型返回数据过大" }
                    buffer.write(block, 0, n)
                }
                val text = buffer.toString("UTF-8")
                if (text.isBlank()) return obj()
                return JSONTokener(text).nextValue()
            }
        } catch (e: java.io.IOException) {
            throw CloudFailure("网络中断；请求可能已提交，请检查任务状态", method != "GET", true)
        } finally {
            calls.remove(call)
        }
    }

    fun json(
        url: String,
        data: Any? = null,
        headers: Map<String, String> = emptyMap(),
        method: String = if (data == null) "GET" else "POST",
    ) =
        request(
            url,
            method,
            data?.toString()?.toRequestBody("application/json".toMediaType()),
            headers,
        )
            as JSONObject

    fun binary(
        url: String,
        file: File,
        headers: Map<String, String> = emptyMap(),
        method: String = "POST",
    ) = request(url, method, file.asRequestBody("audio/wav".toMediaType()), headers) as JSONObject

    fun multipart(
        url: String,
        file: File,
        field: String,
        fields: Map<String, String>,
        headers: Map<String, String>,
        fileLast: Boolean = false,
    ): JSONObject {
        val b = MultipartBody.Builder().setType(MultipartBody.FORM)
        if (!fileLast)
            b.addFormDataPart(field, "audio.wav", file.asRequestBody("audio/wav".toMediaType()))
        fields.forEach { (k, v) -> b.addFormDataPart(k, v) }
        if (fileLast)
            b.addFormDataPart(field, "audio.wav", file.asRequestBody("audio/wav".toMediaType()))
        return request(url, "POST", b.build(), headers) as JSONObject
    }

    fun googleToken(): String {
        val account = JSONObject(profile.o("secrets").s("serviceAccount"))
        val now = Instant.now().epochSecond
        fun u(b: ByteArray) = Base64.getUrlEncoder().withoutPadding().encodeToString(b)
        val head = u(obj("alg" to "RS256", "typ" to "JWT").toString().toByteArray())
        val body =
            u(
                obj(
                        "iss" to account.s("client_email"),
                        "scope" to "https://www.googleapis.com/auth/cloud-platform",
                        "aud" to "https://oauth2.googleapis.com/token",
                        "iat" to now,
                        "exp" to now + 3600,
                    )
                    .toString()
                    .toByteArray()
            )
        val unsigned = "$head.$body"
        val jwt = "$unsigned.${u(rsa(account,unsigned))}"
        return (request(
                "https://oauth2.googleapis.com/token",
                "POST",
                FormBody.Builder()
                    .add("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer")
                    .add("assertion", jwt)
                    .build(),
            )
                as JSONObject)
            .getString("access_token")
    }
}

fun awsSign(
    p: JSONObject,
    url: String,
    service: String,
    body: ByteArray,
    method: String = "POST",
): Map<String, String> {
    val now = Instant.now()
    val date =
        DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss'Z'").withZone(ZoneOffset.UTC).format(now)
    val day = date.take(8)
    val uri = URI(url)
    val region = p.o("options").s("region", "us-east-1")
    val s = p.o("secrets")
    val digest = sha(body)
    val headers =
        sortedMapOf(
            "host" to uri.rawAuthority,
            "x-amz-content-sha256" to digest,
            "x-amz-date" to date,
        )
    if (s.s("sessionToken").isNotEmpty()) headers["x-amz-security-token"] = s.s("sessionToken")
    val signed = headers.keys.joinToString(";")
    val canonical =
        "$method\n${uri.rawPath.ifEmpty { "/" }}\n${uri.rawQuery ?: ""}\n${headers.entries.joinToString("") { "${it.key}:${it.value.trim()}\n" }}\n$signed\n$digest"
    val scope = "$day/$region/$service/aws4_request"
    val toSign = "AWS4-HMAC-SHA256\n$date\n$scope\n${sha(canonical.toByteArray())}"
    val key =
        mac(
            mac(mac(mac(("AWS4" + s.s("secretKey")).toByteArray(), day), region), service),
            "aws4_request",
        )
    return headers +
        mapOf(
            "Authorization" to
                "AWS4-HMAC-SHA256 Credential=${s.s("accessKey")}/$scope, SignedHeaders=$signed, Signature=${hex(mac(key,toSign))}"
        )
}

fun tencentSign(p: JSONObject, body: String, action: String): Map<String, String> {
    val now = Instant.now()
    val date = DateTimeFormatter.ISO_LOCAL_DATE.withZone(ZoneOffset.UTC).format(now)
    val s = p.o("secrets")
    val canonical =
        "POST\n/\n\ncontent-type:application/json; charset=utf-8\nhost:asr.tencentcloudapi.com\n\ncontent-type;host\n${sha(body.toByteArray())}"
    val scope = "$date/asr/tc3_request"
    val toSign = "TC3-HMAC-SHA256\n${now.epochSecond}\n$scope\n${sha(canonical.toByteArray())}"
    val key = mac(mac(mac(("TC3" + s.s("secretKey")).toByteArray(), date), "asr"), "tc3_request")
    return mapOf(
        "Content-Type" to "application/json; charset=utf-8",
        "X-TC-Action" to action,
        "X-TC-Version" to "2019-06-14",
        "X-TC-Timestamp" to now.epochSecond.toString(),
        "X-TC-Region" to p.o("options").s("region", "ap-shanghai"),
        "Authorization" to
            "TC3-HMAC-SHA256 Credential=${s.s("accessKey")}/$scope, SignedHeaders=content-type;host, Signature=${hex(mac(key,toSign))}",
    ) +
        (if (s.s("sessionToken").isNotEmpty()) mapOf("X-TC-Token" to s.s("sessionToken"))
        else emptyMap())
}
