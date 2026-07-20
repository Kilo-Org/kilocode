package ai.kilocode.client.settings.autoapprove

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.base.BaseContentPanel
import ai.kilocode.client.settings.base.SettingsRow
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.rpc.dto.PermissionRuleDto
import com.intellij.icons.AllIcons
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import java.awt.Cursor
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent

private const val AUTO_EXPAND_THRESHOLD = 5

/**
 * One granular permission tool (`external_directory`, `bash`, `read`, `edit`): a wildcard
 * [LevelSelect] row plus a collapsible list of per-pattern exceptions. Instantiated once per tool
 * by [AutoApproveContent].
 */
internal class GranularToolSection(
    private val tool: String,
    description: String,
    wildcardLabel: String,
    addLabel: String,
    placeholder: String,
    private val onWildcardChange: (String) -> Unit,
    private val onWildcardInherit: () -> Unit,
    private val onExceptionAdd: (String) -> Unit,
    private val onExceptionSetLevel: (String, String) -> Unit,
    private val onExceptionRemove: (List<String>) -> Unit,
) : BaseContentPanel() {
    private val wildcard = LevelSelect(onWildcardChange) { onWildcardInherit() }
    private val wildcardRow = SettingsRow(wildcardLabel, null, wildcard)
    private val header = JBLabel().apply {
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) = toggle()
        })
    }
    private val list = SettingsInlineList(addLabel, placeholder, onExceptionAdd, onExceptionSetLevel, onExceptionRemove)
    private val body = Stack.vertical(UiStyle.Gap.sm()).next(header)

    private var manualExpand: Boolean? = null
    private var exceptionCount = 0

    init {
        section(toolTitle(tool), description)
            .row(wildcardRow)
            .row(body)
    }

    @RequiresEdt
    fun sync(rule: PermissionRuleDto?, enabled: Boolean) {
        wildcard.sync(wildcardLevel(rule) ?: defaultLevel(tool), inheritedWildcard(rule), enabled)
        val excs = exceptions(rule)
        exceptionCount = excs.size
        header.text = KiloBundle.message("settings.autoApprove.exceptions.count", excs.size)
        list.syncItems(excs, enabled)
        syncExpanded()
    }

    @RequiresEdt
    internal fun isExpanded(): Boolean = body.components.contains(list)

    private fun toggle() {
        manualExpand = !expanded()
        syncExpanded()
    }

    private fun expanded(): Boolean = manualExpand ?: (exceptionCount <= AUTO_EXPAND_THRESHOLD)

    private fun syncExpanded() {
        val next = expanded()
        val icon = if (next) AllIcons.General.ArrowDown else AllIcons.General.ArrowRight
        if (header.icon !== icon) header.icon = icon
        if (next == isExpanded()) return
        if (next) body.next(list) else body.remove(list)
        body.revalidate()
        body.repaint()
    }
}
