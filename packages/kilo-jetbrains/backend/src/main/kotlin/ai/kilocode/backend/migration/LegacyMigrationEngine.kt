package ai.kilocode.backend.migration

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import ai.kilocode.log.KiloLog
import ai.kilocode.backend.migration.LegacyMigrationConverters.convertAutoApproval
import ai.kilocode.backend.migration.LegacyMigrationConverters.convertCustomMode
import ai.kilocode.backend.migration.LegacyMigrationConverters.convertCustomModePermissions
import ai.kilocode.backend.migration.LegacyMigrationConverters.convertDefaultModel
import ai.kilocode.backend.migration.LegacyMigrationConverters.convertMcpServer
import ai.kilocode.backend.migration.LegacyMigrationConverters.convertProvider
import ai.kilocode.backend.migration.LegacyMigrationConverters.parseCustomModePrompts
import ai.kilocode.backend.migration.LegacyMigrationConverters.parseCustomModes
import ai.kilocode.backend.migration.LegacyMigrationConverters.parseHistoryItems
import ai.kilocode.backend.migration.LegacyMigrationConverters.parseMcpSettings
import ai.kilocode.backend.migration.LegacyMigrationConverters.parseProviderProfiles
import ai.kilocode.backend.migration.LegacyMigrationConverters.parseSettings
import ai.kilocode.backend.migration.session.LegacySessionIds
import ai.kilocode.backend.migration.session.LegacySessionParser

/**
 * Orchestrates legacy data detection, migration, and cleanup.
 *
 * This class is stateless per-call: [detect] and [migrate] re-read source data
 * each time so the UI always sees the current snapshot. No background threads,
 * locks, or EDT scheduling — callers own all sequencing.
 *
 * Progress sink callbacks are invoked synchronously on the caller's thread.
 */
class LegacyMigrationEngine(
    private val store: LegacyMigrationStore,
    private val backend: LegacyMigrationBackend,
) {

    companion object {
        private val LOG = KiloLog.create(LegacyMigrationEngine::class.java)
    }

    // -----------------------------------------------------------------------
    // Status
    // -----------------------------------------------------------------------

    fun status(): LegacyMigrationStatus? = store.status()

    fun mark(status: LegacyMigrationStatus) = store.mark(status)

    // -----------------------------------------------------------------------
    // Detection
    // -----------------------------------------------------------------------

    fun detect(): LegacyMigrationDetection {
        val profiles = parseProviderProfiles(store.providerProfilesRaw())
        val mcpServers = parseMcpSettings(store.mcpSettingsRaw())
        val customModes = parseCustomModes(store.customModesRaw())
        val prompts = parseCustomModePrompts(store.customModePromptsRaw())
        val settings = parseSettings { store.globalStateValue(it) }

        // Detect OAuth providers
        val oauthProviders = mutableSetOf<String>()
        if (store.oauthRaw("openai-codex-oauth-credentials") != null) oauthProviders.add("openai-codex")

        val providerList = buildProviderList(profiles, oauthProviders)
        val mcpList = buildMcpServerList(mcpServers)
        val modeList = buildCustomModeList(customModes, prompts)
        val defaultModel = resolveDefaultModel(profiles, oauthProviders)

        val sessions = detectSessions()

        val hasSettings = settings.autoApprovalEnabled != null ||
                !settings.allowedCommands.isNullOrEmpty() ||
                !settings.deniedCommands.isNullOrEmpty() ||
                settings.alwaysAllowReadOnly != null ||
                settings.alwaysAllowReadOnlyOutsideWorkspace != null ||
                settings.alwaysAllowWrite != null ||
                settings.alwaysAllowExecute != null ||
                settings.alwaysAllowMcp != null ||
                settings.alwaysAllowModeSwitch != null ||
                settings.alwaysAllowSubtasks != null ||
                !settings.language.isNullOrEmpty() ||
                settings.autocomplete != null

        val hasData = providerList.isNotEmpty() || mcpList.isNotEmpty() || modeList.isNotEmpty() ||
                hasSettings || sessions.isNotEmpty()

        return LegacyMigrationDetection(
            providers = providerList,
            mcpServers = mcpList,
            customModes = modeList,
            sessions = sessions,
            defaultModel = defaultModel,
            settings = if (hasSettings) settings else null,
            hasData = hasData,
        )
    }

    fun detectSessions(): List<MigrationSessionInfo> {
        val items = parseHistoryItems(store.taskHistoryRaw())
        return items.mapNotNull { item ->
            if (store.taskConversationRaw(item.id) == null) return@mapNotNull null
            MigrationSessionInfo(
                id = item.id,
                title = item.task?.trim() ?: item.id,
                directory = item.workspace?.trim() ?: "",
                time = item.ts ?: 0L,
            )
        }
    }

    // -----------------------------------------------------------------------
    // Migration
    // -----------------------------------------------------------------------

    fun migrate(
        selections: LegacyMigrationSelections,
        sink: LegacyMigrationSink = LegacyMigrationSink.None,
    ): LegacyMigrationReport {
        val profiles = parseProviderProfiles(store.providerProfilesRaw())
        val mcpServers = parseMcpSettings(store.mcpSettingsRaw())
        val customModes = parseCustomModes(store.customModesRaw())
        val prompts = parseCustomModePrompts(store.customModePromptsRaw())
        val settings = parseSettings { store.globalStateValue(it) }
        val sessions = detectSessions()
        val historyItems = parseHistoryItems(store.taskHistoryRaw())

        val results = mutableListOf<LegacyMigrationResultItem>()

        // Providers
        for (profileName in selections.providers) {
            val providerSettings = profiles?.apiConfigs?.get(profileName)
            if (providerSettings == null) {
                results.add(LegacyMigrationResultItem(profileName, MigrationItemCategory.provider, MigrationItemStatus.error, "Profile not found"))
                continue
            }
            sink.item(LegacyMigrationItemProgress(profileName, MigrationItemProgressStatus.migrating))
            val conv = convertProvider(profileName, providerSettings) { store.oauthRaw(it) }
            conv.auth?.let { backend.setAuth(PROVIDER_MAP[providerSettings["apiProvider"]?.jsonPrimitive?.content]?.id ?: "unknown", it) }
            conv.config?.let { backend.updateGlobalConfig(it) }
            val item = LegacyMigrationResultItem(profileName, MigrationItemCategory.provider, conv.status, conv.message)
            results.add(item)
            sink.item(LegacyMigrationItemProgress(profileName, conv.status.toProgressStatus(), conv.message))
        }

        // MCP servers
        if (selections.mcpServers.isNotEmpty() && mcpServers != null) {
            val mcpConfig = mutableMapOf<String, JsonObject>()
            for (name in selections.mcpServers) {
                val server = mcpServers[name]
                if (server == null) {
                    results.add(LegacyMigrationResultItem(name, MigrationItemCategory.mcpServer, MigrationItemStatus.error, "Server not found"))
                    continue
                }
                sink.item(LegacyMigrationItemProgress(name, MigrationItemProgressStatus.migrating))
                val converted = convertMcpServer(name, server)
                if (converted != null) {
                    mcpConfig[name] = converted
                    results.add(LegacyMigrationResultItem(name, MigrationItemCategory.mcpServer, MigrationItemStatus.success))
                    sink.item(LegacyMigrationItemProgress(name, MigrationItemProgressStatus.success))
                } else {
                    results.add(LegacyMigrationResultItem(name, MigrationItemCategory.mcpServer, MigrationItemStatus.warning, "Could not convert server config"))
                    sink.item(LegacyMigrationItemProgress(name, MigrationItemProgressStatus.warning, "Could not convert server config"))
                }
            }
            if (mcpConfig.isNotEmpty()) {
                backend.updateGlobalConfig(buildJsonObject { put("mcp", JsonObject(mcpConfig)) })
            }
        }

        // Custom modes as agents
        if (selections.customModes.isNotEmpty()) {
            val agentConfig = mutableMapOf<String, JsonObject>()
            val detected = buildCustomModeList(customModes, prompts)
            for (slug in selections.customModes) {
                val info = detected.find { it.slug == slug }
                if (info == null) {
                    results.add(LegacyMigrationResultItem(slug, MigrationItemCategory.customMode, MigrationItemStatus.error, "Mode not found"))
                    continue
                }
                if (info.nativeSlug != null) {
                    val merged = LegacyMigrationConverters.buildMergedNativeMode(
                        customModes?.find { it.slug == info.nativeSlug },
                        prompts?.get(info.nativeSlug),
                        info.nativeSlug,
                    )
                    if (merged != null) {
                        sink.item(LegacyMigrationItemProgress(info.name, MigrationItemProgressStatus.migrating))
                        val agent = convertCustomMode(merged).toMutableMap()
                        agent["name"] = JsonPrimitive(info.name)
                        agentConfig[slug] = JsonObject(agent)
                        results.add(LegacyMigrationResultItem(info.name, MigrationItemCategory.customMode, MigrationItemStatus.success))
                        sink.item(LegacyMigrationItemProgress(info.name, MigrationItemProgressStatus.success))
                    } else {
                        results.add(LegacyMigrationResultItem(info.name, MigrationItemCategory.customMode, MigrationItemStatus.error, "Failed to build merged mode"))
                    }
                } else {
                    val mode = customModes?.find { it.slug == slug }
                    if (mode == null) {
                        results.add(LegacyMigrationResultItem(slug, MigrationItemCategory.customMode, MigrationItemStatus.error, "Mode not found"))
                        continue
                    }
                    sink.item(LegacyMigrationItemProgress(mode.name, MigrationItemProgressStatus.migrating))
                    agentConfig[slug] = convertCustomMode(mode)
                    results.add(LegacyMigrationResultItem(mode.name, MigrationItemCategory.customMode, MigrationItemStatus.success))
                    sink.item(LegacyMigrationItemProgress(mode.name, MigrationItemProgressStatus.success))
                }
            }
            if (agentConfig.isNotEmpty()) {
                backend.updateGlobalConfig(buildJsonObject { put("agent", JsonObject(agentConfig)) })
            }
        }

        // Sessions
        var sessionProgressEmitted = false
        for ((idx, sel) in selections.sessions.withIndex()) {
            val info = sessions.find { it.id == sel.id }
            val historyItem = historyItems.find { it.id == sel.id }
            val conversationRaw = store.taskConversationRaw(sel.id)

            val sessionId = LegacySessionIds.createSessionId(sel.id)

            if (backend.sessionExists(sessionId)) {
                LOG.info("Migration session duplicate skipped legacy=${sel.id} session=$sessionId title=${info?.title}")
                continue
            }

            sink.item(LegacyMigrationItemProgress(sel.id, MigrationItemProgressStatus.migrating))
            sessionProgressEmitted = true

            if (conversationRaw == null) {
                val msg = "Conversation file not found"
                sink.session(LegacyMigrationSessionProgress(info, idx, selections.sessions.size, MigrationSessionPhase.error, msg))
                results.add(LegacyMigrationResultItem(sel.id, MigrationItemCategory.session, MigrationItemStatus.error, msg))
                sink.item(LegacyMigrationItemProgress(sel.id, MigrationItemProgressStatus.error, msg))
                continue
            }

            sink.session(LegacyMigrationSessionProgress(info, idx, selections.sessions.size, MigrationSessionPhase.preparing))

            val parsed = runCatching {
                LegacySessionParser.parseSession(sel.id, conversationRaw, historyItem)
            }.getOrElse { e ->
                val msg = e.message ?: "Parse error"
                sink.session(LegacyMigrationSessionProgress(info, idx, selections.sessions.size, MigrationSessionPhase.error, msg))
                results.add(LegacyMigrationResultItem(sel.id, MigrationItemCategory.session, MigrationItemStatus.error, msg))
                sink.item(LegacyMigrationItemProgress(sel.id, MigrationItemProgressStatus.error, msg))
                null
            } ?: continue

            sink.session(LegacyMigrationSessionProgress(info, idx, selections.sessions.size, MigrationSessionPhase.storing))

            val projectId = runCatching { backend.importProject(parsed.project) }.getOrElse { e ->
                val msg = e.message ?: "Project import failed"
                sink.session(LegacyMigrationSessionProgress(info, idx, selections.sessions.size, MigrationSessionPhase.error, msg))
                results.add(LegacyMigrationResultItem(sel.id, MigrationItemCategory.session, MigrationItemStatus.error, msg))
                sink.item(LegacyMigrationItemProgress(sel.id, MigrationItemProgressStatus.error, msg))
                null
            } ?: continue

            val sessionPayload = buildJsonObject {
                parsed.session.entries.forEach { (k, v) -> put(k, v) }
                put("projectID", projectId)
            }

            val importResult = runCatching { backend.importSession(sessionPayload) }.getOrElse { e ->
                val msg = e.message ?: "Session import failed"
                sink.session(LegacyMigrationSessionProgress(info, idx, selections.sessions.size, MigrationSessionPhase.error, msg))
                results.add(LegacyMigrationResultItem(sel.id, MigrationItemCategory.session, MigrationItemStatus.error, msg))
                sink.item(LegacyMigrationItemProgress(sel.id, MigrationItemProgressStatus.error, msg))
                null
            } ?: continue

            if (importResult.skipped) {
                LOG.info("Migration session import duplicate skipped legacy=${sel.id} session=${importResult.id}")
                continue
            }

            val errors = mutableListOf<String>()
            for (msg in parsed.messages) {
                runCatching { backend.importMessage(msg) }.getOrElse { e ->
                    val err = e.message ?: "Message import failed"
                    LOG.warn("Migration message import failed legacy=${sel.id}: $err")
                    errors.add(err)
                }
            }
            for (part in parsed.parts) {
                runCatching { backend.importPart(part) }.getOrElse { e ->
                    val err = e.message ?: "Part import failed"
                    LOG.warn("Migration part import failed legacy=${sel.id}: $err")
                    errors.add(err)
                }
            }

            val status = if (errors.isEmpty()) MigrationItemStatus.success else MigrationItemStatus.warning
            val msg = errors.firstOrNull()
            sink.session(LegacyMigrationSessionProgress(info, idx, selections.sessions.size, MigrationSessionPhase.done, msg))
            results.add(LegacyMigrationResultItem(sel.id, MigrationItemCategory.session, status, msg))
            sink.item(LegacyMigrationItemProgress(sel.id, status.toProgressStatus(), msg))
        }

        // Summary progress for sessions
        if (sessionProgressEmitted) {
            val last = sessions.find { it.id == selections.sessions.last().id }
            sink.session(LegacyMigrationSessionProgress(last, selections.sessions.size, selections.sessions.size, MigrationSessionPhase.summary))
        }

        // Default model
        if (selections.defaultModel && profiles != null) {
            val activeName = profiles.currentApiConfigName
            val active = profiles.apiConfigs[activeName]
            if (active != null) {
                sink.item(LegacyMigrationItemProgress("Default model", MigrationItemProgressStatus.migrating))
                val patch = convertDefaultModel(active)
                if (patch != null) {
                    backend.updateGlobalConfig(patch)
                    results.add(LegacyMigrationResultItem("Default model", MigrationItemCategory.defaultModel, MigrationItemStatus.success))
                    sink.item(LegacyMigrationItemProgress("Default model", MigrationItemProgressStatus.success))
                } else {
                    results.add(LegacyMigrationResultItem("Default model", MigrationItemCategory.defaultModel, MigrationItemStatus.warning, "No model ID found"))
                    sink.item(LegacyMigrationItemProgress("Default model", MigrationItemProgressStatus.warning, "No model ID found"))
                }
            }
        }

        // Auto-approval / permissions
        val apSel = selections.settings.autoApproval
        val anyAutoApproval = apSel.commandRules || apSel.readPermission || apSel.writePermission ||
                apSel.executePermission || apSel.mcpPermission || apSel.taskPermission
        if (anyAutoApproval) {
            val conv = convertAutoApproval(settings, apSel)
            conv.config?.let { backend.updateGlobalConfig(it) }
            for ((label, status) in conv.results) {
                sink.item(LegacyMigrationItemProgress(label, status.toProgressStatus()))
                results.add(LegacyMigrationResultItem(label, MigrationItemCategory.settings, status))
            }
        }

        // Language
        if (selections.settings.language && !settings.language.isNullOrEmpty()) {
            sink.item(LegacyMigrationItemProgress("Language preference", MigrationItemProgressStatus.migrating))
            val conv = LegacyMigrationConverters.convertLanguage(settings.language)
            if (conv.mapped != null) {
                // Language setting is JetBrains-only; for now report success but don't write anywhere
                results.add(LegacyMigrationResultItem("Language preference", MigrationItemCategory.settings, MigrationItemStatus.success))
                sink.item(LegacyMigrationItemProgress("Language preference", MigrationItemProgressStatus.success))
            } else {
                results.add(LegacyMigrationResultItem("Language preference", MigrationItemCategory.settings, conv.status, conv.message))
                sink.item(LegacyMigrationItemProgress("Language preference", conv.status.toProgressStatus(), conv.message))
            }
        }

        // Autocomplete settings are persisted by the JetBrains frontend before backend migration starts.
        if (selections.settings.autocomplete && settings.autocomplete != null) {
            sink.item(LegacyMigrationItemProgress("Autocomplete settings", MigrationItemProgressStatus.migrating))
            results.add(LegacyMigrationResultItem("Autocomplete settings", MigrationItemCategory.settings, MigrationItemStatus.success))
            sink.item(LegacyMigrationItemProgress("Autocomplete settings", MigrationItemProgressStatus.success))
        }

        return LegacyMigrationReport(results)
    }

    // -----------------------------------------------------------------------
    // Cleanup
    // -----------------------------------------------------------------------

    fun cleanup(targets: LegacyCleanupTargets): LegacyCleanupReport = store.cleanup(targets)

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    private fun buildProviderList(
        profiles: LegacyProviderProfiles?,
        oauthProviders: Set<String>,
    ): List<MigrationProviderInfo> {
        if (profiles?.apiConfigs == null) return emptyList()
        return profiles.apiConfigs.entries.map { (profileName, settings) ->
            val provider: String = settings["apiProvider"]?.jsonPrimitive?.content ?: "unknown"
            val mapping = PROVIDER_MAP[provider]
            val unsupported = provider in UNSUPPORTED_PROVIDERS
            val modelField: String = mapping?.modelField ?: "apiModelId"
            val model: String? = settings[modelField]?.jsonPrimitive?.content
            val hasApiKey: Boolean = when {
                mapping?.oauthSecretKey != null -> provider in oauthProviders
                mapping?.skipAuth == true -> {
                    val fields: List<ConfigField> = mapping.configFields ?: emptyList()
                    fields.any { f -> settings[f.from]?.jsonPrimitive?.content?.isNotBlank() == true }
                }
                mapping != null -> settings[mapping.key]?.jsonPrimitive?.content?.isNotBlank() == true
                else -> false
            }
            MigrationProviderInfo(
                profileName = profileName,
                provider = provider,
                model = model,
                hasApiKey = hasApiKey,
                supported = mapping != null && !unsupported,
                newProviderName = mapping?.name,
            )
        }
    }

    private fun buildMcpServerList(servers: Map<String, LegacyMcpServer>?): List<MigrationMcpServerInfo> {
        servers ?: return emptyList()
        return servers.map { (name, s) ->
            MigrationMcpServerInfo(name = name, type = s.type ?: "stdio", disabled = s.disabled)
        }
    }

    fun buildCustomModeList(
        modes: List<LegacyCustomMode>?,
        prompts: Map<String, JsonObject>?,
    ): List<MigrationCustomModeInfo> {
        val result = mutableListOf<MigrationCustomModeInfo>()
        // Non-native custom modes
        modes?.forEach { m ->
            if (m.slug !in DEFAULT_MODE_SLUGS) result.add(MigrationCustomModeInfo(name = m.name, slug = m.slug))
        }
        // Modified native modes
        for (slug in DEFAULT_MODE_SLUGS) {
            val defaults = LegacyMigrationConverters.NATIVE_MODE_DEFAULTS[slug] ?: continue
            val yaml = modes?.find { it.slug == slug }
            val prompt = prompts?.get(slug)
            if (!LegacyMigrationConverters.isNativeModeModified(yaml, prompt, defaults)) continue
            val name = yaml?.name ?: defaults.name
            result.add(MigrationCustomModeInfo(name = "$name (Custom)", slug = "$slug-custom", nativeSlug = slug))
        }
        return result
    }

    private fun resolveDefaultModel(
        profiles: LegacyProviderProfiles?,
        oauthProviders: Set<String>,
    ): MigrationDefaultModelInfo? {
        profiles ?: return null
        val active = profiles.apiConfigs[profiles.currentApiConfigName] ?: return null
        val provider = active["apiProvider"]?.jsonPrimitive?.content ?: return null
        val mapping = PROVIDER_MAP[provider] ?: return null
        if (mapping.oauthSecretKey != null && provider !in oauthProviders) return null
        val modelField = mapping.modelField ?: "apiModelId"
        val model = active[modelField]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() } ?: return null
        return MigrationDefaultModelInfo(provider = mapping.name, model = model)
    }
}

// -----------------------------------------------------------------------
// Progress sink interface and no-op implementation
// -----------------------------------------------------------------------

interface LegacyMigrationSink {
    fun item(progress: LegacyMigrationItemProgress)
    fun session(progress: LegacyMigrationSessionProgress)

    companion object {
        val None: LegacyMigrationSink = object : LegacyMigrationSink {
            override fun item(progress: LegacyMigrationItemProgress) = Unit
            override fun session(progress: LegacyMigrationSessionProgress) = Unit
        }
    }
}

// -----------------------------------------------------------------------
// Extension: MigrationItemStatus → MigrationItemProgressStatus
// -----------------------------------------------------------------------

private fun MigrationItemStatus.toProgressStatus() = when (this) {
    MigrationItemStatus.success -> MigrationItemProgressStatus.success
    MigrationItemStatus.warning -> MigrationItemProgressStatus.warning
    MigrationItemStatus.error -> MigrationItemProgressStatus.error
}
