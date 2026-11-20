package ai.kilocode.backend.settings

import ai.kilocode.rpc.dto.McpConfigDto
import ai.kilocode.rpc.dto.McpOAuthDto
import kotlinx.serialization.json.*

internal object McpSettingsCodec {
    fun read(row: JsonObject): McpConfigDto {
        val oauth = row["oauth"]
        return McpConfigDto(
            row.text("type"),
            (row["command"] as? JsonArray)?.map { it.jsonPrimitive.content },
            row.text("url"),
            (row["environment"] as? JsonObject)?.mapValues { it.value.jsonPrimitive.content },
            (row["headers"] as? JsonObject)?.mapValues { it.value.jsonPrimitive.content },
            (row["disabled"] as? JsonPrimitive)?.booleanOrNull?.not(),
            row.obj("timeout")["execution"]?.jsonPrimitive?.longOrNull,
            when (oauth) {
                is JsonObject ->
                    McpOAuthDto(
                        true,
                        oauth.text("client_id"),
                        oauth.text("client_secret"),
                        oauth.text("scope"),
                        oauth["callback_port"]?.jsonPrimitive?.intOrNull,
                        oauth.text("redirect_uri"),
                    )
                is JsonPrimitive -> McpOAuthDto(enabled = oauth.booleanOrNull)
                else -> null
            },
        )
    }

    fun write(dto: McpConfigDto) = buildJsonObject {
        dto.type?.let { put("type", it) }
        dto.command?.let { cmd -> put("command", JsonArray(cmd.map(::JsonPrimitive))) }
        dto.url?.let { put("url", it) }
        dto.headers?.let { put("headers", it.asJson()) }
        dto.environment?.let { put("environment", it.asJson()) }
        dto.enabled?.let { put("disabled", !it) }
        dto.timeout?.let { timeout ->
            put(
                "timeout",
                buildJsonObject {
                    put("execution", timeout)
                    put("startup", timeout)
                    put("catalog", timeout)
                },
            )
        }
        dto.oauth?.let { oauth ->
            put(
                "oauth",
                when {
                    oauth.clear -> JsonNull
                    oauth.enabled == false -> JsonPrimitive(false)
                    else ->
                        buildJsonObject {
                            oauth.clientId?.let { put("client_id", it) }
                            oauth.clientSecret?.let { put("client_secret", it) }
                            oauth.scope?.let { put("scope", it) }
                            oauth.callbackPort?.let { put("callback_port", it) }
                            oauth.redirectUri?.let { put("redirect_uri", it) }
                        }
                },
            )
        }
    }
}
