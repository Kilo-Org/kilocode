package ai.kilocode.client.session

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.session.model.SessionModelEvent
import ai.kilocode.client.session.model.SessionState
import ai.kilocode.client.session.ui.LabelPicker
import ai.kilocode.client.session.ui.PermissionPanel
import ai.kilocode.client.session.ui.PromptPanel
import ai.kilocode.client.session.ui.QuestionPanel
import ai.kilocode.client.session.ui.SessionPanel
import ai.kilocode.client.session.ui.StatusPanel
import com.intellij.openapi.Disposable
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.registry.Registry
import ai.kilocode.log.ChatLogSummary
import ai.kilocode.log.KiloLog
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.JBUI
import kotlinx.coroutines.CoroutineScope
import java.awt.BorderLayout
import java.awt.CardLayout
import javax.swing.BoxLayout
import javax.swing.JPanel

/**
 * Top-level session UI — a thin composition root.
 *
 * Responsibilities:
 * - Creates and wires [SessionController], [SessionPanel], [StatusPanel],
 *   [PromptPanel], [QuestionPanel], [PermissionPanel].
 * - Switches between the status (loading) card and the transcript card via
 *   [SessionControllerEvent.ViewChanged].
 * - Delegates all transcript and dock updates to the panels themselves via
 *   [SessionModelEvent] listeners (no inline rendering logic here).
 * - Scrolls to the bottom on new content.
 *
 * Views must never call RPC or services directly; everything goes through
 * the controller.
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
        private val LOG = KiloLog.create(SessionUi::class.java)
    }

    private val flushMs = Registry.intValue("kilo.session.flushMs", EVENT_FLUSH_MS.toInt())
        .takeIf { it > 0 }
        ?.toLong()
        ?: EVENT_FLUSH_MS

    private val controller = SessionController(
        this, null, sessions, workspace, app, cs, this,
        flushMs = flushMs,
        condense = Registry.`is`("kilo.session.condense", true),
    )

    // ------ card switch ------

    private val cards = CardLayout()
    private val center = JPanel(cards)

    // ------ status (loading) panel ------

    private val status = StatusPanel(this, controller)

    // ------ transcript ------

    private val transcript = SessionPanel(controller.model, this)

    private val scroll = JBScrollPane(transcript).apply {
        border = JBUI.Borders.empty()
        verticalScrollBarPolicy = JBScrollPane.VERTICAL_SCROLLBAR_AS_NEEDED
        horizontalScrollBarPolicy = JBScrollPane.HORIZONTAL_SCROLLBAR_NEVER
    }

    // ------ dock panels (above prompt) ------

    private val question = QuestionPanel(controller)
    private val permission = PermissionPanel(controller)

    // ------ prompt ------

    private val prompt = PromptPanel(
        project = project,
        onSend = { text -> send(text) },
        onAbort = { controller.abort() },
    )

    init {
        // South area: question dock, permission dock, and prompt stacked vertically.
        // BoxLayout(Y_AXIS) collapses invisible panels to zero height automatically,
        // so hiding a dock doesn't leave an empty gap above the prompt.
        val south = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            isOpaque = false
            add(question)
            add(permission)
            add(prompt)
        }

        center.add(status, STATUS)
        center.add(scroll, MESSAGES)
        cards.show(center, STATUS)

        add(center, BorderLayout.CENTER)
        add(south, BorderLayout.SOUTH)

        // ------ picker wiring ------

        prompt.mode.onSelect = { item -> controller.selectAgent(item.id) }
        prompt.model.onSelect = picker@{ item ->
            val group = item.group ?: return@picker
            controller.selectModel(group, item.id)
        }

        // ------ controller lifecycle events ------

        controller.addListener(this) { event ->
            when (event) {
                is SessionControllerEvent.WorkspaceReady -> {
                    val m = controller.model
                    prompt.mode.setItems(m.agents.map { LabelPicker.Item(it.name, it.display) }, m.agent)
                    val items = m.models.map { LabelPicker.Item(it.id, it.display, it.provider) }
                    val selected = m.model?.let { full -> items.firstOrNull { "${it.group}/${it.id}" == full }?.id }
                    prompt.model.setItems(items, selected)
                    prompt.setReady(m.isReady())
                }

                is SessionControllerEvent.ViewChanged ->
                    cards.show(center, if (event.show) MESSAGES else STATUS)

                is SessionControllerEvent.AppChanged,
                is SessionControllerEvent.WorkspaceChanged ->
                    prompt.setReady(controller.model.isReady())
            }
        }

        // ------ model events — prompt state + dock + auto-scroll ------

        controller.model.addListener(this) { event ->
            when (event) {
                is SessionModelEvent.StateChanged -> onState(event.state)

                is SessionModelEvent.TurnAdded,
                is SessionModelEvent.TurnUpdated,
                is SessionModelEvent.ContentAdded,
                is SessionModelEvent.ContentDelta,
                is SessionModelEvent.HistoryLoaded -> scrollToBottom()

                is SessionModelEvent.TurnRemoved,
                is SessionModelEvent.MessageAdded,
                is SessionModelEvent.MessageUpdated,
                is SessionModelEvent.MessageRemoved,
                is SessionModelEvent.ContentUpdated,
                is SessionModelEvent.ContentRemoved,
                is SessionModelEvent.DiffUpdated,
                is SessionModelEvent.TodosUpdated,
                is SessionModelEvent.Compacted,
                is SessionModelEvent.Cleared -> Unit
            }
        }
    }

    // ------ private helpers ------

    private fun send(text: String) {
        if (text.isBlank()) return
        LOG.debug {
            "${ChatLogSummary.prompt(text)} agent=${controller.model.agent ?: "none"} model=${controller.model.model ?: "none"} ready=${controller.ready}"
        }
        controller.prompt(text)
        prompt.clear()
    }

    private fun onState(state: SessionState) {
        prompt.setBusy(state.isBusy())
        when (state) {
            is SessionState.AwaitingQuestion -> {
                permission.hidePanel()
                question.show(state.question)
            }
            is SessionState.AwaitingPermission -> {
                question.hidePanel()
                permission.show(state.permission)
            }
            else -> {
                question.hidePanel()
                permission.hidePanel()
            }
        }
        scrollToBottom()
    }

    private fun scrollToBottom() {
        val bar = scroll.verticalScrollBar
        bar.value = bar.maximum
    }

    override fun dispose() {}
}

private fun SessionState.isBusy(): Boolean = when (this) {
    is SessionState.Idle, is SessionState.Error -> false
    else -> true
}
