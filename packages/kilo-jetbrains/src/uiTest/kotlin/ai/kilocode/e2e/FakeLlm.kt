package ai.kilocode.e2e

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets
import java.time.Duration

/**
 * Minimal client for the C1 fake-LLM side channels used by the gated prompt scenario.
 * The coordinator only accepts loopback origins, so the documented local admin token is
 * the fallback; evidence redacts it like every other fixture secret.
 */
class FakeLlm private constructor(
    private val origin: String,
    private val admin: String,
) {
    private val http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build()

    fun requests(scope: String): Int? = get("/test/requests?scope=${encode(scope)}")?.let { body ->
        runCatching {
            Json.parseToJsonElement(body).jsonObject["chatCompletions"]?.jsonPrimitive?.intOrNull
        }.getOrNull()
    }

    fun gateEngaged(tag: String): Boolean? = get("/test/gate-status?tag=${encode(tag)}")?.let { body ->
        runCatching {
            Json.parseToJsonElement(body).jsonObject["engaged"]?.jsonPrimitive?.booleanOrNull
        }.getOrNull()
    }

    /** Requests attributed to one scenario tag, independent of the prompt scope marker. */
    fun scenarioRequests(tag: String): Int? = get("/test/scenario-status?tag=${encode(tag)}")?.let { body ->
        runCatching {
            Json.parseToJsonElement(body).jsonObject["requests"]?.jsonPrimitive?.intOrNull
        }.getOrNull()
    }

    /** Returns the HTTP status, or null when the request could not be sent. */
    fun release(tag: String): Int? = send("/test/release?tag=${encode(tag)}", post = true)?.statusCode()

    private fun get(path: String): String? = send(path, post = false)
        ?.takeIf { it.statusCode() in 200..299 }
        ?.body()

    private fun send(path: String, post: Boolean): HttpResponse<String>? = runCatching {
        val request = HttpRequest.newBuilder(URI.create("$origin$path"))
            .timeout(Duration.ofSeconds(10))
            .header("Authorization", "Bearer $admin")
            .apply { if (post) POST(HttpRequest.BodyPublishers.noBody()) else GET() }
            .build()
        http.send(request, HttpResponse.BodyHandlers.ofString())
    }.getOrNull()

    private fun encode(value: String): String = URLEncoder.encode(value, StandardCharsets.UTF_8)

    companion object {
        const val LOCAL_ADMIN = "local-fake-llm-admin"

        fun create(origin: String?): FakeLlm? {
            val base = origin?.trim()?.trimEnd('/')?.takeIf { it.isNotEmpty() } ?: return null
            val admin = System.getenv("FAKE_LLM_ADMIN_TOKEN")?.takeIf { it.isNotBlank() } ?: LOCAL_ADMIN
            return FakeLlm(base, admin)
        }
    }
}
