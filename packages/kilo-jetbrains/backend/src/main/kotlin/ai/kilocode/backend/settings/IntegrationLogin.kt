package ai.kilocode.backend.settings

import ai.kilocode.backend.v2.V2Client
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.*

/** OAuth attempt IDs are location-bound, including for a remote MCP server of the same name. */
internal class IntegrationLogin(private val client: suspend () -> V2Client) {
    private data class Key(val directory: String?, val integration: String)

    private val attempts = ConcurrentHashMap<Key, JsonObject>()

    suspend fun begin(
        directory: String?,
        id: String,
        method: String,
        inputs: Map<String, String> = emptyMap(),
    ): JsonObject {
        cancel(directory, id)
        val result =
            client()
                .data(
                    "integration.oauth.connect",
                    directory,
                    mapOf("integrationID" to id),
                    buildJsonObject {
                        put("methodID", method)
                        if (inputs.isNotEmpty()) put("answer", inputs.asJson())
                    },
                )
                .jsonObject
        attempts[Key(directory, id)] = result
        return result
    }

    suspend fun finish(directory: String?, id: String, code: String? = null) {
        val key = Key(directory, id)
        val attempt = attempts[key] ?: error("No sign-in in progress")
        val path = mapOf("integrationID" to id, "attemptID" to attempt.required("attemptID"))
        val api = client()
        try {
            if (attempt.text("mode") == "code" || code != null) {
                api.call(
                    "integration.oauth.complete",
                    path,
                    location(directory),
                    buildJsonObject { code?.let { put("code", it) } },
                )
                if (attempt.text("mode") == "code") return
            }
            while (attempts[key] === attempt) {
                val row = api.data("integration.oauth.status", directory, path).jsonObject
                when (val status = row.required("status")) {
                    "complete" -> return
                    "pending" -> delay(750)
                    else -> error(row.text("message") ?: "Sign-in $status")
                }
            }
            error("Sign-in cancelled")
        } catch (e: CancellationException) {
            if (attempts.remove(key, attempt))
                withContext(NonCancellable) {
                    withTimeoutOrNull(3000) {
                        runCatching {
                            api.call("integration.oauth.cancel", path, location(directory))
                        }
                    }
                }
            throw e
        } finally {
            attempts.remove(key, attempt)
        }
    }

    suspend fun cancel(directory: String?, id: String) {
        val key = Key(directory, id)
        val previous = attempts.remove(key) ?: return
        client()
            .call(
                "integration.oauth.cancel",
                mapOf("integrationID" to id, "attemptID" to previous.required("attemptID")),
                location(directory),
            )
    }
}

internal suspend fun V2Client.removeConnections(directory: String?, integration: String): Boolean {
    val info = data("integration.get", directory, mapOf("integrationID" to integration)).jsonObject
    val credentials = info.rows("connections").filter { it.text("type") == "credential" }
    credentials.forEach {
        call("credential.remove", path = mapOf("credentialID" to it.required("id")))
    }
    return credentials.isNotEmpty()
}
