package ai.kilocode.backend.migration

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import ai.kilocode.backend.migration.LegacyMigrationJson.json
import ai.kilocode.backend.migration.LegacyMigrationJson.obj
import ai.kilocode.backend.migration.LegacyMigrationJson.str
import ai.kilocode.backend.migration.LegacyMigrationJson.arr

/**
 * Pure conversion functions: parse legacy source data → migration result models.
 *
 * No I/O, no backend calls, no side effects. Everything returns data structures.
 */
object LegacyMigrationConverters {

    // ---------------------------------------------------------------------------
    // Parse raw legacy data from store
    // ---------------------------------------------------------------------------

    fun parseProviderProfiles(raw: String?): LegacyProviderProfiles? {
        raw ?: return null
        val obj = LegacyMigrationJson.parseObject(raw) ?: return null
        val name = obj["currentApiConfigName"]?.jsonPrimitive?.content ?: return null
        val configs = obj["apiConfigs"]?.let {
            runCatching { it.jsonObject }.getOrNull()
        } ?: return null
        val apiConfigs = configs.entries.associate { (k, v) ->
            k to (runCatching { v.jsonObject }.getOrNull() ?: JsonObject(emptyMap()))
        }
        val modeConfigs = obj["modeApiConfigs"]?.let {
            runCatching { it.jsonObject }.getOrNull()
        }?.entries?.associate { (k, v) ->
            k to (runCatching { v.jsonPrimitive.content }.getOrNull() ?: "")
        }
        return LegacyProviderProfiles(
            currentApiConfigName = name,
            apiConfigs = apiConfigs,
            modeApiConfigs = modeConfigs,
        )
    }

    fun parseMcpSettings(raw: String?): Map<String, LegacyMcpServer>? {
        raw ?: return null
        val obj = LegacyMigrationJson.parseObject(raw) ?: return null
        val servers = obj["mcpServers"]?.let { runCatching { it.jsonObject }.getOrNull() } ?: return null
        return servers.entries.associate { (name, v) ->
            val s = runCatching { v.jsonObject }.getOrNull() ?: JsonObject(emptyMap())
            name to LegacyMcpServer(
                type = s["type"]?.jsonPrimitive?.content,
                command = s["command"]?.jsonPrimitive?.content,
                args = s["args"]?.let { a ->
                    runCatching { (a as? JsonArray)?.map { it.jsonPrimitive.content } }.getOrNull()
                },
                url = s["url"]?.jsonPrimitive?.content,
                env = s["env"]?.let { runCatching { it.jsonObject }.getOrNull() }
                    ?.entries?.associate { (k, ev) -> k to (runCatching { ev.jsonPrimitive.content }.getOrNull() ?: "") },
                headers = s["headers"]?.let { runCatching { it.jsonObject }.getOrNull() }
                    ?.entries?.associate { (k, hv) -> k to (runCatching { hv.jsonPrimitive.content }.getOrNull() ?: "") },
                disabled = s["disabled"]?.jsonPrimitive?.content?.toBooleanStrictOrNull(),
                timeout = s["timeout"]?.jsonPrimitive?.content?.toIntOrNull(),
            )
        }
    }

    fun parseCustomModes(raw: String?): List<LegacyCustomMode>? {
        raw ?: return null
        // Try JSON first
        val jsonModes = runCatching {
            val obj = LegacyMigrationJson.parseObject(raw) ?: return@runCatching null
            val arr = obj["customModes"]?.let { runCatching { it as JsonArray }.getOrNull() } ?: return@runCatching null
            arr.mapNotNull { parseCustomModeFromJson(it) }
        }.getOrNull()
        if (jsonModes != null) return jsonModes.takeIf { it.isNotEmpty() }
        return parseCustomModesYaml(raw).takeIf { it.isNotEmpty() }
    }

    private fun parseCustomModeFromJson(elem: JsonElement): LegacyCustomMode? {
        val obj = runCatching { elem.jsonObject }.getOrNull() ?: return null
        val slug = obj["slug"]?.jsonPrimitive?.content ?: return null
        val name = obj["name"]?.jsonPrimitive?.content ?: return null
        val role = obj["roleDefinition"]?.jsonPrimitive?.content ?: ""
        val groups: List<Any> = obj["groups"]?.let { g ->
            runCatching { g as JsonArray }.getOrNull()?.mapNotNull { elem ->
                parseGroupElem(elem)
            }
        } ?: emptyList()
        return LegacyCustomMode(
            slug = slug,
            name = name,
            roleDefinition = role,
            customInstructions = obj["customInstructions"]?.jsonPrimitive?.content,
            whenToUse = obj["whenToUse"]?.jsonPrimitive?.content,
            description = obj["description"]?.jsonPrimitive?.content,
            groups = groups,
        )
    }

    private fun parseGroupElem(elem: JsonElement): Any? {
        // String group: "read"
        runCatching { elem.jsonPrimitive.content }
            .getOrNull()?.let { return it }
        // Array group: ["edit", {"fileRegex": "..."}]
        val arr = runCatching { elem as JsonArray }.getOrNull() ?: return null
        if (arr.size < 1) return null
        val name = runCatching { arr[0].jsonPrimitive.content }.getOrNull() ?: return null
        val opts = if (arr.size >= 2) runCatching { arr[1].jsonObject }.getOrNull() else null
        return if (opts != null) Pair(name, opts.entries.associate { (k, v) ->
            k to (runCatching { v.jsonPrimitive.content }.getOrNull() ?: "")
        }) else name
    }

    fun parseCustomModePrompts(raw: String?): Map<String, JsonObject>? {
        raw ?: return null
        val obj = LegacyMigrationJson.parseObject(raw) ?: return null
        return obj.entries.mapNotNull { (k, v) ->
            runCatching { k to v.jsonObject }.getOrNull()
        }.toMap().takeIf { it.isNotEmpty() }
    }

    fun parseHistoryItems(raw: String?): List<LegacyHistoryItem> {
        raw ?: return emptyList()
        val arr = LegacyMigrationJson.parseArray(raw) ?: return emptyList()
        return arr.mapNotNull { elem ->
            val obj = runCatching { elem.jsonObject }.getOrNull() ?: return@mapNotNull null
            val id = obj["id"]?.jsonPrimitive?.content ?: return@mapNotNull null
            LegacyHistoryItem(
                id = id,
                task = obj["task"]?.jsonPrimitive?.content,
                workspace = obj["workspace"]?.jsonPrimitive?.content,
                ts = obj["ts"]?.jsonPrimitive?.content?.toLongOrNull(),
                mode = obj["mode"]?.jsonPrimitive?.content,
                rootTaskId = obj["rootTaskId"]?.jsonPrimitive?.content,
                parentTaskId = obj["parentTaskId"]?.jsonPrimitive?.content,
            )
        }
    }

    fun parseSettings(globalState: (String) -> JsonElement?): LegacySettings {
        val autocompleteRaw = globalState("ghostServiceSettings")
        val autocomplete: LegacyAutocompleteSettings? = autocompleteRaw?.let {
            runCatching { it.jsonObject }.getOrNull()
        }?.let { obj ->
            LegacyAutocompleteSettings(
                enableAutoTrigger = obj["enableAutoTrigger"]?.jsonPrimitive?.content?.toBooleanStrictOrNull(),
                enableSmartInlineTaskKeybinding = obj["enableSmartInlineTaskKeybinding"]?.jsonPrimitive?.content?.toBooleanStrictOrNull(),
                enableChatAutocomplete = obj["enableChatAutocomplete"]?.jsonPrimitive?.content?.toBooleanStrictOrNull(),
            ).takeIf { it.enableAutoTrigger != null || it.enableSmartInlineTaskKeybinding != null || it.enableChatAutocomplete != null }
        }
        return LegacySettings(
            autoApprovalEnabled = globalState("kilo-code.autoApprovalEnabled")?.jsonPrimitive?.content?.toBooleanStrictOrNull(),
            allowedCommands = globalState("kilo-code.allowedCommands")?.let { parseBoolOrList(it) },
            deniedCommands = globalState("kilo-code.deniedCommands")?.let { parseBoolOrList(it) },
            alwaysAllowReadOnly = globalState("alwaysAllowReadOnly")?.jsonPrimitive?.content?.toBooleanStrictOrNull(),
            alwaysAllowReadOnlyOutsideWorkspace = globalState("alwaysAllowReadOnlyOutsideWorkspace")?.jsonPrimitive?.content?.toBooleanStrictOrNull(),
            alwaysAllowWrite = globalState("alwaysAllowWrite")?.jsonPrimitive?.content?.toBooleanStrictOrNull(),
            alwaysAllowExecute = globalState("alwaysAllowExecute")?.jsonPrimitive?.content?.toBooleanStrictOrNull(),
            alwaysAllowMcp = globalState("alwaysAllowMcp")?.jsonPrimitive?.content?.toBooleanStrictOrNull(),
            alwaysAllowModeSwitch = globalState("alwaysAllowModeSwitch")?.jsonPrimitive?.content?.toBooleanStrictOrNull(),
            alwaysAllowSubtasks = globalState("alwaysAllowSubtasks")?.jsonPrimitive?.content?.toBooleanStrictOrNull(),
            language = globalState("kilo-code.language")?.jsonPrimitive?.content,
            autocomplete = autocomplete,
        )
    }

    private fun parseBoolOrList(elem: JsonElement): List<String>? {
        return runCatching {
            (elem as? JsonArray)?.map { it.jsonPrimitive.content }
        }.getOrNull()
    }

    // ---------------------------------------------------------------------------
    // Provider conversion
    // ---------------------------------------------------------------------------

    data class ProviderConversionResult(
        val auth: JsonObject?,
        val config: JsonObject?,
        val status: MigrationItemStatus,
        val message: String?,
    )

    fun convertProvider(
        profileName: String,
        settings: JsonObject,
        oauthRaw: (String) -> String?,
    ): ProviderConversionResult {
        val provider = settings["apiProvider"]?.jsonPrimitive?.content
            ?: return ProviderConversionResult(null, null, MigrationItemStatus.error, "No provider type found")

        if (provider in UNSUPPORTED_PROVIDERS) {
            return ProviderConversionResult(null, null, MigrationItemStatus.warning, "Provider \"$provider\" is not supported in the new version")
        }

        val mapping = PROVIDER_MAP[provider]
            ?: return ProviderConversionResult(null, null, MigrationItemStatus.warning, "Unknown provider \"$provider\"")

        // OAuth providers (e.g. openai-codex) stored separately
        if (mapping.oauthSecretKey != null) {
            val raw = oauthRaw(mapping.oauthSecretKey)
                ?: return ProviderConversionResult(null, null, MigrationItemStatus.warning, "No OAuth credentials found")
            val creds = parseOAuthCredentials(raw)
                ?: return ProviderConversionResult(null, null, MigrationItemStatus.warning, "Invalid OAuth credentials")
            val auth = buildJsonObject {
                put("type", "oauth")
                put("access", creds.access)
                put("refresh", creds.refresh)
                put("expires", creds.expires)
                creds.accountId?.let { put("accountId", it) }
            }
            return ProviderConversionResult(auth, null, MigrationItemStatus.success, null)
        }

        // Vertex AI — skip auth, write config fields only
        if (mapping.skipAuth) {
            val config = buildVertexConfig(mapping, settings)
            val hadCredentials = settings["vertexJsonCredentials"]?.jsonPrimitive?.content?.isNotBlank() == true ||
                    settings["vertexKeyFile"]?.jsonPrimitive?.content?.isNotBlank() == true
            val status = if (hadCredentials) MigrationItemStatus.warning else MigrationItemStatus.success
            val msg = if (hadCredentials) "Project and location migrated. The new CLI uses Application Default Credentials — set GOOGLE_APPLICATION_CREDENTIALS or run 'gcloud auth application-default login'" else null
            return ProviderConversionResult(null, config, status, msg)
        }

        val apiKey = settings[mapping.key]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() }
            ?: return ProviderConversionResult(null, null, MigrationItemStatus.warning, "No API key found in profile")

        // Kilo gateway — write OAuth-shaped auth with 1-year expiry
        val auth = if (mapping.id == "kilo") {
            val org = mapping.organizationIdField?.let { settings[it]?.jsonPrimitive?.content }
            buildJsonObject {
                put("type", "oauth")
                put("access", apiKey)
                put("refresh", apiKey)
                put("expires", System.currentTimeMillis() + 365L * 24 * 60 * 60 * 1000)
                org?.let { put("accountId", it) }
            }
        } else {
            val orgId = mapping.organizationIdField?.let { settings[it]?.jsonPrimitive?.content }
            if (orgId != null) {
                buildJsonObject {
                    put("type", "oauth")
                    put("access", apiKey)
                    put("refresh", "")
                    put("expires", 0)
                    put("accountId", orgId)
                }
            } else {
                buildJsonObject {
                    put("type", "api")
                    put("key", apiKey)
                }
            }
        }

        // Custom base URL config
        val urlConfig = mapping.urlField?.let { settings[it]?.jsonPrimitive?.content?.takeIf { u -> u.isNotBlank() } }?.let { url ->
            buildJsonObject {
                put("provider", buildJsonObject {
                    put(mapping.id, buildJsonObject {
                        put("options", buildJsonObject {
                            put("apiKey", apiKey)
                            put("baseURL", url)
                        })
                    })
                })
            }
        }

        val configFields = buildConfigFieldsPatch(mapping, settings)
        val combined = listOfNotNull(urlConfig, configFields).reduceOrNull { a, b -> LegacyMigrationJson.merge(a, b) }

        return ProviderConversionResult(auth, combined, MigrationItemStatus.success, null)
    }

    private fun buildVertexConfig(mapping: ProviderMapping, settings: JsonObject): JsonObject? {
        val fields = mapping.configFields ?: return null
        val opts = mutableMapOf<String, JsonElement>()
        for (field in fields) {
            val v = settings[field.from]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() } ?: continue
            opts[field.option] = JsonPrimitive(v)
        }
        if (opts.isEmpty()) return null
        return buildJsonObject {
            put("provider", buildJsonObject {
                put(mapping.id, buildJsonObject {
                    put("options", JsonObject(opts))
                })
            })
        }
    }

    private fun buildConfigFieldsPatch(mapping: ProviderMapping, settings: JsonObject): JsonObject? {
        val fields = mapping.configFields ?: return null
        val opts = mutableMapOf<String, JsonElement>()
        for (field in fields) {
            val v = settings[field.from]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() } ?: continue
            opts[field.option] = JsonPrimitive(v)
        }
        if (opts.isEmpty()) return null
        return buildJsonObject {
            put("provider", buildJsonObject {
                put(mapping.id, buildJsonObject {
                    put("options", JsonObject(opts))
                })
            })
        }
    }

    data class OAuthCreds(
        val access: String,
        val refresh: String,
        val expires: Long,
        val accountId: String?,
    )

    fun parseOAuthCredentials(raw: String): OAuthCreds? {
        val obj = LegacyMigrationJson.parseObject(raw) ?: return null
        val access = obj["access_token"]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() } ?: return null
        val refresh = obj["refresh_token"]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() } ?: return null
        val expires = obj["expires"]?.jsonPrimitive?.content?.toLongOrNull() ?: return null
        val accountId = obj["accountId"]?.jsonPrimitive?.content
        return OAuthCreds(access, refresh, expires, accountId)
    }

    fun convertDefaultModel(settings: JsonObject): JsonObject? {
        val provider = settings["apiProvider"]?.jsonPrimitive?.content ?: return null
        val mapping = PROVIDER_MAP[provider] ?: return null
        val modelField = mapping.modelField ?: "apiModelId"
        val modelId = settings[modelField]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() } ?: return null
        return buildJsonObject {
            put("model", "${mapping.id}/$modelId")
        }
    }

    // ---------------------------------------------------------------------------
    // MCP conversion
    // ---------------------------------------------------------------------------

    fun convertMcpServer(name: String, server: LegacyMcpServer): JsonObject? {
        val enabled = if (server.disabled == true) false else null
        val timeout = server.timeout?.let { it * 1000L }

        return when (server.type) {
            "sse", "streamable-http" -> {
                val url = server.url ?: return null
                buildJsonObject {
                    put("type", "remote")
                    put("url", url)
                    if (enabled != null) put("enabled", enabled)
                    if (timeout != null) put("timeout", timeout)
                    server.headers?.let { h ->
                        put("headers", JsonObject(h.mapValues { JsonPrimitive(it.value) }))
                    }
                }
            }
            else -> {
                val command = server.command ?: return null
                val cmd = if (server.args != null) listOf(command) + server.args else listOf(command)
                buildJsonObject {
                    put("type", "local")
                    put("command", JsonArray(cmd.map { JsonPrimitive(it) }))
                    if (enabled != null) put("enabled", enabled)
                    if (timeout != null) put("timeout", timeout)
                    server.env?.let { e ->
                        put("environment", JsonObject(e.mapValues { JsonPrimitive(it.value) }))
                    }
                }
            }
        }
    }

    // ---------------------------------------------------------------------------
    // Custom mode / agent conversion
    // ---------------------------------------------------------------------------

    private val GROUP_TO_PERMISSION = mapOf(
        "read" to "read",
        "edit" to "edit",
        "browser" to "bash",
        "command" to "bash",
        "mcp" to "skill",
    )
    private val ALL_MODE_PERMISSIONS = listOf("read", "edit", "bash", "skill")

    fun convertCustomModePermissions(groups: List<Any>): JsonObject {
        val permission = mutableMapOf<String, JsonElement>()
        val allowed = mutableSetOf<String>()

        for (group in groups) {
            val groupName: String
            val groupConfig: Map<String, String>?
            when (group) {
                is String -> { groupName = group; groupConfig = null }
                is Pair<*, *> -> {
                    @Suppress("UNCHECKED_CAST")
                    groupName = group.first as? String ?: continue
                    @Suppress("UNCHECKED_CAST")
                    groupConfig = group.second as? Map<String, String>
                }
                else -> continue
            }
            val permKey = GROUP_TO_PERMISSION[groupName] ?: groupName
            allowed.add(permKey)

            val fileRegex = groupConfig?.get("fileRegex")
            val newValue: JsonElement = if (fileRegex != null) {
                JsonObject(mapOf(fileRegex to JsonPrimitive("allow"), "*" to JsonPrimitive("deny")))
            } else {
                JsonPrimitive("allow")
            }

            val existing = permission[permKey]
            permission[permKey] = when {
                existing == null -> newValue
                existing == JsonPrimitive("allow") || newValue == JsonPrimitive("allow") -> JsonPrimitive("allow")
                existing is JsonObject && newValue is JsonObject -> JsonObject(existing + newValue)
                else -> newValue
            }
        }

        for (perm in ALL_MODE_PERMISSIONS) {
            if (perm !in allowed) permission[perm] = JsonPrimitive("deny")
        }

        return JsonObject(permission)
    }

    fun convertCustomMode(mode: LegacyCustomMode): JsonObject {
        val parts = mutableListOf(mode.roleDefinition)
        val instructions = mode.customInstructions?.trim()
        if (!instructions.isNullOrEmpty()) {
            parts.add(
                listOf(
                    "USER'S CUSTOM INSTRUCTIONS",
                    "",
                    "The following additional instructions are provided by the user, and should be followed to the best of your ability.",
                    "",
                    "Mode-specific Instructions:\n$instructions",
                ).joinToString("\n")
            )
        }
        val prompt = parts.filter { it.isNotBlank() }.joinToString("\n\n")
        val description = mode.description ?: mode.whenToUse ?: mode.roleDefinition.take(120)
        val permission = convertCustomModePermissions(mode.groups)

        return buildJsonObject {
            put("mode", "primary")
            put("description", description)
            put("prompt", prompt)
            put("permission", permission)
        }
    }

    // ---------------------------------------------------------------------------
    // Auto-approval / permissions conversion
    // ---------------------------------------------------------------------------

    data class PermissionConversion(
        /** config patch to write, null if nothing to write */
        val config: JsonObject?,
        val results: List<Pair<String, MigrationItemStatus>>,
    )

    fun convertAutoApproval(settings: LegacySettings, sel: MigrationAutoApprovalSelections): PermissionConversion {
        val fallback = if (settings.autoApprovalEnabled == true) "allow" else "ask"
        val results = mutableListOf<Pair<String, MigrationItemStatus>>()
        val permission = mutableMapOf<String, JsonElement>()
        var globalAllowApplied = false

        if (sel.commandRules) {
            val hasCommandLists = (settings.allowedCommands?.isNotEmpty() == true) || (settings.deniedCommands?.isNotEmpty() == true)
            if (settings.autoApprovalEnabled == true && !hasCommandLists) {
                // Scalar "allow" — caller should write this as top-level permission:"allow"
                globalAllowApplied = true
            } else if (hasCommandLists) {
                val bashRules = mutableMapOf<String, JsonElement>()
                for (cmd in settings.allowedCommands ?: emptyList()) {
                    bashRules["${cmd.trimEnd()} *"] = JsonPrimitive("allow")
                }
                for (cmd in settings.deniedCommands ?: emptyList()) {
                    bashRules["${cmd.trimEnd()} *"] = JsonPrimitive("deny")
                }
                bashRules["*"] = JsonPrimitive(
                    when (settings.alwaysAllowExecute) {
                        true -> "allow"
                        false -> "ask"
                        null -> fallback
                    }
                )
                permission["bash"] = JsonObject(bashRules)
            }
            results.add("Command rules" to MigrationItemStatus.success)
        }

        if (sel.readPermission) {
            if (settings.alwaysAllowReadOnly == true) {
                permission["read"] = JsonPrimitive("allow")
                permission["glob"] = JsonPrimitive("allow")
                permission["grep"] = JsonPrimitive("allow")
                permission["list"] = JsonPrimitive("allow")
            } else if (settings.alwaysAllowReadOnly == false) {
                permission["read"] = JsonPrimitive("ask")
            }
            if (settings.alwaysAllowReadOnlyOutsideWorkspace == true) {
                permission["external_directory"] = JsonPrimitive("allow")
            } else if (settings.alwaysAllowReadOnlyOutsideWorkspace == false) {
                permission["external_directory"] = JsonPrimitive("ask")
            }
            results.add("Read permission" to MigrationItemStatus.success)
        }

        if (sel.writePermission) {
            if (settings.alwaysAllowWrite == true) {
                permission["edit"] = JsonPrimitive("allow")
            } else if (settings.alwaysAllowWrite == false) {
                permission["edit"] = JsonPrimitive("ask")
            }
            results.add("Write permission" to MigrationItemStatus.success)
        }

        if (sel.executePermission && !sel.commandRules) {
            if (settings.alwaysAllowExecute == true) {
                permission["bash"] = JsonPrimitive("allow")
            } else if (settings.alwaysAllowExecute == false) {
                permission["bash"] = JsonPrimitive("ask")
            }
            results.add("Execute permission" to MigrationItemStatus.success)
        } else if (sel.executePermission) {
            results.add("Execute permission" to MigrationItemStatus.success)
        }

        if (sel.mcpPermission) {
            if (settings.alwaysAllowMcp == true) {
                permission["skill"] = JsonPrimitive("allow")
            } else if (settings.alwaysAllowMcp == false) {
                permission["skill"] = JsonPrimitive("ask")
            }
            results.add("MCP permission" to MigrationItemStatus.success)
        }

        if (sel.taskPermission) {
            if (settings.alwaysAllowModeSwitch == true || settings.alwaysAllowSubtasks == true) {
                permission["task"] = JsonPrimitive("allow")
            } else if (settings.alwaysAllowModeSwitch == false && settings.alwaysAllowSubtasks == false) {
                permission["task"] = JsonPrimitive("ask")
            }
            results.add("Task permission" to MigrationItemStatus.success)
        }

        val config = when {
            globalAllowApplied -> buildJsonObject { put("permission", "allow") }
            permission.isNotEmpty() -> buildJsonObject { put("permission", JsonObject(permission)) }
            else -> null
        }

        return PermissionConversion(config = config, results = results)
    }

    // ---------------------------------------------------------------------------
    // Native mode defaults comparison
    // ---------------------------------------------------------------------------

    data class NativeModeDefaults(
        val name: String,
        val roleDefinition: String,
        val customInstructions: String? = null,
        val whenToUse: String? = null,
        val description: String? = null,
        val groups: List<Any>,
    )

    val NATIVE_MODE_DEFAULTS: Map<String, NativeModeDefaults> = mapOf(
        "architect" to NativeModeDefaults(
            name = "Architect",
            roleDefinition = "You are Kilo Code, an experienced technical leader who is inquisitive and an excellent planner. Your goal is to gather information and get context to create a detailed plan for accomplishing the user's task, which the user will review and approve before they switch into another mode to implement the solution.",
            whenToUse = "Use this mode when you need to plan, design, or strategize before implementation.",
            description = "Plan and design before implementation",
            groups = listOf("read", Pair("edit", mapOf("fileRegex" to "\\.md$", "description" to "Markdown files only")), "browser", "mcp"),
        ),
        "code" to NativeModeDefaults(
            name = "Code",
            roleDefinition = "You are Kilo Code, a highly skilled software engineer with extensive knowledge in many programming languages, frameworks, design patterns, and best practices.",
            whenToUse = "Use this mode when you need to write, modify, or refactor code.",
            description = "Write, modify, and refactor code",
            groups = listOf("read", "edit", "browser", "command", "mcp"),
        ),
        "ask" to NativeModeDefaults(
            name = "Ask",
            roleDefinition = "You are Kilo Code, a knowledgeable technical assistant focused on answering questions and providing information about software development, technology, and related topics.",
            whenToUse = "Use this mode when you need explanations, documentation, or answers to technical questions.",
            description = "Get answers and explanations",
            groups = listOf("read", "browser", "mcp"),
        ),
        "debug" to NativeModeDefaults(
            name = "Debug",
            roleDefinition = "You are Kilo Code, an expert software debugger specializing in systematic problem diagnosis and resolution.",
            whenToUse = "Use this mode when you're troubleshooting issues, investigating errors, or diagnosing problems.",
            description = "Diagnose and fix software issues",
            groups = listOf("read", "edit", "browser", "command", "mcp"),
        ),
        "orchestrator" to NativeModeDefaults(
            name = "Orchestrator",
            roleDefinition = "You are Kilo Code, a strategic workflow orchestrator who coordinates complex tasks by delegating them to appropriate specialized modes.",
            whenToUse = "Use this mode for complex, multi-step projects that require coordination across different specialties.",
            description = "Coordinate tasks across multiple modes",
            groups = emptyList(),
        ),
        "review" to NativeModeDefaults(
            name = "Review",
            roleDefinition = "You are Kilo Code, an expert code reviewer with deep expertise in software engineering best practices, security vulnerabilities, performance optimization, and code quality.",
            whenToUse = "Use this mode when you need to review code changes.",
            description = "Review code changes locally",
            groups = listOf("read", "browser", "mcp", "command"),
        ),
    )

    fun isNativeModeModified(
        yaml: LegacyCustomMode?,
        prompt: JsonObject?,
        defaults: NativeModeDefaults,
    ): Boolean {
        if (yaml != null) return true
        if (prompt == null) return false
        val role = prompt["roleDefinition"]?.jsonPrimitive?.content
        if (role != null && role != defaults.roleDefinition) return true
        val ci = prompt["customInstructions"]?.jsonPrimitive?.content
        if (ci != null && ci != (defaults.customInstructions ?: "")) return true
        val wtu = prompt["whenToUse"]?.jsonPrimitive?.content
        if (wtu != null && wtu != (defaults.whenToUse ?: "")) return true
        val desc = prompt["description"]?.jsonPrimitive?.content
        if (desc != null && desc != (defaults.description ?: "")) return true
        return false
    }

    fun buildMergedNativeMode(yaml: LegacyCustomMode?, prompt: JsonObject?, slug: String): LegacyCustomMode? {
        val defaults = NATIVE_MODE_DEFAULTS[slug] ?: return null
        val base = yaml?.copy() ?: LegacyCustomMode(
            slug = slug,
            name = defaults.name,
            roleDefinition = defaults.roleDefinition,
            customInstructions = defaults.customInstructions,
            whenToUse = defaults.whenToUse,
            description = defaults.description,
            groups = defaults.groups.toList(),
        )
        if (prompt == null) return base
        return base.copy(
            roleDefinition = prompt["roleDefinition"]?.jsonPrimitive?.content ?: base.roleDefinition,
            customInstructions = prompt["customInstructions"]?.jsonPrimitive?.content ?: base.customInstructions,
            whenToUse = prompt["whenToUse"]?.jsonPrimitive?.content ?: base.whenToUse,
            description = prompt["description"]?.jsonPrimitive?.content ?: base.description,
        )
    }

    // ---------------------------------------------------------------------------
    // YAML parser for custom_modes.yaml
    // ---------------------------------------------------------------------------

    fun parseCustomModesYaml(text: String): List<LegacyCustomMode> {
        val modes = mutableListOf<LegacyCustomMode>()
        val lines = text.split("\n")
        var inModes = false
        var current: MutableMap<String, Any?> = mutableMapOf()
        var blockField: String? = null
        var blockLines = mutableListOf<String>()
        var inGroups = false
        var groups = mutableListOf<Any>()

        fun stripYamlQuotes(value: String) = value.replace(Regex("^(['\"])(.*?)\\1$"), "$2")

        fun flush() {
            val slug = current["slug"] as? String ?: return
            val name = current["name"] as? String ?: return
            if (blockField != null && blockLines.isNotEmpty()) {
                current[blockField!!] = blockLines.joinToString("\n").trim()
            }
            modes.add(
                LegacyCustomMode(
                    slug = slug,
                    name = name,
                    roleDefinition = current["roleDefinition"] as? String ?: "",
                    customInstructions = current["customInstructions"] as? String,
                    whenToUse = current["whenToUse"] as? String,
                    description = current["description"] as? String,
                    groups = groups.toList(),
                )
            )
            current = mutableMapOf()
            blockField = null
            blockLines = mutableListOf()
            inGroups = false
            groups = mutableListOf()
        }

        for (raw in lines) {
            if (!inModes) {
                if (raw.trim() == "customModes:") inModes = true
                continue
            }
            if (raw.matches(Regex("  - slug: .*"))) {
                flush()
                current["slug"] = stripYamlQuotes(raw.removePrefix("  - slug: ").trim())
                continue
            }
            if (current.isEmpty()) continue

            if (raw.matches(Regex("    name: .*"))) {
                current["name"] = stripYamlQuotes(raw.removePrefix("    name: ").trim())
                continue
            }

            val blockMatch = Regex("    (roleDefinition|customInstructions): [|>]").find(raw)
            if (blockMatch != null) {
                if (blockField != null && blockLines.isNotEmpty()) {
                    current[blockField!!] = blockLines.joinToString("\n").trim()
                }
                blockField = blockMatch.groupValues[1]
                inGroups = false
                blockLines = mutableListOf()
                continue
            }

            if (raw.matches(Regex("    roleDefinition: .*")) && blockField == null) {
                current["roleDefinition"] = stripYamlQuotes(raw.removePrefix("    roleDefinition: ").trim())
                continue
            }
            if (raw.matches(Regex("    customInstructions: .*")) && blockField == null) {
                current["customInstructions"] = stripYamlQuotes(raw.removePrefix("    customInstructions: ").trim())
                continue
            }
            if (raw.matches(Regex("    whenToUse: .*")) && blockField == null) {
                current["whenToUse"] = stripYamlQuotes(raw.removePrefix("    whenToUse: ").trim())
                continue
            }
            if (raw.matches(Regex("    description: .*")) && blockField == null) {
                current["description"] = stripYamlQuotes(raw.removePrefix("    description: ").trim())
                continue
            }

            if (blockField != null) {
                if (raw.startsWith("      ")) {
                    blockLines.add(raw.removePrefix("      "))
                    continue
                }
                current[blockField!!] = blockLines.joinToString("\n").trim()
                blockField = null
                blockLines = mutableListOf()
            }

            if (raw.matches(Regex("    groups:.*"))) {
                inGroups = true
                groups = mutableListOf()
                continue
            }
            if (inGroups && raw.matches(Regex("      - .*"))) {
                groups.add(stripYamlQuotes(raw.removePrefix("      - ").trim()))
                continue
            }
            if (inGroups && !raw.startsWith("      ")) {
                inGroups = false
            }
        }
        flush()
        return modes
    }
}
