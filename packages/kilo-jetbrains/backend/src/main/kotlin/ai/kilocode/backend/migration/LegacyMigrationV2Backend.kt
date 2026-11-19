package ai.kilocode.backend.migration

import ai.kilocode.backend.migration.session.LegacySessionParser
import ai.kilocode.backend.settings.*
import ai.kilocode.backend.v2.V2Client
import ai.kilocode.backend.v2.V2HttpException
import kotlinx.serialization.json.*

internal class LegacyMigrationV2Backend(private val client: suspend () -> V2Client) :
    LegacyMigrationBackend {
    override suspend fun setAuth(provider: String, auth: JsonObject) {
        val api = client()
        val value =
            when (auth.required("type")) {
                "api" -> mapOf("type" to "key", "key" to auth.required("key")).asJson()
                "oauth" -> {
                    val methods =
                        api.data("integration.get", path = mapOf("integrationID" to provider))
                            .jsonObject
                            .rows("methods")
                    val method = methods.first { it.text("type") == "oauth" }
                    buildJsonObject {
                        put("type", "oauth")
                        put("methodID", method.required("id"))
                        put("access", auth.getValue("access"))
                        put("refresh", auth.getValue("refresh"))
                        put("expires", auth.getValue("expires"))
                        auth.text("accountId")?.let { account ->
                            put(
                                "metadata",
                                buildJsonObject {
                                    put(
                                        if (provider == "kilo") "organizationID" else "accountId",
                                        account,
                                    )
                                },
                            )
                        }
                    }
                }
                else -> error("Unknown legacy credential type")
            }
        api.call(
            "credential.create",
            body =
                buildJsonObject {
                    put("integrationID", provider)
                    put("value", value)
                },
        )
    }

    override suspend fun updateGlobalConfig(config: JsonObject) {
        client().write(null, "global", nativeMigrationConfig(config))
    }

    override suspend fun sessionExists(id: String) =
        try {
            client().call("session.get", path = mapOf("sessionID" to id))
            true
        } catch (e: V2HttpException) {
            if (e.status == 404) false else throw e
        }

    override suspend fun importTranscript(
        parsed: LegacySessionParser.NormalizedSession
    ): LegacyImportResult {
        val api = client()
        val id = parsed.session.required("id")
        val place =
            api.call("location.get", query = location(parsed.session.text("directory"))).jsonObject
        val loc = mapOf("directory" to place.required("directory")).asJson()
        val info = buildJsonObject {
            put("id", id)
            put("location", loc)
            put("projectID", place.obj("project").required("id"))
            put("title", parsed.session.required("title"))
            put(
                "time",
                buildJsonObject {
                    put("created", parsed.session.getValue("timeCreated"))
                    put("updated", parsed.session.getValue("timeUpdated"))
                },
            )
            put("cost", 0)
            put(
                "tokens",
                buildJsonObject {
                    put("input", 0)
                    put("output", 0)
                    put("reasoning", 0)
                    put(
                        "cache",
                        buildJsonObject {
                            put("read", 0)
                            put("write", 0)
                        },
                    )
                },
            )
        }
        try {
            api.call(
                "experimental.session.import",
                body =
                    buildJsonObject {
                        put("info", info)
                        put("location", loc)
                        put("messages", transcriptMessages(parsed))
                    },
            )
        } catch (e: V2HttpException) {
            if (e.status == 409 && sessionExists(id)) return LegacyImportResult(id, true)
            else throw e
        }
        return LegacyImportResult(id, false)
    }
}

internal fun transcriptMessages(parsed: LegacySessionParser.NormalizedSession): JsonArray {
    val parts = parsed.parts.groupBy { it.required("messageID") }
    return JsonArray(
        parsed.messages.map { message ->
            buildJsonObject {
                val data = message.obj("data")
                val id = message.required("id")
                val role = data.required("role")
                val items =
                    parts[id]
                        .orEmpty()
                        .map { it.obj("data") }
                        .filterNot { it.text("ignored") == "true" }
                put("type", role)
                put("id", id)
                put("time", data.getValue("time"))
                if (role == "user")
                    put("text", items.mapNotNull { it.text("text") }.joinToString("\n"))
                else {
                    put("agent", data.text("mode") ?: "code")
                    put("model", mapOf("id" to "legacy", "providerID" to "legacy").asJson())
                    put(
                        "content",
                        JsonArray(
                            items.map { item ->
                                when (val type = item.required("type")) {
                                    "tool" ->
                                        buildJsonObject {
                                            val state = item.obj("state")
                                            put("type", "tool")
                                            put("id", item.required("callID"))
                                            put("name", item.required("tool"))
                                            put(
                                                "time",
                                                buildJsonObject {
                                                    put(
                                                        "created",
                                                        state.obj("time").getValue("start"),
                                                    )
                                                    put(
                                                        "completed",
                                                        state.obj("time").getValue("end"),
                                                    )
                                                },
                                            )
                                            put(
                                                "state",
                                                buildJsonObject {
                                                    put("status", "completed")
                                                    put("input", state.obj("input"))
                                                    put("metadata", state.obj("metadata"))
                                                    put(
                                                        "content",
                                                        JsonArray(
                                                            listOf(
                                                                mapOf(
                                                                        "type" to "text",
                                                                        "text" to
                                                                            state.required("output"),
                                                                    )
                                                                    .asJson()
                                                            )
                                                        ),
                                                    )
                                                },
                                            )
                                        }
                                    else ->
                                        mapOf("type" to type, "text" to item.required("text"))
                                            .asJson()
                                }
                            }
                        ),
                    )
                }
            }
        }
    )
}

/**
 * Convert the historical preferences into canonical config fields before the settings writer
 * validates them.
 */
internal fun nativeMigrationConfig(config: JsonObject) = buildJsonObject {
    config["model"]?.let { put("model", it) }
    config["permission"]?.let { put("permissions", migrationRules(it)) }
    config["agent"]?.let { agents ->
        put(
            "agents",
            JsonObject(
                agents.jsonObject.mapValues { (_, agent) ->
                    buildJsonObject {
                        val raw = agent.jsonObject
                        listOf("description", "mode").forEach { k -> raw[k]?.let { put(k, it) } }
                        raw["prompt"]?.let { put("system", it) }
                        raw["permission"]?.let { put("permissions", migrationRules(it)) }
                    }
                }
            ),
        )
    }
    config["mcp"]?.let { mcp ->
        put(
            "mcp",
            buildJsonObject {
                put(
                    "servers",
                    JsonObject(
                        mcp.jsonObject.mapValues { (_, server) ->
                            buildJsonObject {
                                val raw = server.jsonObject
                                listOf("command", "url", "type", "headers", "environment")
                                    .forEach { k -> raw[k]?.let { put(k, it) } }
                                raw["enabled"]?.let { put("disabled", !it.jsonPrimitive.boolean) }
                                raw["timeout"]?.let { limit ->
                                    put(
                                        "timeout",
                                        buildJsonObject {
                                            put("startup", limit)
                                            put("catalog", limit)
                                            put("execution", limit)
                                        },
                                    )
                                }
                            }
                        }
                    ),
                )
            },
        )
    }
    config["provider"]?.let { providers ->
        put(
            "providers",
            JsonObject(
                providers.jsonObject.mapValues { (_, provider) ->
                    buildJsonObject {
                        val settings = JsonObject(provider.jsonObject.obj("options") - "apiKey")
                        if (settings.isNotEmpty()) put("settings", settings)
                    }
                }
            ),
        )
    }
}

private fun migrationRules(raw: JsonElement): JsonArray {
    fun rule(action: String, resource: String, value: JsonElement) =
        mapOf(
                "action" to
                    when (action) {
                        "bash" -> "shell"
                        "task" -> "subagent"
                        "write",
                        "patch",
                        "apply_patch" -> "edit"
                        else -> action
                    },
                "resource" to resource,
                "effect" to value.jsonPrimitive.content,
            )
            .asJson()
    if (raw !is JsonObject) return JsonArray(listOf(rule("*", "*", raw)))
    return JsonArray(
        raw.flatMap { (action, value) ->
            if (value !is JsonObject) listOf(rule(action, "*", value))
            else value.entries.sortedBy { it.key != "*" }.map { rule(action, it.key, it.value) }
        }
    )
}
