@file:Suppress("UnstableApiUsage")

package ai.kilocode.backend.rpc

import ai.kilocode.backend.cli.KiloBackendCliManager
import ai.kilocode.backend.cli.KiloClaudeCompatSettings
import ai.kilocode.backend.settings.*
import ai.kilocode.backend.v2.V2Client
import ai.kilocode.backend.workspace.KiloWorkspaceData
import ai.kilocode.rpc.KiloAgentBehaviorRpcApi
import ai.kilocode.rpc.dto.*
import com.intellij.openapi.components.service
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.Path
import java.nio.file.StandardOpenOption
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*

internal class KiloAgentBehaviorRpcApiImpl(
    private val client: suspend () -> V2Client = ::settingsClient
) : KiloAgentBehaviorRpcApi {
    private val login = IntegrationLogin(client)
    private val authEvents = MutableSharedFlow<McpAuthEventDto>()

    override suspend fun agents(directory: String): List<AgentDetailDto> {
        val api = client()
        val removable =
            api.plugin("kilocode.agent", "removable", directory)
                .jsonArray
                .map { it.jsonObject.required("name") }
                .toSet()
        return api.data("agent.list", directory).jsonArray.map { value ->
            val row = value.jsonObject
            val id = row.required("id")
            AgentDetailDto(
                id,
                row.text("name"),
                row.text("description"),
                row.required("mode"),
                removable = id in removable,
                hidden = row["hidden"]?.jsonPrimitive?.boolean,
                permission =
                    row.rows("permissions").map {
                        PermissionRuleItemDto(
                            it.required("action"),
                            it.text("resource"),
                            it.required("effect"),
                        )
                    },
            )
        }
    }

    override suspend fun removeAgent(directory: String, name: String): Boolean {
        client().plugin("kilocode.agent", "remove", directory, mapOf("name" to name).asJson())
        return true
    }

    override suspend fun createAgent(directory: String, input: AgentCreateDto): Boolean {
        require(
            Regex("[A-Za-z0-9_-]+").matches(input.name) &&
                input.mode in setOf("primary", "subagent", "all")
        )
        val root = if (input.scope == "global") globalRoot(directory) else projectRoot(directory)
        return withContext(Dispatchers.IO) {
            val file = root.resolve("agents").resolve(input.name + ".md")
            if (!writableUnder(file, root)) return@withContext false
            Files.createDirectories(file.parent)
            Files.writeString(
                file,
                buildString {
                    appendLine("---")
                    appendLine("mode: ${input.mode}")
                    input.description?.let { appendLine("description: ${JsonPrimitive(it)}") }
                    appendLine("---")
                    append(input.prompt)
                },
                StandardOpenOption.CREATE_NEW,
            )
            true
        }
    }

    override suspend fun skills(directory: String): List<SkillDto> {
        val items = KiloWorkspaceData(client(), directory).skills()
        return withContext(Dispatchers.IO) {
            items.map { skill ->
                if (!skill.editable) skill
                else skill.copy(content = Files.readString(Path.of(skill.location)))
            }
        }
    }

    override suspend fun removeSkill(directory: String, location: String): Boolean {
        client().plugin("kilocode.skill", "remove", directory, mapOf("path" to location).asJson())
        return true
    }

    override suspend fun saveSkill(directory: String, location: String, content: String) =
        saveSkills(directory, mapOf(location to content))

    override suspend fun saveSkills(directory: String, edits: Map<String, String>): Boolean {
        val known =
            client()
                .plugin("kilocode.skill", "removable", directory)
                .jsonArray
                .map { it.jsonPrimitive.content }
                .toSet()
        if (!known.containsAll(edits.keys)) return false
        return withContext(Dispatchers.IO) {
            edits.forEach { (path, value) -> Files.writeString(Path.of(path), value) }
            true
        }
    }

    override suspend fun reloadSkills(directory: String) = reload(directory)

    override suspend fun reloadCommands(directory: String) = reload(directory)

    private suspend fun reload(directory: String): Boolean {
        val api = client()
        if (
            api.data("session.active").jsonObject.isNotEmpty() ||
                api.data("permission.request.list", directory).jsonArray.isNotEmpty() ||
                api.data("form.list", directory).jsonArray.isNotEmpty()
        )
            return false
        api.call("location.reload")
        return true
    }

    override suspend fun commands(directory: String) =
        KiloWorkspaceData(client(), directory).commands()

    private suspend fun globalRoot(directory: String) =
        Path.of(KiloWorkspaceData(client(), directory).target("global").path).parent

    private fun projectRoot(directory: String) =
        Path.of(directory).also { require(it.isAbsolute) }.normalize().resolve(".kilo2")

    private suspend fun commandRoots(directory: String): List<Path> {
        val writable = buildList {
            add(globalRoot(directory))
            if (directory.isNotBlank()) add(projectRoot(directory))
        }
        return writable.flatMap { root ->
            listOf(root.resolve("commands"), root.resolve("command"))
        }
    }

    private fun writableUnder(path: Path, root: Path): Boolean {
        if (!path.normalize().startsWith(root.normalize()) || path.normalize() != path) return false
        return generateSequence(path) { it.parent }
            .takeWhile { it != root.parent }
            .none(Files::isSymbolicLink)
    }

    override suspend fun commandFiles(directory: String): List<CommandFileDto> {
        val roots = commandRoots(directory)
        val commands = commands(directory).associateBy { it.name }
        val files =
            withContext(Dispatchers.IO) {
                roots
                    .filter { Files.isDirectory(it, LinkOption.NOFOLLOW_LINKS) }
                    .flatMap { root ->
                        Files.walk(root).use { files ->
                            files
                                .filter { file ->
                                    file.toString().endsWith(".md") &&
                                        Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS) &&
                                        writableUnder(file, root.parent)
                                }
                                .map { path ->
                                    val name =
                                        root.relativize(path).joinToString("/").removeSuffix(".md")
                                    val info = commands[name]
                                    CommandFileDto(
                                        name,
                                        info?.description,
                                        info?.agent,
                                        info?.model,
                                        info?.variant,
                                        "command",
                                        location = path.toString(),
                                        editable = true,
                                        content = Files.readString(path),
                                        subtask = info?.subtask,
                                    )
                                }
                                .toList()
                        }
                    }
            }
        val withFiles = files.mapTo(mutableSetOf()) { it.name }
        // Registry-only commands have no editable manifest, but remain viewable in Settings.
        return files +
            commands.values
                .filterNot { it.name in withFiles }
                .map { cmd ->
                    CommandFileDto(
                        cmd.name,
                        cmd.description,
                        cmd.agent,
                        cmd.model,
                        cmd.variant,
                        cmd.source,
                        builtin = true,
                        location = "builtin",
                        content = cmd.template,
                        subtask = cmd.subtask,
                        hints = cmd.hints,
                    )
                }
    }

    override suspend fun removeCommand(directory: String, location: String): Boolean {
        val roots = commandRoots(directory)
        val path = Path.of(location)
        return withContext(Dispatchers.IO) {
            path.toString().endsWith(".md") &&
                roots.any { path.startsWith(it) && writableUnder(path, it.parent) } &&
                Files.deleteIfExists(path)
        }
    }

    override suspend fun saveCommands(directory: String, edits: Map<String, String>): Boolean {
        val roots = commandRoots(directory)
        return withContext(Dispatchers.IO) {
            val files = edits.mapKeys { Path.of(it.key) }
            if (
                !files.keys.all { p ->
                    p.toString().endsWith(".md") &&
                        roots.any { p.startsWith(it) && writableUnder(p, it.parent) }
                }
            )
                return@withContext false
            files.forEach { (p, v) ->
                Files.createDirectories(p.parent)
                Files.writeString(p, v)
            }
            true
        }
    }

    private suspend fun servers(directory: String) =
        client().data("mcp.list", directory).jsonArray.map { it.jsonObject }

    override suspend fun mcpStatus(directory: String) =
        servers(directory).map {
            McpStatusDto(
                it.required("name"),
                it.obj("status").required("status"),
                it.obj("status").text("error"),
            )
        }

    override suspend fun mcpConfig(directory: String): Map<String, McpServerConfigDto> {
        val scopes = if (directory.isBlank()) listOf("global") else listOf("global", "project")
        return scopes
            .flatMap { scope ->
                client().document(directory, scope).obj("mcp").obj("servers").map { (name, value) ->
                    name to
                        McpServerConfigDto(
                            McpSettingsCodec.read(value.jsonObject),
                            if (scope == "global") scope else "workspace",
                        )
                }
            }
            .toMap()
    }

    override suspend fun saveMcp(
        directory: String,
        name: String,
        scope: String,
        config: McpConfigDto?,
    ): Boolean {
        client()
            .write(
                directory,
                if (scope == "workspace") "project" else scope,
                buildJsonObject {
                    put(
                        "mcp",
                        buildJsonObject {
                            put(
                                "servers",
                                buildJsonObject {
                                    put(name, config?.let(McpSettingsCodec::write) ?: JsonNull)
                                },
                            )
                        },
                    )
                },
            )
        return true
    }

    override suspend fun mcpConnect(directory: String, name: String): Boolean {
        client().call("experimental.mcp.connect", mapOf("server" to name), location(directory))
        return true
    }

    override suspend fun mcpDisconnect(directory: String, name: String): Boolean {
        client().call("experimental.mcp.disconnect", mapOf("server" to name), location(directory))
        return true
    }

    private suspend fun integration(directory: String, name: String) =
        servers(directory).single { it.text("name") == name }.required("integrationID")

    override suspend fun mcpAuthenticate(directory: String, name: String): McpAuthResultDto {
        val server =
            servers(directory).find { it.text("name") == name }
                ?: return McpAuthResultDto("not_found")
        val id = server.text("integrationID") ?: return McpAuthResultDto("unsupported")
        val api = client()
        val method =
            api.data("integration.get", directory, mapOf("integrationID" to id))
                .jsonObject
                .rows("methods")
                .firstOrNull { it.text("type") == "oauth" }
                ?: return McpAuthResultDto("unsupported")
        return try {
            val attempt = login.begin(directory, id, method.required("id"))
            authEvents.emit(McpAuthEventDto(name, attempt.required("url"), external = true))
            login.finish(directory, id)
            mcpConnect(directory, name)
            val status = mcpStatus(directory).single { it.name == name }
            McpAuthResultDto(status.status, status.error)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            McpAuthResultDto("failed", e.message)
        }
    }

    override suspend fun mcpAuthCancel(directory: String, name: String): Boolean {
        login.cancel(directory, integration(directory, name))
        return true
    }

    override suspend fun mcpAuthRemove(directory: String, name: String): Boolean {
        val id = integration(directory, name)
        login.cancel(directory, id)
        client().removeConnections(directory, id)
        return true
    }

    override suspend fun mcpAuthEvents() = authEvents.asSharedFlow()

    override suspend fun claudeCodeCompat() = KiloClaudeCompatSettings.get()

    override suspend fun setClaudeCodeCompat(value: Boolean): Boolean {
        KiloClaudeCompatSettings.set(value)
        service<KiloBackendCliManager>().restart()
        return value
    }
}
