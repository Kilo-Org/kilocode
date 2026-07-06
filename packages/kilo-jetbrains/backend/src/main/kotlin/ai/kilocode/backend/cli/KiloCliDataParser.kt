package ai.kilocode.backend.cli

import ai.kilocode.backend.workspace.CommandInfo
import ai.kilocode.backend.workspace.ModelAutoRoutingInfo
import ai.kilocode.backend.workspace.ModelCacheCostInfo
import ai.kilocode.backend.workspace.ModelCapabilitiesInfo
import ai.kilocode.backend.workspace.ModelCostInfo
import ai.kilocode.backend.workspace.ModelInfo
import ai.kilocode.backend.workspace.ModelInputCapabilitiesInfo
import ai.kilocode.backend.workspace.ModelLimitInfo
import ai.kilocode.backend.workspace.ModelOptionsInfo
import ai.kilocode.backend.workspace.ModelTerminalBenchInfo
import ai.kilocode.backend.workspace.ProviderData
import ai.kilocode.backend.workspace.ProviderInfo
import ai.kilocode.rpc.dto.AgentConfigDto
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.CloudSessionDto
import ai.kilocode.rpc.dto.CloudSessionListDto
import ai.kilocode.rpc.dto.CommandDto
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.ConfigPatchDto
import ai.kilocode.rpc.dto.ConfigUpdateDto
import ai.kilocode.rpc.dto.CustomModelDto
import ai.kilocode.rpc.dto.CustomProviderConfigDto
import ai.kilocode.rpc.dto.CustomProviderSaveDto
import ai.kilocode.rpc.dto.DiffFileDto
import ai.kilocode.rpc.dto.MessageDto
import ai.kilocode.rpc.dto.MessageErrorDto
import ai.kilocode.rpc.dto.MessageTimeDto
import ai.kilocode.rpc.dto.MessageWithPartsDto
import ai.kilocode.rpc.dto.McpConfigDto
import ai.kilocode.rpc.dto.McpStatusDto
import ai.kilocode.rpc.dto.ModelAutoRoutingDto
import ai.kilocode.rpc.dto.ModelCacheCostDto
import ai.kilocode.rpc.dto.ModelCapabilitiesDto
import ai.kilocode.rpc.dto.ModelCostDto
import ai.kilocode.rpc.dto.ModelDto
import ai.kilocode.rpc.dto.ModelInputCapabilitiesDto
import ai.kilocode.rpc.dto.ModelLimitDto
import ai.kilocode.rpc.dto.ModelOptionsDto
import ai.kilocode.rpc.dto.ModelSelectionDto
import ai.kilocode.rpc.dto.ModelStateDto
import ai.kilocode.rpc.dto.ModelTerminalBenchDto
import ai.kilocode.rpc.dto.PartDto
import ai.kilocode.rpc.dto.PartSourceDto
import ai.kilocode.rpc.dto.PartSourceTextDto
import ai.kilocode.rpc.dto.PermissionAlwaysRulesDto
import ai.kilocode.rpc.dto.PermissionFileDiffDto
import ai.kilocode.rpc.dto.PermissionReplyDto
import ai.kilocode.rpc.dto.PermissionRequestDto
import ai.kilocode.rpc.dto.PermissionConfigDto
import ai.kilocode.rpc.dto.ProviderAuthMethodDto
import ai.kilocode.rpc.dto.ProviderAuthOptionDto
import ai.kilocode.rpc.dto.ProviderAuthPromptDto
import ai.kilocode.rpc.dto.ProviderMetadataDto
import ai.kilocode.rpc.dto.ProviderSettingsProviderDto
import ai.kilocode.rpc.dto.PartTimeDto
import ai.kilocode.rpc.dto.PermissionRuleDto
import ai.kilocode.rpc.dto.PromptDto
import ai.kilocode.rpc.dto.PromptPartDto
import ai.kilocode.rpc.dto.QuestionInfoDto
import ai.kilocode.rpc.dto.QuestionOptionDto
import ai.kilocode.rpc.dto.QuestionReplyDto
import ai.kilocode.rpc.dto.QuestionRequestDto
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.SessionStatusDto
import ai.kilocode.rpc.dto.SessionSummaryDto
import ai.kilocode.rpc.dto.SessionTimeDto
import ai.kilocode.rpc.dto.SkillDto
import ai.kilocode.rpc.dto.SkillsConfigDto
import ai.kilocode.rpc.dto.TodoDto
import ai.kilocode.rpc.dto.TodoViewDto
import ai.kilocode.rpc.dto.TokensDto
import ai.kilocode.rpc.dto.ToolRefDto
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
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
    private val READ_TOOL_LINE = Regex("^\\s*Called\\s+the\\s+Read\\s+tool\\s+with\\s+the\\s+following\\s+input:", RegexOption.IGNORE_CASE)
    private val READ_TOOL_PATH = Regex("\"(?:filePath|path)\"\\s*:")
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

            "session.created" -> {
                val info = props["info"]?.jsonObject ?: return null
                val dto = parseSessionObject(info)
                val sid = props.str("sessionID") ?: dto.id.takeIf { it.isNotBlank() } ?: return null
                ChatEventDto.SessionCreated(sid, dto)
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
                val todos = parseTodos(props["todos"])
                ChatEventDto.TodoUpdated(sid, todos)
            }

            else -> null
        }
    }

    class ChatEventNormalizer {
        private val roles = mutableMapOf<String, String>()
        private val raw = mutableMapOf<Key, String>()
        private val text = mutableMapOf<Key, String>()

        fun parse(type: String, data: String): List<ChatEventDto>? {
            val event = parseChatEvent(type, data) ?: return null
            return when (event) {
                is ChatEventDto.MessageUpdated -> {
                    roles[event.info.id] = event.info.role
                    listOf(event)
                }

                is ChatEventDto.MessageRemoved -> {
                    roles.remove(event.messageID)
                    clear(event.messageID)
                    listOf(event)
                }

                is ChatEventDto.PartUpdated -> listOf(update(event))

                is ChatEventDto.PartDelta -> delta(event)

                is ChatEventDto.PartRemoved -> {
                    val key = Key(event.messageID, event.partID)
                    raw.remove(key)
                    text.remove(key)
                    listOf(event)
                }

                else -> listOf(event)
            }
        }

        private fun update(event: ChatEventDto.PartUpdated): ChatEventDto {
            val part = event.part
            val key = Key(part.messageID, part.id)
            if (roles[part.messageID] != "user" || part.type != "text") {
                raw.remove(key)
                text.remove(key)
                return event
            }

            val value = part.text.orEmpty()
            val clean = sanitizeUserPromptText(value)
            raw[key] = value
            text[key] = clean
            return event.copy(part = part.copy(text = clean))
        }

        private fun delta(event: ChatEventDto.PartDelta): List<ChatEventDto> {
            if (event.field != "text" || roles[event.messageID] != "user") return listOf(event)

            val key = Key(event.messageID, event.partID)
            val prev = text[key].orEmpty()
            val next = raw[key].orEmpty() + event.delta
            val clean = sanitizeUserPromptText(next)
            raw[key] = next
            text[key] = clean

            if (clean == prev) return emptyList()
            if (clean.startsWith(prev)) return listOf(event.copy(delta = clean.removePrefix(prev)))
            return listOf(ChatEventDto.PartUpdated(
                sessionID = event.sessionID,
                part = PartDto(
                    id = event.partID,
                    sessionID = event.sessionID,
                    messageID = event.messageID,
                    type = "text",
                    text = clean,
                ),
            ))
        }

        private fun clear(id: String) {
            raw.keys.filter { it.messageID == id }.forEach(raw::remove)
            text.keys.filter { it.messageID == id }.forEach(text::remove)
        }

        private data class Key(val messageID: String, val partID: String)
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
            val msg = parseMessage(info)
            val parts = obj["parts"]?.jsonArray ?: JsonArray(emptyList())
            MessageWithPartsDto(
                info = msg,
                parts = parts.map { sanitizePart(parsePart(it.jsonObject), msg.role) },
            )
        }
    }

    internal fun sanitizeUserPromptText(text: String): String {
        val lines = text.lines()
        if (lines.none(::readPayload)) return text

        val out = mutableListOf<String>()
        var gap = false
        for (line in lines) {
            if (readPayload(line)) {
                gap = true
                continue
            }
            if (line.isBlank() && out.lastOrNull()?.isBlank() == true && gap) {
                gap = false
                continue
            }
            out.add(line)
            if (line.isNotBlank()) gap = false
        }
        return out.joinToString("\n")
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

    /**
     * Parse a provider catalog response (`GET /provider`) into [ProviderData].
     * Throws if [raw] is not a valid JSON object (lets the workspace loading
     * catch the exception and surface it as a LoadError).
     */
    fun parseProviders(raw: String): ProviderData {
        val obj = json.parseToJsonElement(raw).jsonObject
        return ProviderData(
            providers = obj["all"]?.jsonArray?.map { parseProvider(it.jsonObject) } ?: emptyList(),
            connected = obj["connected"]?.jsonArray?.mapNotNull { it.jsonPrimitive.contentOrNull } ?: emptyList(),
            defaults = obj["default"]?.jsonObject?.mapValues { (_, v) -> v.jsonPrimitive.content } ?: emptyMap(),
        )
    }

    fun parseProviderSettingsProviders(raw: String): Triple<List<ProviderSettingsProviderDto>, List<String>, Map<String, String>> {
        val obj = json.parseToJsonElement(raw).jsonObject
        val all = obj["all"]?.jsonArray?.map { elem ->
            val item = elem.jsonObject
            ProviderSettingsProviderDto(
                id = item.str("id") ?: "",
                name = item.str("name") ?: item.str("id") ?: "",
                description = item.str("description"),
                source = item.str("source"),
                key = item.str("key"),
                metadata = parseProviderMetadata(item["metadata"].obj()),
                models = item["models"]?.jsonObject?.mapValues { (id, v) -> parseModelDto(id, v.jsonObject) } ?: emptyMap(),
            )
        } ?: emptyList()
        val connected = obj["connected"]?.jsonArray?.mapNotNull { it.jsonPrimitive.contentOrNull } ?: emptyList()
        val defaults = obj["default"]?.jsonObject?.mapValues { (_, v) -> v.jsonPrimitive.content } ?: emptyMap()
        return Triple(all, connected, defaults)
    }

    fun parseProviderAuth(raw: String): Map<String, List<ProviderAuthMethodDto>> {
        val root = tryParseObject(raw) ?: return emptyMap()
        return root.entries.associate { (id, elem) ->
            val arr = runCatching { elem.jsonArray }.getOrNull()
            val methods = arr?.mapNotNull { parseAuthMethod(runCatching { it.jsonObject }.getOrNull()) } ?: emptyList()
            id to methods
        }
    }

    fun parseProviderConfig(raw: String): Pair<Map<String, CustomProviderConfigDto>, Pair<List<String>, List<String>>> {
        val obj = tryParseObject(raw) ?: return emptyMap<String, CustomProviderConfigDto>() to (emptyList<String>() to emptyList())
        val cfg = obj["provider"]?.jsonObject?.entries?.mapNotNull { (id, elem) ->
            val item = runCatching { elem.jsonObject }.getOrNull() ?: return@mapNotNull null
            id to CustomProviderConfigDto(
                id = id,
                name = item.str("name"),
                npm = item.str("npm"),
                env = item["env"]?.jsonArray?.mapNotNull { it.jsonPrimitive.contentOrNull } ?: emptyList(),
                options = item["options"].obj()?.entries?.mapNotNull { (key, value) -> value.scalar()?.let { key to it } }?.toMap() ?: emptyMap(),
                headers = item["headers"].obj()?.entries?.mapNotNull { (key, value) -> value.scalar()?.let { key to it } }?.toMap() ?: emptyMap(),
                models = item["models"].obj()?.entries?.mapNotNull { (mid, value) ->
                    val model = runCatching { value.jsonObject }.getOrNull() ?: return@mapNotNull null
                    mid to CustomModelDto(
                        id = model.str("id") ?: mid,
                        name = model.str("name") ?: mid,
                        reasoning = model["capabilities"].obj()?.bool("reasoning") ?: false,
                    )
                }?.toMap() ?: emptyMap(),
            )
        }?.toMap() ?: emptyMap()
        val disabled = obj["disabled_providers"]?.jsonArray?.mapNotNull { it.jsonPrimitive.contentOrNull } ?: emptyList()
        val enabled = obj["enabled_providers"]?.jsonArray?.mapNotNull { it.jsonPrimitive.contentOrNull } ?: emptyList()
        return cfg to (disabled to enabled)
    }

    /**
     * Parse the `/global/config` response body into a [ConfigDto]. Tolerant of
     * the discriminated MCP union and the `env`/`environment` alias. Never
     * throws on malformed input so a bad config cannot block startup.
     */
    fun parseConfig(raw: String): ConfigDto = runCatching {
        val obj = tryParseObject(raw) ?: return ConfigDto()
        ConfigDto(
            model = obj.str("model"),
            smallModel = obj.str("small_model"),
            subagentModel = obj.str("subagent_model"),
            subagentVariant = obj.str("subagent_variant"),
            defaultAgent = obj.str("default_agent"),
            instructions = obj["instructions"].arr()
                ?.mapNotNull { runCatching { it.jsonPrimitive.contentOrNull }.getOrNull() }
                ?: emptyList(),
            skills = parseSkillsConfig(obj["skills"].obj()),
            mcp = parseMcpConfig(obj["mcp"].obj()),
            agent = parseAgentConfig(obj["agent"].obj()),
        )
    }.getOrDefault(ConfigDto())

    private fun parseSkillsConfig(obj: JsonObject?): SkillsConfigDto? {
        if (obj == null) return null
        return SkillsConfigDto(
            paths = obj["paths"].arr()
                ?.mapNotNull { runCatching { it.jsonPrimitive.contentOrNull }.getOrNull() }
                ?: emptyList(),
            urls = obj["urls"].arr()
                ?.mapNotNull { runCatching { it.jsonPrimitive.contentOrNull }.getOrNull() }
                ?: emptyList(),
        )
    }

    private fun parseMcpConfig(obj: JsonObject?): Map<String, McpConfigDto> {
        if (obj == null) return emptyMap()
        return obj.entries.mapNotNull { (name, elem) ->
            val item = elem.obj() ?: return@mapNotNull null
            name to McpConfigDto(
                type = item.str("type"),
                command = item["command"].arr()
                    ?.mapNotNull { runCatching { it.jsonPrimitive.contentOrNull }.getOrNull() }
                    ?.takeIf { it.isNotEmpty() },
                url = item.str("url"),
                environment = item.map("environment").takeIf { it.isNotEmpty() }
                    ?: item.map("env").takeIf { it.isNotEmpty() },
                headers = item.map("headers").takeIf { it.isNotEmpty() },
                enabled = item.flagOrNull("enabled"),
                timeout = item.long("timeout"),
            )
        }.toMap()
    }

    private fun parseAgentConfig(obj: JsonObject?): Map<String, AgentConfigDto> {
        if (obj == null) return emptyMap()
        return obj.entries.mapNotNull { (name, elem) ->
            val item = elem.obj() ?: return@mapNotNull null
            name to AgentConfigDto(
                model = item.str("model"),
                variant = item.str("variant"),
                prompt = item.str("prompt"),
                description = item.str("description"),
                mode = item.str("mode"),
                hidden = item.flagOrNull("hidden"),
                disable = item.flagOrNull("disable"),
                temperature = item.num("temperature"),
                top_p = item.num("top_p"),
                steps = item.long("steps"),
                permission = parsePermissionConfig(item["permission"].obj()),
            )
        }.toMap()
    }

    private fun parsePermissionConfig(obj: JsonObject?): PermissionConfigDto? {
        if (obj == null) return null
        return obj.entries.mapNotNull { (tool, rule) ->
            val value = when (rule) {
                is JsonNull -> PermissionRuleDto.Level(null)
                is JsonObject -> PermissionRuleDto.Patterns(
                    rule.entries.mapNotNull { (pattern, level) ->
                        pattern to level.scalar()
                    }.toMap()
                )
                else -> PermissionRuleDto.Level(rule.scalar())
            }
            tool to value
        }.toMap().takeIf { it.isNotEmpty() }
    }

    /**
     * Parse a command list response (`GET /command`) into a list of [CommandInfo].
     * The `template` field is intentionally ignored — CLI commands can return lazy
     * promise objects (`{}`) for that field, which must not crash JetBrains startup.
     */
    fun parseCommands(raw: String): List<CommandInfo> =
        json.parseToJsonElement(raw).jsonArray.map { item ->
            val obj = item.jsonObject
            CommandInfo(
                name = obj.str("name") ?: "",
                description = obj.str("description"),
                source = obj.str("source"),
                hints = obj["hints"]?.jsonArray?.mapNotNull { it.jsonPrimitive.contentOrNull } ?: emptyList(),
            )
        }

    fun parseAgentRemovable(raw: String): Map<String, Boolean> =
        raw.array().mapNotNull { item ->
            val obj = item.obj() ?: return@mapNotNull null
            val name = obj.str("name") ?: return@mapNotNull null
            name to removable(obj)
        }.toMap()

    fun parseAgentBehaviorSkills(raw: String): List<SkillDto> =
        raw.array().mapNotNull { item ->
            val obj = item.obj() ?: return@mapNotNull null
            val name = obj.str("name") ?: return@mapNotNull null
            val location = obj.str("location") ?: return@mapNotNull null
            SkillDto(name = name, description = obj.str("description"), location = location)
        }

    fun parseAgentBehaviorCommands(raw: String): List<CommandDto> =
        raw.array().mapNotNull { item ->
            val obj = item.obj() ?: return@mapNotNull null
            val name = obj.str("name") ?: return@mapNotNull null
            CommandDto(
                name = name,
                description = obj.str("description"),
                source = obj.str("source"),
                hints = obj["hints"].arr()?.mapNotNull { it.jsonPrimitive.contentOrNull } ?: emptyList(),
                template = obj.str("template"),
            )
        }

    fun parseMcpStatus(raw: String): List<McpStatusDto> {
        val root = runCatching { json.parseToJsonElement(raw) }.getOrNull() ?: return emptyList()
        return when (root) {
            is JsonArray -> root.mapNotNull { mcpStatus(it) }
            is JsonObject -> root.mapNotNull { (name, item) -> mcpStatus(item, name) }
            else -> emptyList()
        }
    }

    private fun String.array(): JsonArray {
        val root = runCatching { json.parseToJsonElement(this) }.getOrNull()
        return when (root) {
            is JsonArray -> root
            is JsonObject -> root["data"] as? JsonArray ?: JsonArray(emptyList())
            else -> JsonArray(emptyList())
        }
    }

    private fun mcpStatus(item: JsonElement, fallback: String? = null): McpStatusDto? {
        val obj = item.obj() ?: return null
        val name = obj.str("name") ?: fallback ?: return null
        return McpStatusDto(
            name = name,
            status = obj.str("status") ?: obj.str("state") ?: "unknown",
            error = obj.str("error"),
        )
    }

    private fun removable(obj: JsonObject): Boolean {
        if (obj.flagOrNull("native") == true) return false
        val opts = obj["options"].obj()
        if (obj.str("source") == "organization" || opts?.str("source") == "organization") return false
        if (opts?.containsKey("reference") == true || opts?.containsKey("resolved") == true) return false
        return true
    }

    /**
     * Extract the `state` directory path from a `/path` response.
     * Returns `null` when the field is missing, not a JSON string, or the JSON is malformed.
     */
    fun parsePathState(raw: String): String? {
        val prim = runCatching { tryParseObject(raw)?.get("state")?.jsonPrimitive }.getOrNull() ?: return null
        return if (prim.isString) prim.content else null
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

    fun parseEnhancedPrompt(raw: String): String =
        tryParseObject(raw)?.str("text")
            ?: throw IllegalArgumentException("Enhance prompt response is missing text")

    fun buildEnhancePromptJson(text: String): String =
        """{"text":${escape(text)}}"""

    /**
     * Build the JSON body for `POST /session/{id}/prompt_async`.
     */
    fun buildPromptJson(prompt: PromptDto): String {
        val parts = prompt.parts.joinToString(",") { part ->
            buildPromptPartJson(part)
        }
        val sb = StringBuilder()
        sb.append("""{"parts":[$parts]""")
        val msg = prompt.messageID
        if (msg != null) {
            sb.append(""","messageID":${escape(msg)}""")
        }
        val reply = prompt.noReply
        if (reply != null) {
            sb.append(""","noReply":$reply""")
        }
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

    private fun buildPromptPartJson(part: PromptPartDto): String {
        val fields = mutableListOf("\"type\":${escape(part.type)}")
        if (part.type == "file") {
            part.mime?.let { fields += "\"mime\":${escape(it)}" }
            part.url?.let { fields += "\"url\":${escape(it)}" }
            part.filename?.let { fields += "\"filename\":${escape(it)}" }
            part.source?.let { fields += "\"source\":${sourceJson(it)}" }
            return "{${fields.joinToString(",")}}"
        }
        fields += "\"text\":${escape(part.text.orEmpty())}"
        return "{${fields.joinToString(",")}}"
    }

    /**
     * Build the JSON body for `POST /session/{id}/summarize`.
     */
    fun buildSummarizeJson(model: ModelSelectionDto): String =
        """{"providerID":${escape(model.providerID)},"modelID":${escape(model.modelID)}}"""

    fun buildCommandJson(command: String, args: String, prompt: PromptDto): String {
        val fields = mutableListOf(
            "\"command\":${escape(command)}",
            "\"arguments\":${escape(args)}",
        )
        prompt.agent?.let { fields += "\"agent\":${escape(it)}" }
        prompt.variant?.let { fields += "\"variant\":${escape(it)}" }
        val pid = prompt.providerID
        val mid = prompt.modelID
        if (pid != null && mid != null) {
            val model = "$pid/$mid"
            fields += "\"model\":${escape(model)}"
        }
        val parts = prompt.parts.filter { it.type == "file" }.joinToString(",") { buildPromptPartJson(it) }
        if (parts.isNotEmpty()) fields += "\"parts\":[$parts]"
        return "{${fields.joinToString(",")}}"
    }

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

    fun buildConfigPatch(patch: ConfigPatchDto): String {
        val allowed = setOf("model", "small_model", "subagent_model", "subagent_variant", "default_agent")
        val obj = buildJsonObject {
            for ((key, value) in patch.values) {
                if (key !in allowed) continue
                put(key, value?.let(::JsonPrimitive) ?: JsonNull)
            }

            val instructions = patch.instructions
            if (instructions != null) put("instructions", JsonArray(instructions.map(::JsonPrimitive)))

            val skills = patch.skills
            if (skills != null) {
                put("skills", buildJsonObject {
                    val paths = skills.paths
                    if (paths != null) put("paths", JsonArray(paths.map(::JsonPrimitive)))
                    val urls = skills.urls
                    if (urls != null) put("urls", JsonArray(urls.map(::JsonPrimitive)))
                })
            }

            val mcp = patch.mcp
            if (mcp != null) {
                put("mcp", buildJsonObject {
                    for ((name, cfg) in mcp) put(name, cfg?.let {
                        buildJsonObject {
                            if (it.type != null) put("type", it.type)
                            val command = it.command
                            if (command != null) put("command", JsonArray(command.map(::JsonPrimitive)))
                            if (it.url != null) put("url", it.url)
                            if (it.environment != null) {
                                put("environment", buildJsonObject {
                                    for ((key, value) in it.environment) put(key, value)
                                })
                            }
                            if (it.headers != null) {
                                put("headers", buildJsonObject {
                                    for ((key, value) in it.headers) put(key, value)
                                })
                            }
                            if (it.enabled != null) put("enabled", it.enabled)
                            if (it.timeout != null) put("timeout", it.timeout)
                        }
                    } ?: JsonNull)
                })
            }

            if (patch.agents.isNotEmpty()) {
                put("agent", buildJsonObject {
                    for ((name, agent) in patch.agents) put(name, buildJsonObject {
                        for (field in agent.clear) put(field, JsonNull)
                        if (agent.model != null) put("model", agent.model)
                        if (agent.variant != null) put("variant", agent.variant)
                        if (agent.prompt != null) put("prompt", agent.prompt)
                        if (agent.description != null) put("description", agent.description)
                        if (agent.mode != null) put("mode", agent.mode)
                        if (agent.hidden != null) put("hidden", agent.hidden)
                        if (agent.disable != null) put("disable", agent.disable)
                        if (agent.temperature != null) put("temperature", agent.temperature)
                        if (agent.top_p != null) put("top_p", agent.top_p)
                        if (agent.steps != null) put("steps", agent.steps)
                        val permission = agent.permission
                        if (permission != null) put("permission", buildPermission(permission))
                    })
                })
            }
        }

        return json.encodeToString(JsonObject.serializer(), obj)
    }

    private fun buildPermission(permission: Map<String, PermissionRuleDto>) = buildJsonObject {
        for ((tool, rule) in permission) {
            when (rule) {
                is PermissionRuleDto.Level -> put(tool, rule.value?.let(::JsonPrimitive) ?: JsonNull)
                is PermissionRuleDto.Patterns -> put(tool, buildJsonObject {
                    for ((pattern, level) in rule.map) put(pattern, level?.let(::JsonPrimitive) ?: JsonNull)
                })
            }
        }
    }

    fun buildProviderAuthJson(key: String, metadata: Map<String, String>): String {
        val obj = buildJsonObject {
            put("type", "api")
            put("key", key)
            if (metadata.isNotEmpty()) {
                put("metadata", buildJsonObject { metadata.forEach { (k, v) -> put(k, v) } })
            }
        }
        return json.encodeToString(JsonObject.serializer(), obj)
    }

    fun buildProviderOAuthJson(method: String, inputs: Map<String, String> = emptyMap(), code: String? = null): String {
        val obj = buildJsonObject {
            val index = method.toLongOrNull()
            if (index != null) {
                put("method", index)
            } else {
                put("method", method)
            }
            if (inputs.isNotEmpty()) put("inputs", buildJsonObject { inputs.forEach { (k, v) -> put(k, v) } })
            if (code != null) put("code", code)
        }
        return json.encodeToString(JsonObject.serializer(), obj)
    }

    fun buildDisabledProviderPatch(ids: List<String>): String {
        val arr = JsonArray(ids.distinct().sorted().map { JsonPrimitive(it) })
        return json.encodeToString(JsonObject.serializer(), JsonObject(mapOf("disabled_providers" to arr)))
    }

    fun buildCustomProviderPatch(input: CustomProviderSaveDto): String {
        val id = input.id.trim()
        val env = input.envVar?.trim()?.takeIf { it.isNotBlank() }
        val models = input.models.associate { model ->
            model.id to buildJsonObject {
                put("id", model.id)
                put("name", model.name.ifBlank { model.id })
                put("capabilities", buildJsonObject { put("reasoning", model.reasoning) })
            }
        }
        val provider = buildJsonObject {
            put("name", input.name.trim().ifBlank { id })
            put("npm", "@ai-sdk/openai-compatible")
            put("options", buildJsonObject { put("baseURL", input.baseUrl.trim()) })
            if (env != null) put("env", buildJsonArray { add(JsonPrimitive(env)) })
            if (input.headers.isNotEmpty()) put("headers", buildJsonObject { input.headers.forEach { (k, v) -> put(k, v) } })
            if (models.isNotEmpty()) put("models", JsonObject(models))
        }
        val root = buildJsonObject {
            put("provider", buildJsonObject { put(id, provider) })
        }
        return json.encodeToString(JsonObject.serializer(), root)
    }

    fun buildCustomProviderDeletePatch(id: String): String {
        val root = buildJsonObject {
            put("provider", buildJsonObject { put(id, JsonNull) })
        }
        return json.encodeToString(JsonObject.serializer(), root)
    }

    fun parseOAuthReady(raw: String): Triple<String?, String, String?> {
        val obj = tryParseObject(raw) ?: return Triple(null, "auto", null)
        return Triple(obj.str("url"), obj.str("method") ?: "auto", obj.str("instructions"))
    }

    fun parseModelIds(raw: String): List<String> {
        val obj = tryParseObject(raw) ?: return emptyList()
        return obj["data"]?.jsonArray?.mapNotNull { elem ->
            val item = runCatching { elem.jsonObject }.getOrNull() ?: return@mapNotNull null
            item.str("id")
        }?.distinct()?.sorted() ?: emptyList()
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
        val input = state?.get("input").obj()
        val stateMeta = state?.get("metadata").obj()
        val topMeta = obj["metadata"].obj()
        val todos = sequenceOf(topMeta?.get("todos"), stateMeta?.get("todos"), input?.get("todos"))
            .firstNotNullOfOrNull(::parseTodosOrNull)
            ?: emptyList()
        val view = sequenceOf(topMeta?.get("view"), stateMeta?.get("view"))
            .mapNotNull(::parseTodoView)
            .firstOrNull()
        return PartDto(
            id = obj.str("id") ?: "",
            sessionID = obj.str("sessionID") ?: "",
            messageID = obj.str("messageID") ?: "",
            type = obj.str("type") ?: "unknown",
            text = obj.str("text"),
            mime = obj.str("mime"),
            url = obj.str("url"),
            filename = obj.str("filename"),
            synthetic = obj.flagOrNull("synthetic"),
            source = parseSource(obj["source"]),
            tool = obj.str("tool"),
            callID = obj.str("callID"),
            state = state?.str("status"),
            title = state?.str("title"),
            input = state.map("input"),
            metadata = meta,
            output = state?.str("output"),
            error = state?.str("error"),
            time = obj.time("time") ?: state.time("time"),
            todos = todos,
            todoView = view,
            reason = obj.str("reason"),
            cost = obj.num("cost"),
            tokens = tokens?.let(::parseTokens),
        )
    }

    private fun sanitizePart(part: PartDto, role: String): PartDto {
        if (role != "user" || part.type != "text") return part
        return part.copy(text = part.text?.let(::sanitizeUserPromptText))
    }

    private fun readPayload(line: String): Boolean {
        if (!READ_TOOL_LINE.containsMatchIn(line)) return false
        return READ_TOOL_PATH.containsMatchIn(line)
    }

    private fun parseSource(raw: JsonElement?): PartSourceDto? {
        val obj = raw.obj() ?: return null
        val type = obj.str("type") ?: return null
        val text = obj["text"].obj() ?: return null
        val value = text.str("value") ?: return null
        val start = text.num("start") ?: return null
        val end = text.num("end") ?: return null
        return PartSourceDto(
            type = type,
            text = PartSourceTextDto(value = value, start = start, end = end),
            path = obj.str("path"),
            clientName = obj.str("clientName"),
            uri = obj.str("uri"),
            name = obj.str("name"),
            kind = obj.long("kind")?.safeInt(),
        )
    }

    private fun sourceJson(source: PartSourceDto): String {
        val fields = mutableListOf(
            "\"type\":${escape(source.type)}",
            "\"text\":{\"value\":${escape(source.text.value)},\"start\":${source.text.start},\"end\":${source.text.end}}",
        )
        source.path?.let { fields += "\"path\":${escape(it)}" }
        source.clientName?.let { fields += "\"clientName\":${escape(it)}" }
        source.uri?.let { fields += "\"uri\":${escape(it)}" }
        source.name?.let { fields += "\"name\":${escape(it)}" }
        source.kind?.let { fields += "\"kind\":$it" }
        return "{${fields.joinToString(",")}}"
    }

    internal fun parseTodos(raw: JsonElement?): List<TodoDto> {
        return parseTodosOrNull(raw) ?: emptyList()
    }

    private fun parseTodosOrNull(raw: JsonElement?): List<TodoDto>? {
        val arr = runCatching { raw?.jsonArray }.getOrNull() ?: return null
        return arr.mapNotNull { elem ->
            val obj = runCatching { elem.jsonObject }.getOrNull() ?: return@mapNotNull null
            parseTodo(obj)
        }
    }

    private fun parseTodo(obj: JsonObject) = TodoDto(
        content = obj.str("content") ?: "",
        status = obj.str("status") ?: "pending",
        priority = obj.str("priority") ?: "medium",
        changed = obj.flag("changed", false),
    )

    internal fun parseTodoView(raw: JsonElement?): TodoViewDto? {
        val obj = runCatching { raw?.jsonObject }.getOrNull() ?: return null
        val rawTodos = runCatching { obj["todos"]?.jsonArray }.getOrNull() ?: return null
        val todos = parseTodos(rawTodos)
        return TodoViewDto(
            mode = obj.str("mode") ?: "full",
            todos = todos,
            hiddenBefore = obj.long("hiddenBefore")?.safeInt() ?: 0,
            hiddenAfter = obj.long("hiddenAfter")?.safeInt() ?: 0,
            changed = obj.long("changed")?.safeInt() ?: 0,
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
        val data = obj["data"]?.jsonObject
        val msg = obj.str("message")
            ?: data?.str("message")
            ?: obj.str("error")
        return MessageErrorDto(
            type,
            msg,
            statusCode = data?.long("statusCode")?.safeInt(),
            responseBody = data?.str("responseBody"),
            dataKeys = data?.keys?.sorted().orEmpty(),
            ref = data?.str("ref"),
        )
    }

    internal fun parsePermissionRequest(obj: JsonObject): PermissionRequestDto? {
        val id = obj.str("id") ?: return null
        val sid = obj.str("sessionID") ?: return null
        val permission = obj.str("permission") ?: return null
        val patterns = obj["patterns"]?.jsonArray?.mapNotNull { it.jsonPrimitive.contentOrNull } ?: emptyList()
        val always = obj["always"]?.jsonArray?.mapNotNull { it.jsonPrimitive.contentOrNull } ?: emptyList()
        val metaObj = obj["metadata"].obj()
        val meta = metaObj?.entries?.mapNotNull { (key, value) ->
            val text = value.scalar() ?: return@mapNotNull null
            key to text
        }?.toMap() ?: emptyMap()
        val path = metaObj.path()
        val diffs = metaObj.permissionDiffs(path)
        return PermissionRequestDto(
            id = id,
            sessionID = sid,
            permission = permission,
            patterns = patterns,
            metadata = meta,
            always = always,
            tool = toolRef(obj),
            message = obj.str("message") ?: metaObj?.str("message"),
            command = metaObj?.str("command") ?: obj.str("command"),
            rules = metaObj.rules(),
            filePath = path,
            fileDiffs = diffs,
        )
    }

    internal fun parseQuestionRequest(obj: JsonObject): QuestionRequestDto? {
        val id = obj.str("id") ?: return null
        val sid = obj.str("sessionID") ?: return null
        val questions = obj["questions"]?.jsonArray?.map { q ->
            val qo = q.jsonObject
            val options = qo["options"]?.jsonArray?.map { o ->
                val oo = o.jsonObject
                QuestionOptionDto(
                    label = oo.str("label") ?: "",
                    description = oo.str("description") ?: "",
                    labelKey = oo.str("labelKey"),
                    descriptionKey = oo.str("descriptionKey"),
                    mode = oo.str("mode"),
                )
            } ?: emptyList()
            QuestionInfoDto(
                question = qo.str("question") ?: "",
                header = qo.str("header") ?: "",
                options = options,
                multiple = qo.flag("multiple", false),
                custom = qo.flag("custom", true),
                questionKey = qo.str("questionKey"),
                headerKey = qo.str("headerKey"),
            )
        } ?: emptyList()
        val ref = toolRef(obj)
        return QuestionRequestDto(id, sid, questions, ref, blocking = obj.flag("blocking", false))
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

    // ================================================================
    // Internal — provider/catalog parsing
    // ================================================================

    private val EFFORT_ORDER = listOf("none", "minimal", "low", "medium", "high", "xhigh", "max")
        .withIndex().associate { it.value to it.index }

    private fun parseProvider(obj: JsonObject) = ProviderInfo(
        id = obj.str("id") ?: "",
        name = obj.str("name") ?: "",
        source = obj.str("source"),
        models = obj["models"]?.jsonObject?.mapValues { (id, v) -> parseModel(id, v.jsonObject) } ?: emptyMap(),
    )

    private fun parseProviderMetadata(obj: JsonObject?): ProviderMetadataDto? {
        if (obj == null) return null
        val dto = ProviderMetadataDto(
            noteKey = obj.str("noteKey"),
            icon = obj.str("icon"),
            priority = obj.num("priority")?.toInt(),
        )
        if (dto.noteKey == null && dto.icon == null && dto.priority == null) return null
        return dto
    }

    private fun parseModelDto(id: String, obj: JsonObject): ModelDto {
        val model = parseModel(id, obj)
        return ModelDto(
            id = model.id,
            name = model.name,
            inputPrice = model.inputPrice,
            outputPrice = model.outputPrice,
            contextLength = model.contextLength,
            releaseDate = model.releaseDate,
            latest = model.latest,
            attachment = model.attachment,
            reasoning = model.reasoning,
            temperature = model.temperature,
            toolCall = model.toolCall,
            free = model.free,
            byok = model.byok,
            status = model.status,
            recommendedIndex = model.recommendedIndex,
            variants = model.variants,
            limit = model.limit?.let { ModelLimitDto(it.context, it.input, it.output) },
            cost = model.cost?.let { cost ->
                ModelCostDto(
                    input = cost.input,
                    output = cost.output,
                    cache = cost.cache?.let { ModelCacheCostDto(it.read, it.write) },
                )
            },
            capabilities = model.capabilities?.let { cap ->
                ModelCapabilitiesDto(
                    reasoning = cap.reasoning,
                    input = cap.input?.let { ModelInputCapabilitiesDto(it.text, it.image, it.audio, it.video, it.pdf) },
                )
            },
            options = model.options?.let { ModelOptionsDto(it.description) },
            autoRouting = model.autoRouting?.let { ModelAutoRoutingDto(it.models) },
            terminalBench = model.terminalBench?.let { ModelTerminalBenchDto(it.overallScore, it.avgAttemptCostUsd) },
            mayTrainOnYourPrompts = model.mayTrainOnYourPrompts,
        )
    }

    private fun parseModel(id: String, obj: JsonObject): ModelInfo {
        val cap = obj["capabilities"].obj()
        val limit = obj["limit"].obj()
        val input = cap?.get("input").obj()
        return ModelInfo(
            id = obj.str("id") ?: id,
            name = obj.str("name") ?: id,
            inputPrice = obj.num("inputPrice"),
            outputPrice = obj.num("outputPrice"),
            contextLength = obj.long("contextLength"),
            releaseDate = obj.str("release_date"),
            latest = null,
            attachment = cap.bool("attachment"),
            reasoning = cap.bool("reasoning"),
            temperature = cap.bool("temperature"),
            toolCall = cap.bool("toolcall"),
            free = obj.bool("isFree"),
            byok = obj.bool("hasUserByokAvailable"),
            status = obj.str("status"),
            recommendedIndex = obj.num("recommendedIndex"),
            variants = parseVariants(obj),
            limit = limit?.let {
                ModelLimitInfo(
                    context = it.long("context") ?: 0,
                    input = it.long("input"),
                    output = it.long("output") ?: 0,
                )
            },
            cost = parseModelCost(obj["cost"]),
            capabilities = ModelCapabilitiesInfo(
                reasoning = cap.bool("reasoning"),
                input = input?.let {
                    ModelInputCapabilitiesInfo(
                        text = it.bool("text"),
                        image = it.bool("image"),
                        audio = it.bool("audio"),
                        video = it.bool("video"),
                        pdf = it.bool("pdf"),
                    )
                },
            ).takeUnless { !it.reasoning && it.input == null },
            options = obj["options"].obj()?.str("description")?.let { ModelOptionsInfo(it) },
            autoRouting = obj["autoRouting"].obj()?.get("models")?.arr()?.mapNotNull { it.jsonPrimitive.contentOrNull }?.let {
                ModelAutoRoutingInfo(it)
            },
            terminalBench = parseTerminalBench(obj["terminalBench"]),
            mayTrainOnYourPrompts = obj.bool("mayTrainOnYourPrompts"),
        )
    }

    private fun parseModelCost(raw: JsonElement?): ModelCostInfo? {
        val obj = raw.obj() ?: return null
        val input = obj.num("input") ?: return null
        val output = obj.num("output") ?: return null
        val cache = obj["cache"].obj()?.let { cache ->
            val read = cache.num("read") ?: return@let null
            val write = cache.num("write") ?: return@let null
            ModelCacheCostInfo(read, write)
        }
        return ModelCostInfo(input, output, cache)
    }

    private fun parseTerminalBench(raw: JsonElement?): ModelTerminalBenchInfo? {
        val obj = raw.obj() ?: return null
        val score = obj.num("overallScore") ?: return null
        val cost = obj.num("avgAttemptCostUsd") ?: return null
        return ModelTerminalBenchInfo(score, cost)
    }

    private fun parseVariants(obj: JsonObject): List<String> {
        val keys = obj["variants"]?.jsonObject?.keys?.toList() ?: return emptyList()
        return keys.sortedWith(compareBy<String> { EFFORT_ORDER[it] ?: Int.MAX_VALUE }.thenBy { it })
    }

    private fun parseAuthMethod(obj: JsonObject?): ProviderAuthMethodDto? {
        if (obj == null) return null
        val type = obj.str("type") ?: return null
        val prompts = obj["prompts"]?.jsonArray?.mapNotNull { elem ->
            val prompt = runCatching { elem.jsonObject }.getOrNull() ?: return@mapNotNull null
            val cond = prompt["when"].obj()
            ProviderAuthPromptDto(
                key = prompt.str("key") ?: return@mapNotNull null,
                label = prompt.str("message") ?: prompt.str("label") ?: prompt.str("key") ?: "",
                type = prompt.str("type") ?: "text",
                options = prompt["options"]?.jsonArray?.mapNotNull { parseAuthOption(it) } ?: emptyList(),
                whenKey = cond?.str("key"),
                whenOp = cond?.str("op"),
                whenValue = cond?.str("value"),
            )
        } ?: emptyList()
        return ProviderAuthMethodDto(type, obj.str("label") ?: type, prompts)
    }

    private fun parseAuthOption(elem: JsonElement): ProviderAuthOptionDto? {
        val item = runCatching { elem.jsonObject }.getOrNull()
        if (item != null) {
            val label = item.str("label") ?: item.str("value") ?: return null
            return ProviderAuthOptionDto(label = label, value = item.str("value") ?: label)
        }
        val text = runCatching { elem.jsonPrimitive.contentOrNull }.getOrNull() ?: return null
        return ProviderAuthOptionDto(label = text, value = text)
    }

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
    internal fun parseRulesJson(text: String): List<String> {
        val arr = runCatching { json.parseToJsonElement(text).jsonArray }.getOrNull() ?: return listOf(text)
        return arr.mapNotNull { runCatching { it.jsonPrimitive.contentOrNull }.getOrNull() }
    }

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

// Permission metadata helpers

private fun JsonElement?.obj(): JsonObject? = runCatching { this?.jsonObject }.getOrNull()
private fun JsonElement?.arr(): JsonArray? = runCatching { this?.jsonArray }.getOrNull()

private fun JsonObject?.path(): String? {
    if (this == null) return null
    return str("filepath") ?: str("filePath") ?: str("file") ?: str("path")
}

private fun JsonObject?.rules(): List<String> {
    if (this == null) return emptyList()
    val raw = this["rules"] ?: return emptyList()
    val arr = raw.arr()
    if (arr != null) {
        return arr.mapNotNull { it.jsonPrimitive.contentOrNull }
    }
    val text = runCatching { raw.jsonPrimitive.contentOrNull }.getOrNull() ?: return emptyList()
    if (text.startsWith("[")) {
        return runCatching {
            KiloCliDataParser.parseRulesJson(text)
        }.getOrElse { listOf(text) }
    }
    return listOf(text)
}

private fun JsonObject?.permissionDiffs(path: String?): List<PermissionFileDiffDto> {
    if (this == null) return emptyList()
    val filediff = this["filediff"].obj()
    if (filediff != null) {
        val file = filediff.str("file") ?: filediff.str("relativePath") ?: path ?: return emptyList()
        return listOf(
            PermissionFileDiffDto(
                file = file,
                patch = filediff.str("patch"),
                before = filediff.str("before"),
                after = filediff.str("after"),
                additions = filediff.long("additions")?.safeInt() ?: 0,
                deletions = filediff.long("deletions")?.safeInt() ?: 0,
            )
        )
    }
    val files = this["files"].arr()
    if (files != null) {
        return files.mapNotNull { elem ->
            val item = elem.obj() ?: return@mapNotNull null
            val file = item.str("relativePath") ?: item.str("filePath") ?: item.str("file") ?: return@mapNotNull null
            PermissionFileDiffDto(
                file = file,
                patch = item.str("patch"),
                before = item.str("before"),
                after = item.str("after"),
                additions = item.long("additions")?.safeInt() ?: 0,
                deletions = item.long("deletions")?.safeInt() ?: 0,
            )
        }
    }
    val diff = str("diff")
    if (diff != null) {
        return listOf(PermissionFileDiffDto(file = path ?: "patch", patch = diff))
    }
    return emptyList()
}

// JsonObject convenience extensions
private fun JsonObject.str(key: String): String? =
    this[key]?.jsonPrimitive?.contentOrNull

private fun JsonObject.num(key: String): Double? =
    this[key]?.jsonPrimitive?.doubleOrNull

private fun JsonObject.long(key: String): Long? =
    this[key]?.jsonPrimitive?.longOrNull

private fun JsonObject?.bool(key: String): Boolean =
    this?.get(key)?.jsonPrimitive?.booleanOrNull ?: false

private fun JsonObject.flag(key: String, default: Boolean): Boolean {
    val prim = this[key]?.jsonPrimitive ?: return default
    return prim.booleanOrNull ?: prim.contentOrNull?.toBooleanStrictOrNull() ?: default
}

private fun JsonObject.flagOrNull(key: String): Boolean? {
    val prim = this[key]?.jsonPrimitive ?: return null
    return prim.booleanOrNull ?: prim.contentOrNull?.toBooleanStrictOrNull()
}

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
