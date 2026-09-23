package ai.kilocode.client.settings.marketplace

import ai.kilocode.client.app.KiloAgentBehaviorService
import ai.kilocode.client.app.KiloMarketplaceService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.base.SettingsBannerKind
import ai.kilocode.client.settings.base.SettingsListPanel
import ai.kilocode.client.settings.base.SettingsMessageException
import ai.kilocode.client.telemetry.Telemetry
import ai.kilocode.client.ui.FilledBadgeIcon
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.HAlign
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.VAlign
import ai.kilocode.client.ui.layout.align
import ai.kilocode.client.ui.list.ActiveListBadge
import ai.kilocode.client.ui.list.ActiveListCell
import ai.kilocode.client.ui.list.ActiveListConfig
import ai.kilocode.client.ui.list.ActiveListItem
import ai.kilocode.client.ui.list.ActiveListSelection
import ai.kilocode.rpc.dto.MarketplaceItemDto
import com.intellij.ide.BrowserUtil
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.actionSystem.ActionToolbar
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.actionSystem.ex.ActionUtil
import com.intellij.openapi.application.EDT
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.application.asContextElement
import com.intellij.openapi.components.service
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.ui.Messages
import com.intellij.ui.components.JBCheckBox
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import java.awt.Cursor
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.JComponent
import javax.swing.JSeparator
import javax.swing.SwingConstants
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private val edt = Dispatchers.EDT + ModalityState.any().asContextElement()

internal class MarketplaceSettingsUi(
    cs: CoroutineScope,
    dir: String,
    private val create: (MarketplaceItemDto, Boolean) -> MarketplaceInstallDialogHandle = ::MarketplaceInstallDialog,
    private val browse: (String) -> Unit = { BrowserUtil.browse(it) },
) : SettingsListPanel(cs, ActiveListConfig.Preferred) {
    private var dir = dir
    private var items: List<MarketplaceItemDto> = emptyList()
    private val selectedTypes = ALL_TYPES.toMutableSet()
    private var installedOnly = false
    private var relevantOnly = false

    /** The row currently running an install or uninstall, and the status it reports while it runs. */
    private var pending: Pending? = null

    /** Set while a row action is in flight, so the finished reload hands focus back to the list. */
    private var refocus = false


    private val allButton = textAction(this, allLabel()) { selectAllTypes() }
    private val agentChip = FilterChip(agentLabel(), UiStyle.Badge::typeAgent) { toggleType("agent") }
    private val mcpChip = FilterChip(mcpLabel(), UiStyle.Badge::typeMcp) { toggleType("mcp") }
    private val skillChip = FilterChip(skillLabel(), UiStyle.Badge::typeSkill) { toggleType("skill") }
    private val installedCheck = JBCheckBox(KiloBundle.message("settings.marketplace.installedOnly")).apply {
        toolTipText = UiStyle.Text.tip(KiloBundle.message("settings.marketplace.installedOnly.description"))
        addActionListener { refilter { installedOnly = isSelected } }
    }
    private val relevantCheck = JBCheckBox(KiloBundle.message("settings.marketplace.relevantOnly")).apply {
        toolTipText = UiStyle.Text.tip(KiloBundle.message("settings.marketplace.relevantOnly.description"))
        addActionListener { refilter { relevantOnly = isSelected } }
    }

    private val hasProjectDirectory: Boolean get() = dir.isNotBlank()

    init {
        start()
    }

    fun setDirectory(value: String) {
        if (value == dir) return
        dir = value
        reload()
    }

    override suspend fun fetch(): List<ActiveListItem> {
        val result = service<KiloMarketplaceService>().list(dir)
        items = result.items
        return withContext(edt) {
            syncErrors(result.errors)
            rows()
        }
    }

    override fun onCell(key: String, cellId: String) {
        val item = items.firstOrNull { rowKey(it) == key } ?: return
        when (cellId) {
            INSTALL_CELL -> install(item)
            REMOVE_PROJECT_CELL -> remove(item, "project")
            REMOVE_GLOBAL_CELL -> remove(item, "global")
            DOCS_CELL -> docsUrl(item)?.let { browse(it) }
        }
    }

    override fun searchPlaceholder() = KiloBundle.message("settings.marketplace.search")

    override fun toolbarLeft(): JComponent = Stack.horizontal(UiStyle.Gap.sm())
        .next(divider())
        .next(centered(allButton))
        .next(centered(agentChip))
        .next(centered(mcpChip))
        .next(centered(skillChip))

    override fun toolbarRight(): JComponent = Stack.horizontal(UiStyle.Gap.md())
        .next(centered(installedCheck))
        .next(centered(relevantCheck))

    /**
     * Holds [c] at its own height instead of the row's. A horizontal [Stack] stretches children to the
     * container height, which pushes checkbox and button bounds past the toolbar's standard height.
     */
    private fun centered(c: JComponent): JComponent = c.align(HAlign.LEFT, VAlign.CENTER)

    /** Divider between the action toolbars, bounded to the toolbar button height like a toolbar's own. */
    private fun divider(): JComponent = JSeparator(SwingConstants.VERTICAL)
        .align(HAlign.CENTER, VAlign.CENTER, maxH = { ActionToolbar.DEFAULT_MINIMUM_BUTTON_SIZE.height })

    /** Single entry point for a filter change, so every one of them repaints the same way. */
    private fun refilter(change: () -> Unit) {
        change()
        view.update(rows())
    }

    private fun selectAllTypes() {
        if (selectedTypes.size == ALL_TYPES.size) return
        refilter {
            selectedTypes.clear()
            selectedTypes += ALL_TYPES
            syncChips()
        }
    }

    private fun toggleType(type: String) {
        refilter {
            if (!selectedTypes.remove(type)) selectedTypes += type
            syncChips()
        }
    }

    private fun syncChips() {
        agentChip.selected = "agent" in selectedTypes
        mcpChip.selected = "mcp" in selectedTypes
        skillChip.selected = "skill" in selectedTypes
    }

    private fun rows(): List<ActiveListItem> = items
        .asSequence()
        .filter { it.type in selectedTypes }
        .filter { !installedOnly || it.installedProject || it.installedGlobal }
        .filter { !relevantOnly || it.relevant }
        .sortedWith(compareBy({ typeOrder(it.type) }, { it.name.lowercase() }))
        .map { row(it) }
        .toList()

    private fun row(item: MarketplaceItemDto): ActiveListItem = object : ActiveListItem {
        override val key = rowKey(item)
        override val section = sectionLabel(item.type)
        override val title = item.name
        override val note = item.author
        override val description = item.description
        override val search =
            listOfNotNull(item.id, item.category, item.author, sectionLabel(item.type)).joinToString(" ")
        override val badges = badges(item)
        // While this row owns the work in flight it reports progress instead of actions, so the row's
        // overlay swaps its buttons for the status text and swaps them back once the reload lands.
        override val progress = pending?.takeIf { it.key == rowKey(item) }?.text
        override val cells = if (progress != null) emptyList() else cells(item)
    }

    private fun badges(item: MarketplaceItemDto): List<ActiveListBadge> = listOfNotNull(
        ActiveListBadge(typeLabel(item.type), typeStyle(item.type)),
        ActiveListBadge(KiloBundle.message("settings.marketplace.badge.installedProject"), UiStyle.Badge.Highlight)
            .takeIf { item.installedProject },
        ActiveListBadge(KiloBundle.message("settings.marketplace.badge.installedGlobal"), UiStyle.Badge.Highlight)
            .takeIf { item.installedGlobal },
        ActiveListBadge(item.category, UiStyle.Badge.Secondary).takeIf { item.category.isNotBlank() },
    )

    private fun cells(item: MarketplaceItemDto): List<ActiveListCell> = listOfNotNull(
        ActiveListCell(INSTALL_CELL, KiloBundle.message("settings.marketplace.install"), primary = true)
            .takeIf { !installHidden(item) },
        ActiveListCell(REMOVE_PROJECT_CELL, KiloBundle.message("settings.marketplace.remove.project"))
            .takeIf { item.installedProject },
        ActiveListCell(REMOVE_GLOBAL_CELL, KiloBundle.message("settings.marketplace.remove.global"))
            .takeIf { item.installedGlobal },
        docsUrl(item)?.let { ActiveListCell(DOCS_CELL, KiloBundle.message("settings.marketplace.docs")) },
    )

    private fun installHidden(item: MarketplaceItemDto): Boolean =
        if (hasProjectDirectory) item.installedProject && item.installedGlobal else item.installedGlobal

    private fun docsUrl(item: MarketplaceItemDto): String? =
        item.authorUrl?.takeIf { it.isNotBlank() }
            ?: item.url?.takeIf { it.isNotBlank() }
            ?: item.githubUrl?.takeIf { it.isNotBlank() }

    private fun install(item: MarketplaceItemDto) {
        val dialog = create(item, hasProjectDirectory)
        if (!dialog.showAndGet()) {
            // The list lost focus to the dialog, and row actions only show for the focused selection.
            view.focusList()
            return
        }
        val request = dialog.result()
        Telemetry.send(
            if (request.remove) "Marketplace Uninstall Clicked" else "Marketplace Install Clicked",
            mapOf("type" to item.type, "id" to item.id, "target" to request.target),
        )
        act(item, request)
    }

    /** Runs one install or uninstall against [request]'s scope, reporting progress on the item's row. */
    @RequiresEdt
    private fun act(item: MarketplaceItemDto, request: MarketplaceInstallRequest) {
        val key = rowKey(item)
        pending = Pending(
            key,
            KiloBundle.message(
                if (request.remove) "settings.marketplace.uninstalling" else "settings.marketplace.installing",
            ),
        )
        refocus = true
        view.update(rows(), ActiveListSelection.Key(key))
        mutateAndReload(ActiveListSelection.Key(key), overlay = false) {
            var ok = false
            try {
                val svc = service<KiloMarketplaceService>()
                val result = if (request.remove) {
                    svc.remove(dir, item.id, item.type, request.target)
                } else {
                    svc.install(dir, item, request.target, request.parameters)
                }
                if (!result.success) throw SettingsMessageException(result.error ?: failedText(request.remove))
                if (item.type == "skill" || item.type == "mcp") service<KiloAgentBehaviorService>().reloadSkills(dir)
                Telemetry.send(
                    if (request.remove) "Marketplace Item Removed" else "Marketplace Item Installed",
                    mapOf("type" to item.type, "id" to item.id, "target" to request.target),
                )
                ok = true
                true
            } finally {
                withContext(edt) {
                    pending = null
                    // Repaint unconditionally rather than only on failure. This block covers the
                    // mutation, not the reload that mutateAndReload runs afterwards, so if that reload
                    // throws the row would otherwise stay on the progress text painted before it with
                    // no action cells. On success apply() simply repaints again with the fetched rows.
                    view.update(rows(), ActiveListSelection.Key(key))
                    if (!ok) {
                        // afterApply never runs for a failed mutation, so hand focus back here instead
                        // and clear the flag, or the next unrelated reload would steal it.
                        refocus = false
                        view.focusList()
                    }
                }
            }
        }
    }

    @RequiresEdt
    private fun remove(item: MarketplaceItemDto, scope: String) {
        val notice = if (item.type == "mcp") "\n\n${KiloBundle.message("settings.marketplace.remove.skills")}" else ""
        val answer = Messages.showYesNoDialog(
            KiloBundle.message("settings.marketplace.remove.message", item.name, scopeLabel(scope)) + notice,
            KiloBundle.message("settings.marketplace.remove.title"),
            KiloBundle.message("common.delete"),
            Messages.getCancelButton(),
            Messages.getQuestionIcon(),
        )
        if (answer != Messages.YES) {
            view.focusList()
            return
        }
        act(item, MarketplaceInstallRequest(scope, emptyMap(), remove = true))
    }

    override fun afterApply() {
        syncFilters()
        if (!refocus) return
        refocus = false
        // Puts the row's action overlay back after a mutation, without stealing focus on a plain reload.
        view.focusList()
    }

    /**
     * Repaints from the live filter state after a reload paints.
     *
     * [fetch] builds its rows on one EDT hop and [apply] paints them on a later one, so a filter
     * toggled in between is applied to the controls but not to the rows that land. Rebuilding here
     * unconditionally keeps the two in agreement; tracking whether a toggle actually raced would add
     * state whose corrective branch cannot be reached from a test, to save one list rebuild per reload.
     */
    private fun syncFilters() {
        view.update(rows())
    }

    private fun syncErrors(errors: List<String>) {
        if (errors.isEmpty()) {
            top.hideBanner()
            return
        }
        top.showBanner(errors.joinToString(" "), emptyList(), SettingsBannerKind.WARNING)
    }

    private data class Pending(val key: String, val text: String)

    private companion object {
        const val INSTALL_CELL = "install"
        const val REMOVE_PROJECT_CELL = "removeProject"
        const val REMOVE_GLOBAL_CELL = "removeGlobal"
        const val DOCS_CELL = "docs"
        val ALL_TYPES = setOf("agent", "mcp", "skill")

        fun failedText(remove: Boolean): String = KiloBundle.message(
            if (remove) "settings.marketplace.remove.failed" else "settings.marketplace.install.failed",
        )

        fun rowKey(item: MarketplaceItemDto) = "${item.type}:${item.id}"

        fun typeOrder(type: String): Int = when (type) {
            "agent" -> 0
            "mcp" -> 1
            "skill" -> 2
            else -> 3
        }

        fun sectionLabel(type: String): String = when (type) {
            "agent" -> agentLabel()
            "mcp" -> mcpLabel()
            "skill" -> skillLabel()
            else -> type
        }

        /** Singular form for the per-row tag; the section header carries the plural. */
        fun typeLabel(type: String): String = when (type) {
            "agent" -> KiloBundle.message("settings.marketplace.tag.agent")
            "mcp" -> KiloBundle.message("settings.marketplace.tag.mcp")
            "skill" -> KiloBundle.message("settings.marketplace.tag.skill")
            else -> type
        }

        /** The row tag always paints the active accent, matching its filter chip when that is on. */
        fun typeStyle(type: String): UiStyle.Badge.Style = when (type) {
            "agent" -> UiStyle.Badge.typeAgent(true)
            "mcp" -> UiStyle.Badge.typeMcp(true)
            "skill" -> UiStyle.Badge.typeSkill(true)
            else -> UiStyle.Badge.Secondary
        }

        fun scopeLabel(scope: String): String = when (scope) {
            "global" -> KiloBundle.message("settings.marketplace.install.scope.global")
            else -> KiloBundle.message("settings.marketplace.install.scope.project")
        }

        fun allLabel() = KiloBundle.message("settings.marketplace.type.all")
        fun agentLabel() = KiloBundle.message("settings.marketplace.type.agent")
        fun mcpLabel() = KiloBundle.message("settings.marketplace.type.mcp")
        fun skillLabel() = KiloBundle.message("settings.marketplace.type.skill")
    }
}

/**
 * A text-only action rendered as its own single-action toolbar.
 *
 * Building the button by hand means picking its metrics by hand, and the toolbar's real button size is
 * derived from theme insets rather than the bare minimum constant — so a hand-sized button lands a few
 * pixels off and its hover box does not match the icons beside it. Letting the platform build a toolbar
 * gives the action the same metrics, hover treatment, and label foreground as the refresh button.
 */
private fun textAction(target: JComponent, label: String, run: () -> Unit): JComponent {
    val action = object : DumbAwareAction(label) {
        override fun actionPerformed(e: AnActionEvent) = run()
    }
    // Without this the toolbar builds an icon button, which for a text-only action paints nothing.
    action.templatePresentation.putClientProperty(ActionUtil.SHOW_TEXT_IN_TOOLBAR, true)
    val bar = ActionManager.getInstance()
        .createActionToolbar(ActionPlaces.TOOLBAR, DefaultActionGroup(action), true)
    bar.targetComponent = target
    @Suppress("DEPRECATION")
    bar.updateActionsImmediately()
    bar.component.isOpaque = false
    // Keeps the toolbar's own standard insets, so this button is padded exactly like the refresh
    // toolbar beside it and the divider sits evenly between the two.
    return bar.component
}

/**
 * A clickable pill for one marketplace type filter, painted by [style] for the current [selected]
 * state. Toggling only restyles the pill — the label never leaves the row, so the control reads as a
 * switch rather than something that disappears when you use it.
 */
internal class FilterChip(
    internal val label: String,
    private val style: (Boolean) -> UiStyle.Badge.Style,
    private val onClick: () -> Unit,
) : JBLabel() {
    var selected: Boolean = true
        set(value) {
            if (field == value) return
            field = value
            sync()
        }

    init {
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        sync()
        addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) = onClick()
        })
    }

    /** Re-reads the palette too, so this doubles as the `updateUI` refresh after a theme change. */
    private fun sync() {
        icon = FilledBadgeIcon(label, style(selected))
    }
}
