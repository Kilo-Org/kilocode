package ai.kilocode.backend.workspace

import ai.kilocode.backend.v2.V2Client
import ai.kilocode.backend.v2.V2HttpException
import ai.kilocode.rpc.dto.AgentDto
import ai.kilocode.rpc.dto.AgentsDto
import ai.kilocode.rpc.dto.CommandDto
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.ConfigPatchDto
import ai.kilocode.rpc.dto.ConfigTargetDto
import ai.kilocode.rpc.dto.LoadErrorDto
import ai.kilocode.rpc.dto.ModelsWorkspaceDto
import ai.kilocode.rpc.dto.ProviderDto
import ai.kilocode.rpc.dto.ProvidersDto
import ai.kilocode.rpc.dto.SkillDto
import ai.kilocode.rpc.dto.WorkspaceFileDto
import ai.kilocode.rpc.isManagedWorktreeStorage
import com.intellij.openapi.util.io.FileUtil
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.nio.file.Path

internal class KiloWorkspaceData(private val client: V2Client, directory: String? = null) {
    private val directory = directory?.let(::canonicalDirectory)
    private val location = this.directory?.let { mapOf("location[directory]" to it) }.orEmpty()

    private suspend fun list(operation: String): List<JsonObject> =
        client.call(operation, query = location).jsonObject.getValue("data").jsonArray.map { it.jsonObject }

    private suspend fun rpc(id: String, method: String, input: JsonObject = buildJsonObject {}): JsonElement {
        val body = buildJsonObject { put("input", input) }
        // A newly opened location can be serving requests before its plugins have registered.
        for (attempt in 0..5) {
            try {
                return client.call("rpc.call", mapOf("rpcID" to id, "method" to method), location, body)
                    .jsonObject["output"] ?: JsonNull
            } catch (e: V2HttpException) {
                val type = runCatching { Json.parseToJsonElement(e.body).jsonObject.text("type") }.getOrNull()
                if (type != "rpc.unavailable" || method in setOf("write", "removeSnapshot") || attempt == 5) throw e
                delay(100L shl attempt)
            }
        }
        error("Unreachable")
    }

    suspend fun files(query: String, limit: Int): List<WorkspaceFileDto> {
        val entries = client.call("fs.find", query = location + mapOf("query" to query, "limit" to "$limit"))
            .jsonObject.getValue("data").jsonArray
        return entries.map { it.jsonObject }.mapNotNull { entry ->
            val path = entry.required("path").trimEnd('/')
            if (path.isBlank() || isManagedWorktreeStorage(path)) null
            else WorkspaceFileDto(path, path.substringAfterLast('/'), entry.text("type") == "directory")
        }
    }

    suspend fun agents(): AgentsDto = coroutineScope {
        val config = async { nativeDocuments().asReversed().firstNotNullOfOrNull { it.obj("info")?.text("default_agent") } }
        val all = list("agent.list").map {
            AgentDto(name = it.required("id"), displayName = it.text("name"), description = it.text("description"),
                mode = it.required("mode"), hidden = it.flag("hidden"), color = it.text("color"))
        }
        val visible = all.filter { it.mode != "subagent" && it.hidden != true }
        val default = config.await()
        AgentsDto(visible, all, visible.firstOrNull { it.name == default }?.name
            ?: visible.firstOrNull { it.name == "code" }?.name ?: visible.firstOrNull()?.name.orEmpty())
    }

    suspend fun commands(): List<CommandDto> = list("command.list").map {
        CommandDto(it.required("name"), it.text("description"), model = selection(it["model"]),
            variant = variant(it["model"]), template = it.text("template"))
    }

    suspend fun skills(): List<SkillDto> = coroutineScope {
        val removable = async { rpc("kilocode.skill", "removable").jsonArray.map { it.jsonPrimitive.content }.toSet() }
        val all = list("skill.list")
        val paths = removable.await()
        all.map {
            val path = it.required("path")
            SkillDto(it.required("name"), it.text("description"), path, it.text("content"), path in paths)
        }
    }

    suspend fun providers(): ProvidersDto = coroutineScope {
        val sources = async { list("provider.list") }
        val entries = async { list("model.list") }
        val default = async { client.call("model.default", query = location).jsonObject["data"] as? JsonObject }
        val gateway = async {
            try {
                rpc("kilocode.gateway", "models").jsonArray.map { it.jsonObject }.associateBy { it.required("id") }
            } catch (_: V2HttpException) { emptyMap() }
        }
        val catalog = gateway.await()
        val models = entries.await().filter { it.flag("enabled") != false }.groupBy { it.required("providerID") }
        val providers = sources.await().map { source ->
            val id = source.required("id")
            val rows = models[id].orEmpty().map { model ->
                val meta = if (id == "kilo") catalog[model.text("modelID")] ?: catalog[model.text("id")] else null
                pickerModel(model, meta)
            }
            ProviderDto(id, source.required("name"), source.text("activation"), rows.associateBy { it.id })
        }
        val chosen = default.await()
        ProvidersDto(providers, providers.filter { it.models.isNotEmpty() }.map { it.id },
            chosen?.let { mapOf(it.required("providerID") to it.required("id")) }.orEmpty())
    }

    suspend fun models(): ModelsWorkspaceDto = coroutineScope {
        val sources = async { loadResource { providers() } }
        val modes = async { loadResource { agents() } }
        val p = sources.await()
        val a = modes.await()
        ModelsWorkspaceDto(p.getOrNull(), a.getOrNull(), listOfNotNull(
            p.exceptionOrNull()?.let { LoadErrorDto("providers", detail = it.message) },
            a.exceptionOrNull()?.let { LoadErrorDto("agents", detail = it.message) },
        ))
    }

    private suspend fun nativeDocuments() = client.call("config.get", query = location).jsonArray.map { it.jsonObject }
        .filter { it.text("type") == "document" }

    private suspend fun readSettings(scope: String) = rpc("kilocode.settings", "read", scope(scope)).jsonObject

    private suspend fun document(written: Map<String, Set<String>> = emptyMap()): JsonObject = coroutineScope {
        if (directory == null) return@coroutineScope readSettings("global").getValue("document").jsonObject
        val native = async { nativeDocuments() }
        val global = async { readSettings("global") }
        val project = async { readSettings("project") }
        // config.get normalizes upstream fields but omits Kilo keys. The settings RPC serves the file bytes as JSON
        // immediately after a write, even before the location watcher has reloaded its normalized documents.
        val sources = listOf(global.await(), project.await()).filter { it.obj("target")?.flag("exists") != false }
        val byPath = sources.associate { it.getValue("target").jsonObject.required("path") to it.getValue("document").jsonObject }
        val docs = native.await()
        val loaded = docs.mapNotNull { it.text("path") }.toSet()
        fun extra(scope: String) = sources.firstOrNull { it.text("scope") == scope && it.obj("target")?.text("path") !in loaded }
            ?.get("document")?.jsonObject.orEmpty()
        val merged = extra("global").toMutableMap()
        for (entry in docs) {
            val path = entry.text("path")
            val raw = byPath[path]
            val info = entry.getValue("info").jsonObject.toMutableMap()
            val keys = written[path].orEmpty()
            keys.forEach(info::remove)
            raw?.filterKeys { it in kiloKeys || it in keys }?.let(info::putAll)
            merged.putAll(info)
        }
        merged.putAll(extra("project"))
        JsonObject(merged)
    }

    suspend fun config(): ConfigDto = workspaceConfig(document())

    suspend fun target(scope: String): ConfigTargetDto {
        val result = rpc("kilocode.settings", "target", scope(scope)).jsonObject
        val path = result.required("path")
        return ConfigTargetDto(path, FileUtil.getLocationRelativeToUserHome(path, false), result.flag("exists") == true)
    }

    suspend fun updateConfig(patch: ConfigPatchDto, scope: String = if (directory == null) "global" else "project"): ConfigDto {
        require(patch.retention == null || scope == "global") { "Retention is a machine-wide setting." }
        val read = readSettings(scope)
        val target = read.getValue("target").jsonObject
        val current = document()
        val set = workspacePatch(patch, current)
        rpc("kilocode.settings", "write", buildJsonObject {
            put("scope", scope)
            put("set", set)
            target.text("revision")?.let { put("expected", buildJsonObject { put("path", target.required("path")); put("revision", it) }) }
        })
        return workspaceConfig(document(mapOf(target.required("path") to set.keys)))
    }

    suspend fun evict() { client.call("debug.location.evict", query = location) }

    suspend fun sessionSource(id: String): String {
        val path = mapOf("sessionID" to id)
        client.call("session.interrupt", path)
        return client.call("session.get", path).jsonObject.getValue("data").jsonObject
            .getValue("location").jsonObject.required("directory")
    }

    /** Includes archived and child sessions; neither should disappear from history when their checkout goes away. */
    suspend fun prepareRemoval(): List<String> = coroutineScope {
        val ids = async {
            val sessions = mutableListOf<String>()
            var query = mapOf("directory" to requireNotNull(directory), "limit" to "100")
            while (true) {
                val page = client.call("session.list", query = query).jsonObject
                sessions += page.getValue("data").jsonArray.map { it.jsonObject.required("id") }
                val next = page.obj("cursor")?.text("next") ?: break
                query = mapOf("cursor" to next, "limit" to "100")
            }
            sessions
        }
        val active = async { client.call("session.active").jsonObject.getValue("data").jsonObject }
        val permissions = async { list("permission.request.list") }
        val forms = async { list("form.list") }
        val sessions = ids.await()
        val busy = active.await()
        check(sessions.none(busy::containsKey) && permissions.await().isEmpty() && forms.await().isEmpty()) {
            "Cannot remove a worktree while a session is active or waiting for input"
        }
        evict()
        sessions
    }

    suspend fun rehome(session: String, root: String) {
        client.call("session.move", mapOf("sessionID" to session), body = buildJsonObject { put("directory", root) })
    }

    suspend fun removeSnapshot(path: String) {
        rpc("kilocode.agent-manager", "removeSnapshot", buildJsonObject { put("worktree", path) })
    }

    private fun scope(scope: String) = buildJsonObject { put("scope", scope) }

    private companion object {
        val kiloKeys = setOf("subagent_model", "subagent_variant", "shared_agent_board", "retention")
    }
}

internal fun canonicalDirectory(path: String): String = runCatching { Path.of(path).toRealPath().toString() }.getOrDefault(path)

internal suspend fun <T> loadResource(block: suspend () -> T): Result<T> = try {
    Result.success(block())
} catch (e: CancellationException) {
    throw e
} catch (e: Exception) {
    Result.failure(e)
}
