package ai.kilocode.client.session.ui.header

import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionEditorStyleTarget
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.ChangesPanel
import ai.kilocode.client.ui.FilledBadgeIcon
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.HAlign
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.VAlign
import ai.kilocode.client.ui.layout.align
import ai.kilocode.client.ui.prTooltip
import ai.kilocode.client.ui.stateLabel
import ai.kilocode.client.ui.style
import ai.kilocode.rpc.dto.GhState
import ai.kilocode.rpc.dto.WorktreePrDto
import com.intellij.ide.BrowserUtil
import com.intellij.ui.SimpleColoredComponent
import com.intellij.ui.SimpleTextAttributes
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.Component
import java.awt.Cursor
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.JSeparator
import javax.swing.SwingConstants
import javax.swing.SwingUtilities

internal class PrHeaderView @RequiresEdt constructor(
    private val titleStyle: Int = SimpleTextAttributes.STYLE_BOLD,
    mode: ChangesPanel.Mode = ChangesPanel.Mode.COMPACT,
    onLocal: (() -> Unit)? = null,
    openDiff: () -> Unit,
) : BorderLayoutPanel(), SessionEditorStyleTarget {
    private val status = JBLabel()
    private val title = SimpleColoredComponent()
    private val changes = ChangesPanel(mode, onBase = openDiff, onLocal = onLocal)
    private val statusPane = status.align(HAlign.LEFT, VAlign.CENTER)
    // Hidden until the first action is added: hosts with no trailing actions (e.g. BranchDock) show
    // just the changes summary, so an always-visible separator would dangle with nothing after it.
    private val actionsSeparator = JSeparator(SwingConstants.VERTICAL).apply { isVisible = false }
    private val actions = Stack.horizontal(UiStyle.Gap.sm())
        .next(changes.align(HAlign.CENTER, VAlign.CENTER))
        .next(actionsSeparator)
    private var style = SessionEditorStyle.current()
    private var actionCount = 0
    private var state: GhState? = null
    private var number: String? = null
    private var body: String? = null
    private var tip: String? = null
    private var url: String? = null

    init {
        isOpaque = false
        // Standard padding fences the toolbar off from the PR title on the left.
        actions.border = JBUI.Borders.empty(0, UiStyle.Gap.md(), 0, UiStyle.Gap.sm())
        status.border = JBUI.Borders.empty(0, UiStyle.Gap.md(), 0, UiStyle.Gap.xs())
        status.isVisible = false
        title.border = JBUI.Borders.empty(0, UiStyle.Gap.sm())
        title.isOpaque = false
        title.isVisible = false
        addToLeft(statusPane)
        addToCenter(title)
        addToRight(actions.align(HAlign.RIGHT, VAlign.CENTER))
        val listener = object : MouseAdapter() {
            @RequiresEdt
            override fun mouseClicked(event: MouseEvent) {
                if (event.isConsumed || event.isPopupTrigger || !SwingUtilities.isLeftMouseButton(event) || event.clickCount != 1) return
                if (isEnabled && event.component.isEnabled) url?.let(BrowserUtil::browse)
            }
        }
        status.addMouseListener(listener)
        title.addMouseListener(listener)
        changes.font = style.smallFont
        changes.foreground = SessionUiStyle.Text.Secondary.foreground()
    }

    @RequiresEdt
    fun addAction(component: Component) {
        actionCount++
        actions.next(component.align(HAlign.CENTER, VAlign.CENTER))
        syncSeparator()
    }

    @RequiresEdt
    fun update(
        files: Int,
        additions: Int,
        deletions: Int,
        pull: WorktreePrDto?,
        name: String,
        ahead: Int = 0,
        behind: Int = 0,
        localFiles: Int = 0,
        localAdditions: Int = 0,
        localDeletions: Int = 0,
        base: String = "",
    ) {
        changes.update(files, additions, deletions, ahead, behind, localFiles, localAdditions, localDeletions, base)
        syncSeparator()
        applyPr(pull, name)
    }

    @RequiresEdt
    private fun syncSeparator() {
        val visible = actionCount > 0 && changes.isVisible
        if (actionsSeparator.isVisible != visible) actionsSeparator.isVisible = visible
    }

    @RequiresEdt
    private fun applyPr(pull: WorktreePrDto?, name: String) {
        if (pull == null) {
            syncPr(false)
            syncStatus(null)
            clearTitle()
            syncClick(null)
            return
        }
        syncPr(true)
        val trimmed = pull.title.trim()
        val body = trimmed.takeIf { it.isNotBlank() }
        val tip = prTooltip(pull, name.takeIf { it.isNotBlank() && it != trimmed })
        syncStatus(pull.state)
        syncTitle("#${pull.number}", body, tip)
        syncClick(pull.url)
        if (status.toolTipText != tip) status.toolTipText = tip
    }

    @RequiresEdt
    private fun syncStatus(next: GhState?) {
        if (state == next) return
        state = next
        status.icon = next?.let { FilledBadgeIcon(stateLabel(it), style(it)) }
        status.isVisible = next != null
        changed()
    }

    @RequiresEdt
    private fun syncPr(value: Boolean) {
        if (title.isVisible == value) return
        title.isVisible = value
        changed()
    }

    @RequiresEdt
    private fun clearTitle() {
        if (number == null && tip == null) return
        number = null
        body = null
        tip = null
        title.clear()
        title.toolTipText = null
        status.toolTipText = null
        changed()
    }

    @RequiresEdt
    private fun syncTitle(number: String, body: String?, next: String?) {
        var changed = false
        if (this.number != number || this.body != body) {
            this.number = number
            this.body = body
            syncText()
            changed = true
        }
        if (tip != next) {
            tip = next
            title.toolTipText = next
            changed = true
        }
        if (changed) changed()
    }

    @RequiresEdt
    private fun syncText() {
        val number = number ?: return
        title.clear()
        val body = body
        val attrs = SimpleTextAttributes(titleStyle, UIUtil.getLabelForeground())
        if (body == null) {
            title.append(number, attrs)
            return
        }
        title.append(body, attrs)
        title.append(" $number", SimpleTextAttributes.GRAYED_ATTRIBUTES)
    }

    @RequiresEdt
    private fun syncClick(next: String?) {
        if (url == next) return
        url = next
        val cursor = if (next != null) Cursor.getPredefinedCursor(Cursor.HAND_CURSOR) else Cursor.getDefaultCursor()
        status.cursor = cursor
        title.cursor = cursor
    }

    @RequiresEdt
    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        changes.font = style.smallFont
        changes.foreground = SessionUiStyle.Text.Secondary.foreground()
        syncText()
        changed()
    }

    @RequiresEdt
    private fun changed() {
        revalidate()
        repaint()
    }
}
