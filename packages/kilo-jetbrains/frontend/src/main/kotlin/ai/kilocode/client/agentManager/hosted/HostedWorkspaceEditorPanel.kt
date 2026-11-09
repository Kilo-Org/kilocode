package ai.kilocode.client.agentManager.hosted

import ai.kilocode.client.KiloNotifications
import ai.kilocode.client.app.KiloHostedService
import ai.kilocode.client.app.HostedReadiness
import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.agentManager.WorkspaceSessionEditorPanel
import ai.kilocode.client.agentManager.WorkspaceSessionHeader
import ai.kilocode.client.agentManager.worktree.WorktreeEditorMatchers
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionHost
import ai.kilocode.client.session.SessionRef
import ai.kilocode.client.session.SessionManager
import ai.kilocode.client.session.history.HostedHistoryItem
import ai.kilocode.client.session.history.HistoryTime
import ai.kilocode.client.ui.active.ActiveBadgeCell
import ai.kilocode.client.ui.layout.HAlign
import ai.kilocode.client.ui.layout.VAlign
import ai.kilocode.client.ui.layout.align
import ai.kilocode.client.ui.active.ActiveSelection
import ai.kilocode.client.vfs.KiloVfsManager
import ai.kilocode.rpc.dto.HostedAgentDto
import ai.kilocode.rpc.dto.HostedStartSessionDto
import ai.kilocode.rpc.dto.HostedWorkspaceDto
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import ai.kilocode.rpc.dto.HostedWorkspaceSessionDto
import ai.kilocode.rpc.dto.SessionActivityDto
import ai.kilocode.rpc.dto.SessionActivityKindDto
import com.intellij.icons.AllIcons
import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.DataSink
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.actionSystem.UiDataProvider
import com.intellij.openapi.components.service
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.ui.components.JBLabel
import com.intellij.ui.awt.RelativePoint
import com.intellij.util.concurrency.annotations.RequiresEdt
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.awt.Component
import java.awt.Point

/**
 * Cloud workspace editor: the workspace's root sessions on the left, the ordinary
 * [ai.kilocode.client.session.SessionUi] on
 * the right, using the same editor chrome and rows as a local worktree. Only backend capabilities
 * differ: Cloud has no local create/delete/rename/fork controls.
 */
internal fun hostedIdle(
    previous: Map<String, SessionActivityDto>,
    next: Map<String, SessionActivityDto>,
    workspace: String,
    sessions: List<HostedWorkspaceSessionDto>,
): Boolean = previous.keys.any { key ->
    previous[key]?.kind == SessionActivityKindDto.RUNNING && !next.containsKey(key) &&
        (key.contains(workspace) || sessions.any { it.nativeSessionID == key })
}

class HostedWorkspaceEditorPanel @RequiresEdt constructor(
    parent: Disposable,
    private val project: Project,
    private val ref: HostedWorkspaceRefDto,
    name: String?,
    branch: String? = null,
) : WorkspaceSessionEditorPanel(parent), UiDataProvider {
    private val hosted = project.service<KiloHostedService>()
    private val management = project.service<HostedManagementService>()
    private val cs = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val empty = JBLabel(KiloBundle.message("hosted.workspace.empty"))
    private val header = WorkspaceSessionHeader()
    private val compute = ActiveBadgeCell()
    private val price = JBLabel().apply { isVisible = false }
    private val newSession = NewSessionAction()
    private val delete = DeleteAction()
    private val workspace = hostedWorkspaceRoot(project)
    private val manager = HostedWorkspaceEditorManager(
        parent = this,
        project = project,
        workspace = workspace,
    )

    private var dto = HostedWorkspaceDto(ref, name = name, branch = branch)
    private var sessions: List<HostedWorkspaceSessionDto> = emptyList()
    private var observation: Disposable? = null
    private var selected: String? = null
    private var started = false
    private var loadGeneration = 0L
    private var titleRefresh: Job? = null
    private var identity: String? = null
    private var signedOut = false

    init {
        project.service<WorktreeEditorMatchers>().register(HostedWorkspaceEditorMatcher)
        compute.update(HostedWorkspaceStatus.LOADING.badge())
        header.addAction(compute)
        header.addAction(price)
        header.update(null, null, HostedWorkspaceTitle.text(dto.name, dto.branch, ref.workspaceID))
        initialize(
            content = manager.component,
            header = header,
            actions = DefaultActionGroup(newSession, delete),
            open = { row, focus -> sessions.firstOrNull { it.id == row.key }?.let { open(it, focus) } },
        )
        visibility(
            load = { done -> done(management.listVisible(ref)) },
            save = { value -> management.saveListVisible(ref, value) },
        )
        // First paint has no transcript yet; keep the hint centred instead of tucked in a corner.
        manager.component.addToCenter(empty.align(HAlign.CENTER, VAlign.CENTER))
        manager.onPresent = { key -> key?.let { list.select(it) } }
        manager.onListChanged = { if (started) sync(select = false) }
        manager.onNewSession = { newHostedSession() }
        manager.onDeleteWorkspace = { deleteWorkspace() }
        cs.launch {
            management.preferences.collect {
                withContext(Dispatchers.Main) {
                    if (started && !Disposer.isDisposed(this@HostedWorkspaceEditorPanel)) sync(select = false)
                }
            }
        }
        cs.launch {
            hosted.state.collect { state ->
                withContext(Dispatchers.Main) {
                    if (Disposer.isDisposed(this@HostedWorkspaceEditorPanel)) return@withContext
                    if (state.signedOut || !hosted.enabled()) {
                        // The reset is authoritative only when entering the signed-out surface; a
                        // later signed-in refresh publishes intermediate states that still carry
                        // signedOut=true and must not invalidate the reload it started.
                        if (!signedOut) {
                            signedOut = true
                            loadGeneration++
                        }
                        observation?.let(Disposer::dispose)
                        observation = null
                        selected = null
                        sessions = emptyList()
                        manager.clearPresentation()
                        list.update(emptyList())
                        return@withContext
                    }
                    signedOut = false
                    applyStatus()
                }
            }
        }
        cs.launch {
            val service = project.service<KiloSessionService>()
            var last = service.activity.value
            combine(service.activity, service.statuses) { activity, _ -> activity }.collect { activity ->
                val previous = last
                last = activity
                withContext(Dispatchers.Main) {
                    if (started && !Disposer.isDisposed(this@HostedWorkspaceEditorPanel)) {
                        sync(select = false)
                        if (hostedIdle(previous, activity, ref.workspaceID, sessions)) scheduleTitleRefresh()
                    }
                }
            }
        }
        cs.launch {
            service<KiloAppService>().state.collect { state ->
                val key = "${state.profile?.email}\u0000${state.profile?.currentOrgId}"
                withContext(Dispatchers.Main) {
                    if (Disposer.isDisposed(this@HostedWorkspaceEditorPanel)) return@withContext
                    val previous = identity
                    identity = key
                    if (previous == null || previous == key) return@withContext
                    loadGeneration++
                    observation?.let(Disposer::dispose)
                    observation = null
                    selected = null
                    sessions = emptyList()
                    manager.clearPresentation()
                    list.update(emptyList())
                    header.update(null, null, ref.workspaceID)
                    reload()
                }
            }
        }
        cs.launch {
            hosted.refreshes.drop(1).collect {
                withContext(Dispatchers.Main) {
                    if (started && !Disposer.isDisposed(this@HostedWorkspaceEditorPanel)) reload()
                }
            }
        }
        start()
    }

    override fun dispose() {
        loadGeneration++
        titleRefresh?.cancel()
        manager.onPresent = null
        manager.onListChanged = null
        manager.onNewSession = null
        manager.onDeleteWorkspace = null
        cs.cancel()
    }

    @RequiresEdt
    override fun uiDataSnapshot(sink: DataSink) {
        sink[SessionManager.KEY] = manager
        sink[SessionManager.WORKSPACE_KEY] = workspace
    }

    @RequiresEdt
    private fun start() {
        if (started) return
        started = true
        reload()
    }

    @RequiresEdt
    private fun reload() {
        applyStatus()
        val generation = ++loadGeneration
        cs.launch {
            try {
                val item = hosted.workspace(ref)
                val loaded = hosted.sessions(ref, item)
                hosted.status(ref)
                withContext(Dispatchers.Main) {
                    if (Disposer.isDisposed(this@HostedWorkspaceEditorPanel) || generation != loadGeneration) {
                        return@withContext
                    }
                    sessions = loaded
                    dto = item
                    service<HostedWorkspaceCache>().put(dto)
                    header.update(null, null, HostedWorkspaceTitle.text(dto.name, dto.branch, ref.workspaceID))
                    project.service<KiloVfsManager>().updatePresentation(
                        HostedWorkspaceEditorKind.ID, hostedWorkspaceParams(dto),
                    )
                    applyStatus()
                    sync()
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    if (Disposer.isDisposed(this@HostedWorkspaceEditorPanel) || generation != loadGeneration) {
                        return@withContext
                    }
                    compute.update(HostedWorkspaceStatus.UNAVAILABLE.badge())
                    compute.toolTipText = KiloBundle.message("hosted.workspace.status.error", e.message ?: "")
                }
            }
        }
    }

    private fun scheduleTitleRefresh() {
        titleRefresh?.cancel()
        titleRefresh = cs.launch {
            delay(2_000)
            withContext(Dispatchers.Main) {
                if (started && !Disposer.isDisposed(this@HostedWorkspaceEditorPanel)) reload()
            }
        }
    }

    @RequiresEdt
    private fun applyStatus() {
        val state = hosted.state.value
        val session = selected
        manager.setPreparation(
            session?.let(state::readiness) ?: HostedReadiness.Unknown,
            session?.let { state.preparations[it] },
        )
        val item = state.presentation(ref)
        compute.update(HostedWorkspaceStatus.of(item).badge())
        compute.toolTipText = KiloBundle.message("hosted.workspace.status.tooltip")
        val rate = item?.rateMicrodollarsPerHour?.let(::formatRate).orEmpty()
        if (price.text != rate) price.text = rate
        if (price.isVisible != rate.isNotBlank()) price.isVisible = rate.isNotBlank()
    }

    private fun formatRate(microdollars: Long): String =
        "$" + String.format("%.2f", microdollars / 1_000_000.0) + "/h"

    @RequiresEdt
    private fun sync(select: Boolean = true) {
        manager.setTitles(buildMap {
            sessions.forEach { session ->
                val title = session.title?.takeIf { it.isNotBlank() } ?: return@forEach
                put(session.id, title)
                put(session.nativeSessionID, title)
            }
        })
        val kinds = manager.activity()
        val titles = manager.titles()
        val closed = management.closed(ref)
        val rows = HistoryTime.sorted(sessions.map(::HostedHistoryItem)).map {
            HostedSessionRow(
                item = it,
                kind = kinds[it.id],
                live = titles[it.id],
                closed = it.session.nativeSessionID in closed,
                toggle = ::toggle,
            )
        }
        val open = sessions.filterNot { it.nativeSessionID in closed }
        val current = manager.currentKey()?.takeIf { key ->
            key != SessionHost.NEW && open.any { it.id == key }
        }
        val preferred = management.selected(ref)?.let { id -> open.firstOrNull { it.id == id } }
        val initialSession = if (select) preferred ?: open.maxByOrNull { it.updated } ?: open.firstOrNull() else null
        val route = current?.let { key -> open.firstOrNull { it.id == key } } ?: initialSession
        if (open.isEmpty()) {
            empty.text = KiloBundle.message("hosted.workspace.empty.closed")
            manager.clearPresentation()
            if (manager.component.componentCount == 0) {
                manager.component.addToCenter(empty.align(HAlign.CENTER, VAlign.CENTER))
            }
        } else if (empty.text != KiloBundle.message("hosted.workspace.empty")) {
            empty.text = KiloBundle.message("hosted.workspace.empty")
        }
        list.update(rows, route?.let { ActiveSelection.Key(it.id) } ?: ActiveSelection.Preserve)
        syncToggle(sessions.mapTo(mutableSetOf()) { it.id }, kinds, current)
        if (!select || initialSession == null) return
        if (initialSession.id == current) return
        open(initialSession, focus = false)
    }

    @RequiresEdt
    private fun open(item: HostedWorkspaceSessionDto, focus: Boolean) {
        if (item.nativeSessionID in management.closed(ref)) return
        if (selected != item.id || observation == null) {
            observation?.let(Disposer::dispose)
            observation = hosted.observe(ref, item.nativeSessionID, this)
        }
        selected = item.id
        management.select(ref, item.id)
        val hostedRef = SessionRef.Hosted(ref.providerID, ref.workspaceID, item.nativeSessionID, item.title)
        manager.show(hostedRef, focus)
        hosted.takePrompt(item.id)?.let(manager::seedPrompt)
        applyStatus()
    }

    @RequiresEdt
    private fun toggle(item: HostedHistoryItem) {
        val session = item.session
        if (session.nativeSessionID in management.closed(ref)) {
            management.reopen(ref, session.nativeSessionID)
            open(session, focus = true)
            return
        }
        management.close(ref, session.nativeSessionID)
        if (selected == session.id) {
            observation?.let(Disposer::dispose)
            observation = null
            selected = null
            manager.closeSession(SessionRef.Hosted(ref.providerID, ref.workspaceID, session.nativeSessionID, session.title))
        }
        sync()
    }

    @RequiresEdt
    private fun newHostedSession() {
        val dialog = HostedWorkspaceDialog(
            this,
            project,
            project.basePath.orEmpty(),
            dto.repositoryUrl.orEmpty(),
            withWorkspace = false,
        )
        if (!dialog.showAndGet()) return
        val plan = dialog.plan() ?: return
        startHosted(
            HostedStartSessionDto(
                prompt = plan.prompt,
                agent = HostedAgentDto(plan.agent, plan.model, plan.variant),
                operationKey = java.util.UUID.randomUUID().toString(),
                messageID = hostedMessageID(),
            ),
        )
    }

    @RequiresEdt
    private fun startHosted(request: HostedStartSessionDto) {
        cs.launch {
            val result = hosted.start(ref, request)
            withContext(Dispatchers.Main) {
                if (Disposer.isDisposed(this@HostedWorkspaceEditorPanel)) return@withContext
                val session = result.session
                if (result.failure != null || session == null) {
                    KiloNotifications.error(
                        project,
                        KiloBundle.message("hosted.workspace.session.failed"),
                        result.failure?.message,
                        KiloBundle.message("common.retry"),
                    ) { startHosted(request) }
                    return@withContext
                }
                management.select(ref, session.id)
                sessions = (sessions + session).distinctBy { it.id }
                open(session, focus = true)
                hosted.refresh(project.basePath.orEmpty())
            }
        }
    }

    @RequiresEdt
    private fun deleteWorkspace(anchor: Component? = null) {
        val target = anchor ?: this
        project.service<HostedWorkspaceRemoval>().confirm(
            RelativePoint(target, Point(target.width / 2, if (target === this) 0 else target.height)),
            ref,
            project.basePath.orEmpty(),
        )
    }

    private inner class NewSessionAction : DumbAwareAction(
        KiloBundle.message("hosted.workspace.session.new"),
        null,
        AllIcons.General.Add,
    ) {
        @RequiresEdt
        override fun actionPerformed(e: com.intellij.openapi.actionSystem.AnActionEvent) = newHostedSession()
    }

    private inner class DeleteAction : DumbAwareAction(
        KiloBundle.message("hosted.workspace.session.delete"),
        null,
        null,
    ) {
        @RequiresEdt
        override fun actionPerformed(e: com.intellij.openapi.actionSystem.AnActionEvent) =
            deleteWorkspace(e.inputEvent?.component)
    }
}
