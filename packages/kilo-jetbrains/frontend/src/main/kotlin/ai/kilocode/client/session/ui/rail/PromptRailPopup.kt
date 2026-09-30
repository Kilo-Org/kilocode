package ai.kilocode.client.session.ui.rail

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.popup.HeaderPopupBody
import ai.kilocode.client.ui.HoverIcon
import ai.kilocode.client.ui.PlainLabel
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.popup.SidePopupContent
import com.intellij.icons.AllIcons
import com.intellij.openapi.util.Disposer
import com.intellij.ui.CollectionListModel
import com.intellij.ui.ListUtil
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextArea
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.SwingTextTrimmer
import com.intellij.util.ui.UIUtil
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.BorderLayout
import java.awt.Component
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.JList
import javax.swing.ListCellRenderer
import javax.swing.ScrollPaneConstants

/**
 * Balloon body for the prompt navigator: a header with first/latest jump buttons, and a list of every
 * navigable prompt with its answer preview. Wraps [HeaderPopupBody] for the shared clamp/scroll
 * behavior every session balloon uses.
 */
internal class PromptRailPopup(
    items: List<PromptRailItem>,
    hovered: Int,
    private val onSelect: (PromptRailItem) -> Unit,
    private val onFirst: () -> Unit,
    private val onLatest: () -> Unit,
) : SidePopupContent {
    private val disposer = Disposer.newDisposable("PromptRailPopup")
    private val model = CollectionListModel(items)
    private val list = JBList(model).apply {
        isOpaque = false
        // The expandable-item hint paints a truncated row's full text as a strip outside the list, which
        // escapes the balloon and lands on the ticks. Rows here are meant to read as clamped previews.
        setExpandableItemsEnabled(false)
        visibleRowCount = items.size.coerceAtMost(8)
        fixedCellHeight = JBUI.scale(ROW_HEIGHT)
        cellRenderer = Renderer()
        ListUtil.installAutoSelectOnMouseMove(this)
        addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                val idx = locationToIndex(e.point)
                if (idx < 0) return
                model.getElementAt(idx)?.let(onSelect)
            }
        })
    }

    private val first = HoverIcon().apply {
        icon = AllIcons.Actions.MoveUp
        toolTipText = KiloBundle.message("session.prompts.first")
        addActionListener { onFirst() }
    }

    private val latest = HoverIcon().apply {
        icon = AllIcons.Actions.MoveDown
        toolTipText = KiloBundle.message("session.prompts.latest")
        addActionListener { onLatest() }
    }

    private val body = HeaderPopupBody(
        component = content(),
        disposable = disposer,
        background = UiStyle.Balloon.bg(),
    )

    override val component get() = body.component
    override val disposable get() = body.disposable
    override val background get() = body.background

    override fun fitWithin(width: Int, height: Int) = body.fitWithin(width, height)

    init {
        if (hovered in 0 until model.size) {
            list.selectedIndex = hovered
            list.scrollRectToVisible(list.getCellBounds(hovered, hovered))
        }
    }

    private fun content(): BorderLayoutPanel {
        val header = BorderLayoutPanel().apply {
            isOpaque = false
            border = JBUI.Borders.empty(4, 5, 4, 11)
            add(
                JBLabel(KiloBundle.message("session.prompts.navLabel")).apply {
                    foreground = UIUtil.getContextHelpForeground()
                },
                BorderLayout.WEST,
            )
            add(
                Stack.horizontal(UiStyle.Gap.xs()).next(first).next(latest),
                BorderLayout.EAST,
            )
        }
        val scroll = JBScrollPane(
            list,
            ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED,
            ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER,
        ).apply {
            isOpaque = false
            viewport.isOpaque = false
            border = JBUI.Borders.empty()
        }
        return BorderLayoutPanel().apply {
            isOpaque = false
            add(header, BorderLayout.NORTH)
            add(scroll, BorderLayout.CENTER)
        }
    }

    private class Renderer : ListCellRenderer<PromptRailItem> {
        private val title = PlainLabel().apply {
            putClientProperty(SwingTextTrimmer.KEY, SwingTextTrimmer.ELLIPSIS_AT_RIGHT)
        }
        private val answer = JBTextArea().apply {
            isEditable = false
            isFocusable = false
            isOpaque = false
            lineWrap = true
            wrapStyleWord = true
            foreground = UIUtil.getContextHelpForeground()
        }
        private val panel = BorderLayoutPanel().apply {
            border = JBUI.Borders.empty(9, 11)
            add(Stack.vertical(UiStyle.Gap.xs()).next(title).next(answer))
        }

        override fun getListCellRendererComponent(
            list: JList<out PromptRailItem>,
            value: PromptRailItem?,
            index: Int,
            selected: Boolean,
            focus: Boolean,
        ): Component {
            panel.isOpaque = selected
            panel.background = list.selectionBackground
            title.foreground = if (selected) list.selectionForeground else UIUtil.getLabelForeground()
            title.text = value?.queuedTitle().orEmpty()
            val response = value?.answer.orEmpty()
            answer.isVisible = response.isNotBlank() || value?.prompt.isNullOrBlank()
            answer.text = response.ifBlank { KiloBundle.message("session.prompts.noAnswer") }
            return panel
        }

        private fun PromptRailItem.queuedTitle(): String {
            if (!queued) return prompt
            return "${KiloBundle.message("session.queued")} · $prompt"
        }
    }

    private companion object {
        const val ROW_HEIGHT = 76
    }
}
