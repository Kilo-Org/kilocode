package ai.kilocode.backend.settings

import ai.kilocode.backend.cli.KiloBackendCliManager
import ai.kilocode.backend.v2.V2Client
import ai.kilocode.backend.v2.V2HttpException
import com.intellij.openapi.components.service
import java.io.File
import kotlinx.coroutines.delay
import kotlinx.serialization.json.*

internal suspend fun settingsClient() = service<KiloBackendCliManager>().client()

internal val emptyObject = JsonObject(emptyMap())

internal fun location(directory: String?) =
    directory
        ?.takeIf(String::isNotBlank)
        ?.let { mapOf("location[directory]" to File(it).canonicalPath) }
        .orEmpty()

internal fun JsonObject.text(key: String) = (get(key) as? JsonPrimitive)?.contentOrNull

internal fun JsonObject.required(key: String) = getValue(key).jsonPrimitive.content

internal fun JsonObject.obj(key: String) = get(key) as? JsonObject ?: emptyObject

internal fun JsonObject.rows(key: String) = (get(key) as? JsonArray).orEmpty().map { it.jsonObject }

internal fun JsonObject.strings(key: String) =
    (get(key) as? JsonArray).orEmpty().map { it.jsonPrimitive.content }

internal fun Map<String, String>.asJson() = JsonObject(mapValues { JsonPrimitive(it.value) })

internal suspend fun V2Client.data(
    operation: String,
    directory: String? = null,
    path: Map<String, String> = emptyMap(),
    body: JsonObject? = null,
) =
    call(operation, path = path, query = location(directory), body = body)
        .jsonObject
        .getValue("data")

internal suspend fun V2Client.plugin(
    id: String,
    method: String,
    directory: String? = null,
    input: JsonObject = emptyObject,
): JsonElement {
    val path = mapOf("rpcID" to id, "method" to method)
    val body = buildJsonObject { put("input", input) }
    for (attempt in 0..5) {
        try {
            return call("rpc.call", path, location(directory), body).jsonObject["output"]
                ?: JsonNull
        } catch (e: V2HttpException) {
            val type =
                runCatching { Json.parseToJsonElement(e.body).jsonObject.text("type") }.getOrNull()
            // A location shutdown can also interrupt an in-flight mutation; do not replay it.
            if (
                type != "rpc.unavailable" ||
                    method !in
                        setOf(
                            "read",
                            "target",
                            "list",
                            "installed",
                            "removable",
                            "authStatus",
                            "profile",
                            "notifications",
                            "balance",
                            "kiloPass",
                        ) ||
                    attempt == 5
            )
                throw e
            delay(100L shl attempt)
        }
    }
    error("Unreachable")
}

internal suspend fun V2Client.document(directory: String?, scope: String) =
    plugin("kilocode.settings", "read", directory, buildJsonObject { put("scope", scope) })
        .jsonObject
        .obj("document")

internal suspend fun V2Client.write(directory: String?, scope: String, values: JsonObject) =
    plugin(
        "kilocode.settings",
        "write",
        directory,
        buildJsonObject {
            put("scope", scope)
            put("set", values)
        },
    )
