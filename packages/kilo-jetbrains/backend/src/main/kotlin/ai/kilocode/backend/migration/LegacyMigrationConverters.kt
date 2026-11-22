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
        val mapping = when (val resolution = resolveProvider(provider)) {
            is ProviderResolution.Resolved -> resolution.mapping
            is ProviderResolution.Unresolved ->
                return ProviderConversionResult(null, null, resolution.status, resolution.message)
        }

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

        // The Kilo gateway is the only provider whose static token is stored in an OAuth-shaped
        // envelope: exactly the one the CLI's own Kilo sign-in writes (type=oauth, the token as both
        // access and refresh, a 1-year expiry, and the organization as accountId). Every other
        // provider stores an api credential, even when the legacy profile names an organization.
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
            buildJsonObject {
                put("type", "api")
                put("key", apiKey)
            }
        }

        // Custom base URL config. The secret lives in the credential record written by setAuth
        // (see KiloCliDataParser.buildCustomProviderPatch and the custom-provider save path), so the
        // provider options carry baseURL only.
        val urlConfig = mapping.urlField?.let { settings[it]?.jsonPrimitive?.content?.takeIf { u -> u.isNotBlank() } }?.let { url ->
            buildJsonObject {
                put("provider", buildJsonObject {
                    put(mapping.id, buildJsonObject {
                        put("options", buildJsonObject {
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

    /**
     * Option key the YAML parser adds when a line inside a `- - <group>` options block was not
     * readable. The key sits outside the legacy option set, so the converter narrows that group
     * instead of granting it in full.
     */
    private const val UNPARSED_GROUP_OPTION = "__unparsed"

    private val GROUP_TO_PERMISSION = mapOf(
        "read" to "read",
        "edit" to "edit",
        "browser" to "browser_open",
        "command" to "bash",
    )
    private val ALL_MODE_PERMISSIONS = listOf("read", "edit", "bash", "browser_open", "skill")

    /** Explained once per converted mode whose legacy groups grant no `skill` permission. */
    private const val SKILL_NOT_GRANTED = "Skills are not available: no legacy group grants them"

    /** Option keys a legacy group can carry. Any other key means the group was not read fully. */
    private val KNOWN_GROUP_OPTIONS = setOf("fileRegex", "description")

    data class ModePermissions(
        val permission: JsonObject,
        /** Conditions that need the user's action. */
        val warnings: List<String>,
        /** Explanatory statements about the converted result, not conditions to act on. */
        val notes: List<String>,
    )

    private val PERMISSION_KEY_UNSAFE = Regex("[^a-zA-Z0-9_-]")

    /**
     * The permission rule key covering every tool of one MCP server, `<key>_*`.
     *
     * The CLI's tool-id naming is the authority: its one definition is
     * `packages/opencode/src/kilocode/mcp/tool-id.ts`, which builds both the name a tool is
     * registered under and a migrated mode's `<server>_*` permission key. `permission-key-cases.json`
     * ties the two languages together, so a server name the two sanitize differently fails a suite
     * on one side.
     */
    internal fun permissionRuleKey(server: String): String = server.replace(PERMISSION_KEY_UNSAFE, "_") + "_*"

    private fun hasUnreadableOptions(options: Map<String, String>?): Boolean =
        options != null && options.keys.any { it !in KNOWN_GROUP_OPTIONS }

    /** A rule merged from repeated groups, with the warning a merge that lost a rule reports. */
    private data class MergedRule(val value: JsonElement, val warning: String? = null)

    /** Rule strength: `ask` outranks a file restriction object, which outranks `allow`. */
    private fun ruleRank(rule: JsonElement): Int = when {
        rule is JsonObject -> 1
        rule is JsonPrimitive && rule.isString && rule.content == "ask" -> 2
        else -> 0
    }

    private fun keptRuleWarning(key: String, kept: JsonElement): String? = when (kept) {
        is JsonObject -> "Repeated group; $key kept its file restriction"
        is JsonPrimitive -> if (ruleRank(kept) == 2) "Repeated group; $key set to ask" else null
        else -> null
    }

    /**
     * Merge the rule of a repeated permission group into the rule already recorded for [key].
     *
     * A repeated group keeps the narrower rule: `ask` over a file restriction over `allow`, and a
     * file restriction over a plain grant. Only a merge that drops a rule as written reports it.
     */
    private fun mergeRepeatedRule(key: String, existing: JsonElement?, next: JsonElement): MergedRule {
        if (existing == null || existing == next) return MergedRule(existing ?: next)
        val existingRank = ruleRank(existing)
        val nextRank = ruleRank(next)
        return when {
            existingRank == nextRank && existing is JsonObject && next is JsonObject ->
                MergedRule(JsonPrimitive("ask"), "Repeated group; $key set to ask")
            nextRank > existingRank -> MergedRule(next, keptRuleWarning(key, next))
            existingRank > nextRank -> MergedRule(existing, keptRuleWarning(key, existing))
            else -> MergedRule(next)
        }
    }

    /**
     * Convert legacy mode groups into backend permissions.
     *
     * @param mcpServers names of the MCP servers that were migrated; empty means none reached the
     *   backend config, so no per-server `_*` keys are written.
     * @param mcpAvailable whether the legacy store held at least one MCP server, whether or not it
     *   was selected for migration. An `mcp` group with no migrated server only needs the
     *   "no MCP server was migrated" warning when the store had one to lose.
     */
    fun convertCustomModePermissions(
        groups: List<Any>,
        mcpServers: List<String>,
        mcpAvailable: Boolean,
    ): ModePermissions {
        val permission = mutableMapOf<String, JsonElement>()
        val allowed = mutableSetOf<String>()
        val warnings = mutableListOf<String>()
        val notes = mutableListOf<String>()
        var mcpGroupSeen = false

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

            if (groupName == "mcp") {
                mcpGroupSeen = true
                if (mcpServers.isEmpty()) {
                    if (mcpAvailable) warnings.add("MCP access not migrated: no MCP server was migrated")
                    continue
                }
                val mcpRegex = groupConfig?.get("fileRegex")
                val mcpValue = when {
                    hasUnreadableOptions(groupConfig) -> {
                        warnings.add("Group options not migrated; mcp set to ask")
                        "ask"
                    }
                    mcpRegex != null -> {
                        warnings.add("File restriction not migrated; mcp set to ask: $mcpRegex")
                        "ask"
                    }
                    else -> "allow"
                }
                for (server in mcpServers) {
                    val key = permissionRuleKey(server)
                    allowed.add(key)
                    val merged = mergeRepeatedRule(key, permission[key], JsonPrimitive(mcpValue))
                    if (merged.warning != null) warnings.add(merged.warning)
                    permission[key] = merged.value
                }
                continue
            }

            val permKey = GROUP_TO_PERMISSION[groupName]
            if (permKey == null) {
                warnings.add("Group not migrated; \"$groupName\" ignored")
                continue
            }

            val newValue: JsonElement = if (hasUnreadableOptions(groupConfig)) {
                warnings.add("Group options not migrated; $permKey set to ask")
                JsonPrimitive("ask")
            } else {
                val fileRegex = groupConfig?.get("fileRegex")
                val globs = fileRegex?.let { fileRegexToGlobs(it) }
                when {
                    fileRegex == null -> JsonPrimitive("allow")
                    globs == null -> {
                        warnings.add("File restriction not migrated; $permKey set to ask: $fileRegex")
                        JsonPrimitive("ask")
                    }
                    else -> buildJsonObject {
                        put("*", "deny")
                        globs.forEach { put(it, "allow") }
                    }
                }
            }
            allowed.add(permKey)

            val merged = mergeRepeatedRule(permKey, permission[permKey], newValue)
            if (merged.warning != null) warnings.add(merged.warning)
            permission[permKey] = merged.value
        }

        for (perm in ALL_MODE_PERMISSIONS) {
            if (perm !in allowed) permission[perm] = JsonPrimitive("deny")
        }
        // No legacy group grants `skill`, so it stays denied on purpose. Say so once per mode
        // instead of leaving the user to wonder why a migrated mode cannot load skills. This is a
        // note, not a warning: nothing here needs the user to act, so the mode stays a success.
        if ("skill" !in allowed) notes.add(SKILL_NOT_GRANTED)

        if (!mcpGroupSeen) {
            for (server in mcpServers) {
                val key = permissionRuleKey(server)
                if (key !in allowed) permission[key] = JsonPrimitive("deny")
            }
        }
        return ModePermissions(JsonObject(permission), warnings, notes)
    }

    data class ModeConversion(
        val agent: JsonObject,
        val warnings: List<String>,
        val notes: List<String>,
    )

    /**
     * Convert a legacy custom mode into a backend agent.
     *
     * @param mcpServers names of the MCP servers that were migrated into the backend config.
     * @param mcpAvailable whether the legacy store held at least one MCP server, whether or not it
     *   was selected for migration; see [convertCustomModePermissions].
     */
    fun convertCustomMode(
        mode: LegacyCustomMode,
        mcpServers: List<String>,
        mcpAvailable: Boolean,
    ): ModeConversion {
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
        val permissions = convertCustomModePermissions(mode.groups, mcpServers, mcpAvailable)

        val agent = buildJsonObject {
            put("mode", "primary")
            put("description", description)
            put("prompt", prompt)
            put("permission", permissions.permission)
        }
        return ModeConversion(agent, permissions.warnings, permissions.notes)
    }

    // ---------------------------------------------------------------------------
    // Auto-approval / permissions conversion
    // ---------------------------------------------------------------------------

    data class PermissionEntry(
        val label: String,
        val status: MigrationItemStatus,
        val message: String? = null,
    )

    data class PermissionConversion(
        /** config patch to write, null if nothing to write */
        val config: JsonObject?,
        val results: List<PermissionEntry>,
    )

    fun convertAutoApproval(
        settings: LegacySettings,
        sel: MigrationAutoApprovalSelections,
        mcpServers: List<String>,
    ): PermissionConversion {
        val fallback = if (settings.autoApprovalEnabled == true) "allow" else "ask"
        val results = mutableListOf<PermissionEntry>()
        val permission = mutableMapOf<String, JsonElement>()

        if (sel.commandRules) {
            val hasCommandLists = (settings.allowedCommands?.isNotEmpty() == true) || (settings.deniedCommands?.isNotEmpty() == true)
            if (settings.autoApprovalEnabled == true && !hasCommandLists) {
                permission["bash"] = JsonPrimitive("allow")
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
            results.add(PermissionEntry("Command rules", MigrationItemStatus.success))
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
            results.add(PermissionEntry("Read permission", MigrationItemStatus.success))
        }

        if (sel.writePermission) {
            if (settings.alwaysAllowWrite == true) {
                permission["edit"] = JsonPrimitive("allow")
            } else if (settings.alwaysAllowWrite == false) {
                permission["edit"] = JsonPrimitive("ask")
            }
            results.add(PermissionEntry("Write permission", MigrationItemStatus.success))
        }

        if (sel.executePermission && !sel.commandRules) {
            if (settings.alwaysAllowExecute == true) {
                permission["bash"] = JsonPrimitive("allow")
            } else if (settings.alwaysAllowExecute == false) {
                permission["bash"] = JsonPrimitive("ask")
            }
            results.add(PermissionEntry("Execute permission", MigrationItemStatus.success))
        } else if (sel.executePermission) {
            results.add(PermissionEntry("Execute permission", MigrationItemStatus.success))
        }

        if (sel.mcpPermission) {
            val mcpValue = settings.alwaysAllowMcp?.let { if (it) "allow" else "ask" }
            when {
                mcpValue == null -> results.add(PermissionEntry("MCP permission", MigrationItemStatus.success))
                mcpServers.isEmpty() -> {
                    results.add(
                        PermissionEntry(
                            "MCP permission",
                            MigrationItemStatus.warning,
                            "MCP auto-approval was not applied: no MCP server was migrated",
                        )
                    )
                }
                else -> {
                    for (server in mcpServers) {
                        permission[permissionRuleKey(server)] = JsonPrimitive(mcpValue)
                    }
                    results.add(PermissionEntry("MCP permission", MigrationItemStatus.success))
                }
            }
        }

        if (sel.taskPermission) {
            if (settings.alwaysAllowModeSwitch == true || settings.alwaysAllowSubtasks == true) {
                permission["task"] = JsonPrimitive("allow")
            } else if (settings.alwaysAllowModeSwitch == false && settings.alwaysAllowSubtasks == false) {
                permission["task"] = JsonPrimitive("ask")
            }
            results.add(PermissionEntry("Task permission", MigrationItemStatus.success))
        }

        val config = when {
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

    /**
     * Remove a trailing YAML comment from [line].
     *
     * A `#` starts a comment only when it is the first character of the line or is preceded by a
     * space or tab, and only outside a single-quoted or double-quoted scalar. Inside double quotes a
     * backslash escapes the next character, and inside single quotes a doubled `''` is one literal
     * quote rather than the end of the scalar. The result keeps the text before that `#` with
     * trailing whitespace removed; a line without a comment is returned unchanged.
     */
    private fun stripYamlComment(line: String): String {
        var inSingleQuotes = false
        var inDoubleQuotes = false
        var i = 0
        while (i < line.length) {
            val c = line[i]
            if (inDoubleQuotes) {
                when (c) {
                    '\\' -> i++ // the backslash escapes the next character
                    '"' -> inDoubleQuotes = false
                }
                i++
                continue
            }
            if (inSingleQuotes) {
                val run = singleQuoteRun(line, i)
                inSingleQuotes = run != 1 // a lone quote closes the scalar
                i += run.coerceAtLeast(1)
                continue
            }
            when (c) {
                '\'' -> if (opensScalar(line, i)) inSingleQuotes = true
                '"' -> if (opensScalar(line, i)) inDoubleQuotes = true
                '#' -> if (i == 0 || line[i - 1] == ' ' || line[i - 1] == '\t') {
                    return line.substring(0, i).trimEnd()
                }
            }
            i++
        }
        return line
    }

    /** True when the quote at [index] starts a scalar, not an apostrophe inside plain text. */
    private fun opensScalar(line: String, index: Int): Boolean {
        var i = index - 1
        while (i >= 0 && (line[i] == ' ' || line[i] == '\t')) i--
        if (i < 0) return true
        return line[i] in ":-,{["
    }

    /**
     * Length of the quote run that starts at [index] in [text]: 2 for a doubled `''` pair, 1 for a
     * lone `'` and 0 when the character is not a quote.
     *
     * Inside a single-quoted YAML scalar a doubled quote is one literal quote and the scalar goes
     * on, so a scan of such a scalar skips both characters. Only a lone quote closes the scalar.
     */
    private fun singleQuoteRun(text: String, index: Int): Int {
        if (text[index] != '\'') return 0
        return if (index + 1 < text.length && text[index + 1] == '\'') 2 else 1
    }

    /**
     * Strip one pair of YAML quotes around [value] and decode the escapes inside double quotes.
     *
     * Single-quoted text decodes a doubled `''` to one `'` and is otherwise literal. Inside double
     * quotes only `\\` and `\"` are decoded; any other backslash sequence is kept, so a regex or a
     * path is not rewritten.
     */
    private fun stripYamlQuotes(value: String): String {
        if (value.length < 2) return value
        val quote = value.first()
        if (value.last() != quote || (quote != '"' && quote != '\'')) return value
        val body = value.substring(1, value.length - 1)
        if (quote == '\'') return body.replace("''", "'")
        val out = StringBuilder(body.length)
        var i = 0
        while (i < body.length) {
            val c = body[i]
            if (c == '\\' && i + 1 < body.length) {
                when (body[i + 1]) {
                    '\\' -> { out.append('\\'); i += 2; continue }
                    '"' -> { out.append('"'); i += 2; continue }
                }
            }
            out.append(c)
            i++
        }
        return out.toString()
    }

    /**
     * Split the body of a YAML flow sequence or mapping at its top-level commas.
     *
     * A comma inside a single-quoted or double-quoted scalar, or inside `[...]` or `{...}` nesting,
     * does not split. A doubled `''` inside a single-quoted scalar is a literal quote, so it neither
     * closes the scalar nor exposes the comma after it. Returns null for an unterminated quote or a
     * bracket or brace that does not close, so the caller treats the whole value as unread instead
     * of taking a part of it.
     */
    private fun splitFlowSequence(body: String): List<String>? {
        val items = mutableListOf<String>()
        val open = mutableListOf<Char>()
        var inSingleQuotes = false
        var inDoubleQuotes = false
        var start = 0
        var i = 0
        while (i < body.length) {
            val c = body[i]
            if (inDoubleQuotes) {
                when (c) {
                    '\\' -> i++ // the backslash escapes the next character
                    '"' -> inDoubleQuotes = false
                }
                i++
                continue
            }
            if (inSingleQuotes) {
                val run = singleQuoteRun(body, i)
                inSingleQuotes = run != 1 // a lone quote closes the scalar
                i += run.coerceAtLeast(1)
                continue
            }
            when (c) {
                '\'' -> if (opensScalar(body, i)) inSingleQuotes = true
                '"' -> if (opensScalar(body, i)) inDoubleQuotes = true
                '[', '{' -> { open.add(c) }
                ']' -> if (open.removeLastOrNull() != '[') return null
                '}' -> if (open.removeLastOrNull() != '{') return null
                ',' -> if (open.isEmpty()) {
                    items.add(body.substring(start, i))
                    start = i + 1
                }
            }
            i++
        }
        if (inSingleQuotes || inDoubleQuotes || open.isNotEmpty()) return null
        items.add(body.substring(start))
        return items
    }

    /**
     * Read one `{ key: value, ... }` flow mapping into its string options.
     *
     * Returns null when [text] is not a closed mapping, or an entry has no `key: value` shape, so
     * the caller treats the options as unread rather than half-reading them.
     */
    private fun parseFlowMapping(text: String): Map<String, String>? {
        val body = text.trim()
        if (!body.startsWith("{") || !body.endsWith("}")) return null
        val entries = splitFlowSequence(body.substring(1, body.length - 1)) ?: return null
        val options = mutableMapOf<String, String>()
        for (rawEntry in entries) {
            val entry = rawEntry.trim()
            if (entry.isEmpty()) continue
            val sep = entry.indexOf(':')
            if (sep < 0) return null
            val key = stripYamlQuotes(entry.substring(0, sep).trim())
            if (key.isEmpty() || key.any { it in "[]{}" }) return null
            options[key] = stripYamlQuotes(entry.substring(sep + 1).trim())
        }
        return options
    }

    /** One item of a `groups:` flow sequence, in the shapes [convertCustomModePermissions] reads. */
    private sealed interface FlowGroupItem {
        /** A plain group name. */
        data class Name(val name: String) : FlowGroupItem

        /** A `[name, { ... }]` pair. */
        data class Group(val pair: Pair<String, Map<String, String>>) : FlowGroupItem

        /** Options with no group name of their own; they belong to the name just before them. */
        object Options : FlowGroupItem

        /** An item whose brackets, braces or quotes do not read. */
        object Unreadable : FlowGroupItem
    }

    /**
     * Read one item of a `groups:` flow sequence.
     *
     * A scalar is a group name and `[name, { ... }]` is a (name, options) pair. A bare `{ ... }`
     * mapping, and a bare `key: value` scalar, are [FlowGroupItem.Options]: neither is a group,
     * because each carries the options the user meant for the plain name just before it.
     */
    private fun parseFlowGroupItem(item: String): FlowGroupItem {
        val text = item.trim()
        if (text.startsWith("[")) return parseFlowPair(text)
        if (text.startsWith("{")) {
            return if (parseFlowMapping(text) != null) FlowGroupItem.Options else FlowGroupItem.Unreadable
        }
        parseFlowScalarOptions(text)?.let { return it }
        // A scalar keeps every character but a quote pair around it. A bracket left over means the
        // item was a list or a mapping that did not close, so it is not a name.
        val name = stripYamlQuotes(text)
        if (name.any { it in "[]{}" }) return FlowGroupItem.Unreadable
        return FlowGroupItem.Name(name)
    }

    /**
     * Index of the `:` that turns a plain scalar into a YAML mapping, or -1 for a plain name.
     *
     * YAML forbids `: ` inside a plain scalar, so such a colon starts a mapping entry. A colon
     * inside quotes, or one followed by a non-space such as the `:` in `https://`, is part of the
     * scalar, and a doubled `''` inside a single-quoted scalar keeps the scan inside it. A trailing
     * `:` is the separator of an entry with an empty value.
     */
    private fun flowScalarSeparator(text: String): Int {
        var inSingleQuotes = false
        var inDoubleQuotes = false
        var i = 0
        while (i < text.length) {
            val c = text[i]
            if (inDoubleQuotes) {
                when (c) {
                    '\\' -> i++ // the backslash escapes the next character
                    '"' -> inDoubleQuotes = false
                }
                i++
                continue
            }
            if (inSingleQuotes) {
                val run = singleQuoteRun(text, i)
                inSingleQuotes = run != 1 // a lone quote closes the scalar
                i += run.coerceAtLeast(1)
                continue
            }
            when (c) {
                '\'' -> if (opensScalar(text, i)) inSingleQuotes = true
                '"' -> if (opensScalar(text, i)) inDoubleQuotes = true
                ':' -> if (i == text.length - 1 || text[i + 1] == ' ' || text[i + 1] == '\t') return i
            }
            i++
        }
        return -1
    }

    /**
     * Read a plain `key: value` list item as the options-bearing item it is, or null for a name.
     *
     * The item is [FlowGroupItem.Options] when its key reads. An empty key, or one holding a
     * bracket, is [FlowGroupItem.Unreadable] so the group it qualifies narrows to ask.
     */
    private fun parseFlowScalarOptions(text: String): FlowGroupItem? {
        val sep = flowScalarSeparator(text)
        if (sep < 0) return null
        val key = stripYamlQuotes(text.substring(0, sep).trim())
        if (key.isEmpty() || key.any { it in "[]{}" }) return FlowGroupItem.Unreadable
        return FlowGroupItem.Options
    }

    /** Read `[name, { ... }, ...]` as a (name, options) pair, or report why it does not read. */
    private fun parseFlowPair(text: String): FlowGroupItem {
        if (!text.endsWith("]")) return FlowGroupItem.Unreadable
        val parts = splitFlowSequence(text.substring(1, text.length - 1)) ?: return FlowGroupItem.Unreadable
        val items = parts.map { it.trim() }.filter { it.isNotEmpty() }
        val nameText = items.firstOrNull() ?: return FlowGroupItem.Unreadable
        if (nameText.startsWith("[") || nameText.startsWith("{")) return FlowGroupItem.Unreadable
        val name = stripYamlQuotes(nameText)
        if (name.any { it in "[]{}" }) return FlowGroupItem.Unreadable
        val options = mutableMapOf<String, String>()
        for (extra in items.drop(1)) {
            // A second scalar, or a mapping this parser cannot read, leaves the pair unread: the
            // options the user wrote are not recoverable, so the group narrows to ask.
            val mapping = parseFlowMapping(extra)
                ?: return FlowGroupItem.Group(Pair(name, mapOf(UNPARSED_GROUP_OPTION to "true")))
            options.putAll(mapping)
        }
        return FlowGroupItem.Group(Pair(name, options))
    }

    /**
     * Read a flow value written after `groups:` or `- ` into the items it holds.
     *
     * A `[...]` sequence yields its items and a `{ ... }` mapping yields the one item it is, which
     * the caller reads as the options of the group just before it. Returns null when the value does
     * not read, so no part of it is taken as a group.
     */
    private fun splitFlowItems(text: String): List<String>? {
        val body = text.trim()
        if (body.startsWith("[")) {
            if (!body.endsWith("]")) return null
            return splitFlowSequence(body.substring(1, body.length - 1))
        }
        if (body.startsWith("{")) return if (parseFlowMapping(body) != null) listOf(body) else null
        return null
    }

    fun parseCustomModesYaml(text: String): List<LegacyCustomMode> {
        val modes = mutableListOf<LegacyCustomMode>()
        val lines = text.split("\n")
        var inModes = false
        var current: MutableMap<String, Any?> = mutableMapOf()
        var blockField: String? = null
        var blockLines = mutableListOf<String>()
        var inGroups = false
        var groups = mutableListOf<Any>()
        var pendingGroupName: String? = null
        var pendingGroupOptions = mutableMapOf<String, String>()
        var pendingGroupUnparsed = false

        /**
         * Record the items of one `groups:` flow value.
         *
         * A bare `{ ... }` mapping, or an item whose brackets do not read, is never a group: it
         * carries the options the user meant for the plain name just before it, so that name is
         * replaced by an unread pair and the converter writes `ask`. With no such name the item is
         * reported as written, so the converter warns about it instead of it vanishing.
         */
        fun addFlowGroups(items: List<String>) {
            for (item in items) {
                val text = item.trim()
                if (text.isEmpty()) continue
                when (val parsed = parseFlowGroupItem(text)) {
                    is FlowGroupItem.Name -> groups.add(parsed.name)
                    is FlowGroupItem.Group -> groups.add(parsed.pair)
                    FlowGroupItem.Options, FlowGroupItem.Unreadable -> {
                        val last = groups.lastIndex
                        val name = groups.getOrNull(last) as? String
                        if (name != null) {
                            groups[last] = Pair(name, mapOf(UNPARSED_GROUP_OPTION to "true"))
                        } else {
                            groups.add(stripYamlQuotes(text))
                        }
                    }
                }
            }
        }

        /** Close an open `- - <name>` options block into a Pair group. */
        fun closeGroupOptions() {
            val name = pendingGroupName
            if (name != null) {
                val options = pendingGroupOptions.toMutableMap()
                if (pendingGroupUnparsed) options[UNPARSED_GROUP_OPTION] = "true"
                groups.add(Pair(name, options))
            }
            pendingGroupName = null
            pendingGroupOptions = mutableMapOf()
            pendingGroupUnparsed = false
        }

        /** Parse a `key: value` option line of an open group options block. */
        fun addGroupOption(line: String) {
            val sep = line.indexOf(": ")
            val (key, value) = if (sep >= 0) {
                line.substring(0, sep).trim() to stripYamlQuotes(line.substring(sep + 2).trim())
            } else {
                line.removeSuffix(":").trim() to ""
            }
            if (key.isEmpty()) return
            pendingGroupOptions[key] = value
        }

        fun closeGroups() {
            closeGroupOptions()
            inGroups = false
        }

        fun flush() {
            val slug = current["slug"] as? String ?: return
            val name = current["name"] as? String ?: return
            if (blockField != null && blockLines.isNotEmpty()) {
                current[blockField!!] = blockLines.joinToString("\n").trim()
            }
            closeGroupOptions()
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

        for (rawLine in lines) {
            if (!inModes) {
                if (stripYamlComment(rawLine).trim() == "customModes:") inModes = true
                continue
            }
            // Lines of an open block scalar are literal content: keep every character, '#' included.
            if (blockField != null && rawLine.startsWith("      ")) {
                blockLines.add(rawLine.removePrefix("      "))
                continue
            }
            val raw = stripYamlComment(rawLine)
            // A blank line or a comment-only line does not end an open groups block.
            if (inGroups && raw.isBlank()) continue
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
                closeGroups()
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
                current[blockField!!] = blockLines.joinToString("\n").trim()
                blockField = null
                blockLines = mutableListOf()
            }

            if (raw.matches(Regex("    groups:.*"))) {
                closeGroups()
                inGroups = true
                groups = mutableListOf()
                val inline = raw.removePrefix("    groups:").trim()
                if (inline.startsWith("[") || inline.startsWith("{")) {
                    val items = splitFlowItems(inline)
                    if (items != null) {
                        addFlowGroups(items)
                        closeGroups()
                    } else {
                        // A flow value that does not read is still reported as a group entry, so the
                        // converter warns about it instead of the whole value vanishing. The block
                        // stays open, so an indented list item below it is still read.
                        groups.add(stripYamlQuotes(inline))
                    }
                }
                continue
            }
            if (inGroups && raw.startsWith("      - - ")) {
                closeGroupOptions()
                pendingGroupName = stripYamlQuotes(raw.removePrefix("      - - ").trim())
                continue
            }
            if (inGroups && pendingGroupName != null && raw.startsWith("        - ")) {
                addGroupOption(raw.removePrefix("        - ").trim())
                continue
            }
            if (inGroups && pendingGroupName != null && raw.startsWith("          ") &&
                !raw.startsWith("          - ")
            ) {
                addGroupOption(raw.trim())
                continue
            }
            if (inGroups && (raw.startsWith("      - [") || raw.startsWith("      - {"))) {
                closeGroupOptions()
                // The list item is one flow value: `[name, { ... }]` is the pair shape the legacy
                // docs show, and a `{ ... }` item carries the options of the name before it.
                addFlowGroups(listOf(raw.removePrefix("      - ").trim()))
                continue
            }
            if (inGroups && raw.matches(Regex("      - .*"))) {
                closeGroupOptions()
                val entry = raw.removePrefix("      - ").trim()
                // A `key: value` list item is a mapping, so it carries the options of the plain
                // name just before it instead of naming a group of its own.
                if (parseFlowScalarOptions(entry) != null) {
                    addFlowGroups(listOf(entry))
                } else {
                    groups.add(stripYamlQuotes(entry))
                }
                continue
            }
            if (inGroups && !raw.startsWith("      ")) {
                closeGroups()
            }
            // An option line the shapes above do not read belongs to the open group, so the
            // converter narrows that group instead of receiving a junk entry.
            if (inGroups && pendingGroupName != null) {
                pendingGroupUnparsed = true
                continue
            }
            // A line the rules above did not consume is still reported as a group entry, so the
            // converter can warn about it instead of the entry vanishing.
            if (inGroups && raw.isNotBlank()) {
                closeGroupOptions()
                groups.add(stripYamlQuotes(raw.trim()))
            }
        }
        flush()
        return modes
    }
}

private const val MAX_GLOB_ARMS = 32

private val UNSUPPORTED_REGEX_CHARS = setOf('*', '+', '{', '}', '[', ']', '^', '$', '?')

// A backslash may escape only an ASCII punctuation character that the glob carries literally.
// Backslash, `*` and `?` are excluded because the glob syntax has no literal form for them.
// The set is written out because a Unicode-aware predicate cannot be mirrored exactly between
// JavaScript and Java; a fixed ASCII set keeps this translator identical to the TypeScript one.
private val ESCAPABLE: Set<Char> = "!\"#\$%&'()+,-./:;<=>@[]^_`{|}~".toSet()

/**
 * Translate a legacy `fileRegex` pattern into permission wildcard globs.
 *
 * A top-level `|` is the same alternation a group carries, with each alternative holding its own
 * anchors, so `^src/.*|^test/.*` grants exactly what `^(src/.*|test/.*)$` grants. One alternative
 * the glob syntax cannot express rejects the whole pattern: a rule that kept only the other
 * alternatives would deny files the legacy pattern allowed, so the caller reports it instead.
 *
 * Returns null when the pattern uses a construct that the glob syntax cannot
 * express, or when every alternative is empty while both anchors are present,
 * so the caller can report it instead of writing an unmatched rule.
 *
 * A glob arm made only of digits is also rejected. When the CLI reads the written config back,
 * JavaScript enumerates such a key as an array index ahead of `"*"`, so the trailing `"*": "deny"`
 * wins and the file the legacy mode allowed is denied.
 *
 * A glob arm that names a home-relative path is also rejected. `Permission.fromConfig` runs every
 * configured pattern through its `expand()`, which rewrites `~`, `~/...` and `$HOME...` to an
 * absolute path under the user's home directory. The file permissions ask with a workspace-relative
 * path, so such an arm does not match and the sibling catch-all deny decides instead: the migrated
 * rule stops meaning what the legacy pattern meant.
 */
internal fun fileRegexToGlobs(regex: String): List<String>? {
    val parts = splitTopLevel(regex) ?: return null
    if (parts.size == 1) return translateFileRegex(parts[0])

    val arms = mutableSetOf<String>()
    for (part in parts) {
        // An empty alternative matches the empty string, and no path is empty. Split at the top
        // level it carries no anchor, so it matches every path, which is the rule the existing
        // empty-alternative handling applies inside a group.
        if (part.isEmpty()) {
            arms.add("*")
            continue
        }
        val globs = translateFileRegex(part) ?: return null
        arms.addAll(globs)
    }
    return checkGlobArms(arms.toList())
}

/**
 * Split a pattern at its top-level `|` alternatives.
 *
 * A `|` escaped by an odd number of backslashes is a literal and never splits, and a `|` inside
 * parentheses belongs to the group parser. The empty string between two adjacent separators is
 * kept as a part, because it is a real empty alternative. Returns null for a `)` outside any
 * group, which no supported pattern contains.
 */
private fun splitTopLevel(text: String): List<String>? {
    val parts = mutableListOf<String>()
    var depth = 0
    var start = 0
    var i = 0
    while (i < text.length) {
        val c = text[i]
        if (c == '|' && depth == 0 && !isEscapedAt(text, i)) {
            parts.add(text.substring(start, i))
            start = i + 1
            i += 1
            continue
        }
        if (!isEscapedAt(text, i)) {
            if (c == '(') depth += 1
            if (c == ')') {
                if (depth == 0) return null
                depth -= 1
            }
        }
        i += 1
    }
    parts.add(text.substring(start))
    return parts
}

/** Translate one alternative, which carries its own `^` and `$` anchors. */
private fun translateFileRegex(regex: String): List<String>? {
    if (regex.isEmpty()) return null
    var body = regex
    val anchoredStart = body.startsWith("^")
    if (anchoredStart) body = body.substring(1)
    var anchoredEnd = false
    if (body.isNotEmpty() && body.endsWith("$") && !isEscapedAt(body, body.length - 1)) {
        anchoredEnd = true
        body = body.substring(0, body.length - 1)
    }
    if (body.isEmpty()) return null

    val parsed = parseGlobSequence(body, 0, inGroup = false)?.first ?: return null

    // An empty alternative matches the empty string, and no path is empty. With both anchors
    // the pattern must consume the whole path, so empty alternatives are dropped and the arms
    // that do name a path are kept: `^(a|)$` and `^(|a)$` both allow `a`. Only when every arm
    // is empty does the pattern match nothing but the empty string, which no glob can express,
    // so the caller must report it. Without both anchors an empty arm is padded to `*`, which
    // is right because that arm then matches the rest of any path.
    val kept = if (anchoredStart && anchoredEnd) parsed.filter { it.isNotEmpty() } else parsed
    if (kept.isEmpty()) return null

    val arms = kept.map { arm ->
        var result = arm
        if (!anchoredStart && !result.startsWith("*")) result = "*$result"
        if (!anchoredEnd && !result.endsWith("*")) result = "$result*"
        result
    }.distinct()

    return checkGlobArms(arms)
}

/**
 * Apply the arm-level limits shared by one translated alternative and a union of them.
 *
 * The arm count stays under [MAX_GLOB_ARMS], an arm ending in a literal space is rejected, and so
 * are a home-relative arm and an all-digit one.
 */
private fun checkGlobArms(arms: List<String>): List<String>? {
    if (arms.size > MAX_GLOB_ARMS) return null
    // `Wildcard.match` rewrites a pattern ending in `" .*"` into `"( .*)?"`, so an arm ending in
    // ` *` also matches the text before the space. A pattern ending in a literal space (`^docs `
    // becomes `docs *`) is expressible but is rejected here, so that group asks and the
    // restriction is reported.
    if (arms.any { it.endsWith(" *") }) return null
    // See the KDoc: the CLI expands such an arm to an absolute home path before matching.
    if (arms.any { isHomeArm(it) }) return null
    // See the KDoc. Only ASCII digits form an array index, so only those arms are rejected.
    if (arms.any { arm -> arm.all { it in '0'..'9' } }) return null
    return arms
}

/**
 * True when the CLI's `expand()` would rewrite [arm] against the user's home directory.
 *
 * The check is anchored at the start, so an arm that merely contains `~` later, such as
 * `*~*`, is left alone.
 */
private fun isHomeArm(arm: String): Boolean =
    arm == "~" || arm.startsWith("~/") || arm.startsWith("\$HOME")

private fun isEscapedAt(text: String, index: Int): Boolean {
    var backslashes = 0
    var i = index - 1
    while (i >= 0 && text[i] == '\\') {
        backslashes++
        i--
    }
    return backslashes % 2 == 1
}

private fun globProduct(left: List<String>, right: List<String>): List<String>? {
    if (left.size.toLong() * right.size.toLong() > MAX_GLOB_ARMS) return null
    val out = ArrayList<String>(left.size * right.size)
    for (a in left) for (b in right) out.add(a + b)
    return out
}

/**
 * Parse a supported regex sequence starting at [start] into glob arms.
 *
 * Returns the arms and the index of the char that stopped the parse: `)` or `|`
 * inside a group, or the end of the text at the top level.
 */
private fun parseGlobSequence(text: String, start: Int, inGroup: Boolean): Pair<List<String>, Int>? {
    var arms = listOf("")
    var i = start
    while (i < text.length) {
        val c = text[i]
        if (inGroup && (c == ')' || c == '|')) return arms to i
        if (!inGroup && (c == ')' || c == '|')) return null

        val atom: List<String>
        when (c) {
            '\\' -> {
                if (i + 1 >= text.length) return null
                val escaped = text[i + 1]
                if (escaped !in ESCAPABLE) return null
                atom = listOf(escaped.toString())
                i += 2
            }
            '.' -> {
                if (i + 1 < text.length && text[i + 1] == '*') {
                    atom = listOf("*")
                    i += 2
                } else {
                    atom = listOf("?")
                    i += 1
                }
            }
            '(' -> {
                if (inGroup) return null
                val group = parseGlobGroup(text, i) ?: return null
                atom = group.first
                i = group.second
            }
            else -> {
                if (c in UNSUPPORTED_REGEX_CHARS) return null
                atom = listOf(c.toString())
                i += 1
            }
        }

        val before: List<String> = arms
        arms = globProduct(before, atom) ?: return null

        if (i < text.length && text[i] == '?') {
            val optional = (before + arms).distinct()
            if (optional.size > MAX_GLOB_ARMS) return null
            arms = optional
            i += 1
        }
    }
    return arms to i
}

private fun parseGlobGroup(text: String, start: Int): Pair<List<String>, Int>? {
    var i = start + 1
    var arms = mutableListOf<String>()
    var current = listOf("")
    while (true) {
        val seq = parseGlobSequence(text, i, inGroup = true) ?: return null
        current = globProduct(current, seq.first) ?: return null
        val next = seq.second
        if (next >= text.length) return null
        when (text[next]) {
            ')' -> {
                arms.addAll(current)
                if (arms.size > MAX_GLOB_ARMS) return null
                return arms to next + 1
            }
            '|' -> {
                arms.addAll(current)
                if (arms.size > MAX_GLOB_ARMS) return null
                current = listOf("")
                i = next + 1
            }
            else -> return null
        }
    }
}
