package ai.kilocode.client.session.ui

import ai.kilocode.client.session.model.SessionModel
import ai.kilocode.client.session.model.SessionModelEvent
import ai.kilocode.client.session.model.SessionState
import ai.kilocode.client.session.model.Compaction
import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Generic
import ai.kilocode.client.session.model.Message
import ai.kilocode.client.session.model.Reasoning
import ai.kilocode.client.session.model.Text
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import com.intellij.openapi.Disposable
import com.intellij.ui.AnimatedIcon
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.BorderLayout
import java.awt.FlowLayout
import javax.swing.BoxLayout
import javax.swing.JPanel
import javax.swing.JTextArea
import javax.swing.border.MatteBorder

/**
 * Scrollable panel displaying session messages aligned to the top,
 * with an optional animated status indicator at the bottom.
 *
 * Passive view — all rendering is driven by [SessionModelEvent]s
 * from the [SessionModel]. No public mutation methods.
 */
class MessageListUi(
    parent: Disposable,
    private val model: SessionModel,
) : JPanel(BorderLayout()) {

    private val blocks = LinkedHashMap<String, MessageBlock>()
    private var errorLabel: JBLabel? = null

    private val inner = JPanel().apply {
        layout = BoxLayout(this, BoxLayout.Y_AXIS)
        isOpaque = false
        border = JBUI.Borders.empty(4, 8)
    }

    private val label = JBLabel().apply {
        foreground = UIUtil.getContextHelpForeground()
    }

    private val spinner = JPanel(FlowLayout(FlowLayout.LEFT, JBUI.scale(4), 0)).apply {
        isOpaque = false
        isVisible = false
        border = JBUI.Borders.empty(6, 0)
        alignmentX = LEFT_ALIGNMENT
        add(JBLabel(AnimatedIcon.Default()))
        add(label)
    }

    init {
        isOpaque = true
        background = UIUtil.getPanelBackground()
        inner.add(spinner)
        add(inner, BorderLayout.NORTH)

        model.addListener(parent) { event ->
            when (event) {
                is SessionModelEvent.MessageAdded -> onAdded(event.info)
                is SessionModelEvent.MessageUpdated -> onAdded(event.info) // refresh/upsert
                is SessionModelEvent.MessageRemoved -> onRemoved(event.id)
                is SessionModelEvent.ContentAdded -> onContentAdded(event.messageId, event.content)
                is SessionModelEvent.ContentUpdated -> onContentUpdated(event.messageId, event.content)
                is SessionModelEvent.ContentRemoved -> onContentRemoved(event.messageId, event.contentId)
                is SessionModelEvent.ContentDelta -> onContentDelta(event.messageId, event.contentId, event.delta)
                is SessionModelEvent.StateChanged -> onState(event.state)
                is SessionModelEvent.HistoryLoaded -> onHistory()
                is SessionModelEvent.Cleared -> onCleared()
                is SessionModelEvent.DiffUpdated,
                is SessionModelEvent.TodosUpdated,
                is SessionModelEvent.Compacted,
                is SessionModelEvent.TurnAdded,
                is SessionModelEvent.TurnUpdated,
                is SessionModelEvent.TurnRemoved -> Unit
            }
        }
    }

    private fun onAdded(info: Message) {
        if (blocks.containsKey(info.info.id)) return
        val block = MessageBlock(info)
        blocks[info.info.id] = block
        inner.add(block, inner.componentCount - 1)
        refresh()
    }

    private fun onRemoved(id: String) {
        val block = blocks.remove(id) ?: return
        inner.remove(block)
        refresh()
    }

    private fun onContentAdded(messageId: String, content: Content) {
        blocks[messageId]?.addContent(content)
        refresh()
    }

    private fun onContentUpdated(messageId: String, content: Content) {
        blocks[messageId]?.updateContent(content)
        refresh()
    }

    private fun onContentRemoved(messageId: String, contentId: String) {
        blocks[messageId]?.removeContent(contentId)
        refresh()
    }

    private fun onContentDelta(messageId: String, contentId: String, delta: String) {
        blocks[messageId]?.appendDelta(contentId, delta)
        refresh()
    }

    private fun onState(state: SessionState) {
        errorLabel?.let { inner.remove(it); errorLabel = null }
        when (state) {
            is SessionState.Busy -> {
                label.text = state.text
                spinner.isVisible = true
            }
            is SessionState.Error -> {
                spinner.isVisible = false
                val err = JBLabel(state.message).apply {
                    foreground = JBColor.RED
                    font = JBUI.Fonts.label()
                    border = JBUI.Borders.empty(4, 0)
                    alignmentX = LEFT_ALIGNMENT
                }
                errorLabel = err
                inner.add(err, inner.componentCount - 1)
            }
            else -> {
                spinner.isVisible = false
            }
        }
        refresh()
    }

    private fun onHistory() {
        clear()
        for (entry in model.messages()) {
            val block = MessageBlock(entry)
            blocks[entry.info.id] = block
            inner.add(block, inner.componentCount - 1)
            for ((_, content) in entry.parts) block.addContent(content)
        }
        refresh()
    }

    private fun onCleared() {
        clear()
        refresh()
    }

    private fun clear() {
        blocks.clear()
        errorLabel = null
        inner.removeAll()
        inner.add(spinner)
        spinner.isVisible = false
    }

    private fun refresh() {
        revalidate()
        repaint()
    }
}

private class MessageBlock(info: Message) : JPanel() {
    private val areas = LinkedHashMap<String, JTextArea>()
    private val labels = LinkedHashMap<String, JBLabel>()

    init {
        layout = BoxLayout(this, BoxLayout.Y_AXIS)
        isOpaque = false
        alignmentX = LEFT_ALIGNMENT

        border = if (info.info.role == "user") {
            JBUI.Borders.compound(
                MatteBorder(1, 0, 0, 0, JBColor.border()),
                JBUI.Borders.empty(8, 0, 4, 0),
            )
        } else {
            JBUI.Borders.empty(4, 0)
        }
    }

    fun addContent(content: Content) {
        when (content) {
            is Text -> {
                val area = createArea()
                if (content.content.isNotEmpty()) area.text = content.content.toString()
                areas[content.id] = area
                add(area)
            }
            is Reasoning -> {
                val area = createArea().apply {
                    foreground = UIUtil.getContextHelpForeground()
                }
                if (content.content.isNotEmpty()) area.text = content.content.toString()
                areas[content.id] = area
                add(area)
            }
            is Tool -> {
                val lbl = createToolLabel(content)
                labels[content.id] = lbl
                add(lbl)
            }
            is Compaction -> {
                val lbl = JBLabel("Context compacted").apply {
                    foreground = UIUtil.getContextHelpForeground()
                    font = JBUI.Fonts.smallFont()
                    border = JBUI.Borders.empty(4, 0)
                    alignmentX = LEFT_ALIGNMENT
                }
                labels[content.id] = lbl
                add(lbl)
            }
            is Generic -> {} // unknown part type — not rendered in this pass
        }
        revalidate()
    }

    fun removeContent(contentId: String) {
        areas.remove(contentId)?.let { remove(it) }
        labels.remove(contentId)?.let { remove(it) }
        revalidate()
    }

    fun updateContent(content: Content) {
        when (content) {
            is Text -> areas[content.id]?.text = content.content.toString()
            is Reasoning -> areas[content.id]?.text = content.content.toString()
            is Tool -> labels[content.id]?.text = toolText(content)
            is Compaction -> {}
            is Generic -> {}
        }
        revalidate()
    }

    fun appendDelta(contentId: String, delta: String) {
        areas[contentId]?.append(delta)
        revalidate()
    }

    private fun createArea() = JTextArea().apply {
        isEditable = false
        lineWrap = true
        wrapStyleWord = true
        isOpaque = false
        font = JBUI.Fonts.label()
        foreground = UIUtil.getLabelForeground()
        border = JBUI.Borders.empty()
        alignmentX = LEFT_ALIGNMENT
    }

    private fun createToolLabel(content: Tool) = JBLabel(toolText(content)).apply {
        foreground = UIUtil.getContextHelpForeground()
        font = JBUI.Fonts.smallFont()
        border = JBUI.Borders.empty(2, 0)
        alignmentX = LEFT_ALIGNMENT
    }

    private fun toolText(content: Tool): String {
        val icon = when (content.state) {
            ToolExecState.PENDING -> "\u23F3"
            ToolExecState.RUNNING -> "\u25B6"
            ToolExecState.COMPLETED -> "\u2713"
            ToolExecState.ERROR -> "\u2717"
        }
        return "$icon ${content.title ?: content.name}"
    }
}
