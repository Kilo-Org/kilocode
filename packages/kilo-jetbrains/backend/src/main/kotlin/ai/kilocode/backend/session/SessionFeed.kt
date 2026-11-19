package ai.kilocode.backend.session

import ai.kilocode.backend.v2.V2Client
import ai.kilocode.backend.v2.V2HttpException
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.DiffFileDto
import ai.kilocode.rpc.dto.MessageDto
import ai.kilocode.rpc.dto.MessageSummaryDto
import ai.kilocode.rpc.dto.MessageTimeDto
import ai.kilocode.rpc.dto.MessageWithPartsDto
import ai.kilocode.rpc.dto.PartDto
import ai.kilocode.rpc.dto.PartTimeDto
import ai.kilocode.rpc.dto.SessionStatusDto
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject

/** Independent state for an open split-RPC subscription. Its authoritative snapshot is also its reconnect boundary. */
internal class SessionFeed(private val sid: String, private val api: suspend () -> V2Client) {
    private var transcript = SessionTranscript(sid)
    private val known = mutableSetOf<String>()
    private var queued = mutableSetOf<String>()
    private var permissions = mutableSetOf<String>()
    private var forms = mutableSetOf<String>()
    private val tools = mutableMapOf<String, PartDto>()

    suspend fun receive(e: JsonObject): List<ChatEventDto> {
        val type = e.required("type")
        if (type == "server.connected") return snapshot()
        val d = e.obj("data") ?: return emptyList()
        if (type == "session.created") {
            val child = d.required("sessionID")
            val time = e.getValue("created")
            val session = JsonObject(d + fields("id" to child) + ("time" to buildJsonObject { put("created", time); put("updated", time) }))
            return listOf(ChatEventDto.SessionCreated(child, sessionDto(session)))
        }
        val owner = d.str("sessionID") ?: d.obj("form")?.str("sessionID")
        if (owner != sid) return emptyList()
        val common = activityEvents(type, d)
        if (common.isNotEmpty()) {
            for (event in common) when (event) {
                is ChatEventDto.PermissionAsked -> permissions += event.request.id
                is ChatEventDto.PermissionReplied -> permissions -= event.requestID
                is ChatEventDto.QuestionAsked -> forms += event.request.id
                is ChatEventDto.QuestionRejected -> forms -= event.requestID
                is ChatEventDto.QuestionReplied -> forms -= event.requestID
                else -> Unit
            }
            return common
        }
        return when (type) {
            "session.step.started" -> {
                val m = d.required("assistantMessageID")
                val selected = d.getValue("model").jsonObject
                val info = MessageDto(m, sid, "assistant", MessageTimeDto(d.required("started").toDouble()),
                    d.str("agent"), selected.str("providerID"), selected.str("id"), transcript.parent)
                known += m
                listOf(ChatEventDto.MessageUpdated(sid, info))
            }
            "session.step.ended", "session.step.failed" -> {
                val m = d.required("assistantMessageID"); tools.keys.removeAll { it.startsWith("$m:tool:") }
                message(m) + if (d.strings("files").isNotEmpty() && transcript.parent != null) updateDiff(transcript.parent!!) else emptyList()
            }
            "session.inbox.enqueued" -> {
                val id = d.required("inboxID"); val item = d.getValue("item").jsonObject
                if (item.str("type") != "user") return emptyList()
                queued += id
                val user = JsonObject(item.getValue("payload").jsonObject + fields("id" to id, "type" to "user") +
                    ("time" to buildJsonObject { put("created", e.getValue("created")) }))
                updates(SessionTranscript(sid).message(user)) + ChatEventDto.SessionQueueChanged(sid, queued.toList())
            }
            "session.inbox.delivered", "session.inbox.cancelled" -> {
                val id = d.required("inboxID"); if (!queued.remove(id)) return emptyList()
                val changes = if (type == "session.inbox.delivered") message(id) else if (known.remove(id)) listOf(ChatEventDto.MessageRemoved(sid, id)) else emptyList()
                changes + ChatEventDto.SessionQueueChanged(sid, queued.toList())
            }
            "session.renamed", "session.moved", "session.revert.staged", "session.revert.cleared" -> listOf(info())
            "session.revert.committed" -> snapshot()
            "session.compaction.ended" -> listOf(ChatEventDto.SessionCompacted(sid))
            "session.text.started", "session.text.delta", "session.text.ended", "session.reasoning.started", "session.reasoning.delta", "session.reasoning.ended" -> listOf(fragment(type, d))
            "session.tool.input.started", "session.tool.called", "session.tool.progress", "session.tool.success", "session.tool.failed" -> tool(type, d, e)
            else -> emptyList()
        }
    }

    private fun fragment(type: String, d: JsonObject): ChatEventDto {
        val kind = type.substringAfter('.').substringBefore('.')
        val m = d.required("assistantMessageID")
        val key = partID(m, kind, d.required("ordinal").toInt())
        return if (type.endsWith(".delta")) ChatEventDto.PartDelta(sid, m, key, "text", d.required("delta"))
            else ChatEventDto.PartUpdated(sid, PartDto(key, sid, m, kind, text = d.str("text").orEmpty()))
    }

    private suspend fun tool(type: String, d: JsonObject, e: JsonObject): List<ChatEventDto> {
        val m = d.required("assistantMessageID"); val call = d.required("id"); val key = partIDForTool(m, call)
        val part = when (type) {
            "session.tool.input.started" -> PartDto(key, sid, m, "tool", tool = d.required("name"), callID = call, state = "pending", time = PartTimeDto(e.str("created")?.toDouble()))
            "session.tool.called" -> tools[key]?.copy(state = "running", input = d.obj("input")?.flatten().orEmpty())
            "session.tool.progress" -> tools[key]?.copy(metadata = d.obj("metadata")?.flatten().orEmpty().let { meta ->
                meta["sessionID"]?.let { meta + ("sessionId" to it) } ?: meta })
            else -> null
        }
        if (part == null) {
            val projected = transcript.message(api().call("session.message.get", sessionPath(sid) + ("messageID" to m)).data().jsonObject)
                ?.parts?.find { it.id == key } ?: return emptyList()
            tools[key] = projected
            return buildList { add(ChatEventDto.PartUpdated(sid, projected)); if (projected.todos.isNotEmpty()) add(ChatEventDto.TodoUpdated(sid, projected.todos)) }
        }
        tools[key] = part
        return listOf(ChatEventDto.PartUpdated(sid, part))
    }

    private fun updates(message: MessageWithPartsDto?): List<ChatEventDto> {
        if (message == null) return emptyList()
        known += message.info.id
        return listOf(ChatEventDto.MessageUpdated(sid, message.info)) + message.parts.map { ChatEventDto.PartUpdated(sid, it) }
    }
    private suspend fun message(id: String): List<ChatEventDto> = updates(transcript.message(api().call("session.message.get", sessionPath(sid) + ("messageID" to id)).data().jsonObject))
    private suspend fun info() = ChatEventDto.SessionUpdated(sid, sessionDto(api().call("session.get", sessionPath(sid)).data().jsonObject))

    private suspend fun updateDiff(user: String): List<ChatEventDto> {
        val api = api()
        val files = turnDiff(api, sid, user) ?: return emptyList()
        val prompt = SessionTranscript(sid).message(api.call("session.message.get", sessionPath(sid) + ("messageID" to user)).data().jsonObject) ?: return emptyList()
        return listOf(ChatEventDto.MessageUpdated(sid, prompt.info.copy(summary = MessageSummaryDto(files))), ChatEventDto.SessionDiffChanged(sid, files))
    }

    private suspend fun snapshot(): List<ChatEventDto> {
        val api = api()
        val path = sessionPath(sid)
        transcript = SessionTranscript(sid); tools.clear()
        val previous = known.toSet(); known.clear()
        val history = history(api, sid, transcript, summaries = true)
        val pending = api.call("session.inbox.list", path).data().jsonArray.map { it.jsonObject }.filter { it.str("type") == "user" }
        queued = pending.mapTo(mutableSetOf()) { it.required("id") }
        val permissionList = api.call("session.permission.list", path).data().jsonArray.map { permissionDto(it.jsonObject) }
        val formList = api.call("session.form.list", path).data().jsonArray.map { formDto(it.jsonObject) }
        val active = sid in api.call("session.active").data().jsonObject
        return buildList {
            add(info()); add(ChatEventDto.SessionStatusChanged(sid, SessionStatusDto(if (active) "busy" else "idle")))
            history.forEach { m -> addAll(updates(m)); if (m.info.time.completed == null) m.parts.filter { it.type == "tool" }.forEach { tools[it.id] = it } }
            for (p in pending) {
                val raw = JsonObject(p.getValue("payload").jsonObject + fields("id" to p.required("id"), "type" to "user") + ("time" to p.getValue("time")))
                addAll(updates(SessionTranscript(sid).message(raw)))
            }
            (previous - known).forEach { add(ChatEventDto.MessageRemoved(sid, it)) }
            add(ChatEventDto.SessionQueueChanged(sid, queued.toList()))
            if (!active) when (transcript.idle?.str("outcome")) {
                "failed" -> {
                    transcript.idle?.obj("error")?.let { add(ChatEventDto.Error(sid, chatError(it))) }
                    add(ChatEventDto.TurnClose(sid, "error"))
                }
                "interrupted" -> add(ChatEventDto.TurnClose(sid, "interrupted"))
            }
            val oldPermissions = permissions; val oldForms = forms
            permissions = permissionList.mapTo(mutableSetOf()) { it.id }; forms = formList.mapTo(mutableSetOf()) { it.id }
            (oldPermissions - permissions).forEach { add(ChatEventDto.PermissionReplied(sid, it)) }
            (oldForms - forms).forEach { add(ChatEventDto.QuestionRejected(sid, it)) }
            permissionList.forEach { add(ChatEventDto.PermissionAsked(sid, it)) }; formList.forEach { add(ChatEventDto.QuestionAsked(sid, it)) }
        }
    }
}

internal suspend fun history(api: V2Client, id: String, transcript: SessionTranscript = SessionTranscript(id), summaries: Boolean = false): List<MessageWithPartsDto> {
    val result = mutableListOf<MessageWithPartsDto>()
    val changed = mutableSetOf<String>()
    var query = mapOf("order" to "asc", "limit" to "200")
    do {
        val page = api.call("session.message.list", sessionPath(id), query).jsonObject
        for (row in page.items("data")) {
            val message = transcript.message(row.jsonObject) ?: continue
            result.add(message)
            val parent = message.info.parentID
            if (summaries && parent != null && !row.jsonObject.obj("snapshot")?.items("files").isNullOrEmpty()) changed += parent
        }
        val next = page.obj("cursor")?.str("next") ?: break
        query = mapOf("cursor" to next, "limit" to "200")
    } while (true)
    return if (changed.isEmpty()) result else result.map { m ->
        val files = if (m.info.id in changed) turnDiff(api, id, m.info.id) else null
        if (files == null) m else m.copy(info = m.info.copy(summary = MessageSummaryDto(files)))
    }
}

private suspend fun turnDiff(api: V2Client, id: String, user: String): List<DiffFileDto>? = try {
    api.call("session.diff", sessionPath(id), mapOf("from" to user, "context" to "3")).data().jsonArray.map { diffDto(it.jsonObject) }
} catch (e: V2HttpException) {
    // A turn spanning a move has no coherent snapshot range. Its transcript is still readable.
    if (e.status == 400 || e.status == 404) null else throw e
}

internal fun activityEvents(type: String, d: JsonObject): List<ChatEventDto> {
    if (type == "form.created") { val form = formDto(d.getValue("form").jsonObject); return listOf(ChatEventDto.QuestionAsked(form.sessionID, form)) }
    val sid = d.str("sessionID") ?: return emptyList()
    return when (type) {
        "permission.asked" -> listOf(ChatEventDto.PermissionAsked(sid, permissionDto(d)))
        "permission.replied" -> listOf(ChatEventDto.PermissionReplied(sid, d.required("requestID")))
        "form.replied" -> listOf(ChatEventDto.QuestionReplied(sid, d.required("id")))
        "form.cancelled" -> listOf(ChatEventDto.QuestionRejected(sid, d.required("id")))
        "session.execution.started" -> listOf(ChatEventDto.TurnOpen(sid))
        "session.execution.failed" -> listOf(ChatEventDto.Error(sid, chatError(d.getValue("error").jsonObject)), ChatEventDto.TurnClose(sid, "error"))
        "session.execution.succeeded" -> listOf(ChatEventDto.TurnClose(sid, "completed"))
        "session.execution.interrupted" -> listOf(ChatEventDto.TurnClose(sid, d.str("reason").takeIf { it == "superseded" } ?: "interrupted"))
        "session.status" -> listOf(ChatEventDto.SessionStatusChanged(sid, statusDto(d.getValue("status").jsonObject)))
        "session.retry.scheduled" -> listOf(ChatEventDto.SessionStatusChanged(sid, SessionStatusDto("retry", d.obj("error")?.str("message"), d.str("attempt")?.toInt(), d.str("at")?.toLong())))
        else -> emptyList()
    }
}
