@file:Suppress("UnstableApiUsage")

package ai.kilocode.backend.rpc

import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.cli.KiloClaudeCompatSettings
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.KiloAgentBehaviorRpcApi
import ai.kilocode.rpc.dto.AgentCreateDto
import ai.kilocode.rpc.dto.AgentDetailDto
import ai.kilocode.jetbrains.api.model.AgentBuilderSaveRequest
import ai.kilocode.rpc.dto.CommandDto
import ai.kilocode.rpc.dto.McpStatusDto
import ai.kilocode.rpc.dto.PermissionRuleItemDto
import ai.kilocode.rpc.dto.SkillDto
import com.intellij.openapi.components.service
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

class KiloAgentBehaviorRpcApiImpl : KiloAgentBehaviorRpcApi {
    companion object {
        private val LOG = KiloLog.create(KiloAgentBehaviorRpcApiImpl::class.java)
        private val JSON = "application/json".toMediaType()
        private val PARSER = Json { ignoreUnknownKeys = true }
    }

    private val app: KiloBackendAppService get() = service()

    override suspend fun agents(directory: String): List<AgentDetailDto> {
        app.requireReady()
        val api = app.api ?: throw IllegalStateException("Kilo API is unavailable")
        return withContext(Dispatchers.IO) { api.appAgents(directory = directory) }.map { item ->
            AgentDetailDto(
                name = item.name,
                displayName = item.displayName,
                description = item.description,
                mode = item.mode.value,
                native = item.native,
                hidden = item.hidden,
                deprecated = item.deprecated,
                permission = rules(item.permission),
            )
        }
    }

    override suspend fun skills(directory: String): List<SkillDto> = get(directory, "/skill").array().mapNotNull { item ->
        val obj = item.jsonObject
        val name = obj.string("name") ?: return@mapNotNull null
        val location = obj.string("location") ?: return@mapNotNull null
        SkillDto(name = name, description = obj.string("description"), location = location)
    }

    override suspend fun removeSkill(directory: String, location: String): Boolean =
        post(directory, "/kilocode/skill/remove", JsonObject(mapOf("location" to JsonPrimitive(location))))

    override suspend fun removeAgent(directory: String, name: String): Boolean =
        post(directory, "/kilocode/agent/remove", JsonObject(mapOf("name" to JsonPrimitive(name))))

    override suspend fun createAgent(directory: String, input: AgentCreateDto): Boolean {
        app.requireReady()
        val api = app.api ?: throw IllegalStateException("Kilo API is unavailable")
        val req = AgentBuilderSaveRequest(
            prompt = input.prompt,
            id = input.name,
            scope = scope(input.scope),
            description = input.description,
            mode = mode(input.mode),
        )
        withContext(Dispatchers.IO) {
            api.agentBuilderSave(input.name, directory = directory, workspace = null, agentBuilderSaveRequest = req)
        }
        return true
    }

    override suspend fun commands(directory: String): List<CommandDto> = get(directory, "/command").array().mapNotNull { item ->
        val obj = item.jsonObject
        val name = obj.string("name") ?: return@mapNotNull null
        CommandDto(
            name = name,
            description = obj.string("description"),
            source = obj.string("source"),
            template = obj.string("template"),
        )
    }

    override suspend fun mcpStatus(directory: String): List<McpStatusDto> = get(directory, "/mcp").let { root ->
        when (root) {
            is JsonArray -> root.mapNotNull(::mcp)
            is JsonObject -> root.mapNotNull { (name, item) -> mcp(item, name) }
            else -> emptyList()
        }
    }

    override suspend fun mcpConnect(directory: String, name: String): Boolean = post(directory, "/mcp/${encodePath(name)}/connect")

    override suspend fun mcpDisconnect(directory: String, name: String): Boolean = post(directory, "/mcp/${encodePath(name)}/disconnect")

    override suspend fun mcpAuthenticate(directory: String, name: String): Boolean =
        post(directory, "/mcp/${encodePath(name)}/auth/authenticate")

    override suspend fun claudeCodeCompat(): Boolean = KiloClaudeCompatSettings.get()

    override suspend fun setClaudeCodeCompat(value: Boolean): Boolean {
        KiloClaudeCompatSettings.set(value)
        app.restart()
        return value
    }

    private suspend fun get(directory: String, path: String): JsonElement {
        val raw = request(directory, path, null)
        return PARSER.parseToJsonElement(raw)
    }

    private suspend fun post(directory: String, path: String, body: JsonObject = JsonObject(emptyMap())): Boolean {
        request(directory, path, body)
        return true
    }

    private suspend fun request(directory: String, path: String, body: JsonObject?): String = withContext(Dispatchers.IO) {
        val http = app.http ?: throw IllegalStateException("Kilo HTTP client is unavailable")
        val url = "http://127.0.0.1:${app.port}$path?directory=${encode(directory)}"
        val request = Request.Builder().url(url).let { builder ->
            if (body == null) builder.get() else builder.post(body.toString().toRequestBody(JSON))
        }.build()
        http.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                LOG.warn("Agent Behavior request failed: $path HTTP ${response.code}: $text")
                throw RuntimeException("HTTP ${response.code}: $text")
            }
            text.ifBlank { "{}" }
        }
    }

    private fun rules(cfg: Any?): List<PermissionRuleItemDto> {
        val list = cfg as? List<*> ?: return emptyList()
        return list.mapNotNull { item ->
            val obj = item ?: return@mapNotNull null
            val tool = prop(obj, "tool") as? String ?: return@mapNotNull null
            val action = prop(obj, "action") as? String ?: return@mapNotNull null
            PermissionRuleItemDto(tool = tool, pattern = prop(obj, "pattern") as? String, action = action)
        }
    }

    private fun mcp(item: JsonElement, fallback: String? = null): McpStatusDto? {
        val obj = item.jsonObject
        val name = obj.string("name") ?: fallback ?: return null
        return McpStatusDto(
            name = name,
            status = obj.string("status") ?: obj.string("state") ?: "unknown",
            error = obj.string("error"),
        )
    }

    private fun JsonElement.array(): JsonArray = when (this) {
        is JsonArray -> this
        is JsonObject -> this["data"] as? JsonArray ?: JsonArray(emptyList())
        else -> JsonArray(emptyList())
    }

    private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

    private fun prop(obj: Any, name: String): Any? {
        val suffix = name.replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }
        val getter = obj.javaClass.methods.firstOrNull { it.parameterCount == 0 && it.name == "get$suffix" }
            ?: obj.javaClass.methods.firstOrNull { it.parameterCount == 0 && it.name == name }
        return getter?.invoke(obj)
    }

    private fun scope(value: String): AgentBuilderSaveRequest.Scope = when (value) {
        AgentBuilderSaveRequest.Scope.GLOBAL.value -> AgentBuilderSaveRequest.Scope.GLOBAL
        else -> AgentBuilderSaveRequest.Scope.PROJECT
    }

    private fun mode(value: String): AgentBuilderSaveRequest.Mode = when (value) {
        AgentBuilderSaveRequest.Mode.SUBAGENT.value -> AgentBuilderSaveRequest.Mode.SUBAGENT
        AgentBuilderSaveRequest.Mode.ALL.value -> AgentBuilderSaveRequest.Mode.ALL
        else -> AgentBuilderSaveRequest.Mode.PRIMARY
    }

    private fun encode(value: String): String = URLEncoder.encode(value, StandardCharsets.UTF_8)

    private fun encodePath(value: String): String = encode(value).replace("+", "%20")
}
