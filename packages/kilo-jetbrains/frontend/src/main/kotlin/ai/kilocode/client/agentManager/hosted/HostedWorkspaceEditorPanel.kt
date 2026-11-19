package ai.kilocode.client.agentManager.hosted

import ai.kilocode.client.actions.openHostedWorkspaceInBrowser
import ai.kilocode.client.agentManager.WorkspaceSessionHeader
import ai.kilocode.client.agentManager.WorkspaceSessionEditorManager
import ai.kilocode.client.agentManager.WorkspaceSessionEditorPanel
import ai.kilocode.client.agentManager.worktree.WorktreeEditorMatchers
import ai.kilocode.client.agentManager.worktree.isDefaultSessionTitle
import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloHostedService
import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.diff.HostedDiffComparison
import ai.kilocode.client.diff.openHostedDiff
import ai.kilocode.client.diff.refreshHostedDiffTitles
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.log.KiloLog
import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.session.SessionHost
import ai.kilocode.client.session.SessionManager
import ai.kilocode.client.session.SessionRef
import ai.kilocode.client.session.history.HistoryTime
import ai.kilocode.client.session.history.HostedHistoryItem
import ai.kilocode.client.telemetry.Telemetry
import ai.kilocode.client.ui.HoverArea
import ai.kilocode.client.ui.active.ActiveBadgeCell
import ai.kilocode.client.ui.active.ActiveItem
import ai.kilocode.client.ui.active.ActiveSelection
import ai.kilocode.client.vfs.KiloVfsManager
import ai.kilocode.rpc.dto.HostedWorkspaceDto
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import ai.kilocode.rpc.dto.HostedWorkspaceSessionDto
import ai.kilocode.rpc.dto.WorktreePrDto
import ai.kilocode.rpc.dto.WorktreeDirtyDto
import ai.kilocode.rpc.dto.WorktreeStatsDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.DataSink
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.actionSystem.UiDataProvider
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.util.concurrency.annotations.RequiresEdt
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Cloud workspace editor: the workspace's root sessions on the left, the ordinary
 * [ai.kilocode.client.session.SessionUi] on the right, using the same editor chrome and rows as a
 * local worktree. New sessions start blank and Cloud creates them from the first prompt; only
 * backend capabilities that Cloud does not have (rename, fork, close from the editor toolbar) differ.
 */
internal fun hostedSessionOf(key: String, workspace: String, sessions: List<HostedWorkspaceSessionDto>): Boolean =
    key.contains(workspace) || sessions.any { it.id == key || it.nativeSessionID == key }

internal class HostedWorkspaceEditorPanel @RequiresEdt constructor(
    parent: Disposable,
    private val project: Project,
    private val ref: HostedWorkspaceRefDto,
    name: String?,
    branch: String? = null,
) : WorkspaceSessionEditorPanel(parent), UiDataProvider {
    private val hosted = project.service<KiloHostedService>()
    private val prs = project.service<HostedPullRequestService>()
    private val management = project.service<HostedManagementService>()
    private val cs = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val job get() = cs.coroutineContext[Job]!!
    private val compute = ActiveBadgeCell()
    private val status = HoverArea(compute)
    private val header = WorkspaceSessionHeader(
        status = status,
        onLocal = { openDiff(HostedDiffComparison.UNCOMMITTED) },
        openPull = { openDiff(HostedDiffComparison.PULL_REQUEST) },
        pullHint = KiloBundle.message("hosted.diff.pr.tooltip"),
        persistentChanges = true,
        openDiff = { openDiff(HostedDiffComparison.COMMITTED) },
    )
    private val workspace = hostedWorkspaceRoot(project)
    private val manager = HostedWorkspaceEditorManager(
        parent = this,
        project = project,
        workspace = workspace,
        ref = ref,
    )

    private var dto = HostedWorkspaceDto(ref, name = name, branch = branch)
    private var sessions: List<HostedWorkspaceSessionDto> = emptyList()
    private var observation: Disposable? = null
    private var selected: String? = null
    private var active = false
    private var loadGeneration = 0L
    private var changesGeneration = 0L
    private var changesJob: Job? = null
    private var titleRefresh: Job? = null
    private var retry: Job? = null
    private var attempts = 0
    private var identity: String? = null
    private var loaded = false
    private var signedOut = false
    private var lastStatus: HostedWorkspaceStatus? = null
    private var running: Set<String> = emptySet()
    private var pull: WorktreePrDto? = null
    private var stats: WorktreeStatsDto? = null
    private var dirty: WorktreeDirtyDto? = null

    init {
        project.service<WorktreeEditorMatchers>().register(HostedWorkspaceEditorMatcher)
        updateStatus(HostedWorkspaceStatus.LOADING)
        syncHeader()
        initialize(
            content = manager.component,
            header = header,
            actions = DefaultActionGroup(NewAction()),
            open = ::openRow,
        )
        visibility(
            load = { done -> done(management.listVisible(ref)) },
            save = { value -> management.saveListVisible(ref, value) },
        )
        manager.onCreated = ::created
        bindHost()
        // First paint has no transcript yet; present the same blank prompt panel a worktree uses
        // instead of an empty void or a "select a session" hint.
        manager.blank()
        cs.launch {
            management.preferences.collect {
                withContext(Dispatchers.Main) {
                    if (active && !Disposer.isDisposed(this@HostedWorkspaceEditorPanel)) sync(select = false)
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
                            loaded = false
                            loadGeneration++
                            changesGeneration++
                            changesJob?.cancel()
                        }
                        observation?.let(Disposer::dispose)
                        observation = null
                        selected = null
                        sessions = emptyList()
                        manager.clearPresentation()
                        list.update(emptyList())
                        pull = null
                        stats = null
                        dirty = null
                        updateStatus(HostedWorkspaceStatus.UNAVAILABLE)
                        syncHeader()
                        return@withContext
                    }
                    val restored = signedOut
                    signedOut = false
                    applyStatus()
                    syncHeader()
                    if (restored) {
                        reload()
                        refreshChanges()
                    }
                }
            }
        }
        cs.launch {
            val service = project.service<KiloSessionService>()
            combine(service.activity, service.statuses) { activity, _ -> activity }.collect {
                withContext(Dispatchers.Main) {
                    if (active && !Disposer.isDisposed(this@HostedWorkspaceEditorPanel)) syncActivity()
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
                    loaded = false
                    loadGeneration++
                    changesGeneration++
                    changesJob?.cancel()
                    observation?.let(Disposer::dispose)
                    observation = null
                    selected = null
                    sessions = emptyList()
                    manager.clearPresentation()
                    list.update(emptyList())
                    pull = null
                    stats = null
                    dirty = null
                    updateStatus(HostedWorkspaceStatus.UNAVAILABLE)
                    header.update(null, null, ref.workspaceID)
                    reload()
                    refreshChanges()
                }
            }
        }
        cs.launch {
            hosted.refreshes.drop(1).collect {
                withContext(Dispatchers.Main) {
                    if (active && !Disposer.isDisposed(this@HostedWorkspaceEditorPanel)) {
                        reload()
                        refreshChanges()
                    }
                }
            }
        }
        cs.launch {
            prs.pulls.collect { value ->
                withContext(Dispatchers.Main) {
                    if (Disposer.isDisposed(this@HostedWorkspaceEditorPanel)) return@withContext
                    val next = value[ref.key]
                    if (next == pull) return@withContext
                    pull = next
                    syncHeader()
                }
            }
        }
        ensureStarted()
    }

    override fun host(): WorkspaceSessionEditorManager = manager

    override fun onStart() {
        active = true
        reload()
        refreshChanges()
        prs.refresh(ref)
    }

    override fun onHostChanged() {
        if (active) syncActivity()
    }

    /**
     * Re-syncs rows and watches this workspace's sessions leave Running. Cloud names a session after
     * its first turn and never streams that title, so a finished turn is the cue to re-read the
     * workspace until the name shows up — whether the turn ran in this editor or anywhere else.
     */
    @RequiresEdt
    private fun syncActivity() {
        val now = manager.activity().filter { (key, kind) ->
            kind == SessionActivityKind.RUNNING && hostedSessionOf(key, ref.workspaceID, sessions)
        }.keys
        val finished = running.any { it !in now }
        running = now
        sync(select = false)
        if (finished) {
            scheduleTitleRefresh()
            refreshChanges()
            // A finished turn is the first point a push can have created or updated a PR.
            prs.refresh(ref, revalidate = true)
        }
    }

    override fun rows(): List<ActiveItem> {
        val kinds = manager.activity()
        val titles = manager.titles()
        val closed = management.closed(ref)
        return HistoryTime.sorted(sessions.map(::HostedHistoryItem)).map {
            HostedSessionRow(
                item = it,
                kind = kinds[it.id],
                live = titles[it.id],
                closed = it.session.nativeSessionID in closed,
                toggle = ::toggle,
            )
        }
    }

    override fun sessionIds(): Set<String> = sessions.mapTo(mutableSetOf()) { it.id }

    override fun openKey(key: String, focus: Boolean) {
        sessions.firstOrNull { it.id == key }?.let { open(it, focus) }
    }

    override fun dispose() {
        super.dispose()
        loadGeneration++
        changesGeneration++
        changesJob?.cancel()
        titleRefresh?.cancel()
        retry?.cancel()
        manager.onCreated = null
        observation?.let(Disposer::dispose)
        cs.cancel()
    }

    suspend fun closed() {
        manager.closed()
        job.join()
    }

    @RequiresEdt
    override fun uiDataSnapshot(sink: DataSink) {
        snapshot(sink)
        sink[SessionManager.WORKSPACE_KEY] = workspace
        sink[HostedWorkspaceDataKeys.WORKSPACE] = dto
    }

    @RequiresEdt
    private fun reload() {
        applyStatus()
        prs.refresh(ref)
        val generation = ++loadGeneration
        cs.launch { load(generation) }
    }

    private suspend fun load(generation: Long) {
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
                this@HostedWorkspaceEditorPanel.loaded = true
                if (dto.deletionState == "deleted" || dto.deletionState == "deleting") {
                    stats = null
                    dirty = null
                }
                attempts = 0
                syncTitle()
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
                if (retryWhileStarting()) return@withContext
                updateStatus(HostedWorkspaceStatus.UNAVAILABLE)
                compute.toolTipText = KiloBundle.message("hosted.workspace.status.error", e.message ?: "")
            }
        }
    }

    @RequiresEdt
    private fun refreshChanges() {
        changesJob?.cancel()
        val generation = ++changesGeneration
        changesJob = cs.launch { loadChanges(generation) }
    }

    /** Reads the durable snapshot only; this never wakes or attaches the Cloud sandbox. */
    private suspend fun loadChanges(generation: Long) {
        try {
            val summary = hosted.workspaceChanges(ref).headerChanges()
            withContext(Dispatchers.Main) {
                if (Disposer.isDisposed(this@HostedWorkspaceEditorPanel) || generation != changesGeneration) return@withContext
                stats = summary.stats
                dirty = summary.dirty
                syncHeader()
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // Keep the last durable summary during reconnects or transient Cloud failures.
            LOG.warn("Cloud changes unavailable for ${ref.key}", e)
        }
    }

    /**
     * While the sandbox is still booting the Session Host may answer with a retryable failure. Keep
     * the compute badge and retry quietly instead of flashing "Cloud status unavailable".
     */
    @RequiresEdt
    private fun retryWhileStarting(): Boolean {
        val status = HostedWorkspaceStatus.of(hosted.state.value.presentation(ref))
        if (status != HostedWorkspaceStatus.STARTING &&
            status != HostedWorkspaceStatus.SETTING_UP &&
            status != HostedWorkspaceStatus.LOADING
        ) {
            return false
        }
        if (attempts >= RETRY_LIMIT) return false
        attempts++
        updateStatus(status)
        retry?.cancel()
        retry = cs.launch {
            delay(RETRY_MS)
            withContext(Dispatchers.Main) {
                if (active && !Disposer.isDisposed(this@HostedWorkspaceEditorPanel)) reload()
            }
        }
        return true
    }

    /**
     * Re-reads the workspace with backoff until every session carries a real title. Cloud generates
     * the name asynchronously after the first turn, so one fixed delay misses it as often as not.
     */
    private fun scheduleTitleRefresh() {
        titleRefresh?.cancel()
        titleRefresh = cs.launch {
            for (wait in TITLE_RETRY) {
                delay(wait)
                val generation = withContext(Dispatchers.Main) {
                    if (!active || Disposer.isDisposed(this@HostedWorkspaceEditorPanel)) null else ++loadGeneration
                } ?: return@launch
                load(generation)
                if (withContext(Dispatchers.Main) { titled() }) return@launch
            }
        }
    }

    @RequiresEdt
    private fun titled(): Boolean = sessions.isNotEmpty() && sessions.none {
        val title = it.title
        title.isNullOrBlank() || isDefaultSessionTitle(title)
    }

    @RequiresEdt
    private fun applyStatus() {
        val state = hosted.state.value
        // A blank New Session panel keeps its prompt; only the Cloud session that is actually shown
        // receives preparation, never the one that was selected before "+" was pressed.
        val session = selected?.takeIf { manager.currentKey() == it }
        session?.let { manager.setPreparation(state.readiness(ref, it), state.preparations[it]) }
        val item = state.presentation(ref)
        val status = HostedWorkspaceStatus.of(item)
        val previous = lastStatus
        lastStatus = status
        updateStatus(status)
        // Fetch the sessions as soon as the sandbox can answer instead of leaving the list with
        // whatever the discovery snapshot had while the workspace was still booting.
        if (active && previous != status && status == HostedWorkspaceStatus.ACTIVE &&
            previous in setOf(HostedWorkspaceStatus.STARTING, HostedWorkspaceStatus.SETTING_UP, HostedWorkspaceStatus.LOADING)
        ) {
            reload()
        }
    }

    @RequiresEdt
    private fun sync(select: Boolean = true) {
        manager.setTitles(buildMap {
            sessions.forEach { session ->
                val title = session.title?.takeIf { it.isNotBlank() } ?: return@forEach
                put(session.id, title)
                put(session.nativeSessionID, title)
            }
        })
        val closed = management.closed(ref)
        val open = sessions.filterNot { it.nativeSessionID in closed }
        val current = manager.currentKey()?.takeIf { key ->
            key != SessionHost.NEW && open.any { it.id == key }
        }
        val preferred = management.selected(ref)?.let { id -> open.firstOrNull { it.id == id } }
        val initialSession = if (select) preferred ?: open.maxByOrNull { it.updated } ?: open.firstOrNull() else null
        val route = current?.let { key -> open.firstOrNull { it.id == key } } ?: initialSession
        syncList(select = route?.let { ActiveSelection.Key(it.id) })
        // Session construction reports activity before the host registers it; never navigate from that callback.
        if (!select) return
        if (open.isEmpty()) manager.blank()
        if (initialSession == null || initialSession.id == current) return
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
    private fun created(session: HostedWorkspaceSessionDto) {
        management.select(ref, session.id)
        sessions = (sessions + session).distinctBy { it.id }
        open(session, focus = true)
        hosted.refresh(project.basePath.orEmpty())
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
    private fun syncTitle() {
        val value = title()
        syncHeader()
        service<HostedWorkspaceCache>().put(dto, value)
        refreshHostedDiffTitles(project, ref)
        project.service<KiloVfsManager>().updatePresentation(
            HostedWorkspaceEditorKind.ID, hostedWorkspaceParams(dto),
        )
    }

    /** Keeps PR, title and passive saved changes on the exact shared header local worktrees use. */
    @RequiresEdt
    private fun syncHeader() {
        val name = title()
        val available = canDiff()
        header.setChangeActions(
            { openDiff(HostedDiffComparison.COMMITTED) }.takeIf { available },
            { openDiff(HostedDiffComparison.UNCOMMITTED) }.takeIf { available },
        )
        header.update(stats.takeIf { available }, pull?.titled(name).takeIf { available }, name,
            dirty.takeIf { available })
    }

    @RequiresEdt
    private fun openDiff(comparison: HostedDiffComparison) {
        if (!canDiff()) return
        Telemetry.send("Cloud Diff Opened", mapOf("surface" to "workspace_header", "comparison" to comparison.name.lowercase()))
        openHostedDiff(project, ref, comparison)
    }

    @RequiresEdt
    private fun canDiff(): Boolean = loaded && hosted.enabled() && !hosted.state.value.signedOut &&
        !ref.workspaceID.startsWith(HostedWorkspaceEditorKind.PENDING_PREFIX) &&
        dto.deletionState != "deleted" && dto.deletionState != "deleting"

    @RequiresEdt
    private fun updateStatus(status: HostedWorkspaceStatus) {
        val action = ::openBrowser.takeIf { canBrowse() }
        val tooltip = if (action == null) KiloBundle.message("hosted.workspace.status.tooltip")
        else KiloBundle.message("action.Kilo.HostedWorkspace.OpenInBrowser.description")
        compute.update(status.badge())
        this.status.action = action
        this.status.tooltip(tooltip, status.badge().text)
    }

    @RequiresEdt
    private fun canBrowse(): Boolean = loaded && hosted.enabled() && !hosted.state.value.signedOut &&
        !ref.workspaceID.startsWith(HostedWorkspaceEditorKind.PENDING_PREFIX) &&
        dto.deletionState != "deleted" && dto.deletionState != "deleting"

    @RequiresEdt
    private fun openBrowser() {
        if (!canBrowse()) return
        val org = service<KiloAppService>().state.value.profile?.currentOrgId
        openHostedWorkspaceInBrowser(dto.copy(sessions = sessions), org, "workspace_header")
    }

    /** One label for the tab, header, and status bar, matching the tree row. */
    @RequiresEdt
    private fun title(): String {
        val latest = sessions.maxByOrNull { it.updated }
        val live = latest?.let { manager.titles()[it.id] } ?: latest?.title
        return HostedWorkspaceTitle.text(dto.name, dto.branch, ref.workspaceID, live)
    }

    private companion object {
        val LOG = KiloLog.create(HostedWorkspaceEditorPanel::class.java)
        const val RETRY_MS = 2_000L
        const val RETRY_LIMIT = 10
        val TITLE_RETRY = listOf(2_000L, 4_000L, 8_000L, 16_000L)
    }
}
