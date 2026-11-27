package ai.kilocode.backend.session

import ai.kilocode.backend.v2.V2Client
import ai.kilocode.rpc.dto.BackgroundJobDto
import ai.kilocode.rpc.dto.BoardMessageDto
import ai.kilocode.rpc.dto.DiffFileDto
import ai.kilocode.rpc.dto.SessionBoardDto
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.SessionRevertDto
import ai.kilocode.rpc.dto.SessionStatusDto
import ai.kilocode.rpc.dto.SessionTimeDto
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

internal fun JsonObject.obj(key: String) = get(key) as? JsonObject
internal fun JsonObject.items(key: String) = (get(key) as? JsonArray).orEmpty()
internal fun JsonObject.str(key: String) = (get(key) as? JsonPrimitive)?.contentOrNull
internal fun JsonObject.required(key: String) = checkNotNull(str(key)) { "Missing $key in server response" }
internal fun JsonObject.strings(key: String) = items(key).mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
internal fun JsonObject.flatten() = mapValues { (_, v) -> (v as? JsonPrimitive)?.contentOrNull ?: v.toString() }
internal fun JsonElement.data() = jsonObject.getValue("data")
internal fun sessionPath(id: String) = mapOf("sessionID" to id)
internal fun scopeQuery(directory: String) = mapOf("location[directory]" to directory)
internal fun fields(vararg pairs: Pair<String, String?>) = buildJsonObject { pairs.forEach { (k, v) -> if (v != null) put(k, v) } }

internal suspend fun V2Client.sessionRpc(id: String, method: String, directory: String, input: JsonObject): JsonElement =
    call("rpc.call", mapOf("rpcID" to id, "method" to method), scopeQuery(directory), buildJsonObject { put("input", input) }).jsonObject.getValue("output")

internal fun sessionDto(o: JsonObject): SessionDto {
    val time = o.getValue("time").jsonObject
    return SessionDto(
        id = o.required("id"), projectID = o.required("projectID"), directory = o.getValue("location").jsonObject.required("directory"),
        parentID = o.str("parentID"), title = o.str("title").orEmpty(), version = "2",
        time = SessionTimeDto(time.required("created").toDouble(), time.required("updated").toDouble(), time.str("archived")?.toDouble()),
        revert = o.obj("revert")?.let { r -> SessionRevertDto(r.required("messageID"), r.str("partID"), r.str("snapshot"),
            diffs = r.items("files").map { diffDto(it.jsonObject) }, workspace = r.str("workspace")) },
    )
}

internal fun diffDto(file: JsonObject) = DiffFileDto(file.required("file"), file.required("additions").toInt(),
    file.required("deletions").toInt(), file.str("patch"), file.str("status"))

internal fun statusDto(o: JsonObject) = SessionStatusDto(o.required("type"), o.str("message"), o.str("attempt")?.toInt(), o.str("next")?.toLong())

internal fun jobDto(o: JsonObject) = BackgroundJobDto(id = o.required("id"), type = "task", status = o.required("status"),
    title = o.str("title"), startedAt = o.getValue("time").jsonObject.required("started").toLong(),
    completedAt = o.obj("time")?.str("completed")?.toLong(), error = o.str("error"), sessionId = o.required("sessionID"),
    parentSessionId = o.required("parentSessionID"), background = o.required("background").toBooleanStrict())

internal fun boardDto(owner: String, o: JsonObject): SessionBoardDto {
    check(o.required("ownerSessionID") == owner) { "Session $owner is not the board owner" }
    return SessionBoardDto(owner, o.required("revision").toInt(), o.items("messages").map { row ->
        val m = row.jsonObject
        BoardMessageDto(m.required("id"), m.required("timestamp").toLong(), m.required("from"), m.required("to"),
            m.str("fromLabel"), m.str("toLabel"), m.required("type"), m.required("body"), m.str("reply_to"))
    }, o.str("cursor"), o.required("hasMore").toBooleanStrict())
}
