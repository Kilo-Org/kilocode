package ai.kilocode.client.session

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.session.model.SessionEvent
import ai.kilocode.client.session.model.SessionModel
import ai.kilocode.client.session.ui.LabelPicker
import ai.kilocode.client.session.ui.MessageListPanel
import ai.kilocode.client.session.ui.PromptPanel
import ai.kilocode.client.session.ui.StatusPanel
import com.intellij.openapi.Disposable
import com.intellij.openapi.project.Project
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.JBUI
import kotlinx.coroutines.CoroutineScope
import java.awt.BorderLayout
import java.awt.CardLayout
import javax.swing.JPanel

/**
 * Main chat panel — reacts to [SessionModel] events.
 *
 * Uses [CardLayout] in the center to switch between the empty panel
 * (shown before the first prompt) and the scrollable message list.
 *
 * All business logic (app/workspace watching, session lifecycle, event
 * handling, status computation) lives in [SessionModel]. Welcome
 * rendering lives in [ai.kilocode.client.session.ui.StatusPanel]. This class handles layout, prompt
 * wiring, message list updates, card switching, picker population,
 * busy state, and scrolling.
 */
class SessionUi(
    project: Project,
    workspace: Workspace,
    sessions: KiloSessionService,
    app: KiloAppService,
    cs: CoroutineScope,
) : JPanel(BorderLayout()), Disposable {

    companion object {
        private const val STATUS = "status"
        private const val MESSAGES = "messages"
    }

    private val model = SessionModel(this, null, sessions, workspace, app, cs)
    private val status = StatusPanel(this, model)
    private val messages = MessageListPanel()

    private val cards = CardLayout()
    private val center = JPanel(cards)

    private val scroll = JBScrollPane(messages).apply {
        border = JBUI.Borders.empty()
        verticalScrollBarPolicy = JBScrollPane.VERTICAL_SCROLLBAR_AS_NEEDED
        horizontalScrollBarPolicy = JBScrollPane.HORIZONTAL_SCROLLBAR_NEVER
    }

    private val prompt = PromptPanel(
      project = project,
      onSend = { text -> send(text) },
      onAbort = { model.abort() },
    )

    init {
        // Layout
        center.add(status, STATUS)
        center.add(scroll, MESSAGES)
        cards.show(center, STATUS)

        add(center, BorderLayout.CENTER)
        add(prompt, BorderLayout.SOUTH)

        // Wire picker callbacks via typed model methods
        prompt.mode.onSelect = { item ->
            model.selectAgent(item.id)
        }
        prompt.model.onSelect = { item ->
            val group = item.group
            if (group != null) {
                model.selectModel(group, item.id)
            }
        }

        // React to model events — no coroutines, pure EDT
        model.addListener(this) { event ->
            when (event) {
                is SessionEvent.MessageAdded -> {
                    val msg = model.chat.message(event.id) ?: return@addListener
                    messages.addMessage(msg.info)
                    refreshMessages()
                }

                is SessionEvent.MessageRemoved -> {
                    messages.removeMessage(event.id)
                    refreshMessages()
                }

                is SessionEvent.PartUpdated -> {
                    val part = model.chat.part(event.messageId, event.partId) ?: return@addListener
                    messages.updatePartText(event.messageId, event.partId, part.text.toString())
                    refreshMessages()
                }

                is SessionEvent.PartDelta -> {
                    messages.appendDelta(event.messageId, event.partId, event.delta)
                    refreshMessages()
                }

                is SessionEvent.StatusChanged -> {
                    messages.setStatus(event.text)
                    refreshMessages()
                }

                is SessionEvent.Error -> {
                    messages.addError(event.message)
                    refreshMessages()
                }

                is SessionEvent.HistoryLoaded -> {
                    messages.clear()
                    for (msg in model.chat.messages()) {
                        messages.addMessage(msg.info)
                        for ((partId, part) in msg.parts) {
                            if (part.dto.type == "text" && part.text.isNotEmpty()) {
                                messages.updatePartText(msg.info.id, partId, part.text.toString())
                            }
                        }
                    }
                    refreshMessages()
                }

                is SessionEvent.Cleared -> {
                    messages.clear()
                    refreshMessages()
                }

                is SessionEvent.WorkspaceReady -> {
                    val c = model.chat
                    prompt.mode.setItems(
                        c.agents.map { LabelPicker.Item(it.name, it.display) },
                        c.agent,
                    )
                    val items = c.models.map { LabelPicker.Item(it.id, it.display, it.provider) }
                    // chat.model is "provider/modelId", picker items use modelId only.
                    // Find the matching item and pass its id for selection.
                    val selected = c.model?.let { full ->
                        items.firstOrNull { "${it.group}/${it.id}" == full }?.id
                    }
                    prompt.model.setItems(items, selected)
                    prompt.setReady(c.ready)
                }

                is SessionEvent.ViewChanged -> {
                    cards.show(center, if (event.show) MESSAGES else STATUS)
                }

                is SessionEvent.BusyChanged -> {
                    prompt.setBusy(event.busy)
                }

                is SessionEvent.AppChanged,
                is SessionEvent.WorkspaceChanged -> {
                    // Handled by StatusPanel
                }
            }
        }
    }

    private fun send(text: String) {
        if (text.isBlank()) return
        model.prompt(text)
        prompt.clear()
    }

    private fun refreshMessages() {
        messages.revalidate()
        messages.repaint()
        scrollToBottom()
    }

    private fun scrollToBottom() {
        val bar = scroll.verticalScrollBar
        bar.value = bar.maximum
    }

    override fun dispose() {
        // All children (status, model) disposed by Disposer
    }
}
