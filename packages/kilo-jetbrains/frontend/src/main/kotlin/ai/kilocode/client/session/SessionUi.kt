package ai.kilocode.client.session

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.SessionModelEvent
import ai.kilocode.client.session.model.SessionState
import ai.kilocode.client.session.ui.ConnectionPanel
import ai.kilocode.client.session.ui.EmptySessionPanel
import ai.kilocode.client.session.ui.ReasoningPicker
import ai.kilocode.client.session.ui.mode.ModePicker
import ai.kilocode.client.session.ui.model.ModelPicker
import ai.kilocode.client.session.ui.PermissionPanel
import ai.kilocode.client.session.ui.prompt.PromptPanel
import ai.kilocode.client.session.ui.QuestionPanel
import ai.kilocode.client.session.ui.SessionRootPanel
import ai.kilocode.client.session.ui.SessionMessageListPanel
import ai.kilocode.client.session.ui.header.SessionHeaderPanel
import ai.kilocode.client.session.ui.SessionStyle
import ai.kilocode.client.session.ui.SessionStyleTarget
import ai.kilocode.client.session.update.EVENT_FLUSH_MS
import ai.kilocode.client.session.update.SessionController
import ai.kilocode.client.session.update.SessionControllerEvent
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.log.ChatLogSummary
import ai.kilocode.log.KiloLog
import com.intellij.ide.ui.LafManagerListener
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.editor.colors.EditorColorsListener
import com.intellij.openapi.editor.colors.EditorColorsManager
import com.intellij.openapi.Disposable
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.registry.Registry
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.Centerizer
import kotlinx.coroutines.CoroutineScope
import java.awt.BorderLayout
import javax.swing.BoxLayout
import javax.swing.BoxLayout.Y_AXIS
import javax.swing.JComponent
import javax.swing.JPanel

/**
 * Top-level session UI composition root.
 *
 * It builds the session panels, wires controller/model listeners, and swaps the
 * center body between the empty state and the message list.
 */
class SessionUi private constructor(
    project: Project,
    workspace: Workspace,
    sessions: KiloSessionService,
    app: KiloAppService,
    cs: CoroutineScope,
    id: String?,
    displayMs: Long,
    open: (SessionDto) -> Unit,
    private val loading: Boolean,
    session: SessionDto? = null,
) : JPanel(BorderLayout()), Disposable, SessionStyleTarget {

    constructor(
        project: Project,
        workspace: Workspace,
        sessions: KiloSessionService,
        app: KiloAppService,
        cs: CoroutineScope,
        id: String? = null,
        displayMs: Long = SessionController.DISPLAY_DELAY_MS,
        open: (SessionDto) -> Unit = {},
        session: SessionDto? = null,
    ) : this(project, workspace, sessions, app, cs, session?.id ?: id, displayMs, open, id == null, session)

    internal constructor(
        project: Project,
        workspace: Workspace,
        sessions: KiloSessionService,
        app: KiloAppService,
        cs: CoroutineScope,
        id: String? = null,
        displayMs: Long = SessionController.DISPLAY_DELAY_MS,
        loading: Boolean,
        open: (SessionDto) -> Unit = {},
        session: SessionDto? = null,
    ) : this(project, workspace, sessions, app, cs, id, displayMs, open, loading, session)

    companion object {
        private val LOG = KiloLog.create(SessionUi::class.java)
    }

    private val project = project
    private val app = app
    private var opening = id != null
    private var pending = false
    private var loaded: Boolean? = null
    private val flushMs =
        Registry.intValue("kilo.session.flushMs", EVENT_FLUSH_MS.toInt())
            .takeIf { it > 0 }
            ?.toLong()
            ?: EVENT_FLUSH_MS

    private val controller = SessionController(
        this, id, sessions, workspace, app, cs, this,
        flushMs = flushMs,
        condense = Registry.`is`("kilo.session.condense", true),
        displayMs = displayMs,
        session = session,
        open = open,
        beforeUpdate = { if (opening) false else scroll.atBottom() },
        afterUpdate = { if (!opening) scroll.followBottom(it) },
        loaded = ::onHistoryLoaded,
    )


    private lateinit var root: SessionRootPanel

    private lateinit var sessionContent: JPanel

    private lateinit var blankBody: JPanel

    private lateinit var progressBody: JPanel

    private lateinit var messageBody: SessionMessageListPanel

    private lateinit var header: SessionHeaderPanel

    internal lateinit var scroll: SessionScroll

    private lateinit var question: QuestionPanel
    private lateinit var permission: PermissionPanel
    private lateinit var connection: ConnectionPanel

    private lateinit var prompt: PromptPanel
    private lateinit var loadingLabel: JBLabel
    private var style = SessionStyle.current()

    init {
        buildUi()
        bindUi()
        bindStyle()
        applyStyle(style)
        onStateChanged(controller.model.state)
        scroll.show(startBody())
        loaded?.let(::finishOpen)
    }

    override fun addNotify() {
        super.addNotify()
        resumeOpen()
    }

    override fun doLayout() {
        super.doLayout()
        resumeOpen()
    }

    internal val blank: Boolean get() = controller.blank

    internal val id: String? get() = controller.id

    internal fun currentStyle() = style

    val defaultFocusedComponent: JComponent get() = prompt.defaultFocusedComponent

    private fun buildUi() {
        root = SessionRootPanel()

        sessionContent = JPanel(BorderLayout())

        blankBody = JPanel(BorderLayout()).apply {
            isOpaque = false
        }

        progressBody = JPanel(BorderLayout()).apply {
            isOpaque = false
            loadingLabel = JBLabel(KiloBundle.message("session.empty.loading"))
            add(Centerizer(
                loadingLabel,
                Centerizer.TYPE.BOTH,
            ), BorderLayout.CENTER)
        }
        messageBody = SessionMessageListPanel(controller.model, this)
        header = SessionHeaderPanel(controller, this)

        scroll = SessionScroll(root, sessionContent, messageBody, blankBody)
        question = QuestionPanel(controller)
        permission = PermissionPanel(controller)
        connection = ConnectionPanel(this, controller)

        prompt = PromptPanel(
            project = project,
            onSend = { text -> sendPrompt(text) },
            onAbort = { controller.abort() },
        )

        sessionContent.add(header, BorderLayout.NORTH)
        sessionContent.add(scroll.component, BorderLayout.CENTER)
        root.content.add(sessionContent, BorderLayout.CENTER)
        // Dock panels stay in normal flow so each visible state takes layout space
        // above the prompt.
        root.content.add(JPanel().apply {
            this.layout = BoxLayout(this, Y_AXIS)
            add(question)
            add(permission)
            add(connection)
            add(prompt)
        }, BorderLayout.SOUTH)
        add(root, BorderLayout.CENTER)
    }

    private fun bindUi() {
        prompt.mode.onSelect = { item -> controller.selectAgent(item.id) }
        prompt.model.onSelect = { item -> controller.selectModel(item.provider, item.id) }
        prompt.reasoning.onSelect = { item -> controller.selectVariant(item.id) }
        prompt.onReset = { controller.clearModelOverride() }
        prompt.model.favorites = { app.favorites.value }
        prompt.model.onFavoriteToggle = { item -> app.toggleModelFavorite(item.provider, item.id) }

        controller.addListener(this) { event ->
            when (event) {
                is SessionControllerEvent.WorkspaceReady -> {
                    val m = controller.model
                    prompt.mode.setItems(m.agents.map {
                        ModePicker.Item(
                            it.name,
                            it.display,
                            it.description,
                            it.deprecated,
                        )
                    }, m.agent)
                    val items = m.models.map {
                        ModelPicker.Item(
                            it.id,
                            it.display,
                            it.provider,
                            it.providerName,
                            it.recommendedIndex,
                            it.free,
                            it.variants,
                        )
                    }
                    val selected =
                        m.model?.let { full -> items.firstOrNull { it.key == full }?.key }
                    prompt.model.setItems(items, selected)
                    prompt.reasoning.setItems(m.variants.map { ReasoningPicker.Item(it, variantTitle(it)) }, m.variant)
                    prompt.setResetVisible(m.modelOverride)
                    prompt.setReady(m.isReady())
                }

                is SessionControllerEvent.ViewChanged.ShowProgress -> {
                    scroll.show(progressBody)
                }

                is SessionControllerEvent.ViewChanged.ShowRecents -> {
                    val panel = EmptySessionPanel(this, controller, event.recents)
                    scroll.show(panel)
                }

                is SessionControllerEvent.ViewChanged.ShowSession -> {
                    scroll.show(messageBody)
                }

                is SessionControllerEvent.AppChanged,
                is SessionControllerEvent.WorkspaceChanged -> {
                    prompt.setReady(controller.model.isReady())
                }

                is SessionControllerEvent.ConnectionChanged -> Unit
            }
        }

        controller.model.addListener(this) { event ->
            when (event) {
                is SessionModelEvent.StateChanged -> onStateChanged(event.state)

                is SessionModelEvent.TurnAdded,
                is SessionModelEvent.TurnUpdated,
                is SessionModelEvent.ContentAdded,
                is SessionModelEvent.ContentDelta,
                is SessionModelEvent.HistoryLoaded,
                is SessionModelEvent.TurnRemoved,
                is SessionModelEvent.MessageAdded,
                is SessionModelEvent.MessageUpdated,
                is SessionModelEvent.MessageRemoved,
                is SessionModelEvent.ContentUpdated,
                is SessionModelEvent.ContentRemoved,
                is SessionModelEvent.DiffUpdated,
                is SessionModelEvent.TodosUpdated,
                is SessionModelEvent.SessionUpdated,
                is SessionModelEvent.HeaderUpdated,
                is SessionModelEvent.Compacted,
                is SessionModelEvent.Cleared -> Unit
            }
        }
    }

    private fun bindStyle() {
        val bus = ApplicationManager.getApplication().messageBus.connect(this)
        bus.subscribe(EditorColorsManager.TOPIC, EditorColorsListener {
            ApplicationManager.getApplication().invokeLater {
                applyStyle(SessionStyle.current())
            }
        })
        bus.subscribe(LafManagerListener.TOPIC, LafManagerListener {
            ApplicationManager.getApplication().invokeLater {
                applyStyle(SessionStyle.current())
            }
        })
    }

    private fun startBody(): JPanel {
        if (controller.model.showSession) return messageBody
        if (loading) return progressBody
        return blankBody
    }

    private fun onHistoryLoaded(show: Boolean) {
        loaded = show
        if (!this::scroll.isInitialized) return
        finishOpen(show)
    }

    private fun finishOpen(show: Boolean) {
        loaded = show
        if (!opening) return
        if (!show) {
            pending = false
            opening = false
            return
        }
        pending = true
        resumeOpen()
    }

    private fun resumeOpen() {
        if (!pending || !opening || !this::scroll.isInitialized) return
        if (width <= 0 || height <= 0) return
        pending = false
        scroll.openBottom {
            opening = false
        }
    }

    private fun sendPrompt(text: String) {
        if (text.isBlank()) return
        LOG.debug {
            val agent = controller.model.agent ?: "none"
            val model = controller.model.model ?: "none"
            "${ChatLogSummary.prompt(text)} agent=$agent model=$model ready=${controller.ready}"
        }
        controller.prompt(text)
        prompt.clear()
    }

    private fun onStateChanged(state: SessionState) {
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
        refresh()
    }

    private fun refresh() {
        scroll.refresh()
        root.revalidate()
        root.repaint()
    }

    override fun applyStyle(style: SessionStyle) {
        this.style = style
        loadingLabel.font = style.uiFont
        header.applyStyle(style)
        prompt.applyStyle(style)
        scroll.applyStyle(style)
        refresh()
    }

    override fun dispose() {}
}

private fun variantTitle(value: String): String = value.replaceFirstChar { it.titlecase() }
