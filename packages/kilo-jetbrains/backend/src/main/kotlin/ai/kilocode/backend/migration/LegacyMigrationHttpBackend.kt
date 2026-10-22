package ai.kilocode.backend.migration

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * OkHttp implementation of [LegacyMigrationBackend] against `kilo serve`.
 *
 * Uses raw OkHttp so that partial/dynamic JSON payloads (provider auth, global config,
 * session-import) can be built exactly as needed without the generated client's type
 * constraints getting in the way. Mirrors the pattern in KiloBackendChatManager.
 *
 * All calls are synchronous blocking. The caller owns threading and error handling.
 */
class LegacyMigrationHttpBackend(
    private val client: OkHttpClient,
    private val base: String,
) : LegacyMigrationBackend {

    companion object {
        private val JSON_TYPE = "application/json".toMediaType()
        private val json = Json { ignoreUnknownKeys = true }
    }

    // -----------------------------------------------------------------------
    // Auth
    // -----------------------------------------------------------------------

    override fun setAuth(provider: String, auth: JsonObject) {
        val body = auth.toString()
        val request = Request.Builder()
            .url("$base/auth/$provider")
            .put(body.toRequestBody(JSON_TYPE))
            .build()
        client.newCall(request).execute().use { resp ->
            if (!resp.isSuccessful) throw RuntimeException("setAuth failed for $provider: HTTP ${resp.code} — ${resp.body?.string()}")
        }
    }

    // -----------------------------------------------------------------------
    // Global config
    // -----------------------------------------------------------------------

    override fun updateGlobalConfig(config: JsonObject) {
        val body = config.toString()
        val request = Request.Builder()
            .url("$base/global/config")
            .patch(body.toRequestBody(JSON_TYPE))
            .build()
        client.newCall(request).execute().use { resp ->
            if (!resp.isSuccessful) throw RuntimeException("updateGlobalConfig failed: HTTP ${resp.code} — ${resp.body?.string()}")
        }
    }

    // -----------------------------------------------------------------------
    // Session existence check
    // -----------------------------------------------------------------------

    override fun sessionExists(id: String): Boolean {
        val request = Request.Builder()
            .url("$base/session/$id")
            .get()
            .build()
        client.newCall(request).execute().use { resp ->
            return resp.isSuccessful
        }
    }

    // -----------------------------------------------------------------------
    // Session import
    // -----------------------------------------------------------------------

    override fun importProject(project: JsonObject): String {
        val dir = project["worktree"]?.jsonPrimitive?.content ?: ""
        val url = "$base/kilocode/session-import/project?directory=${encode(dir)}"
        val body = project.toString()
        val request = Request.Builder()
            .url(url)
            .post(body.toRequestBody(JSON_TYPE))
            .build()
        client.newCall(request).execute().use { resp ->
            if (!resp.isSuccessful) throw RuntimeException("importProject failed: HTTP ${resp.code} — ${resp.body?.string()}")
            val raw = resp.body?.string() ?: throw RuntimeException("importProject: empty response")
            val obj = runCatching { json.parseToJsonElement(raw).jsonObject }.getOrNull()
            return obj?.get("id")?.jsonPrimitive?.content
                ?: project["id"]?.jsonPrimitive?.content
                ?: ""
        }
    }

    override fun importSession(session: JsonObject): LegacyImportResult {
        val dir = session["directory"]?.jsonPrimitive?.content ?: ""
        val url = "$base/kilocode/session-import/session?directory=${encode(dir)}"
        val body = session.toString()
        val request = Request.Builder()
            .url(url)
            .post(body.toRequestBody(JSON_TYPE))
            .build()
        client.newCall(request).execute().use { resp ->
            if (!resp.isSuccessful) throw RuntimeException("importSession failed: HTTP ${resp.code} — ${resp.body?.string()}")
            val raw = resp.body?.string() ?: throw RuntimeException("importSession: empty response")
            val obj = runCatching { json.parseToJsonElement(raw).jsonObject }.getOrNull()
            val id = obj?.get("id")?.jsonPrimitive?.content
                ?: session["id"]?.jsonPrimitive?.content
                ?: ""
            val skipped = obj?.get("skipped")?.jsonPrimitive?.content?.toBooleanStrictOrNull() ?: false
            return LegacyImportResult(id = id, skipped = skipped)
        }
    }

    override fun importMessage(message: JsonObject) {
        val sessionId = message["sessionID"]?.jsonPrimitive?.content ?: ""
        val url = "$base/kilocode/session-import/message?sessionID=${encode(sessionId)}"
        val body = message.toString()
        val request = Request.Builder()
            .url(url)
            .post(body.toRequestBody(JSON_TYPE))
            .build()
        client.newCall(request).execute().use { resp ->
            if (!resp.isSuccessful) throw RuntimeException("importMessage failed: HTTP ${resp.code} — ${resp.body?.string()}")
        }
    }

    override fun importPart(part: JsonObject) {
        val sessionId = part["sessionID"]?.jsonPrimitive?.content ?: ""
        val url = "$base/kilocode/session-import/part?sessionID=${encode(sessionId)}"
        val body = part.toString()
        val request = Request.Builder()
            .url(url)
            .post(body.toRequestBody(JSON_TYPE))
            .build()
        client.newCall(request).execute().use { resp ->
            if (!resp.isSuccessful) throw RuntimeException("importPart failed: HTTP ${resp.code} — ${resp.body?.string()}")
        }
    }

    // -----------------------------------------------------------------------
    // Utilities
    // -----------------------------------------------------------------------

    private fun encode(value: String): String =
        java.net.URLEncoder.encode(value, "UTF-8")
}
