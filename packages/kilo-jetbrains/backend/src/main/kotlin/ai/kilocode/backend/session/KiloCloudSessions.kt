package ai.kilocode.backend.session

import ai.kilocode.backend.v2.V2Client
import ai.kilocode.backend.v2.V2HttpException
import ai.kilocode.rpc.dto.CloudHistoryCapabilitiesDto
import ai.kilocode.rpc.dto.CloudSessionDto
import ai.kilocode.rpc.dto.CloudSessionListDto
import ai.kilocode.rpc.dto.SessionDto
import java.io.IOException
import java.time.Instant
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

internal class KiloCloudSessions(private val api: V2Client, private val directory: String) {
    private val unavailable = "Cloud history is unavailable in this CLI. Retry after startup or update to a Kilo CLI with native cloud history support."

    suspend fun capabilities(): CloudHistoryCapabilitiesDto = try {
        val output = call("capabilities", JsonObject(emptyMap()))
        CloudHistoryCapabilitiesDto(available = true, repositoryFilter = output.required("repositoryFilter").toBooleanStrict())
    } catch (_: MissingHistoryRpc) {
        CloudHistoryCapabilitiesDto(available = false)
    }

    suspend fun list(cursor: String?, limit: Int): CloudSessionListDto {
        val page = call("list", buildJsonObject { put("limit", limit); cursor?.let { put("cursor", it) } })
        return CloudSessionListDto(page.getValue("items").jsonArray.map { item ->
            val row = item.jsonObject
            val date = Instant.ofEpochMilli(row.required("createdAt").toLong()).toString()
            CloudSessionDto(row.required("sessionID"), createdAt = date, updatedAt = date, version = 2.0)
        }, page.str("cursor"))
    }

    suspend fun importSession(id: String): SessionDto {
        require(Regex("ses[A-Za-z0-9_-]{1,253}").matches(id)) { "Enter a native Kilo cloud session ID." }
        val transcript = call("download", fields("sessionID" to id))
        val body = buildJsonObject {
            put("info", transcript.getValue("info")); put("messages", transcript.getValue("messages"))
            put("location", fields("directory" to directory))
        }
        return sessionDto(api.call("experimental.session.import", body = body).data().jsonObject)
    }

    private suspend fun call(method: String, input: JsonObject): JsonObject = try {
        api.sessionRpc("kilocode.cloud-history", method, directory, input).jsonObject
    } catch (e: V2HttpException) {
        val error = runCatching { Json.parseToJsonElement(e.body).jsonObject }.getOrNull()
        when (error?.str("type")) {
            "rpc.unavailable", "rpc.method_not_found" -> throw MissingHistoryRpc(unavailable)
            "failed" -> throw IOException(error.str("message") ?: "Cloud history request failed.")
            else -> throw e
        }
    }

    private class MissingHistoryRpc(message: String) : IOException(message)
}
