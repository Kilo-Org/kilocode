package ai.kilo.plugin.model

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

interface EventSchema<T : ServerEvent> {
    val wire: String
    fun deserialize(json: Json, properties: JsonObject): T?
}

sealed class ServerEvent {

    // Session events
    data class SessionCreated(val session: Session) : ServerEvent() {
        companion object : EventSchema<SessionCreated> {
            override val wire = "session.created"
            override fun deserialize(json: Json, properties: JsonObject): SessionCreated {
                val data = properties["info"]?.jsonObject ?: properties
                return SessionCreated(json.decodeFromJsonElement(data))
            }
        }
    }

    data class SessionUpdated(val session: Session) : ServerEvent() {
        companion object : EventSchema<SessionUpdated> {
            override val wire = "session.updated"
            override fun deserialize(json: Json, properties: JsonObject): SessionUpdated {
                val data = properties["info"]?.jsonObject ?: properties
                return SessionUpdated(json.decodeFromJsonElement(data))
            }
        }
    }

    data class SessionDeleted(val sessionId: String) : ServerEvent() {
        companion object : EventSchema<SessionDeleted> {
            override val wire = "session.deleted"
            override fun deserialize(json: Json, properties: JsonObject): SessionDeleted? {
                val sessionInfo = properties["info"]?.jsonObject ?: return null
                val sessionId = sessionInfo["id"]?.jsonPrimitive?.content ?: return null
                return SessionDeleted(sessionId)
            }
        }
    }

    data class SessionStatus(val sessionId: String, val status: ai.kilo.plugin.model.SessionStatus) : ServerEvent() {
        companion object : EventSchema<SessionStatus> {
            override val wire = "session.status"
            override fun deserialize(json: Json, properties: JsonObject): SessionStatus? {
                val sessionId = properties["sessionID"]?.jsonPrimitive?.content ?: return null
                val statusObj = properties["status"]?.jsonObject ?: return null
                val status = json.decodeFromJsonElement<ai.kilo.plugin.model.SessionStatus>(statusObj)
                return SessionStatus(sessionId, status)
            }
        }
    }

    data class SessionDiff(val sessionId: String, val diffs: List<FileDiff>) : ServerEvent() {
        companion object : EventSchema<SessionDiff> {
            override val wire = "session.diff"
            override fun deserialize(json: Json, properties: JsonObject): SessionDiff? {
                val sessionId = properties["sessionID"]?.jsonPrimitive?.content ?: return null
                val diffsJson = properties["diff"] ?: return null  // API uses "diff" not "diffs"
                val diffs = json.decodeFromJsonElement<List<FileDiff>>(diffsJson)
                return SessionDiff(sessionId, diffs)
            }
        }
    }

    // Message events
    data class MessageUpdated(val message: Message) : ServerEvent() {
        companion object : EventSchema<MessageUpdated> {
            override val wire = "message.updated"
            override fun deserialize(json: Json, properties: JsonObject): MessageUpdated {
                val data = properties["info"]?.jsonObject ?: properties
                return MessageUpdated(json.decodeFromJsonElement(data))
            }
        }
    }

    data class MessageRemoved(val sessionId: String, val messageId: String) : ServerEvent() {
        companion object : EventSchema<MessageRemoved> {
            override val wire = "message.removed"
            override fun deserialize(json: Json, properties: JsonObject): MessageRemoved? {
                val sessionId = properties["sessionID"]?.jsonPrimitive?.content ?: return null
                val messageId = properties["messageID"]?.jsonPrimitive?.content ?: return null
                return MessageRemoved(sessionId, messageId)
            }
        }
    }

    data class MessagePartUpdated(
        val sessionId: String,
        val messageId: String,
        val part: Part,
        val delta: String?
    ) : ServerEvent() {
        companion object : EventSchema<MessagePartUpdated> {
            override val wire = "message.part.updated"
            override fun deserialize(json: Json, properties: JsonObject): MessagePartUpdated? {
                val partJson = properties["part"]?.jsonObject ?: return null
                val part = json.decodeFromJsonElement<Part>(partJson)
                val delta = properties["delta"]?.jsonPrimitive?.content
                return MessagePartUpdated(part.sessionID, part.messageID, part, delta)
            }
        }
    }

    data class MessagePartRemoved(
        val sessionId: String,
        val messageId: String,
        val partId: String
    ) : ServerEvent() {
        companion object : EventSchema<MessagePartRemoved> {
            override val wire = "message.part.removed"
            override fun deserialize(json: Json, properties: JsonObject): MessagePartRemoved? {
                val sessionId = properties["sessionID"]?.jsonPrimitive?.content ?: return null
                val messageId = properties["messageID"]?.jsonPrimitive?.content ?: return null
                val partId = properties["partID"]?.jsonPrimitive?.content ?: return null
                return MessagePartRemoved(sessionId, messageId, partId)
            }
        }
    }

    // Permission events
    data class PermissionAsked(val request: PermissionRequest) : ServerEvent() {
        companion object : EventSchema<PermissionAsked> {
            override val wire = "permission.asked"
            override fun deserialize(json: Json, properties: JsonObject): PermissionAsked {
                return PermissionAsked(json.decodeFromJsonElement(properties))
            }
        }
    }

    data class PermissionReplied(val requestId: String, val reply: String) : ServerEvent() {
        companion object : EventSchema<PermissionReplied> {
            override val wire = "permission.replied"
            override fun deserialize(json: Json, properties: JsonObject): PermissionReplied? {
                val requestId = properties["requestID"]?.jsonPrimitive?.content ?: return null
                val reply = properties["reply"]?.jsonPrimitive?.content ?: return null
                return PermissionReplied(requestId, reply)
            }
        }
    }

    // Question events
    data class QuestionAsked(val request: QuestionRequest) : ServerEvent() {
        companion object : EventSchema<QuestionAsked> {
            override val wire = "question.asked"
            override fun deserialize(json: Json, properties: JsonObject): QuestionAsked {
                return QuestionAsked(json.decodeFromJsonElement(properties))
            }
        }
    }

    data class QuestionReplied(val requestId: String, val answers: List<List<String>>) : ServerEvent() {
        companion object : EventSchema<QuestionReplied> {
            override val wire = "question.replied"
            override fun deserialize(json: Json, properties: JsonObject): QuestionReplied? {
                val requestId = properties["requestID"]?.jsonPrimitive?.content ?: return null
                val answersJson = properties["answers"] ?: return null
                val answers = json.decodeFromJsonElement<List<List<String>>>(answersJson)
                return QuestionReplied(requestId, answers)
            }
        }
    }

    data class QuestionRejected(val requestId: String) : ServerEvent() {
        companion object : EventSchema<QuestionRejected> {
            override val wire = "question.rejected"
            override fun deserialize(json: Json, properties: JsonObject): QuestionRejected? {
                val requestId = properties["requestID"]?.jsonPrimitive?.content ?: return null
                return QuestionRejected(requestId)
            }
        }
    }

    // Todo events
    data class TodoUpdated(val sessionId: String, val todos: List<Todo>) : ServerEvent() {
        companion object : EventSchema<TodoUpdated> {
            override val wire = "todo.updated"
            override fun deserialize(json: Json, properties: JsonObject): TodoUpdated? {
                val sessionId = properties["sessionID"]?.jsonPrimitive?.content ?: return null
                val todosJson = properties["todos"] ?: return null
                val todos = json.decodeFromJsonElement<List<Todo>>(todosJson)
                return TodoUpdated(sessionId, todos)
            }
        }
    }

    // VCS events
    data class VcsBranchUpdated(val branch: String) : ServerEvent() {
        companion object : EventSchema<VcsBranchUpdated> {
            override val wire = "vcs.branch.updated"
            override fun deserialize(json: Json, properties: JsonObject): VcsBranchUpdated? {
                val branch = properties["branch"]?.jsonPrimitive?.content ?: return null
                return VcsBranchUpdated(branch)
            }
        }
    }

    // Unknown/ignored events
    data class Unknown(val wire: String) : ServerEvent()

    companion object {
        private val schemas: List<EventSchema<*>> = listOf(
            SessionCreated, SessionUpdated, SessionDeleted, SessionStatus, SessionDiff,
            MessageUpdated, MessageRemoved, MessagePartUpdated, MessagePartRemoved,
            PermissionAsked, PermissionReplied,
            QuestionAsked, QuestionReplied, QuestionRejected,
            TodoUpdated,
            VcsBranchUpdated
        )

        private val registry: Map<String, EventSchema<*>> = schemas.associateBy { it.wire }

        // Known but ignored event types
        private val ignored = setOf(
            "server.connected", "server.heartbeat", "server.instance.disposed",
            "global.disposed", "session.error", "session.idle", "session.compacted",
            "file.edited", "file.updated", "project.updated"
        )

        fun fromJson(json: Json, wire: String, properties: JsonObject): ServerEvent? {
            if (wire in ignored) return null
            val schema = registry[wire] ?: return Unknown(wire)
            return schema.deserialize(json, properties)
        }
    }
}
