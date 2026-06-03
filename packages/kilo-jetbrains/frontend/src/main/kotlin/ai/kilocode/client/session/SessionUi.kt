package ai.kilocode.client.session

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.migration.KiloMigrationService
import ai.kilocode.client.migration.MigrationUiController
import ai.kilocode.client.migration.MigrationUiState
import ai.kilocode.client.migration.ui.MigrationOverlayPanel
import ai.kilocode.client.session.model.SessionModelEvent
import ai.kilocode.client.session.model.SessionState
import ai.kilocode.client.session.scroll.SessionScroll
import ai.kilocode.client.session.ui.ConnectionPanel
import ai.kilocode.client.session.ui.empty.EmptySessionPanel
import ai.kilocode.client.session.ui.LoadingPanel
import ai.kilocode.client.session.ui.ReasoningPicker
import ai.kilocode.client.session.ui.mode.ModePicker
import ai.kilocode.client.session.ui.model.ModelPicker
import ai.kilocode.client.session.ui.prompt.PromptPanel
import ai.kilocode.client.session.ui.account.SessionAccountOverlay
import ai.kilocode.client.session.ui.SessionRootPanel
import ai.kilocode.client.session.ui.SessionMessageListPanel
import ai.kilocode.client.session.ui.header.SessionHeaderPanel
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionEditorStyleTarget
import ai.kilocode.client.session.controller.EVENT_FLUSH_MS
import ai.kilocode.client.session.controller.SessionController
import ai.kilocode.client.session.controller.SessionControllerEvent
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.LoginRequiredView
import ai.kilocode.client.session.views.permission.PermissionView
import ai.kilocode.client.session.views.question.QuestionView
import ai.kilocode.client.settings.profile.UserProfileConfigurable
import ai.kilocode.client.telemetry.Telemetry
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.log.ChatLogSummary
import com.intellij.util.ui.JBUI
import ai.kilocode.log.KiloLog
import com.intellij.ide.BrowserUtil
import com.intellij.ide.ui.LafManagerListener
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.openapi.editor.colors.EditorColorsListener
import com.intellij.openapi.editor.colors.EditorColorsManager
import com.intellij.openapi.options.Configurable
import com.intellij.openapi.options.ConfigurableWithId
import com.intellij.openapi.options.ShowSettingsUtil
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.registry.Registry
import com.intellij.util.concurrency.annotations.RequiresEdt
import java.util.function.Predicate
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.awt.BorderLayout
import java.awt.event.HierarchyEvent
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.UIManager

/**
 * Top-level session UI composition root.
 *
 * It builds the session panels, wires controller/model listeners, and swaps the
 * center body between the empty state and the message list.
 */
class SessionUi(
    project: Project,
    workspace: Workspace,
    sessions: KiloSessionService,
    app: KiloAppService,
    private val cs: CoroutineScope,
    ref: SessionRef? = null,
    displayMs: Long = SessionController.DISPLAY_DELAY_MS,
    private val manager: SessionManager? = null,
    private val workspaces: KiloWorkspaceService = service(),
    private val migration: MigrationUiController = service<KiloMigrationService>(),
) : JPanel(BorderLayout()), Disposable, SessionEditorStyleTarget {

    companion object {
        private val LOG = KiloLog.create(SessionUi::class.java)
    }

    private val project = project
    private val app = app
    private val sessions = sessions
    private val workspace = workspace
    private var opening = ref != null
    private var pending = false
    private var loaded: Boolean? = null
    private val flushMs =
        Registry.intValue("kilo.session.flushMs", EVENT_FLUSH_MS.toInt())
            .takeIf { it > 0 }
            ?.toLong()
            ?: EVENT_FLUSH_MS

    private val controller = SessionController(
        this, ref, sessions, workspace, app, cs, comp = this,
        flushMs = flushMs,
        condense = Registry.`is`("kilo.session.condense", true),
        displayMs = displayMs,
        open = { item -> manager?.openSession(item) },
        beforeUpdate = { if (opening) false else scroll.atBottom() },
        afterUpdate = { if (!opening) scroll.followBottom(it) },
        loaded = ::onSessionLoaded,
        openProfileAction = ::openProfileSettings,
    )


    private lateinit var root: SessionRootPanel
    private lateinit var account: SessionAccountOverlay

    private lateinit var sessionContent: JPanel

    private lateinit var blankBody: JPanel

    private lateinit var progressBody: JPanel

    private lateinit var messageBody: SessionMessageListPanel

    private lateinit var header: SessionHeaderPanel

    internal lateinit var scroll: SessionScroll

    private lateinit var question: QuestionView
    private lateinit var permission: PermissionView
    private lateinit var login: LoginRequiredView
    private lateinit var connection: ConnectionPanel

    private lateinit var prompt: PromptPanel
    private lateinit var load: LoadingPanel
    private lateinit var migrationOverlay: MigrationOverlayPanel
    private var empty: EmptySessionPanel? = null
    private var modalFocus: (() -> JComponent)? = null
    private var style = SessionEditorStyle.current()
    private var editorTheme = style.editorScheme
    private var colorTheme = UIManager.getLookAndFeel()

    init {
        buildUi()
        scroll.show(body(controller.model.state))
        bindUi()
        bindStyle()
        bindMigration()
        applyStyle(style)
        onStateChanged(controller.model.state)
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

    internal val cacheKey: String? get() = controller.refKey

    internal fun currentStyle() = style

    @RequiresEdt
    internal fun canDisposeInactive(): Boolean = controller.model.state is SessionState.Idle

    @RequiresEdt
    internal fun activityKind(): SessionActivityKind? = when (val state = controller.model.state) {
        is SessionState.Idle,
        is SessionState.Loading,
        is SessionState.Busy,
        is SessionState.Retry,
        is SessionState.Offline,
        is SessionState.Error -> null
        is SessionState.LoginRequired -> SessionActivityKind.LOGIN_REQUIRED
        is SessionState.AwaitingPermission -> SessionActivityKind.PERMISSION
        is SessionState.AwaitingQuestion ->
            SessionActivityKind.PLAN.takeIf { state.question.items.any { it.planFollowup() } } ?: SessionActivityKind.QUESTION
    }

    @RequiresEdt
    internal fun title(): String? = controller.model.session?.title?.takeIf { it.isNotBlank() }

    @RequiresEdt
    internal fun syncActivity() {
        empty?.syncActivity()
    }

    val defaultFocusedComponent: JComponent get() {
        modalFocus?.invoke()?.let { return it }
        return prompt.defaultFocusedComponent
    }

    internal fun setModalContent(content: JComponent?, focus: (() -> JComponent)? = null) {
        modalFocus = if (content == null) null else focus
        root.setModalContent(content)
    }

    private fun buildUi() {
        root = SessionRootPanel()

        migrationOverlay = MigrationOverlayPanel().apply {
            onSkip = { migration.skip() }
            onDone = { migration.finish() }
            onContinueFromError = { migration.finish() }
            onStart = { sel -> migration.start(sel) }
        }
        migrationOverlay.border = JBUI.Borders.empty(
            JBUI.scale(SessionUiStyle.View.Prompt.PANEL_VERTICAL_PADDING),
            JBUI.scale(SessionUiStyle.View.Prompt.PANEL_HORIZONTAL_PADDING),
            JBUI.scale(SessionUiStyle.View.Prompt.PANEL_VERTICAL_PADDING),
            JBUI.scale(SessionUiStyle.View.Prompt.PANEL_HORIZONTAL_PADDING),
        )

        account = SessionAccountOverlay(
            select = { org -> controller.selectOrganization(org) },
            profile = { controller.openProfile() },
        )
        root.addOverlay(account) { pane, child ->
            val size = child.preferredSize
            val top = JBUI.scale(SessionUiStyle.View.Prompt.PANEL_VERTICAL_PADDING)
            val right = JBUI.scale(SessionUiStyle.View.Prompt.PANEL_HORIZONTAL_PADDING)
            java.awt.Rectangle(
                pane.width - size.width - right,
                top,
                size.width,
                size.height,
            )
        }

        sessionContent = JPanel(BorderLayout())

        blankBody = JPanel(BorderLayout()).apply {
            isOpaque = false
        }

        load = LoadingPanel()
        progressBody = load
        question = QuestionView(
            project = project,
            reply = { id, dto, opts -> controller.replyQuestion(id, dto, opts) },
            reject = { id -> controller.rejectQuestion(id) },
            follow = { scroll.following() },
            scroll = { scroll.followBottom(it) },
        )
        permission = PermissionView(
            reply = { id, dto -> controller.replyPermission(id, dto) },
        )
        login = LoginRequiredView(openProfile = { controller.openProfile() }, dismiss = { controller.dismissLoginRequired() })
        messageBody = SessionMessageListPanel(controller.model, this, question, permission, login, ::openFile, ::openUrl)
        header = SessionHeaderPanel(controller, this)

        scroll = SessionScroll(root, sessionContent, messageBody, blankBody)
        connection = ConnectionPanel(this, controller)

        prompt = PromptPanel(
            project = project,
            onSend = { text -> sendPrompt(text) },
            onAbort = { controller.abort() },
        )

        sessionContent.add(header, BorderLayout.NORTH)
        sessionContent.add(scroll.component, BorderLayout.CENTER)
        root.content.add(sessionContent, BorderLayout.CENTER)
        root.content.add(Stack.vertical().next(connection).next(prompt), BorderLayout.SOUTH)
        add(root, BorderLayout.CENTER)
    }

    private fun bindUi() {
        prompt.mode.onSelect = { item -> controller.selectAgent(item.id) }
        prompt.model.onSelect = { item -> controller.selectModel(item.provider, item.id) }
        prompt.reasoning.onSelect = { item -> controller.selectVariant(item.id) }
        prompt.onReset = { controller.clearModelOverride() }
        prompt.onChange = { scroll.refresh() }
        prompt.onAutoApproveToggle = { value ->
            controller.setAutoApprove(value)
            prompt.setAutoApprove(controller.autoApprove)
        }
        prompt.setAutoApprove(controller.autoApprove)
        prompt.model.favorites = { app.favorites.value }
        prompt.model.onFavoriteToggle = { item ->
            Telemetry.send(
                "Model Favorite Toggled",
                mapOf("provider" to item.provider, "modelId" to item.id),
            )
            app.toggleModelFavorite(item.provider, item.id)
        }

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
                    empty = null
                    scroll.show(progressBody)
                }

                is SessionControllerEvent.ViewChanged.ShowRecents -> {
                    val panel = EmptySessionPanel(
                        this,
                        controller,
                        event.recents,
                        history = { manager?.showHistory() },
                        activity = { manager?.activity() ?: sessions.activity() },
                        titles = { manager?.titles().orEmpty() },
                    )
                    empty = panel
                    scroll.show(panel.view)
                }

                is SessionControllerEvent.ViewChanged.ShowSession -> {
                    empty = null
                    scroll.show(messageBody)
                }

                is SessionControllerEvent.AppChanged -> {
                    prompt.setReady(controller.model.isReady())
                }

                is SessionControllerEvent.WorkspaceChanged -> {
                    prompt.setReady(controller.model.isReady())
                }

                is SessionControllerEvent.ConnectionChanged -> Unit

                is SessionControllerEvent.AccountOverlayChanged -> account.onEvent(event)
            }
        }

        controller.model.addListener(this) { event ->
            when (event) {
                is SessionModelEvent.StateChanged -> onStateChanged(event.state)

                is SessionModelEvent.SessionUpdated -> onSessionUpdated()

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
                is SessionModelEvent.HeaderUpdated,
                is SessionModelEvent.Compacted,
                is SessionModelEvent.Cleared -> Unit
            }
        }
    }

    private fun bindMigration() {
        cs.launch {
            migration.state.collect { state ->
                withContext(Dispatchers.Main) {
                    applyMigrationState(state)
                }
            }
        }
    }

    @RequiresEdt
    private fun applyMigrationState(state: MigrationUiState) {
        when (state) {
            is MigrationUiState.Hidden -> {
                if (root.blocker.isVisible) LOG.info("Migration wizard: overlay hidden session=${id ?: cacheKey ?: "new"}")
                setModalContent(null)
            }
            is MigrationUiState.Needed -> {
                if (!root.blocker.isVisible) LOG.info("Migration wizard: overlay shown session=${id ?: cacheKey ?: "new"} phase=${state.phase}")
                migrationOverlay.update(state)
                setModalContent(migrationOverlay) { migrationOverlay.preferredFocusComponent() }
                migrationOverlay.revalidate()
                migrationOverlay.repaint()
            }
        }
    }

    private fun bindStyle() {
        addHierarchyListener { event ->
            if ((event.changeFlags and HierarchyEvent.SHOWING_CHANGED.toLong()) == 0L) return@addHierarchyListener
            if (!isShowing) return@addHierarchyListener
            applyStyleIfThemeChanged()
        }

        val bus = ApplicationManager.getApplication().messageBus.connect(this)
        bus.subscribe(EditorColorsManager.TOPIC, EditorColorsListener {
            ApplicationManager.getApplication().invokeLater {
                applyStyle(SessionEditorStyle.current())
            }
        })
        bus.subscribe(LafManagerListener.TOPIC, LafManagerListener {
            ApplicationManager.getApplication().invokeLater {
                applyStyle(SessionEditorStyle.current())
            }
        })
    }

    private fun onSessionLoaded(show: Boolean) {
        loaded = show
        if (!this::scroll.isInitialized) return
        finishOpen(show)
    }

    private fun body(state: SessionState): JPanel {
        if (state is SessionState.Retry || state is SessionState.Offline) return progressBody
        if (controller.model.showSession) return messageBody
        if (state is SessionState.Loading) return progressBody
        return blankBody
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
        prompt.clear()
        val follow = scroll.atBottom()
        controller.prompt(text)
        scroll.followBottom(follow)
    }

    private fun openFile(path: String) {
        cs.launch {
            workspaces.openPath(workspace.directory, path)
        }
    }

    private fun openUrl(url: String) {
        BrowserUtil.browse(url)
    }

    private fun onStateChanged(state: SessionState) {
        prompt.setBusy(state.isBusy())
        load.setState(state)
        scroll.setQuestionPending(questionPending(state))
        scroll.show(body(state))
        manager?.activityChanged()
        refresh()
    }

    private fun onSessionUpdated() {
        manager?.activityChanged()
    }

    private fun refresh() {
        scroll.refresh()
        root.revalidate()
        root.repaint()
    }

    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        editorTheme = style.editorScheme
        colorTheme = UIManager.getLookAndFeel()
        background = style.editorBackground
        root.content.background = style.editorBackground
        sessionContent.background = style.editorBackground
        blankBody.background = style.editorBackground
        load.applyStyle(style)
        header.applyStyle(style)
        prompt.applyStyle(style)
        scroll.applyStyle(style)
        refresh()
    }

    private fun applyStyleIfThemeChanged() {
        val next = SessionEditorStyle.current()
        val laf = UIManager.getLookAndFeel()
        if (editorTheme === next.editorScheme && colorTheme == laf) return
        applyStyle(next)
    }

    private fun openProfileSettings() {
        ShowSettingsUtil.getInstance().showSettingsDialog(
            project,
            Predicate { cfg: Configurable ->
                cfg is ConfigurableWithId && cfg.getId() == UserProfileConfigurable.ID
            },
            { cfg: Configurable -> cfg.focusOn(UserProfileConfigurable.FOCUS_ACCOUNT_COMBO) },
        )
    }

    override fun dispose() {}
}

private fun variantTitle(value: String): String = value.replaceFirstChar { it.titlecase() }

private fun questionPending(state: SessionState): Boolean {
    if (state !is SessionState.AwaitingQuestion) return false
    return state.question.items.none { it.planFollowup() }
}

private fun ai.kilocode.client.session.model.QuestionItem.planFollowup() =
    questionKey == "plan.followup.question" || headerKey == "plan.followup.header"
