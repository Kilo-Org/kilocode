package ai.kilocode.client.session

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.migration.KiloMigrationService
import ai.kilocode.client.migration.MigrationUiController
import ai.kilocode.client.migration.MigrationUiState
import ai.kilocode.client.migration.ui.MigrationOverlayPanel
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.FileAttachment
import ai.kilocode.client.session.model.SessionModelEvent
import ai.kilocode.client.session.model.SessionState
import ai.kilocode.client.session.scroll.SessionScroll
import ai.kilocode.client.session.ui.ConnectionPanel
import ai.kilocode.client.session.ui.empty.EmptySessionPanel
import ai.kilocode.client.session.ui.LoadingPanel
import ai.kilocode.client.session.ui.ReasoningPicker
import ai.kilocode.client.session.ui.mode.ModePicker
import ai.kilocode.client.session.ui.model.ModelPicker
import ai.kilocode.client.session.ui.prompt.KiloPromptCompletionProvider
import ai.kilocode.client.session.ui.prompt.MentionAction
import ai.kilocode.client.session.ui.prompt.PromptPanel
import ai.kilocode.client.session.ui.prompt.SlashAction
import ai.kilocode.client.session.ui.prompt.mentionParts as promptMentionParts
import ai.kilocode.client.session.ui.account.SessionAccountOverlay
import ai.kilocode.client.session.ui.popup.HeaderPopupController
import ai.kilocode.client.session.ui.SessionDropOverlay
import ai.kilocode.client.session.ui.SessionRootPanel
import ai.kilocode.client.session.ui.SessionMessageListPanel
import ai.kilocode.client.session.ui.attachment.AttachmentEditorKind
import ai.kilocode.client.session.ui.attachment.attachmentParams
import ai.kilocode.client.session.ui.attachment.ensureAttachmentEditorKind
import ai.kilocode.client.session.ui.attachment.isEmbeddedAttachment
import ai.kilocode.client.session.ui.header.SessionHeaderPanel
import ai.kilocode.client.session.ui.selection.SessionContextMenu
import ai.kilocode.client.session.ui.selection.SessionHoverCopyOverlay
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionEditorStyleTarget
import ai.kilocode.client.session.controller.EVENT_FLUSH_MS
import ai.kilocode.client.session.controller.SessionController
import ai.kilocode.client.session.controller.SessionControllerEvent
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.LoginRequiredView
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
import ai.kilocode.rpc.dto.PromptDto
import ai.kilocode.rpc.dto.PromptPartDto
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
import java.net.URI
import java.nio.file.Path
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.SwingUtilities
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
        beforeUpdate = { if (opening) false else scroll.atBottom() },
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

    internal lateinit var scroll: SessionScroll

    private lateinit var question: QuestionView
    private lateinit var permission: PermissionView
    private lateinit var login: LoginRequiredView
    private lateinit var connection: ConnectionPanel

    private lateinit var prompt: PromptPanel
    private lateinit var completion: KiloPromptCompletionProvider
    private lateinit var load: LoadingPanel
    private lateinit var migrationOverlay: MigrationOverlayPanel
    private var empty: EmptySessionPanel? = null
    private var modalFocus: (() -> JComponent)? = null
    private var style = SessionEditorStyle.current()
    private val selection = SessionSelection()
    private val popup = HeaderPopupController(timers)
    private val provider = object : TextCopyProvider() {
        override fun getActionUpdateThread() = ActionUpdateThread.EDT

        override fun getTextLinesToCopy(): Collection<String>? {
            val text = selection.selectedText()?.takeIf { it.isNotEmpty() } ?: return null
            return listOf(text)
        }
    }
    private var editorTheme = style.editorScheme
    private var colorTheme = UIManager.getLookAndFeel()
    private var disposed = false

    init {
        Disposer.register(this, popup)
        buildUi()
        Disposer.register(this, selection)
        scroll.show(body(controller.model.state))
        bindUi()
        bindStyle()
        bindMigration()
        applyStyle(style)
        onStateChanged(controller.model.state)
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
        fileLinks = SessionFileLinks(workspace.directory, workspaces, cs, root, ::openUrl)
        SessionContextMenu.install(root, this)

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

        overlay = SessionHoverCopyOverlay(root, this)
        root.addOverlay(overlay) { pane, child ->
            overlay.bounds(pane, child)
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
            selection = selection,
        )
        permission = PermissionView(
            reply = { id, dto -> controller.replyPermission(id, dto) },
            selection = selection,
        )
        login = LoginRequiredView(
            openProfile = { controller.openProfile() },
            dismiss = { controller.dismissLoginRequired() },
            selection = selection,
        )
        messageBody = SessionMessageListPanel(
            controller.model,
            this,
            question,
            permission,
            login,
            fileLinks::open,
            ::openUrl,
            selection,
            ::openAttachment,
            repo = workspace.directory,
            resize = { anchor, fn -> scroll.preserve(anchor, fn) },
        ).also {
            it.onHover = { view, on -> if (on) popup.show(view) else popup.notifyExit(view) }
        }
        header = SessionHeaderPanel(controller, this)

        scroll = SessionScroll(root, sessionContent, messageBody, blankBody)
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
        )
        connection = ConnectionPanel(this, controller)
        root.addOverlay(connection) { pane, child ->
            val size = child.preferredSize
            val point = SwingUtilities.convertPoint(prompt.parent ?: root.content, prompt.x, prompt.y, pane)
            val overlap = SessionUiStyle.View.Outline.width()
            java.awt.Rectangle(
                point.x,
                point.y - size.height - overlap,
                prompt.width,
                size.height,
            )
        }

        drop = SessionDropOverlay()
        root.addOverlay(drop) { pane, _ ->
            java.awt.Rectangle(0, 0, pane.width, pane.height)
        }
        root.overlay.setComponentZOrder(drop, 0)
        prompt.onFileDrag = ::syncDrop
        prompt.installFileDrop(root, "session-root")
        // The visual overlay returns contains(false) so normal UI remains clickable.
        // Registering it as a native DnD target makes IntelliJ resolve a null over-component.

        sessionContent.add(header, BorderLayout.NORTH)
        sessionContent.add(scroll.component, BorderLayout.CENTER)
        root.content.add(sessionContent, BorderLayout.CENTER)
        root.content.add(prompt, BorderLayout.SOUTH)
        add(root, BorderLayout.CENTER)
    }

    private fun bindUi() {
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

                is SessionControllerEvent.ViewChanged.ShowRecents -> {
                    val panel = EmptySessionPanel(
                        this,
                        controller,
                        event.recents,
                        history = { manager?.showHistory() },
                        activity = { manager?.activity() ?: sessions.activity() },
                        titles = { manager?.titles().orEmpty() },
                        timers = timers,
                    )
                    empty = panel
                    scroll.show(panel.view)
                }

                is SessionControllerEvent.ViewChanged.ShowSession -> {
                    empty = null
                    scroll.show(body(controller.model.state))
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
            if (!isShowing) {
                popup.hideAll()
                return@addHierarchyListener
            }
            applyStyleIfThemeChanged()
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
        if (body(controller.model.state) !== messageBody) return
        pending = false
        scroll.openBottom {
            opening = false
        }
    }

    private fun sendPrompt(text: String, files: List<PromptPartDto>) {
        if (text.isBlank() && files.isEmpty()) return
        val parts = buildList {
            text.takeIf { it.isNotBlank() }?.let { add(PromptPartDto(type = "text", text = it)) }
            addAll(files)
        }
        LOG.debug {
            val agent = controller.model.agent ?: "none"
            val model = controller.model.model ?: "none"
            "${ChatLogSummary.prompt(PromptDto(parts = parts))} agent=$agent model=$model ready=${controller.ready}"
        }
        prompt.clear()
        val follow = scroll.atBottom()
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
        controller.prompt(text, files)
        scroll.followBottom(follow)
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
            val path = runCatching { Path.of(uri).toString() }.getOrNull() ?: run {
                LOG.info("kind=attachment-open skipped=true reason=invalid-file-uri message=$messageId part=${item.id} url=${attachmentUrl(url)}")
                return
            }
            LOG.info("kind=attachment-open route=file session=${controller.id ?: "none"} message=$messageId part=${item.id} path=$path")
            fileLinks.open(path, null)
            return
        }
        LOG.info("kind=attachment-open route=browser session=${controller.id ?: "none"} message=$messageId part=${item.id} url=${attachmentUrl(url)}")
        openUrl(url)
    }

    private fun attachmentName(item: FileAttachment) = item.filename?.takeIf { it.isNotBlank() }
        ?: item.url.substringBefore(',').substringAfterLast('/').takeIf { it.isNotBlank() }
        ?: "attachment"

    private fun attachmentUrl(url: String): String {
        val scheme = url.substringBefore(':', missingDelimiterValue = "none")
        return "scheme=$scheme chars=${url.length} embedded=${isEmbeddedAttachment(url)}"
    }

    private fun onStateChanged(state: SessionState) {
        if (disposed) return
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
        if (disposed) return
        scroll.refresh()
        root.revalidate()
        root.repaint()
    }

    override fun applyStyle(style: SessionEditorStyle) {
        if (disposed) return
        this.style = style
        selection.applyStyle(style)
        editorTheme = style.editorScheme
        colorTheme = UIManager.getLookAndFeel()
        background = style.editorBackground
        root.content.background = style.editorBackground
        sessionContent.background = style.editorBackground
        blankBody.background = style.editorBackground
        load.applyStyle(style)
        header.applyStyle(style)
        prompt.applyStyle(style)
        connection.applyStyle(style)
        scroll.applyStyle(style)
        refresh()
    }

    private fun applyStyleIfThemeChanged() {
        if (disposed) return
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
