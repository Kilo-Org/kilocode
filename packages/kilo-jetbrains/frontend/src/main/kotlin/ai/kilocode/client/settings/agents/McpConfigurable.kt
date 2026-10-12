package ai.kilocode.client.settings.agents

import ai.kilocode.client.app.KiloAgentBehaviorService
import ai.kilocode.client.app.KiloMcpAuthService
import ai.kilocode.client.app.KiloMarketplaceService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.plugin.KiloDocs
import ai.kilocode.client.settings.base.DirectoryReadyConfigurable
import ai.kilocode.client.settings.base.SettingsInfo
import ai.kilocode.client.settings.base.SettingsListPanel
import ai.kilocode.client.settings.base.SettingsMessageException
import ai.kilocode.client.settings.marketplace.marketplaceAction
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.list.ActiveListBadge
import ai.kilocode.client.ui.list.ActiveListCell
import ai.kilocode.client.ui.list.ActiveListConfig
import ai.kilocode.client.ui.list.ActiveListItem
import ai.kilocode.client.ui.list.ActiveListSelection
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.McpConfigDto
import ai.kilocode.rpc.dto.McpServerConfigDto
import ai.kilocode.rpc.dto.McpStatusDto
import ai.kilocode.rpc.dto.MarketplaceBundleDto
import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.application.EDT
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.application.asContextElement
import com.intellij.openapi.components.service
import com.intellij.openapi.ui.Messages
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.UIUtil
import javax.swing.JComponent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val edt = Dispatchers.EDT + ModalityState.any().asContextElement()

class McpConfigurable : DirectoryReadyConfigurable<JComponent>() {
    private var ui: McpSettingsUi? = null
    private var query: String? = null

    override fun getId(): String = ID
    override fun getDisplayName(): String = KiloBundle.message("settings.agentBehavior.mcp.displayName")
    override fun create(cs: CoroutineScope, dir: String): JComponent = McpSettingsUi(cs, dir).also { panel ->
        ui = panel
        query?.let(panel::filter)
    }
    override fun update(ui: JComponent, dir: String) {
        (ui as? McpSettingsUi)?.setDirectory(dir)
    }
    override fun scrollReadyShell() = false

    @RequiresEdt
    internal fun filter(query: String) {
        this.query = query
        ui?.filter(query)
    }

    override fun disposeReadyComponent(component: JComponent) {
        if (ui === component) ui = null
        query = null
        // DraftReadyConfigurableBase clears its retained panel and disposes McpSettingsUi, which is a
        // Disposable SettingsListPanel. Skipping super would leak the page and its in-flight reload.
        super.disposeReadyComponent(component)
    }

    companion object { const val ID = "ai.kilocode.jetbrains.settings.agentBehavior.mcp" }
}

internal class McpSettingsUi(
    private val cs: CoroutineScope,
    dir: String,
    private val create: (String, McpConfigDto) -> McpEditDialogHandle = ::McpEditDialog,
) : SettingsListPanel(cs, ActiveListConfig.Equal.copy(description = false, keepActions = true)) {
    private var dir = dir

    private var servers: Map<String, McpServerConfigDto> = emptyMap()
    private var bundles: List<MarketplaceBundleDto> = emptyList()

    init {
        start()
    }

    fun setDirectory(value: String) {
        if (value == dir) return
        dir = value
        reload()
    }

    /** A Marketplace install or removal can add or drop servers while this page sits open. */
    override fun refreshOnFocus(): Boolean = true

    override suspend fun fetch(): List<ActiveListItem> {
        val behavior = service<KiloAgentBehaviorService>()
        val cfg = behavior.mcpConfig(dir)
        val owned = ownedBundles(dir)
        withContext(edt) {
            servers = cfg
            bundles = owned
        }
        val statuses = if (dir.isBlank()) {
            LOG.warn("mcp settings fetch skipped runtime status: missing project directory config=${cfg.size}")
            emptyMap()
        } else {
            behavior.mcpStatus(dir).associateBy { it.name }
        }
        val names = (cfg.keys + statuses.keys).sorted()
        LOG.info("mcp settings fetch dir=$dir config=${cfg.size} runtime=${statuses.size} total=${names.size}")
        if (names.isEmpty()) {
            LOG.warn("mcp settings fetch returned no servers dir=$dir")
        }
        // A row only has room for the status pill, so the reason a server is unhealthy would otherwise
        // live solely in its tooltip. Log it too, so a failure is diagnosable from the IDE log alone.
        for (name in names) {
            val status = statuses[name] ?: continue
            if (status.status == CONNECTED || status.status == DISABLED) continue
            LOG.warn("mcp server unhealthy dir=$dir name=$name status=${status.status} reason=${status.error ?: "unreported"}")
        }
        return names.map { name -> item(name, cfg[name]?.config, statuses[name]) }
    }

    override fun onCell(key: String, cellId: String) {
        when (cellId) {
            CONNECT_CELL -> mutate(key) { service<KiloAgentBehaviorService>().mcpConnect(dir, key) }
            DISCONNECT_CELL -> mutate(key) { service<KiloAgentBehaviorService>().mcpDisconnect(dir, key) }
            AUTH_CELL -> signIn(key)
            RESET_AUTH_CELL -> resetAuth(key)
            EDIT_CELL -> edit(key)
            REMOVE_CELL -> remove(key)
        }
    }

    override fun searchPlaceholder() = KiloBundle.message("settings.agentBehavior.mcp.search")

    override fun tailActions(): List<AnAction> = listOf(marketplaceAction("settings_mcp"))

    override fun info(): JComponent = SettingsInfo(
        KiloBundle.message("settings.agentBehavior.mcp.info"),
        KiloBundle.message("settings.agentBehavior.mcp.info.more"),
        KiloDocs.MCP,
    )

    override fun toolbarRight(): JComponent = JBLabel(KiloBundle.message("settings.agentBehavior.mcp.addHint")).apply {
        foreground = UIUtil.getContextHelpForeground()
    }

    private fun item(name: String, cfg: McpConfigDto?, status: McpStatusDto?) = object : ActiveListItem {
        override val key = name
        override val title = name
        override val description = description(cfg, status)
        override val badges = badges(cfg, status)
        override val cells = cells(cfg, status)
    }

    private fun description(cfg: McpConfigDto?, status: McpStatusDto?): String? {
        val parts = listOfNotNull(
            cfg?.url?.takeIf { it.isNotBlank() },
            cfg?.command?.takeIf { it.isNotEmpty() }?.joinToString(" "),
            status?.error?.takeIf { it.isNotBlank() },
        )
        return parts.joinToString(" - ").takeIf { it.isNotBlank() }
    }

    private fun badges(cfg: McpConfigDto?, status: McpStatusDto?): List<ActiveListBadge> = listOfNotNull(
        // The row hides its description line, which suppresses the row-level tooltip, so the status
        // pill carries the reason itself. An id is what opts a badge into list hit-testing.
        ActiveListBadge(
            statusLabel(status),
            statusStyle(status),
            id = STATUS_BADGE,
            icon = AllIcons.General.Warning.takeIf { status?.status == NEEDS_AUTH },
            tooltip = statusTooltip(status),
        ).takeIf { status != null },
        ActiveListBadge(cfg?.type ?: KiloBundle.message("settings.agentBehavior.mcp.configured")).takeIf { cfg != null },
    )

    private fun cells(cfg: McpConfigDto?, status: McpStatusDto?): List<ActiveListCell> = listOfNotNull(
        connect(status?.status == CONNECTED).takeUnless { status?.status == NEEDS_AUTH },
        ActiveListCell(AUTH_CELL, KiloBundle.message("settings.agentBehavior.mcp.signIn")).takeIf {
            status?.status == NEEDS_AUTH
        },
        ActiveListCell(RESET_AUTH_CELL, KiloBundle.message("settings.agentBehavior.mcp.resetAuth")).takeIf {
            cfg?.type == "remote" && status?.status == CONNECTED
        },
        ActiveListCell(
            EDIT_CELL,
            KiloBundle.message("settings.agentBehavior.edit"),
            primary = true,
        ).takeIf { cfg != null },
        ActiveListCell(
            REMOVE_CELL,
            KiloBundle.message("common.delete"),
            icon = AllIcons.Actions.GC,
            iconOnly = true,
        ).takeIf { cfg != null },
    )

    private fun connect(connected: Boolean) = ActiveListCell(
        if (connected) DISCONNECT_CELL else CONNECT_CELL,
        if (connected) KiloBundle.message("settings.agentBehavior.mcp.disconnect")
        else KiloBundle.message("settings.agentBehavior.mcp.connect"),
    )

    private fun edit(name: String) {
        val server = servers[name] ?: return
        val dialog = create(name, server.config)
        if (!dialog.showAndGet()) return
        val next = dialog.result()
        mutateAndReload(ActiveListSelection.Key(name)) {
            if (!service<KiloAgentBehaviorService>().saveMcp(dir, name, server.scope, next)) {
                throw SettingsMessageException(KiloBundle.message("settings.agentBehavior.save.failed"))
            }
            true
        }
    }

    @RequiresEdt
    private fun signIn(name: String) {
        checkEdt()
        val auth = service<KiloMcpAuthService>()
        if (!launch("mcp sign in name=$name") { id ->
            val result = auth.signIn(dir, name)
            if (!withContext(edt) { active(id) }) return@launch
            withContext(edt) { auth.report(name, result) }
            if (result.status != "connected" && result.status != "cancelled") {
                throw SettingsMessageException(
                    result.error ?: KiloBundle.message("settings.agentBehavior.mcp.signIn.failed", name),
                )
            }
            val items = fetch()
            withContext(edt) {
                if (!active(id)) return@withContext
                setBusy(false)
                view.update(items, ActiveListSelection.Key(name))
                clearProgress()
            }
        }) return
        showProgress(
            KiloBundle.message("settings.agentBehavior.mcp.signIn.progress", name),
            KiloBundle.message("settings.agentBehavior.mcp.signIn.cancel"),
        ) { cs.launch { auth.cancel(dir, name) } }
    }

    private fun resetAuth(name: String) {
        val result = Messages.showYesNoDialog(
            KiloBundle.message("settings.agentBehavior.mcp.resetAuth.message", name),
            KiloBundle.message("settings.agentBehavior.mcp.resetAuth.title"),
            KiloBundle.message("settings.agentBehavior.mcp.resetAuth"),
            Messages.getCancelButton(),
            Messages.getQuestionIcon(),
        )
        if (result != Messages.YES) return
        mutate(name) { service<KiloMcpAuthService>().reset(dir, name) }
    }

    private fun remove(name: String) {
        val scope = servers[name]?.scope ?: return
        val target = if (scope == "workspace") "project" else scope
        val bundle = bundles.singleOrNull { it.id == name && it.scope == target }
        val result = Messages.showYesNoDialog(
            KiloBundle.message(
                if (bundle == null) "settings.agentBehavior.mcp.delete.message"
                else "settings.agentBehavior.mcp.delete.bundle.message",
                name,
            ),
            KiloBundle.message("settings.agentBehavior.mcp.delete.title"),
            KiloBundle.message("common.delete"),
            Messages.getCancelButton(),
            Messages.getQuestionIcon(),
        )
        if (result != Messages.YES) return
        mutateAndReload(ActiveListSelection.Slide) {
            if (bundle != null) {
                val removed = service<KiloMarketplaceService>().remove(dir, name, "mcp", target)
                if (!removed.success) {
                    throw SettingsMessageException(
                        removed.error ?: KiloBundle.message("settings.marketplace.remove.failed"),
                    )
                }
                service<KiloAgentBehaviorService>().reloadSkills(dir)
                return@mutateAndReload true
            }
            if (!service<KiloAgentBehaviorService>().saveMcp(dir, name, scope, null)) {
                throw SettingsMessageException(KiloBundle.message("settings.agentBehavior.save.failed"))
            }
            true
        }
    }

    private fun mutate(name: String, block: suspend () -> Boolean) {
        mutateAndReload(ActiveListSelection.Key(name)) {
            if (!block()) throw SettingsMessageException(KiloBundle.message("settings.agentBehavior.mcp.action.failed"))
            true
        }
    }

    private companion object {
        const val CONNECTED = "connected"
        const val FAILED = "failed"
        const val NEEDS_AUTH = "needs_auth"
        const val NEEDS_REGISTRATION = "needs_client_registration"
        const val DISABLED = "disabled"
        const val STATUS_BADGE = "status"
        const val CONNECT_CELL = "connect"
        const val DISCONNECT_CELL = "disconnect"
        const val AUTH_CELL = "auth"
        const val RESET_AUTH_CELL = "resetAuth"
        const val EDIT_CELL = "edit"
        const val REMOVE_CELL = "remove"
        val LOG = KiloLog.create(McpSettingsUi::class.java)

        fun statusLabel(status: McpStatusDto?): String {
            val value = status?.status ?: return ""
            return when (value) {
                CONNECTED -> KiloBundle.message("settings.agentBehavior.mcp.status.connected")
                FAILED -> KiloBundle.message("settings.agentBehavior.mcp.status.failed")
                NEEDS_AUTH -> KiloBundle.message("settings.agentBehavior.mcp.status.needsAuth")
                NEEDS_REGISTRATION -> KiloBundle.message("settings.agentBehavior.mcp.status.needsRegistration")
                DISABLED -> KiloBundle.message("settings.agentBehavior.mcp.status.disabled")
                else -> value
            }
        }

        /**
         * Why the server is in [status], wrapped for a multi-line tooltip. Null when the pill text
         * already says everything, so a healthy row does not gain a tooltip that repeats it.
         */
        fun statusTooltip(status: McpStatusDto?): String? {
            val reason = status?.error?.takeIf { it.isNotBlank() } ?: return null
            return UiStyle.Text.tipLines(listOf(statusLabel(status)) + reason.lines())
        }

        fun statusStyle(status: McpStatusDto?): UiStyle.Badge.Style {
            return when (status?.status) {
                CONNECTED -> UiStyle.Badge.Highlight
                FAILED,
                NEEDS_AUTH,
                NEEDS_REGISTRATION,
                -> UiStyle.Badge.Alert
                else -> UiStyle.Badge.Secondary
            }
        }
    }
}
