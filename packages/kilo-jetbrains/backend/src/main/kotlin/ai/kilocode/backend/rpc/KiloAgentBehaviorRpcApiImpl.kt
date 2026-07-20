@file:Suppress("UnstableApiUsage")

package ai.kilocode.backend.rpc

import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.cli.KiloClaudeCompatSettings
import ai.kilocode.backend.cli.KiloCliDataParser
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.KiloAgentBehaviorRpcApi
import ai.kilocode.rpc.dto.AgentCreateDto
import ai.kilocode.rpc.dto.AgentDetailDto
import ai.kilocode.jetbrains.api.model.AgentBuilderSaveRequest
import ai.kilocode.rpc.dto.ConfigPatchDto
import ai.kilocode.rpc.dto.McpConfigDto
import ai.kilocode.rpc.dto.McpServerConfigDto
import ai.kilocode.rpc.dto.PermissionRuleItemDto
import ai.kilocode.rpc.dto.SkillDto
import com.intellij.openapi.components.service
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import com.intellij.openapi.util.SystemInfo
import java.net.URLEncoder
import java.nio.file.Files
import java.nio.file.InvalidPathException
import java.nio.file.Path
import java.nio.charset.StandardCharsets
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

class KiloAgentBehaviorRpcApiImpl(private val backend: KiloBackendAppService? = null) : KiloAgentBehaviorRpcApi {
    companion object {
        private val LOG = KiloLog.create(KiloAgentBehaviorRpcApiImpl::class.java)
        private val JSON = "application/json".toMediaType()
        private val saved = ConcurrentHashMap<String, SavedMcp>()
        private val port = AtomicInteger(-1)
        private val extensions = setOf("md", "markdown", "txt", "text", "html", "htm")
    }

    private val app: KiloBackendAppService get() = backend ?: service()

    override suspend fun agents(directory: String): List<AgentDetailDto> {
        app.requireReady()
        val api = app.api ?: throw IllegalStateException("Kilo API is unavailable")
        val removable = KiloCliDataParser.parseAgentRemovable(request(directory, "/agent", null))
        return withContext(Dispatchers.IO) { api.appAgents(directory = directory) }.map { item ->
            AgentDetailDto(
                name = item.name,
                displayName = item.displayName,
                description = item.description,
                mode = item.mode.value,
                native = item.native,
                removable = removable[item.name] ?: false,
                hidden = item.hidden,
                deprecated = item.deprecated,
                permission = rules(item.permission),
            )
        }
    }

    override suspend fun skills(directory: String): List<SkillDto> {
        val items = KiloCliDataParser.parseAgentBehaviorSkills(request(directory, "/skill", null))
        return items.map { item ->
            val editable = editable(item)
            item.copy(content = skillContent(item) ?: item.content, editable = editable)
        }
    }

    override suspend fun removeSkill(directory: String, location: String): Boolean =
        post(directory, "/kilocode/skill/remove", JsonObject(mapOf("location" to JsonPrimitive(location))))

    override suspend fun reloadSkills(directory: String): Boolean {
        LOG.info("Skills reload requested dir=$directory")
        if (hasActiveSession(directory)) {
            LOG.warn("Skills reload blocked by active session dir=$directory")
            return false
        }
        runCatching { post(directory, "/instance/reload") }.onFailure { err ->
            LOG.warn("Skills reload failed dir=$directory", err)
        }.getOrThrow()
        LOG.info("Skills reload succeeded dir=$directory")
        return true
    }

    override suspend fun saveSkill(directory: String, location: String, content: String): Boolean {
        LOG.info("Skill save requested dir=$directory location=$location")
        app.requireReady()
        val raw = normalizeWorkspacePath(location) ?: run {
            LOG.warn("Skill save rejected: invalid location dir=$directory location=$location")
            return false
        }
        val path = try {
            Path.of(raw).normalize()
        } catch (err: InvalidPathException) {
            LOG.warn("Skill save rejected: invalid path dir=$directory location=$location", err)
            return false
        }
        if (!path.isAbsolute || !isSkillFile(path)) {
            LOG.warn("Skill save rejected: not a skill file dir=$directory path=$path")
            return false
        }
        if (!knownSkill(directory, path)) {
            LOG.warn("Skill save rejected: unknown skill dir=$directory path=$path")
            return false
        }
        withContext(Dispatchers.IO) {
            Files.writeString(path, content, StandardCharsets.UTF_8)
        }
        LOG.info("Skill file saved dir=$directory path=$path bytes=${content.toByteArray(StandardCharsets.UTF_8).size}")
        LOG.info("Skill save reload deferred dir=$directory path=$path")
        return true
    }

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

    override suspend fun commands(directory: String) = KiloCliDataParser.parseAgentBehaviorCommands(request(directory, "/command", null))

    override suspend fun mcpStatus(directory: String) = KiloCliDataParser.parseMcpStatus(request(directory, "/mcp", null)).also { items ->
        LOG.info("MCP status returned dir=$directory count=${items.size}")
    }

    override suspend fun mcpConfig(directory: String): Map<String, McpServerConfigDto> {
        app.requireReady()
        val global = app.config?.mcp ?: emptyMap()
        val workspace = if (directory.isBlank()) emptyMap() else try {
            KiloCliDataParser.parseConfig(request(directory, "/config", null)).mcp
        } catch (e: Exception) {
            LOG.warn("MCP workspace config fetch failed dir=$directory: ${e.message}", e)
            emptyMap()
        }
        val items = buildMap {
            for (name in global.keys + workspace.keys) {
                val ws = workspace[name]
                val gl = global[name]
                val cfg = ws ?: gl ?: continue
                val scope = if (ws != null && (gl == null || ws != gl)) "workspace" else "global"
                put(name, McpServerConfigDto(cfg, scope))
            }
        }
        return withSavedMcp(directory, items)
    }

    override suspend fun saveMcp(directory: String, name: String, scope: String, config: McpConfigDto?): Boolean {
        app.requireReady()
        val patch = ConfigPatchDto(mcp = mapOf(name to config))
        if (scope == "workspace") {
            patchConfig("/config?directory=${encode(directory)}", KiloCliDataParser.buildConfigPatch(patch))
        } else {
            app.updateConfig(patch)
        }
        saveMcpOverride(directory, name, scope, config)
        return true
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

    private suspend fun post(directory: String, path: String, body: JsonObject = JsonObject(emptyMap())): Boolean {
        request(directory, path, body)
        return true
    }

    private fun hasActiveSession(directory: String): Boolean {
        val active = app.sessions.statuses.value.filterValues { it.type != "idle" }
        if (active.isNotEmpty()) {
            LOG.info("Skills reload active statuses dir=$directory count=${active.size} types=${active.values.map { it.type }.distinct()}")
            return true
        }
        val permissions = runCatching { app.chat.pendingPermissions(directory) }.onFailure { err ->
            LOG.warn("Skills reload pending permission check failed dir=$directory", err)
        }.getOrDefault(emptyList())
        if (permissions.isNotEmpty()) {
            LOG.info("Skills reload pending permissions dir=$directory count=${permissions.size}")
            return true
        }
        val questions = runCatching { app.chat.pendingQuestions(directory) }.onFailure { err ->
            LOG.warn("Skills reload pending question check failed dir=$directory", err)
        }.getOrDefault(emptyList())
        if (questions.isNotEmpty()) {
            LOG.info("Skills reload pending questions dir=$directory count=${questions.size}")
            return true
        }
        return false
    }

    private suspend fun skillContent(skill: SkillDto): String? {
        val raw = normalizeWorkspacePath(skill.location) ?: return null
        val path = try {
            Path.of(raw).normalize()
        } catch (_: InvalidPathException) {
            return null
        }
        if (!path.isAbsolute || !isSkillFile(path)) return null
        return runCatching {
            withContext(Dispatchers.IO) {
                if (!Files.isRegularFile(path)) null else Files.readString(path, StandardCharsets.UTF_8)
            }
        }.onFailure { err ->
            LOG.warn("Skill content read failed: $path", err)
        }.getOrNull()
    }

    private fun editable(skill: SkillDto): Boolean {
        val raw = normalizeWorkspacePath(skill.location) ?: return false
        val path = try {
            Path.of(raw).normalize()
        } catch (_: InvalidPathException) {
            return false
        }
        if (!path.isAbsolute || !isSkillFile(path)) return false
        if (urlCached(path)) return false
        return true
    }

    private suspend fun knownSkill(directory: String, path: Path): Boolean {
        val items = KiloCliDataParser.parseAgentBehaviorSkills(request(directory, "/skill", null))
        return items.any { item -> editable(item) && skillPath(item.location) == path }
    }

    private fun skillPath(location: String): Path? {
        val raw = normalizeWorkspacePath(location) ?: return null
        val path = try {
            Path.of(raw).normalize()
        } catch (_: InvalidPathException) {
            return null
        }
        if (!path.isAbsolute || !isSkillFile(path)) return null
        return path
    }

    private fun urlCached(path: Path): Boolean {
        val root = Path.of(cacheRoot(), "kilo", "skills").normalize()
        if (path.startsWith(root)) return true
        val parts = (0 until path.nameCount).map { path.getName(it).toString() }
        return parts.windowed(3).any { it[1] == "kilo" && it[2] == "skills" && it[0] in cacheNames }
    }

    private fun cacheRoot(): String {
        val xdg = System.getenv("XDG_CACHE_HOME")?.takeIf { it.isNotBlank() }
        if (xdg != null) return xdg
        val home = System.getProperty("user.home")
        if (SystemInfo.isMac) return Path.of(home, "Library", "Caches").toString()
        if (SystemInfo.isWindows) return System.getenv("LOCALAPPDATA")?.takeIf { it.isNotBlank() }
            ?: Path.of(home, "AppData", "Local").toString()
        return Path.of(home, ".cache").toString()
    }

    private suspend fun patchConfig(path: String, body: String): Unit = withContext(Dispatchers.IO) {
        val http = app.http ?: throw IllegalStateException("Kilo HTTP client is unavailable")
        val url = "http://127.0.0.1:${app.port}$path"
        val request = Request.Builder().url(url).patch(body.toRequestBody(JSON)).build()
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                LOG.warn("MCP config patch failed: $path HTTP ${response.code}")
                throw RuntimeException("HTTP ${response.code}")
            }
        }
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
                LOG.warn("Agent Behavior request failed: $path HTTP ${response.code}")
                throw RuntimeException("HTTP ${response.code}")
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

    private fun withSavedMcp(directory: String, items: Map<String, McpServerConfigDto>): Map<String, McpServerConfigDto> = buildMap {
        syncSaved()
        putAll(items)
        for (item in saved.values) {
            if (item.scope == "workspace" && item.directory != directory) continue
            val cfg = item.config ?: continue
            put(item.name, McpServerConfigDto(cfg, item.scope))
        }
    }

    private fun saveMcpOverride(directory: String, name: String, scope: String, config: McpConfigDto?) {
        syncSaved()
        val key = mcpKey(if (scope == "workspace") directory else "", name)
        saved.remove(mcpKey(directory, name))
        saved.remove(mcpKey("", name))
        if (config == null) {
            saved.remove(key)
            return
        }
        saved[key] = SavedMcp(
            directory = if (scope == "workspace") directory else "",
            name = name,
            scope = scope,
            config = config,
        )
    }

    private fun mcpKey(directory: String, name: String): String = "$directory\u0000$name"

    private fun syncSaved() {
        val current = runCatching { app.port }.getOrDefault(-1)
        val prev = port.getAndSet(current)
        if (prev != current) saved.clear()
    }

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

    private fun isSkillFile(path: Path): Boolean {
        val name = path.fileName?.toString() ?: return false
        if (name == "SKILL.md") return true
        return name.substringAfterLast('.', "").lowercase() in extensions
    }

    private data class SavedMcp(
        val directory: String,
        val name: String,
        val scope: String,
        val config: McpConfigDto?,
    )
}

private val cacheNames = setOf(".cache", "cache", "Caches")
