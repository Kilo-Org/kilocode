package ai.kilocode.backend.agentmanager

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * Wire types and (de)serialization for the CLI's `agent_manager` orchestration protocol.
 *
 * Deliberately **not** `shared/` `@Serializable` DTOs: these are parsed from raw SSE JSON and built
 * into raw HTTP bodies entirely inside `backend`, so there is no shared-serializer classloader risk
 * to design around (see the JetBrains architecture skill) — plain `JsonObject` round-tripping is
 * simplest and matches [ai.kilocode.backend.cli.KiloCliDataParser]'s own style for payloads this
 * shape-sensitive.
 *
 * Source of truth for every field and limit here: `packages/opencode/src/kilocode/agent-manager/
 * protocol.ts` and `event.ts` in the main repo. Keep this file's shape in lockstep with that one.
 */
internal object AgentManagerProtocol {
    const val REQUESTED_EVENT = "kilocode.agent_manager.requested"
    const val CANCELLED_EVENT = "kilocode.agent_manager.cancelled"
    const val START_EVENT = "kilocode.agent_manager.start"

    /** One of the five request/reply operations the CLI's `agent_manager` tool can issue. */
    sealed interface Request {
        val id: String
        val sessionID: String

        data class Overview(
            override val id: String,
            override val sessionID: String,
            val sectionIDs: List<String>?,
            val states: List<String>?,
        ) : Request

        data class Prompt(
            override val id: String,
            override val sessionID: String,
            val targetSessionID: String,
            val sourceSessionID: String?,
            val prompt: String,
            val replyTo: String?,
        ) : Request

        data class Stop(
            override val id: String,
            override val sessionID: String,
            val targetSessionID: String,
        ) : Request

        data class Move(
            override val id: String,
            override val sessionID: String,
            val targetSessionID: String,
            val sectionID: String?,
        ) : Request

        data class Answer(
            override val id: String,
            override val sessionID: String,
            val targetSessionID: String,
            val questionID: String?,
            val answers: List<List<String>>,
        ) : Request
    }

    data class Cancelled(val requestID: String, val sessionID: String)

    data class StartTask(
        val prompt: String?,
        val name: String?,
        val branchName: String?,
        val providerID: String?,
        val modelID: String?,
        val variant: String?,
    )

    data class Start(
        val requestID: String,
        val sessionID: String,
        val sandboxInheritanceToken: String?,
        val mode: String,
        val worktreeID: String?,
        val versions: Boolean?,
        val tasks: List<StartTask>,
    )

    /** `GET /kilocode/agent-manager` returns a bare JSON array of pending requests. */
    fun parsePendingRequests(raw: String): List<Request> {
        val array = tryParseArray(raw) ?: return emptyList()
        return array.mapNotNull { element ->
            runCatching { parseRequest(element.jsonObject) }.getOrNull()
        }
    }

    /**
     * Parses one SSE event body into a [Request]/[Cancelled]/[Start], or null when [type] is not one
     * of the three `kilocode.agent_manager.*` event types this host handles, or the body does not
     * decode. The SSE `data` is the whole `GlobalEvent` envelope — `{directory, payload:{type,
     * properties}}` — exactly like [ai.kilocode.backend.cli.KiloCliDataParser.parseChatEvent] already
     * unwraps; [envelopeDirectory] reads the directory the same way.
     */
    fun parseRequest(type: String, data: String): Request? {
        if (type != REQUESTED_EVENT) return null
        val obj = tryParseObject(data) ?: return null
        val props = obj["payload"]?.jsonObject?.get("properties")?.jsonObject ?: obj["properties"]?.jsonObject ?: return null
        return runCatching { parseRequest(props) }.getOrNull()
    }

    fun parseCancelled(type: String, data: String): Cancelled? {
        if (type != CANCELLED_EVENT) return null
        val obj = tryParseObject(data) ?: return null
        val props = obj["payload"]?.jsonObject?.get("properties")?.jsonObject ?: obj["properties"]?.jsonObject ?: return null
        val requestID = props.str("requestID") ?: return null
        val sessionID = props.str("sessionID") ?: return null
        return Cancelled(requestID, sessionID)
    }

    fun parseStart(type: String, data: String): Start? {
        if (type != START_EVENT) return null
        val obj = tryParseObject(data) ?: return null
        val props = obj["payload"]?.jsonObject?.get("properties")?.jsonObject ?: obj["properties"]?.jsonObject ?: return null
        val requestID = props.str("requestID") ?: return null
        val sessionID = props.str("sessionID") ?: return null
        val mode = props.str("mode") ?: return null
        val tasks = props["tasks"]?.jsonArray?.mapNotNull { element ->
            val task = element as? JsonObject ?: return@mapNotNull null
            val model = task["model"]?.jsonObject
            StartTask(
                prompt = task.str("prompt"),
                name = task.str("name"),
                branchName = task.str("branchName"),
                providerID = model?.str("providerID"),
                modelID = model?.str("modelID"),
                variant = task.str("variant"),
            )
        } ?: emptyList()
        if (tasks.isEmpty()) return null
        return Start(
            requestID = requestID,
            sessionID = sessionID,
            sandboxInheritanceToken = props.str("sandboxInheritanceToken"),
            mode = mode,
            worktreeID = props.str("worktreeID"),
            versions = props["versions"]?.jsonPrimitive?.contentOrNull?.toBooleanStrictOrNull(),
            tasks = tasks,
        )
    }

    /** Reads the `directory` field of the `GlobalEvent` envelope wrapping an SSE payload. */
    fun envelopeDirectory(data: String): String? = tryParseObject(data)?.str("directory")

    private fun parseRequest(obj: JsonObject): Request {
        val id = obj.str("id") ?: error("agent_manager request missing id")
        val sessionID = obj.str("sessionID") ?: error("agent_manager request missing sessionID")
        return when (val operation = obj.str("operation")) {
            "overview" -> {
                val filter = obj["filter"]?.jsonObject
                Request.Overview(
                    id = id,
                    sessionID = sessionID,
                    sectionIDs = filter?.get("sectionIDs")?.jsonArray?.mapNotNull { it.jsonPrimitive.contentOrNull },
                    states = filter?.get("states")?.jsonArray?.mapNotNull { it.jsonPrimitive.contentOrNull },
                )
            }
            "prompt" -> Request.Prompt(
                id = id,
                sessionID = sessionID,
                targetSessionID = obj.str("targetSessionID") ?: error("prompt request missing targetSessionID"),
                sourceSessionID = obj.str("sourceSessionID"),
                prompt = obj.str("prompt") ?: error("prompt request missing prompt"),
                replyTo = obj.str("replyTo"),
            )
            "stop" -> Request.Stop(
                id = id,
                sessionID = sessionID,
                targetSessionID = obj.str("targetSessionID") ?: error("stop request missing targetSessionID"),
            )
            "move" -> Request.Move(
                id = id,
                sessionID = sessionID,
                targetSessionID = obj.str("targetSessionID") ?: error("move request missing targetSessionID"),
                sectionID = obj["sectionID"]?.jsonPrimitive?.contentOrNull,
            )
            "answer" -> Request.Answer(
                id = id,
                sessionID = sessionID,
                targetSessionID = obj.str("targetSessionID") ?: error("answer request missing targetSessionID"),
                questionID = obj.str("questionID"),
                answers = obj["answers"]?.jsonArray?.map { row ->
                    row.jsonArray.map { it.jsonPrimitive.contentOrNull.orEmpty() }
                } ?: error("answer request missing answers"),
            )
            else -> error("unknown agent_manager operation: $operation")
        }
    }

    // ---- reply/reject bodies ----

    fun replyBody(request: Request.Overview, overview: JsonObject): String =
        buildJsonObject {
            put("result", buildJsonObject {
                put("operation", "overview")
                put("overview", overview)
            })
        }.toString()

    fun replyBody(request: Request.Prompt): String =
        buildJsonObject {
            put("result", buildJsonObject {
                put("operation", "prompt")
                put("sessionID", request.targetSessionID)
                put("delivered", true)
            })
        }.toString()

    fun replyBody(request: Request.Stop): String =
        buildJsonObject {
            put("result", buildJsonObject {
                put("operation", "stop")
                put("sessionID", request.targetSessionID)
                put("stopped", true)
            })
        }.toString()

    fun replyBody(request: Request.Answer, questionID: String): String =
        buildJsonObject {
            put("result", buildJsonObject {
                put("operation", "answer")
                put("sessionID", request.targetSessionID)
                put("questionID", questionID)
                put("resolved", true)
            })
        }.toString()

    /** `move` is always rejected — see [rejectBody] with [ErrorCode.UNKNOWN_SECTION]. */

    fun rejectBody(code: ErrorCode, message: String): String =
        buildJsonObject {
            put("error", buildJsonObject {
                put("code", code.wire)
                put("message", message)
            })
        }.toString()

    enum class ErrorCode(val wire: String) {
        CANCELLED("cancelled"),
        CROSS_WORKSPACE("cross_workspace"),
        DISCONNECTED("disconnected"),
        HOST_ERROR("host_error"),
        STALE_SESSION("stale_session"),
        TIMEOUT("timeout"),
        UNAVAILABLE_SESSION("unavailable_session"),
        UNKNOWN_SECTION("unknown_section"),
        UNKNOWN_SESSION("unknown_session"),
        WORKSPACE_UNAVAILABLE("workspace_unavailable"),
    }

    /** Thrown by dispatch/overview/starter code to reject a request with a specific [code]. */
    class RequestFailure(val code: ErrorCode, message: String) : Exception(message)

    private val json = Json { ignoreUnknownKeys = true }

    private fun tryParseObject(raw: String): JsonObject? =
        try { json.parseToJsonElement(raw).jsonObject } catch (_: Exception) { null }

    private fun tryParseArray(raw: String): JsonArray? =
        try { json.parseToJsonElement(raw).jsonArray } catch (_: Exception) { null }

    private fun JsonObject.str(key: String): String? = this[key]?.jsonPrimitive?.contentOrNull
}
