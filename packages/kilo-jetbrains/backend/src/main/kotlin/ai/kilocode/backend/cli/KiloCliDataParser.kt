package ai.kilocode.backend.cli

import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.CloudSessionDto
import ai.kilocode.rpc.dto.CloudSessionListDto
import ai.kilocode.rpc.dto.ConfigUpdateDto
import ai.kilocode.rpc.dto.DiffFileDto
import ai.kilocode.rpc.dto.MessageDto
import ai.kilocode.rpc.dto.MessageErrorDto
import ai.kilocode.rpc.dto.MessageTimeDto
import ai.kilocode.rpc.dto.MessageWithPartsDto
import ai.kilocode.rpc.dto.ModelSelectionDto
import ai.kilocode.rpc.dto.ModelStateDto
import ai.kilocode.rpc.dto.PartDto
import ai.kilocode.rpc.dto.PermissionAlwaysRulesDto
import ai.kilocode.rpc.dto.PermissionReplyDto
import ai.kilocode.rpc.dto.PermissionRequestDto
import ai.kilocode.rpc.dto.PartTimeDto
import ai.kilocode.rpc.dto.PromptDto
import ai.kilocode.rpc.dto.QuestionInfoDto
import ai.kilocode.rpc.dto.QuestionOptionDto
import ai.kilocode.rpc.dto.QuestionReplyDto
import ai.kilocode.rpc.dto.QuestionRequestDto
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.SessionStatusDto
import ai.kilocode.rpc.dto.SessionSummaryDto
import ai.kilocode.rpc.dto.SessionTimeDto
import ai.kilocode.rpc.dto.TodoDto
import ai.kilocode.rpc.dto.TokensDto
import ai.kilocode.rpc.dto.ToolRefDto
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import java.util.concurrent.ConcurrentHashMap

/**
 * Stateless parser that centralizes all CLI server response parsing.
 *
 * Callers pass raw JSON strings (SSE event data, HTTP response bodies)
 * and get typed DTOs back. All JSON navigation, regex extraction, and
 * manual serialization is contained here — no caller needs to know
 * about [JsonObject] or kotlinx.serialization.
 *
 * Designed for testability: every public method is pure (no side effects,
 * no dependencies). When a new parsing bug is found, add a test case
 * with the raw JSON that caused the issue.
 */
object KiloCliDataParser {

    private val json = Json { ignoreUnknownKeys = true }
    private val pretty = Json { ignoreUnknownKeys = true; prettyPrint = true }
    private val TYPE_REGEX = Regex(""""type"\s*:\s*"([^"]+)"""")
    private val FIELD_RE = ConcurrentHashMap<String, Regex>()

    // ================================================================
    // SSE event parsing
    // ================================================================

    /**
     * Extract the event type from raw SSE JSON data.
     * Used as a fallback when OkHttp's EventSourceListener receives a null type.
     */
    fun extractEventType(data: String): String =
        TYPE_REGEX.find(data)?.groupValues?.get(1) ?: "unknown"

    /**
     * Parse an SSE chat event into a [ChatEventDto].
     * Returns null if the event type is unrecognized or the JSON is malformed.
     *
     * Handles the GlobalEvent wrapper: `{ directory, payload: { type, properties } }`
     * as well as flat events with top-level `properties`.
     */
    fun parseChatEvent(type: String, data: String): ChatEventDto? {
        val obj = tryParseObject(data) ?: return null

        // SSE data is a GlobalEvent: { directory, payload: { type, properties } }
        val payload = obj["payload"]?.jsonObject ?: obj
        val props = payload["properties"]?.jsonObject ?: return null

        return when (type) {
            "message.updated" -> {
                val sid = props.str("sessionID") ?: return null
                val info = props["info"]?.jsonObject ?: return null
                ChatEventDto.MessageUpdated(sid, parseMessage(info))
            }

            "message.removed" -> {
                val sid = props.str("sessionID") ?: return null
                val mid = props.str("messageID") ?: return null
                ChatEventDto.MessageRemoved(sid, mid)
            }

            "message.part.updated" -> {
                val sid = props.str("sessionID") ?: return null
                val part = props["part"]?.jsonObject ?: return null
                ChatEventDto.PartUpdated(sid, parsePart(part))
            }

            "message.part.delta" -> {
                val sid = props.str("sessionID") ?: return null
                val mid = props.str("messageID") ?: return null
                val pid = props.str("partID") ?: return null
                val field = props.str("field") ?: return null
                val delta = props.str("delta") ?: return null
                ChatEventDto.PartDelta(sid, mid, pid, field, delta)
            }

            "session.turn.open" -> {
                val sid = props.str("sessionID") ?: return null
                ChatEventDto.TurnOpen(sid)
            }

            "session.turn.close" -> {
                val sid = props.str("sessionID") ?: return null
                val reason = props.str("reason") ?: "completed"
                ChatEventDto.TurnClose(sid, reason)
            }

            "session.error" -> {
                val sid = props.str("sessionID")
                val err = props["error"]?.jsonObject?.let { parseError(it) }
                ChatEventDto.Error(sid, err)
            }

            "permission.asked" -> {
                val sid = props.str("sessionID") ?: return null
                val request = parsePermissionRequest(props) ?: return null
                ChatEventDto.PermissionAsked(sid, request)
            }

            "permission.replied" -> {
                val sid = props.str("sessionID") ?: return null
                val rid = props.str("requestID") ?: return null
                ChatEventDto.PermissionReplied(sid, rid)
            }

            "question.asked" -> {
                val sid = props.str("sessionID") ?: return null
                val request = parseQuestionRequest(props) ?: return null
                ChatEventDto.QuestionAsked(sid, request)
            }

            "question.replied" -> {
                val sid = props.str("sessionID") ?: return null
                val rid = props.str("requestID") ?: return null
                ChatEventDto.QuestionReplied(sid, rid)
            }

            "question.rejected" -> {
                val sid = props.str("sessionID") ?: return null
                val rid = props.str("requestID") ?: return null
                ChatEventDto.QuestionRejected(sid, rid)
            }

            "message.part.removed" -> {
                val sid = props.str("sessionID") ?: return null
                val mid = props.str("messageID") ?: return null
                val pid = props.str("partID") ?: return null
                ChatEventDto.PartRemoved(sid, mid, pid)
            }

            "session.status" -> {
                val sid = props.str("sessionID") ?: return null
                val st = props["status"]?.jsonObject ?: return null
                val dto = parseStatus(st)
                ChatEventDto.SessionStatusChanged(sid, dto)
            }

            "session.updated" -> {
                val info = props["info"]?.jsonObject ?: return null
                val dto = parseSessionObject(info)
                val sid = props.str("sessionID") ?: dto.id.takeIf { it.isNotBlank() } ?: return null
                ChatEventDto.SessionUpdated(sid, dto)
            }

            "session.idle" -> {
                val sid = props.str("sessionID") ?: return null
                ChatEventDto.SessionIdle(sid)
            }

            "session.compacted" -> {
                val sid = props.str("sessionID") ?: return null
                ChatEventDto.SessionCompacted(sid)
            }

            "session.diff" -> {
                val sid = props.str("sessionID") ?: return null
                val diffs = props["diff"]?.jsonArray?.mapNotNull { elem ->
                    val d = elem.jsonObject
                    val file = d.str("file") ?: return@mapNotNull null
                    DiffFileDto(
                        file = file,
                        additions = d.long("additions")?.safeInt() ?: 0,
                        deletions = d.long("deletions")?.safeInt() ?: 0,
                        patch = d.str("patch"),
                    )
                } ?: emptyList()
                ChatEventDto.SessionDiffChanged(sid, diffs)
            }

            "todo.updated" -> {
                val sid = props.str("sessionID") ?: return null
                val todos = props["todos"]?.jsonArray?.map { elem ->
                    val t = elem.jsonObject
                    TodoDto(
                        content = t.str("content") ?: "",
                        status = t.str("status") ?: "pending",
                        priority = t.str("priority") ?: "medium",
                    )
                } ?: emptyList()
                ChatEventDto.TodoUpdated(sid, todos)
            }

            else -> null
        }
    }

    /**
     * Parse an SSE `session.status` event into a (sessionID, [SessionStatusDto]) pair.
     * Returns null if the required fields are missing.
     */
    fun parseSessionStatus(data: String): Pair<String, SessionStatusDto>? {
        val obj = tryParseObject(data) ?: return null
        val payload = obj["payload"]?.jsonObject ?: obj
        val props = payload["properties"]?.jsonObject ?: obj
        val id = props.str("sessionID") ?: return null
        val st = props["status"]?.jsonObject ?: return id to SessionStatusDto("idle")
        return id to parseStatus(st)
    }

    // ================================================================
    // HTTP response parsing
    // ================================================================

    /**
     * Parse a session creation response (`POST /session`) into [SessionDto].
     */
    fun parseSession(raw: String): SessionDto {
        val obj = json.parseToJsonElement(raw).jsonObject
        return parseSessionObject(obj)
    }

    /**
     * Parse message history response (`GET /session/{id}/message`)
     * into a list of messages with their parts.
     */
    fun parseMessages(raw: String): List<MessageWithPartsDto> {
        val arr = tryParseArray(raw) ?: return emptyList()
        return arr.mapNotNull { elem ->
            val obj = elem.jsonObject
            val info = obj["info"]?.jsonObject ?: return@mapNotNull null
            val parts = obj["parts"]?.jsonArray ?: JsonArray(emptyList())
            MessageWithPartsDto(
                info = parseMessage(info),
                parts = parts.map { parsePart(it.jsonObject) },
            )
        }
    }

    fun parseCloudSessions(raw: String): CloudSessionListDto {
        val obj = tryParseObject(raw) ?: return CloudSessionListDto(emptyList())
        val items = obj["cliSessions"]?.jsonArray ?: JsonArray(emptyList())
        val sessions = items.mapNotNull { elem ->
            val item = runCatching { elem.jsonObject }.getOrNull() ?: return@mapNotNull null
            CloudSessionDto(
                id = item.str("session_id") ?: return@mapNotNull null,
                title = item.str("title"),
                createdAt = item.str("created_at") ?: return@mapNotNull null,
                updatedAt = item.str("updated_at") ?: return@mapNotNull null,
                version = item.num("version") ?: return@mapNotNull null,
            )
        }
        return CloudSessionListDto(
            sessions = sessions,
            nextCursor = obj.str("nextCursor"),
        )
    }

    fun parseModelState(raw: String): ModelStateDto {
        val obj = tryParseObject(raw) ?: return ModelStateDto()
        return ModelStateDto(
            favorite = parseModelFavorites(obj["favorite"]),
            model = parseModelSelections(obj["model"]),
            variant = parseModelVariants(obj["variant"]),
            recent = parseModelFavorites(obj["recent"]),
        )
    }

    fun buildModelStateJson(raw: String?, favorite: List<ModelSelectionDto>): String {
        val state = parseModelState(raw.orEmpty()).copy(favorite = favorite)
        return buildModelStateJson(raw, state)
    }

    fun buildModelStateJson(raw: String?, state: ModelStateDto): String {
        val data = raw
            ?.takeIf { it.isNotBlank() }
            ?.let(::tryParseObject)
            ?.toMutableMap()
            ?: mutableMapOf()
        data["favorite"] = JsonArray(state.favorite.map(::modelSelection))
        data["model"] = JsonObject(state.model.mapValues { (_, value) -> modelSelection(value) })
        data["variant"] = JsonObject(state.variant.mapValues { (_, value) -> JsonPrimitive(value) })
        data["recent"] = JsonArray(state.recent.map(::modelSelection))
        return pretty.encodeToString(JsonObject.serializer(), JsonObject(data))
    }

    // ================================================================
    // JSON serialization (DTO → JSON for outgoing requests)
    // ================================================================

    /**
     * Build the JSON body for `POST /session/{id}/prompt_async`.
     */
    fun buildPromptJson(prompt: PromptDto): String {
        val parts = prompt.parts.joinToString(",") { part ->
            """{"type":"${part.type}","text":${escape(part.text)}}"""
        }
        val sb = StringBuilder()
        sb.append("""{"parts":[$parts]""")
        val pid = prompt.providerID
        val mid = prompt.modelID
        if (pid != null && mid != null) {
            sb.append(""","model":{"providerID":${escape(pid)},"modelID":${escape(mid)}}""")
        }
        val ag = prompt.agent
        if (ag != null) {
            sb.append(""","agent":${escape(ag)}""")
        }
        val variant = prompt.variant
        if (variant != null) {
            sb.append(""","variant":${escape(variant)}""")
        }
        sb.append("}")
        return sb.toString()
    }

    /**
     * Build the JSON body for `POST /session/{id}/summarize`.
     */
    fun buildSummarizeJson(model: ModelSelectionDto): String =
        """{"providerID":${escape(model.providerID)},"modelID":${escape(model.modelID)}}"""

    /**
     * Build the partial JSON body for `PATCH /global/config`.
     */
    fun buildConfigPartial(update: ConfigUpdateDto): String {
        val sb = StringBuilder("{")
        var first = true
        fun sep() { if (!first) sb.append(","); first = false }

        val model = update.model
        if (model != null) {
            sep(); sb.append(""""model":${escape(model)}""")
        }
        val agent = update.agent
        if (agent != null) {
            sep(); sb.append(""""default_agent":${escape(agent)}""")
        }
        val temp = update.temperature
        if (temp != null) {
            val target = agent ?: "ask"
            sep(); sb.append(""""agent":{"$target":{"temperature":$temp}}""")
        }
        sb.append("}")
        return sb.toString()
    }

    // ================================================================
    // Internal — message/part/session parsing
    // ================================================================

    internal fun parseMessage(obj: JsonObject): MessageDto {
        val time = obj["time"]?.jsonObject
        val tokens = obj["tokens"]?.jsonObject
        val error = obj["error"]?.jsonObject

        return MessageDto(
            id = obj.str("id") ?: "",
            sessionID = obj.str("sessionID") ?: "",
            role = obj.str("role") ?: "unknown",
            time = MessageTimeDto(
                created = time?.num("created") ?: 0.0,
                completed = time?.num("completed"),
            ),
            agent = obj.str("agent"),
            providerID = obj.str("providerID"),
            modelID = obj.str("modelID"),
            parentID = obj.str("parentID"),
            cost = obj.num("cost"),
            tokens = tokens?.let(::parseTokens),
            error = error?.let { parseError(it) },
        )
    }

    internal fun parsePart(obj: JsonObject): PartDto {
        val state = obj["state"]?.jsonObject
        val tokens = obj["tokens"]?.jsonObject
        val top = obj.map("metadata")
        val meta = state.map("metadata") + top
        return PartDto(
            id = obj.str("id") ?: "",
            sessionID = obj.str("sessionID") ?: "",
            messageID = obj.str("messageID") ?: "",
            type = obj.str("type") ?: "unknown",
            text = obj.str("text"),
            tool = obj.str("tool"),
            callID = obj.str("callID"),
            state = state?.str("status"),
            title = state?.str("title"),
            input = state.map("input"),
            metadata = meta,
            output = state?.str("output"),
            error = state?.str("error"),
            time = obj.time("time") ?: state.time("time"),
            reason = obj.str("reason"),
            cost = obj.num("cost"),
            tokens = tokens?.let(::parseTokens),
        )
    }

    private fun parseTokens(obj: JsonObject): TokensDto {
        val cache = obj["cache"]?.jsonObject
        return TokensDto(
            input = obj.long("input") ?: 0,
            output = obj.long("output") ?: 0,
            reasoning = obj.long("reasoning") ?: 0,
            cacheRead = cache?.long("read") ?: 0,
            cacheWrite = cache?.long("write") ?: 0,
        )
    }

    internal fun parseError(obj: JsonObject): MessageErrorDto {
        val type = obj.str("type") ?: obj.str("name") ?: "unknown"
        val msg = obj.str("message")
            ?: obj["data"]?.jsonObject?.str("message")
            ?: obj.str("error")
        return MessageErrorDto(type, msg)
    }

    internal fun parsePermissionRequest(obj: JsonObject): PermissionRequestDto? {
        val id = obj.str("id") ?: return null
        val sid = obj.str("sessionID") ?: return null
        val permission = obj.str("permission") ?: return null
        val patterns = obj["patterns"]?.jsonArray?.mapNotNull { it.jsonPrimitive.contentOrNull } ?: emptyList()
        val always = obj["always"]?.jsonArray?.mapNotNull { it.jsonPrimitive.contentOrNull } ?: emptyList()
        val meta = obj["metadata"]?.jsonObject?.let { m ->
            m.entries.associate { (k, v) -> k to (v.jsonPrimitive.contentOrNull ?: "") }
        } ?: emptyMap()
        val ref = toolRef(obj)
        return PermissionRequestDto(id, sid, permission, patterns, meta, always, ref)
    }

    internal fun parseQuestionRequest(obj: JsonObject): QuestionRequestDto? {
        val id = obj.str("id") ?: return null
        val sid = obj.str("sessionID") ?: return null
        val questions = obj["questions"]?.jsonArray?.map { q ->
            val qo = q.jsonObject
            val options = qo["options"]?.jsonArray?.map { o ->
                val oo = o.jsonObject
                QuestionOptionDto(oo.str("label") ?: "", oo.str("description") ?: "")
            } ?: emptyList()
            QuestionInfoDto(
                question = qo.str("question") ?: "",
                header = qo.str("header") ?: "",
                options = options,
                multiple = qo.str("multiple") == "true",
                custom = qo.str("custom") != "false",
            )
        } ?: emptyList()
        val ref = toolRef(obj)
        return QuestionRequestDto(id, sid, questions, ref)
    }

    internal fun parseModelFavorites(raw: JsonElement?): List<ModelSelectionDto> {
        val array = runCatching { raw?.jsonArray }.getOrNull() ?: return emptyList()
        return array.mapNotNull { elem ->
            val obj = runCatching { elem.jsonObject }.getOrNull() ?: return@mapNotNull null
            val pid = obj.str("providerID") ?: return@mapNotNull null
            val mid = obj.str("modelID") ?: return@mapNotNull null
            ModelSelectionDto(pid, mid)
        }
    }

    internal fun parseModelSelections(raw: JsonElement?): Map<String, ModelSelectionDto> {
        val obj = runCatching { raw?.jsonObject }.getOrNull() ?: return emptyMap()
        return obj.entries.mapNotNull { (name, elem) ->
            if (name.isBlank()) return@mapNotNull null
            val item = runCatching { elem.jsonObject }.getOrNull() ?: return@mapNotNull null
            val pid = item.str("providerID") ?: return@mapNotNull null
            val mid = item.str("modelID") ?: return@mapNotNull null
            name to ModelSelectionDto(pid, mid)
        }.toMap()
    }

    internal fun parseModelVariants(raw: JsonElement?): Map<String, String> {
        val obj = runCatching { raw?.jsonObject }.getOrNull() ?: return emptyMap()
        return obj.entries.mapNotNull { (key, elem) ->
            if (key.isBlank()) return@mapNotNull null
            val prim = runCatching { elem.jsonPrimitive }.getOrNull() ?: return@mapNotNull null
            if (!prim.isString) return@mapNotNull null
            val value = prim.contentOrNull
                ?.takeIf { it.isNotBlank() }
                ?: return@mapNotNull null
            key to value
        }.toMap()
    }

    private fun modelSelection(item: ModelSelectionDto) = JsonObject(mapOf(
        "providerID" to JsonPrimitive(item.providerID),
        "modelID" to JsonPrimitive(item.modelID),
    ))

    private fun parseSessionObject(obj: JsonObject): SessionDto {
        val time = obj["time"]?.jsonObject
        val summary = obj["summary"]?.jsonObject
        return SessionDto(
            id = obj.str("id") ?: "",
            projectID = obj.str("projectID") ?: "",
            directory = obj.str("directory") ?: "",
            parentID = obj.str("parentID"),
            title = obj.str("title") ?: "",
            version = obj.str("version") ?: "",
            time = SessionTimeDto(
                created = time?.num("created") ?: 0.0,
                updated = time?.num("updated") ?: 0.0,
                archived = time?.num("archived"),
            ),
            summary = summary?.let {
                SessionSummaryDto(
                    additions = it.long("additions")?.safeInt() ?: 0,
                    deletions = it.long("deletions")?.safeInt() ?: 0,
                    files = it.long("files")?.safeInt() ?: 0,
                )
            },
        )
    }

    // ================================================================
    // Internal — status parsing
    // ================================================================

    /** Safely parse an optional tool reference, handling `null` JSON values. */
    private fun toolRef(obj: JsonObject): ToolRefDto? {
        val elem = obj["tool"] ?: return null
        if (elem is JsonNull) return null
        val t = elem.jsonObject
        val mid = t.str("messageID") ?: return null
        val cid = t.str("callID") ?: return null
        return ToolRefDto(mid, cid)
    }

    internal fun parseStatus(st: JsonObject): SessionStatusDto {
        val type = st.str("type") ?: "idle"
        return SessionStatusDto(
            type = type,
            message = st.str("message"),
            attempt = st.long("attempt")?.safeInt(),
            next = st.long("next"),
            requestID = st.str("requestID"),
        )
    }

    // ================================================================
    // HTTP response parsing — lists
    // ================================================================

    /**
     * Parse a list of pending permission requests (`GET /permission`).
     */
    fun parsePermissionRequests(raw: String): List<PermissionRequestDto> {
        val arr = tryParseArray(raw) ?: return emptyList()
        return arr.mapNotNull { elem ->
            parsePermissionRequest(elem.jsonObject)
        }
    }

    /**
     * Parse a list of pending question requests (`GET /question`).
     */
    fun parseQuestionRequests(raw: String): List<QuestionRequestDto> {
        val arr = tryParseArray(raw) ?: return emptyList()
        return arr.mapNotNull { elem ->
            parseQuestionRequest(elem.jsonObject)
        }
    }

    // ================================================================
    // JSON serialization (DTO → JSON for outgoing permission/question requests)
    // ================================================================

    /**
     * Build the JSON body for `POST /permission/{requestID}/reply`.
     */
    fun buildPermissionReplyJson(reply: PermissionReplyDto): String {
        val sb = StringBuilder()
        sb.append("""{"reply":${escape(reply.reply)}""")
        val msg = reply.message
        if (msg != null) sb.append(""","message":${escape(msg)}""")
        sb.append("}")
        return sb.toString()
    }

    /**
     * Build the JSON body for `POST /permission/{requestID}/always-rules`.
     */
    fun buildPermissionAlwaysRulesJson(rules: PermissionAlwaysRulesDto): String {
        val approved = rules.approvedAlways.joinToString(",") { escape(it) }
        val denied = rules.deniedAlways.joinToString(",") { escape(it) }
        return """{"approvedAlways":[$approved],"deniedAlways":[$denied]}"""
    }

    /**
     * Build the JSON body for `POST /question/{requestID}/reply`.
     */
    fun buildQuestionReplyJson(reply: QuestionReplyDto): String {
        val answers = reply.answers.joinToString(",") { inner ->
            val items = inner.joinToString(",") { escape(it) }
            "[$items]"
        }
        return """{"answers":[$answers]}"""
    }

    // ================================================================
    // Internal — regex-based field extraction (for status events)
    // ================================================================

    private fun extractField(raw: String, field: String): String? {
        val re = FIELD_RE.getOrPut(field) {
            Regex(""""$field"\s*:\s*"([^"]+)"""")
        }
        return re.find(raw)?.groupValues?.get(1)
    }

    private fun extractNested(raw: String, outer: String, inner: String): String? {
        val block = Regex(""""$outer"\s*:\s*\{([^}]+)}""")
            .find(raw)?.groupValues?.get(1) ?: return null
        return extractField("{$block}", inner)
    }

    // ================================================================
    // Internal — JSON helpers
    // ================================================================

    private fun tryParseObject(raw: String): JsonObject? =
        try { json.parseToJsonElement(raw).jsonObject } catch (_: Exception) { null }

    private fun tryParseArray(raw: String): kotlinx.serialization.json.JsonArray? =
        try { json.parseToJsonElement(raw).jsonArray } catch (_: Exception) { null }

    /** Escape and double-quote a string for manual JSON building. */
    private fun escape(value: String): String {
        val escaped = value
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
            .replace("\t", "\\t")
        return "\"$escaped\""
    }
}

// JsonObject convenience extensions
private fun JsonObject.str(key: String): String? =
    this[key]?.jsonPrimitive?.contentOrNull

private fun JsonObject.num(key: String): Double? =
    this[key]?.jsonPrimitive?.doubleOrNull

private fun JsonObject.long(key: String): Long? =
    this[key]?.jsonPrimitive?.longOrNull

private fun Long.safeInt() = coerceIn(Int.MIN_VALUE.toLong(), Int.MAX_VALUE.toLong()).toInt()

private fun JsonObject?.map(key: String): Map<String, String> {
    val obj = this?.get(key)?.jsonObject ?: return emptyMap()
    return obj.entries.mapNotNull { (name, value) ->
        val text = value.scalar() ?: return@mapNotNull null
        name to text
    }.toMap()
}

private fun JsonObject?.time(key: String): PartTimeDto? {
    val obj = this?.get(key)?.jsonObject ?: return null
    val start = obj.num("start")
    val end = obj.num("end")
    if (start == null && end == null) return null
    return PartTimeDto(start = start, end = end)
}

private fun JsonElement.scalar(): String? {
    if (this is JsonNull) return null
    val prim = runCatching { jsonPrimitive }.getOrNull()
    if (prim != null) {
        prim.contentOrNull?.let { return it }
        prim.booleanOrNull?.let { return it.toString() }
        prim.doubleOrNull?.let { return it.toString() }
    }
    return toString()
}
