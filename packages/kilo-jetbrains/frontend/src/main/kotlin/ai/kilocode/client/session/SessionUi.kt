package ai.kilocode.client.session

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.diff.KiloDiffEditorKind
import ai.kilocode.client.diff.KiloInlineDiffStore
import ai.kilocode.client.diff.diffParams
import ai.kilocode.client.diff.ensureDiffEditorKind
import ai.kilocode.client.migration.KiloMigrationService
import ai.kilocode.client.migration.MigrationUiController
import ai.kilocode.client.migration.MigrationUiState
import ai.kilocode.client.migration.ui.MigrationWizardPanel
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.FileAttachment
import ai.kilocode.client.session.model.SessionModelEvent
import ai.kilocode.client.session.model.SessionState
import ai.kilocode.client.session.scroll.SessionScroll
import ai.kilocode.client.session.subagent.SubagentSessionEditorKind
import ai.kilocode.client.session.subagent.SubagentTitleCache
import ai.kilocode.client.session.subagent.ensureSubagentSessionEditorKind
import ai.kilocode.client.session.subagent.subagentSessionParams
import ai.kilocode.client.session.ui.ConnectionPanel
import ai.kilocode.client.session.ui.empty.EmptySessionPanel
import ai.kilocode.client.session.ui.LoadingPanel
import ai.kilocode.client.session.ui.ReasoningPicker
import ai.kilocode.client.session.ui.RevertBanner
import ai.kilocode.client.session.ui.mode.ModePicker
import ai.kilocode.client.session.ui.model.ModelPicker
import ai.kilocode.client.session.ui.prompt.KiloPromptCompletionProvider
import ai.kilocode.client.session.ui.prompt.MentionAction
import ai.kilocode.client.session.ui.prompt.PromptPanel
import ai.kilocode.client.session.ui.prompt.SlashAction
import ai.kilocode.client.session.ui.prompt.mentionParts as promptMentionParts
import ai.kilocode.client.session.settings.ApprovalReasonVisibilityListener
import ai.kilocode.client.session.ui.account.SessionAccountOverlay
import ai.kilocode.client.session.ui.popup.HeaderPopupController
import ai.kilocode.client.session.ui.SessionDropOverlay
import ai.kilocode.client.session.ui.SessionRootPanel
import ai.kilocode.client.session.ui.SessionMessageListPanel
import ai.kilocode.client.session.ui.attachment.AttachmentEditorKind
import ai.kilocode.client.session.ui.attachment.attachmentParams
import ai.kilocode.client.session.ui.attachment.ensureAttachmentEditorKind
import ai.kilocode.client.session.ui.attachment.isEmbeddedAttachment
import ai.kilocode.client.agentManager.worktree.KiloWorktreeService
import ai.kilocode.client.session.ui.header.BranchDock
import ai.kilocode.client.session.ui.header.SessionHeaderPanel
import ai.kilocode.client.session.ui.selection.SessionContextMenu
import ai.kilocode.client.session.ui.selection.SessionHoverCopyOverlay
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionEditorStyleTarget
import ai.kilocode.client.ui.layout.HAlign
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.VAlign
import ai.kilocode.client.ui.layout.align
import ai.kilocode.client.session.controller.EVENT_FLUSH_MS
import ai.kilocode.client.session.controller.PromptSelection
import ai.kilocode.client.session.controller.SessionController
import ai.kilocode.client.session.controller.SessionControllerEvent
import ai.kilocode.client.session.context.EditorContextGatherer
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.LoginRequiredView
import ai.kilocode.client.session.views.SessionOutcomeView
import ai.kilocode.client.session.views.permission.PermissionView
import ai.kilocode.client.session.views.question.QuestionView
import ai.kilocode.client.settings.KiloSettingsConfigurable
import ai.kilocode.client.settings.profile.UserProfileConfigurable
import ai.kilocode.client.telemetry.Telemetry
import ai.kilocode.client.util.UiTimerSource
import ai.kilocode.client.util.UiTimers
import ai.kilocode.client.vfs.KiloVfsManager
import ai.kilocode.log.ChatLogSummary
import ai.kilocode.rpc.dto.ModelLimitDto
import ai.kilocode.rpc.dto.DiffFileDto
import ai.kilocode.rpc.dto.PromptDto
import ai.kilocode.rpc.dto.PromptPartDto
import ai.kilocode.rpc.dto.SessionRevertDto
import com.intellij.util.ui.JBUI
import ai.kilocode.log.KiloLog
import com.intellij.ide.BrowserUtil
import com.intellij.ide.TextCopyProvider
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.DataSink
import com.intellij.openapi.actionSystem.PlatformDataKeys
import com.intellij.openapi.actionSystem.UiDataProvider
import com.intellij.ide.ui.LafManagerListener
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.components.service
import com.intellij.openapi.editor.colors.EditorColorsListener
import com.intellij.openapi.editor.colors.EditorColorsManager
import com.intellij.openapi.options.Configurable
import com.intellij.openapi.options.ConfigurableWithId
import com.intellij.openapi.options.ShowSettingsUtil
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.registry.Registry
import com.intellij.openapi.wm.IdeFocusManager
import com.intellij.util.concurrency.annotations.RequiresEdt
import java.util.function.Predicate
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.awt.BorderLayout
import java.awt.event.HierarchyEvent
import java.net.URI
import java.nio.file.Path
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.SwingUtilities

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
    private val timers: UiTimerSource = UiTimers,
) : JPanel(BorderLayout()), Disposable, SessionEditorStyleTarget, UiDataProvider {

    companion object {
        private val LOG = KiloLog.create(SessionUi::class.java)
        private const val HIDE_MS = 120
    }

    private val project = project
    private val app = app
    private val sessions = sessions
    private val workspace = workspace
    private var opening = ref != null
    private var pending = false
    private var loaded: Boolean? = null
    private var revertPrompt: String? = null
    private var pendingRollback: String? = null
    private var pendingRedo: String? = null
    private val flushMs =
        Registry.intValue("kilo.session.flushMs", EVENT_FLUSH_MS.toInt())
            .takeIf { it > 0 }
            ?.toLong()
            ?: EVENT_FLUSH_MS

    private val controller = SessionController(
        parent = this,
        ref = ref,
        sessions = sessions,
        workspace = workspace,
        app = app,
        cs = cs,
        comp = this,
        flushMs = flushMs,
        condense = Registry.`is`("kilo.session.condense", true),
        displayMs = displayMs,
        open = { item -> manager?.openSession(item) },
        beforeUpdate = { if (opening) false else scroll.following() },
        afterUpdate = { if (!opening) scroll.followBottom(it) },
        loaded = ::onSessionLoaded,
        openProfileAction = ::openProfileSettings,
        timers = timers,
    )


    private lateinit var root: SessionRootPanel
    private lateinit var fileLinks: SessionFileLinks
    private lateinit var account: SessionAccountOverlay
    private lateinit var drop: SessionDropOverlay
    private lateinit var overlay: SessionHoverCopyOverlay
    private val hide = timers.timer(HIDE_MS, repeats = false) {
        if (disposed || !this::drop.isInitialized) return@timer
        drop.setActive(false)
    }

    private lateinit var sessionContent: JPanel

    private lateinit var blankBody: JPanel

    private lateinit var progressBody: JPanel

    private lateinit var messageBody: SessionMessageListPanel

    private lateinit var header: SessionHeaderPanel

    private var dock: BranchDock? = null

    private var bottom: JComponent? = null

    internal lateinit var scroll: SessionScroll

    private lateinit var question: QuestionView
    private lateinit var permission: PermissionView
    private lateinit var login: LoginRequiredView
    private lateinit var outcome: SessionOutcomeView
    private lateinit var connection: ConnectionPanel

    private lateinit var prompt: PromptPanel
    private lateinit var completion: KiloPromptCompletionProvider
    private lateinit var load: LoadingPanel
    private lateinit var migrationWizard: MigrationWizardPanel
    private var empty: EmptySessionPanel? = null
    private var modalFocus: (() -> JComponent)? = null
    private var style = SessionEditorStyle.current()
    private val selection = SessionSelection()
    private val popup = HeaderPopupController(timers)
    private val readonly: Boolean get() = manager?.readonly == true
    private val provider = object : TextCopyProvider() {
        override fun getActionUpdateThread() = ActionUpdateThread.EDT

        override fun getTextLinesToCopy(): Collection<String>? {
            val text = selection.selectedText()?.takeIf { it.isNotEmpty() } ?: return null
            return listOf(text)
        }
    }
    private var wasBusy = false
    // Kept separate so a background stat refresh (turn end / revert) can supersede another refresh
    // but never cancel an in-flight user-initiated open.
    private var refreshJob: Job? = null
    private var openJob: Job? = null
    private var branchJob: Job? = null
    private var disposed = false

    init {
        Disposer.register(this, popup)
        buildUi()
        Disposer.register(this, selection)
        applyStyle(style)
        scroll.show(body(controller.model.state))
        bindUi()
        bindStyle()
        bindMigration()
        onStateChanged(controller.model.state)
        dock?.let {
            syncDock()
            refreshBranchChanges()
            refreshBranch()
        }
        loaded?.let(::finishOpen)
    }

    override fun addNotify() {
        if (disposed) return
        super.addNotify()
        resumeOpen()
    }

    override fun doLayout() {
        super.doLayout()
        if (disposed) return
        resumeOpen()
    }

    internal val blank: Boolean get() = controller.blank

    internal val id: String? get() = controller.id

    internal val cacheKey: String? get() = controller.refKey

    internal fun currentStyle() = style

    override fun uiDataSnapshot(sink: DataSink) {
        sink[PlatformDataKeys.COPY_PROVIDER] = provider
    }

    @RequiresEdt
    internal fun activityKind(): SessionActivityKind? = when (val state = controller.model.state) {
        is SessionState.Idle,
        is SessionState.Loading,
        is SessionState.Busy,
        is SessionState.Reverting,
        is SessionState.Retry,
        is SessionState.Offline,
        is SessionState.Error,
        is SessionState.TurnEnded -> null
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
        if (readonly) return scroll.component
        return prompt.defaultFocusedComponent
    }

    internal val promptFocusedComponent: JComponent get() = if (readonly) scroll.component else prompt.defaultFocusedComponent

    /**
     * Sends [text] as the session's first message. Used by the New Worktree flow to auto-start a
     * session with the prompt typed in the dialog, routing through the same path as a typed prompt.
     * The optional [select] carries the mode / model / reasoning picked in the dialog so the first
     * turn runs with them even before this session's own model state has loaded.
     */
    @RequiresEdt
    internal fun submitPrompt(text: String, select: PromptSelection? = null) {
        if (readonly) return
        if (text.isBlank()) return
        // Seed the session's agent/model/reasoning so the pickers and later turns reflect the pick,
        // then send the first turn carrying it too (so it applies before workspace-ready resolves).
        select?.let { controller.applySelection(it) }
        sendPrompt(text, emptyList(), select)
    }

    @RequiresEdt
    internal fun focusPrompt() {
        val target = promptFocusedComponent
        ApplicationManager.getApplication().invokeLater({
            if (!disposed && !project.isDisposed) {
                IdeFocusManager.getInstance(project).requestFocusInProject(target, project)
            }
        }, ModalityState.defaultModalityState())
    }

    internal fun setModalContent(content: JComponent?, maxW: (() -> Int)? = null, focus: (() -> JComponent)? = null) {
        modalFocus = if (content == null) null else focus
        root.setModalContent(content, maxW)
    }

    private fun buildUi() {
        root = SessionRootPanel()
        // Containers stay transparent over the single self-rendered session root backdrop.
        fileLinks = SessionFileLinks(workspace.directory, workspaces, cs, root, ::openUrl)
        SessionContextMenu.install(root, this)

        migrationWizard = MigrationWizardPanel().apply {
            onSkip = { migration.skip() }
            onLater = { migration.later() }
            onDone = { migration.finish() }
            onContinueFromError = { migration.finish() }
            onStart = { sel -> migration.start(sel) }
        }

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

        sessionContent = JPanel(BorderLayout()).apply { isOpaque = false }

        blankBody = JPanel(BorderLayout()).apply { isOpaque = false }

        load = LoadingPanel()
        progressBody = load
        val focus = { manager?.focusPrompt() ?: focusPrompt() }
        val questionView = if (readonly) null else QuestionView(
            project = project,
            reply = { id, dto, opts -> controller.replyQuestion(id, dto, opts) },
            reject = { id -> controller.rejectQuestion(id) },
            follow = { scroll.following() },
            scroll = { scroll.followBottom(it) },
            selection = selection,
            focus = focus,
        ).also { question = it }
        val permissionView = if (readonly) null else PermissionView(
            reply = { id, dto, rules -> controller.replyPermission(id, dto, rules) },
            openFile = fileLinks::open,
            selection = selection,
            focus = focus,
        ).also { permission = it }
        val loginView = if (readonly) null else LoginRequiredView(
            openProfile = { controller.openProfile() },
            dismiss = { controller.dismissLoginRequired() },
            selection = selection,
            focus = focus,
        ).also { login = it }
        outcome = SessionOutcomeView(
            selection = selection,
            focus = focus,
            retry = if (readonly) null else controller::retry,
            retryable = controller::canRetry,
        )
        messageBody = SessionMessageListPanel(
            controller.model,
            this,
            questionView,
            permissionView,
            loginView,
            fileLinks::open,
            ::openUrl,
            selection,
            ::openAttachment,
            repo = workspace.directory,
            resize = { anchor, fn -> scroll.preserve(anchor, fn) },
            revert = if (readonly) null else ::revert,
            cancelRevert = if (readonly) null else ::cancelRevert,
            deleteQueued = if (readonly) null else { id -> controller.deleteQueuedMessage(id) },
            banner = if (readonly) null else RevertBanner(controller.model, ::redo, controller::redoAll, ::cancelRevert, focus),
            onOpenSubagent = ::openSubagent,
        ).also {
            it.outcome = outcome
            it.setDiffOpener(::openInlineDiff, controller.id)
            it.onHover = { view, on -> if (on) popup.show(view) else popup.notifyExit(view) }
        }
        header = SessionHeaderPanel(controller, this, readonly)
        if (!readonly && showBranchDock()) {
            val owner = manager
            val newWorktree = if (owner?.supportsNewWorktree == true) owner::newWorktree else null
            val move = if (owner?.supportsMoveToWorktree == true) ::moveToWorktree else null
            dock = BranchDock(openDiff = ::openBranchChanges, onMove = move, onNewWorktree = newWorktree)
        }

        scroll = SessionScroll(root, sessionContent, messageBody, blankBody)
        overlay = SessionHoverCopyOverlay(root, scroll.component, this)
        root.addOverlay(overlay) { pane, child ->
            overlay.bounds(pane, child)
        }
        messageBody.onReflow = { on -> if (on && !opening) scroll.followTail() }
        scroll.onScroll = {
            overlay.clear()
            popup.hideAll()
        }

        completion = KiloPromptCompletionProvider(
            workspace = workspace,
            service = workspaces,
            actions = slashActions(),
            mentions = mentionActions(),
            scope = cs,
        )
        prompt = PromptPanel(
            project = project,
            selection = selection,
            onSend = { text, files -> sendPrompt(text, files) },
            onAbort = { controller.abort() },
            onEnhance = controller::enhancePrompt,
            onMentions = ::mentionParts,
            completion = completion,
            cs = cs,
            hostedInEditorTab = manager?.hostedInEditorTab == true,
        )
        connection = ConnectionPanel(this, controller)
        // The banner reports a broken session, so it owns the pointer where it sits: the transcript
        // under it must not stay hovered and keep a popup open behind it.
        root.addOverlay(connection, blocks = true) { pane, child ->
            val size = child.preferredSize
            if (readonly) {
                val gap = SessionUiStyle.View.contentGap()
                return@addOverlay java.awt.Rectangle(
                    gap,
                    pane.height - size.height - gap,
                    (pane.width - gap * 2).coerceAtLeast(0),
                    size.height,
                )
            }
            val point = SwingUtilities.convertPoint(prompt.parent ?: root.content, prompt.x, prompt.y, pane)
            val gap = SessionUiStyle.View.contentGap()
            val wide = (prompt.width - gap * 2).coerceAtLeast(0)
            // Anchor above the whole bottom container (dock + prompt) so the banner floats over the
            // dock rather than covering it; fall back to the prompt when there is no dock.
            val anchor = bottom ?: prompt
            val topY = SwingUtilities.convertPoint(anchor.parent ?: root.content, anchor.x, anchor.y, pane).y
            // Fix the banner width before measuring so its word-wrapped detail height is known.
            child.setSize(wide, child.height)
            val height = child.preferredSize.height.coerceAtMost((topY - gap).coerceAtLeast(0))
            java.awt.Rectangle(
                point.x + gap,
                topY - height - gap,
                wide,
                height,
            )
        }

        drop = SessionDropOverlay()
        root.addOverlay(drop) { pane, _ ->
            java.awt.Rectangle(0, 0, pane.width, pane.height)
        }
        root.overlay.setComponentZOrder(drop, 0)
        if (!readonly) {
            prompt.onFileDrag = ::syncDrop
            prompt.installFileDrop(root, "session-root")
        }
        // The visual overlay returns contains(false) so normal UI remains clickable.
        // Registering it as a native DnD target makes IntelliJ resolve a null over-component.

        sessionContent.add(header, BorderLayout.NORTH)
        sessionContent.add(scroll.component, BorderLayout.CENTER)
        root.content.add(sessionContent, BorderLayout.CENTER)
        if (!readonly) {
            // In the sidebar tool window the bottom panel fills the full width; editor tabs keep the
            // readable-width centering used across the transcript.
            val aligned = if (manager?.hostedInEditorTab == true) {
                prompt.align(
                    HAlign.CENTER,
                    VAlign.FIT,
                    maxW = { SessionUiStyle.SessionLayout.readableWidth(prompt, style.transcriptFont) },
                )
            } else {
                prompt.align(HAlign.FIT, VAlign.FIT)
            }
            val container = Stack.vertical()
            dock?.let { container.next(it) }
            container.next(aligned)
            bottom = container
            root.content.add(container, BorderLayout.SOUTH)
        }
        add(root, BorderLayout.CENTER)
    }

    private fun bindUi() {
        if (!readonly) {
            prompt.mode.onSelect = { item -> controller.selectAgent(item.id) }
            prompt.model.onSelect = { item ->
                prompt.setAttachmentEnabled(item.attachment)
                controller.selectModel(item.provider, item.id)
            }
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
        }

        controller.addListener(this) { event ->
            when (event) {
                is SessionControllerEvent.WorkspaceReady -> {
                    if (readonly) return@addListener
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
                            id = it.id,
                            display = it.display,
                            provider = it.provider,
                            providerName = it.providerName,
                            inputPrice = it.inputPrice,
                            outputPrice = it.outputPrice,
                            contextLength = it.contextLength,
                            releaseDate = it.releaseDate,
                            latest = it.latest,
                            recommendedIndex = it.recommendedIndex,
                            free = it.free,
                            byok = it.byok,
                            variants = it.variants,
                            limit = it.limit?.let { limit -> ModelLimitDto(limit.context, limit.input, limit.output) },
                            cost = it.cost,
                            capabilities = it.capabilities,
                            options = it.options,
                            autoRouting = it.autoRouting,
                            terminalBench = it.terminalBench,
                            reasoning = it.reasoning,
                            attachment = it.attachment,
                            mayTrainOnYourPrompts = it.mayTrainOnYourPrompts,
                        )
                    }
                    val selected =
                        m.model?.let { full -> items.firstOrNull { it.key == full }?.key }
                    prompt.model.setItems(items, selected)
                    prompt.setAttachmentEnabled(items.firstOrNull { it.key == selected }?.attachment ?: true)
                    prompt.reasoning.setItems(m.variants.map { ReasoningPicker.Item(it, variantTitle(it)) }, m.variant)
                    prompt.setResetVisible(m.modelOverride)
                    prompt.setReady(m.isReady())
                    prompt.refreshHighlights()
                }

                is SessionControllerEvent.ViewChanged.ShowProgress -> {
                    empty = null
                    scroll.show(progressBody)
                }

                is SessionControllerEvent.ViewChanged.ShowEmpty -> {
                    val panel = manager?.emptyPanel(this, controller)
                        ?: EmptySessionPanel(this, controller, controller.recents(), timers = timers)
                    empty = panel
                    scroll.show(panel.view)
                }

                is SessionControllerEvent.ViewChanged.ShowSession -> {
                    empty = null
                    scroll.show(body(controller.model.state))
                }

                is SessionControllerEvent.AppChanged -> {
                    if (readonly) return@addListener
                    prompt.setReady(controller.model.isReady())
                }

                is SessionControllerEvent.WorkspaceChanged -> {
                    if (readonly) return@addListener
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

                is SessionModelEvent.RevertChanged -> onRevertChanged(event.revert)

                is SessionModelEvent.MessageAdded,
                is SessionModelEvent.MessageRemoved,
                is SessionModelEvent.HistoryLoaded,
                is SessionModelEvent.Cleared -> syncDock()

                is SessionModelEvent.QueueChanged -> Unit

                is SessionModelEvent.TurnAdded,
                is SessionModelEvent.TurnUpdated,
                is SessionModelEvent.ContentAdded,
                is SessionModelEvent.ContentDelta,
                is SessionModelEvent.TurnRemoved,
                is SessionModelEvent.MessageUpdated,
                is SessionModelEvent.ContentUpdated,
                is SessionModelEvent.ContentRemoved,
                is SessionModelEvent.DiffUpdated,
                is SessionModelEvent.TodosUpdated,
                is SessionModelEvent.HeaderUpdated,
                is SessionModelEvent.Compacted -> Unit
            }
        }
    }

    @RequiresEdt
    private fun syncDock() {
        val dock = dock ?: return
        dock.setHasMessages(controller.model.messages().isNotEmpty())
        dock.setHasSession(controller.id != null)
    }

    @RequiresEdt
    private fun syncDrop(value: Boolean) {
        if (disposed) return
        if (value) {
            hide.stop()
            drop.setActive(true)
            return
        }
        hide.restart()
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
                migrationWizard.update(state)
                setModalContent(
                    migrationWizard,
                    maxW = { SessionUiStyle.SessionLayout.readableWidth(root, style.transcriptFont) },
                ) { migrationWizard.preferredFocusComponent() }
                migrationWizard.revalidate()
                migrationWizard.repaint()
            }
        }
    }

    private fun bindStyle() {
        addHierarchyListener { event ->
            if ((event.changeFlags and HierarchyEvent.SHOWING_CHANGED.toLong()) == 0L) return@addHierarchyListener
            if (isShowing) refreshBranch() else popup.hideAll()
        }

        val bus = ApplicationManager.getApplication().messageBus.connect(this)
        bus.subscribe(EditorColorsManager.TOPIC, EditorColorsListener {
            ApplicationManager.getApplication().invokeLater {
                if (disposed) return@invokeLater
                applyStyle(SessionEditorStyle.current())
            }
        })
        bus.subscribe(LafManagerListener.TOPIC, LafManagerListener {
            ApplicationManager.getApplication().invokeLater {
                if (disposed) return@invokeLater
                applyStyle(SessionEditorStyle.current())
            }
        })
        bus.subscribe(ApprovalReasonVisibilityListener.TOPIC, ApprovalReasonVisibilityListener { visible ->
            ApplicationManager.getApplication().invokeLater {
                if (disposed) return@invokeLater
                if (!this::messageBody.isInitialized) return@invokeLater
                messageBody.syncApprovalReasons(visible)
            }
        })
    }

    private fun onSessionLoaded(show: Boolean) {
        loaded = show
        if (!this::scroll.isInitialized) return
        finishOpen(show)
    }

    private fun body(state: SessionState): JPanel {
        if (controller.model.showSession) return messageBody
        if (state is SessionState.Retry || state is SessionState.Offline) return progressBody
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
        if (body(controller.model.state) !== messageBody) return
        pending = false
        messageBody.reflow()
        scroll.openBottom {
            opening = false
        }
    }

    private fun sendPrompt(text: String, files: List<PromptPartDto>, select: PromptSelection? = null) {
        if (readonly) return
        if (text.isBlank() && files.isEmpty()) return
        prompt.clear()
        val follow = scroll.following()
        val action = completion.clientAction(text)
        if (action != null) {
            action.action()
            scroll.followBottom(follow)
            return
        }
        val command = completion.serverCommand(text)
        if (command != null) {
            controller.command(command.first, command.second, files)
            scroll.followBottom(follow)
            return
        }
        // Only the prompt path uses editor context; gather after the command branches so slash
        // commands and client actions don't pay the editor-context cost or hit its failure modes.
        val editor = EditorContextGatherer.gather(project, workspace.directory)
        val allFiles = files + listOfNotNull(editor.selection)
        LOG.debug {
            val parts = buildList {
                text.takeIf { it.isNotBlank() }?.let { add(PromptPartDto(type = "text", text = it)) }
                addAll(allFiles)
            }
            val agent = controller.model.agent ?: "none"
            val model = controller.model.model ?: "none"
            "${ChatLogSummary.prompt(PromptDto(parts = parts, editorContext = editor.context))} agent=$agent model=$model ready=${controller.ready}"
        }
        controller.prompt(text, allFiles, editor.context, select)
        scroll.followBottom(follow)
    }

    @RequiresEdt
    private fun revert(id: String) {
        pendingRollback = id
        pendingRedo = null
        controller.revert(id)
    }

    @RequiresEdt
    private fun redo() {
        pendingRedo = controller.model.revert()?.messageID
        pendingRollback = null
        controller.redo()
    }

    @RequiresEdt
    private fun cancelRevert() {
        pendingRollback = null
        pendingRedo = null
        controller.cancelRevert()
    }

    @RequiresEdt
    private fun onRevertChanged(revert: SessionRevertDto?) {
        refreshBranchChanges()
        syncPromptRevert()
        val rollback = pendingRollback
        if (rollback != null) {
            if (revert?.messageID == rollback) {
                pendingRollback = null
                scroll.followBottom(true)
                return
            }
            pendingRollback = null
        }
        val redo = pendingRedo
        if (redo == null) return
        if (!controller.model.isRevertedMessage(redo)) {
            pendingRedo = null
            scroll.scrollMessageBottom(redo)
            return
        }
        if (revert != null) pendingRedo = null
    }

    @RequiresEdt
    private fun syncPromptRevert() {
        val saved = revertPrompt
        if (saved != null && (prompt.text() != saved || prompt.hasAttachments())) {
            revertPrompt = null
            return
        }
        if (saved == null && prompt.hasDraft()) return
        val mark = controller.model.revert()
        if (mark == null) {
            prompt.clear()
            revertPrompt = null
            return
        }
        val msg = controller.model.message(mark.messageID) ?: return
        val text = msg.parts.values.filterIsInstance<ai.kilocode.client.session.model.Text>().firstOrNull()?.content?.toString() ?: return
        prompt.setText(text)
        revertPrompt = prompt.text()
    }

    private fun slashActions(): List<SlashAction> {
        val fns: Map<SlashAction.Spec, () -> Unit> = mapOf(
            SlashAction.NEW to { manager?.newSession() },
            SlashAction.SESSIONS to { manager?.showHistory() },
            SlashAction.MODELS to { prompt.model.open() },
            SlashAction.AGENTS to { prompt.mode.open() },
            SlashAction.VARIANT to { prompt.reasoning.open() },
            SlashAction.COMPACT to { controller.compact() },
            SlashAction.SETTINGS to { openKiloSettings() },
            SlashAction.HELP to { BrowserUtil.browse("https://kilo.ai/docs") },
        )
        return SlashAction.ALL.map { spec -> bind(spec, fns.getValue(spec)) }
    }

    private fun bind(spec: SlashAction.Spec, action: () -> Unit) = SlashAction(
        spec.name,
        KiloBundle.message(spec.descriptionKey),
        spec.hints,
        {
            Telemetry.send("Slash Command Used", mapOf("slashCommandType" to "client", "command" to spec.name))
            action()
        },
    )

    private fun mentionActions(): List<MentionAction> = MentionAction.ALL.map(::bind)

    private fun bind(spec: MentionAction.Spec) = MentionAction(
        spec.name,
        KiloBundle.message(spec.descriptionKey),
        spec.hints,
        spec.available,
    )

    private suspend fun mentionParts(text: String): List<PromptPartDto> {
        val names = MentionAction.ALL.mapTo(mutableSetOf()) { it.name }
        return promptMentionParts(
            text = text,
            directory = workspace.directory,
            reserved = names,
            resolve = { path -> workspaces.files(workspace.directory, path).isNotEmpty() },
            gitChanges = { workspaces.gitChanges(workspace.directory) },
        )
    }

    private fun openUrl(url: String) {
        BrowserUtil.browse(url)
    }

    private fun openInlineDiff(files: List<DiffFileDto>, title: String, key: String) {
        val dir = controller.sessionDirectory
        cs.launch {
            val branch = workspaces.branchName(dir)
            val label = branch?.let { KiloBundle.message("diff.editor.inline.title.named", title, it) } ?: title
            LOG.info("open inline diff session=${controller.id ?: "pending"} dir=${ChatLogSummary.dir(dir)} files=${files.size}")
            withContext(Dispatchers.Main) {
                ensureDiffEditorKind()
                project.service<KiloInlineDiffStore>().put(key, files)
                project.service<KiloVfsManager>().open(
                    KiloDiffEditorKind.ID,
                    diffParams("inline", dir, controller.id, label, token = key),
                )
                Telemetry.send("Diff Editor Opened", mapOf("source" to "inline"))
            }
        }
    }

    @RequiresEdt
    private fun openSubagent(sessionId: String, title: String) {
        service<SubagentTitleCache>().put(sessionId, title)
        ensureSubagentSessionEditorKind()
        project.service<KiloVfsManager>().open(
            SubagentSessionEditorKind.ID,
            subagentSessionParams(sessionId, workspace.directory),
        )
        Telemetry.send("Subagent Session Opened", mapOf("sessionId" to sessionId))
    }

    /** Badge-only refresh: fetches stats (no patch text) and updates the dock's changes badge. */
    private fun refreshBranchChanges() {
        val dock = dock ?: return
        refreshJob?.cancel()
        refreshJob = cs.launch {
            val files = runCatching { workspaces.branchDiff(workspace.directory, patches = false) }
                .getOrElse {
                    if (it is CancellationException) throw it
                    LOG.warn("branch changes badge refresh failed dir=${workspace.directory}", it)
                    return@launch
                }
            withContext(Dispatchers.Main) {
                if (disposed || project.isDisposed) return@withContext
                dock.setChanges(files)
            }
        }
    }

    /** User clicked the badge: opens the branch diff editor. Never cancelled by a background refresh. */
    private fun openBranchChanges() {
        val dock = dock ?: return
        openJob?.cancel()
        openJob = cs.launch {
            val dir = workspace.directory
            val branch = workspaces.branchName(dir)
            val files = runCatching { workspaces.branchDiff(dir, patches = false) }
                .getOrElse {
                    if (it is CancellationException) throw it
                    LOG.warn("branch changes open failed dir=$dir", it)
                    emptyList()
                }
            withContext(Dispatchers.Main) {
                if (disposed || project.isDisposed) return@withContext
                dock.setChanges(files)
                openBranchDiff(branch)
            }
        }
    }

    /** Starts the Move to Worktree flow for the current session through the side-panel manager. */
    @RequiresEdt
    private fun moveToWorktree() {
        manager?.moveToWorktree(controller.id, controller.sessionDirectory)
    }

    @RequiresEdt
    private fun openBranchDiff(branch: String?) {
        // No store seeding: the diff editor's fetch recomputes branchDiff authoritatively, so a
        // re-open or Refresh always reflects the current worktree (and nothing is retained for its life).
        ensureDiffEditorKind()
        val dir = workspace.directory
        val title = branch?.let { KiloBundle.message("diff.editor.branch.title.named", it) }
            ?: KiloBundle.message("diff.editor.branch.title")
        project.service<KiloVfsManager>().open(
            KiloDiffEditorKind.ID,
            diffParams("branch", dir, null, title, branch),
        )
        Telemetry.send("Diff Editor Opened", mapOf("source" to "branch"))
    }

    private fun showBranchDock(): Boolean = manager?.showsBranchDock != false

    /**
     * Refreshes the branch/PR status feeding the dock. Uses the session's own [workspace] directory
     * (the resolved backend path) — not `project.basePath`, which is a synthetic frontend path in
     * split mode — so the PR always matches the branch checked out in this session's directory.
     */
    private fun refreshBranch() {
        val dock = dock ?: return
        branchJob?.cancel()
        branchJob = cs.launch {
            val status = runCatching { service<KiloWorktreeService>().branchStatus(workspace.directory) }
                .getOrElse {
                    if (it is CancellationException) throw it
                    LOG.warn("branch status refresh failed dir=${workspace.directory}", it)
                    return@launch
                }
            withContext(Dispatchers.Main) {
                if (disposed || project.isDisposed) return@withContext
                dock.setBranch(status)
            }
        }
    }

    private fun openAttachment(messageId: String, item: FileAttachment) {
        val url = item.url.takeIf { it.isNotBlank() } ?: run {
            LOG.info("kind=attachment-open skipped=true reason=blank-url message=$messageId part=${item.id} name=${attachmentName(item)} mime=${item.mime}")
            return
        }
        LOG.info(
            "kind=attachment-open session=${controller.id ?: "none"} message=$messageId part=${item.id} " +
                "name=${attachmentName(item)} mime=${item.mime} url=${attachmentUrl(url)} dir=${workspace.directory}"
        )
        if (isEmbeddedAttachment(url)) {
            val id = controller.id ?: run {
                LOG.info("kind=attachment-open skipped=true reason=missing-session message=$messageId part=${item.id} name=${attachmentName(item)}")
                return
            }
            LOG.info("kind=attachment-open route=kilo-vfs session=$id message=$messageId part=${item.id} name=${attachmentName(item)}")
            ensureAttachmentEditorKind()
            project.service<KiloVfsManager>().open(
                AttachmentEditorKind.ID,
                attachmentParams(id, messageId, item, attachmentName(item), workspace.directory),
            )
            return
        }
        val uri = runCatching { URI.create(url) }.getOrNull() ?: run {
            LOG.info("kind=attachment-open skipped=true reason=invalid-uri message=$messageId part=${item.id} url=${attachmentUrl(url)}")
            return
        }
        if (uri.scheme == "file") {
            val path = runCatching { Path.of(cleanAttachmentUri(uri)).toString() }.getOrNull() ?: run {
                LOG.info("kind=attachment-open skipped=true reason=invalid-file-uri message=$messageId part=${item.id} url=${attachmentUrl(url)}")
                return
            }
            val target = attachmentHref(path, item)
            LOG.info("kind=attachment-open route=file session=${controller.id ?: "none"} message=$messageId part=${item.id} path=$target")
            fileLinks.open(target, null)
            return
        }
        LOG.info("kind=attachment-open route=browser session=${controller.id ?: "none"} message=$messageId part=${item.id} url=${attachmentUrl(url)}")
        openUrl(url)
    }

    private fun attachmentName(item: FileAttachment) = item.filename?.takeIf { it.isNotBlank() }
        ?: item.url.substringBefore(',').substringAfterLast('/').takeIf { it.isNotBlank() }
        ?: "attachment"

    private fun attachmentHref(path: String, item: FileAttachment): String {
        val start = item.startLine ?: return path
        val end = item.endLine ?: start
        return "$path:$start-$end"
    }

    private fun cleanAttachmentUri(uri: URI): URI = URI(uri.scheme, uri.authority, uri.path, null, null)

    private fun attachmentUrl(url: String): String {
        val scheme = url.substringBefore(':', missingDelimiterValue = "none")
        return "scheme=$scheme chars=${url.length} embedded=${isEmbeddedAttachment(url)}"
    }

    private fun onStateChanged(state: SessionState) {
        if (disposed) return
        val busy = state.isBusy()
        if (wasBusy && state is SessionState.Idle) {
            refreshBranchChanges()
            refreshBranch()
        }
        wasBusy = busy
        if (state is SessionState.Reverting) overlay.clear()
        if (state is SessionState.Error || state is SessionState.TurnEnded) {
            pendingRollback = null
            pendingRedo = null
        }
        prompt.setBusy(busy)
        dock?.setBusy(busy)
        load.setState(state)
        scroll.setQuestionPending(questionPending(state))
        scroll.show(body(state))
        manager?.activityChanged()
        refresh()
    }

    private fun onSessionUpdated() {
        syncDock()
        manager?.activityChanged()
    }

    private fun refresh() {
        if (disposed) return
        scroll.refresh()
        root.revalidate()
        root.repaint()
    }

    override fun applyStyle(style: SessionEditorStyle) {
        if (disposed) return
        this.style = style
        selection.applyStyle(style)
        load.applyStyle(style)
        header.applyStyle(style)
        dock?.applyStyle(style)
        prompt.applyStyle(style)
        connection.applyStyle(style)
        scroll.applyStyle(style)
        empty?.applyStyle(style)
        refresh()
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

    private fun openKiloSettings() {
        ShowSettingsUtil.getInstance().showSettingsDialog(
            project,
            Predicate { cfg: Configurable ->
                cfg is ConfigurableWithId && cfg.getId() == KiloSettingsConfigurable.ID
            },
            { _: Configurable -> },
        )
    }

    override fun dispose() {
        disposed = true
        refreshJob?.cancel()
        openJob?.cancel()
        branchJob?.cancel()
        hide.stop()
        popup.hideAll()
        modalFocus = null
        empty = null
        if (this::root.isInitialized) root.setModalContent(null)
        removeAll()
    }
}

private fun variantTitle(value: String): String = value.replaceFirstChar { it.titlecase() }

private fun questionPending(state: SessionState): Boolean {
    if (state !is SessionState.AwaitingQuestion) return false
    return state.question.items.none { it.planFollowup() }
}

private fun ai.kilocode.client.session.model.QuestionItem.planFollowup() =
    questionKey == "plan.followup.question" || headerKey == "plan.followup.header"
