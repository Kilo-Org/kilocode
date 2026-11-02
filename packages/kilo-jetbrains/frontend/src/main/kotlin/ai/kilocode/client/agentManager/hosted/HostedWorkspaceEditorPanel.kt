package ai.kilocode.client.agentManager.hosted

import ai.kilocode.client.app.KiloHostedService
import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.agentManager.WorkspaceSessionEditorPanel
import ai.kilocode.client.agentManager.WorkspaceSessionHeader
import ai.kilocode.client.agentManager.WorkspaceSessionRow
import ai.kilocode.client.agentManager.worktree.WorktreeEditorMatchers
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionHost
import ai.kilocode.client.session.SessionRef
import ai.kilocode.client.session.SessionManager
import ai.kilocode.client.session.history.HostedHistoryItem
import ai.kilocode.client.session.history.HistoryTime
import ai.kilocode.client.ui.list.ActiveListBadgeCell
import ai.kilocode.client.ui.layout.HAlign
import ai.kilocode.client.ui.layout.VAlign
import ai.kilocode.client.ui.layout.align
import ai.kilocode.client.ui.list.ActiveListSelection
import ai.kilocode.client.vfs.KiloVfsManager
import ai.kilocode.rpc.dto.HostedWorkspaceDto
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import ai.kilocode.rpc.dto.HostedWorkspaceSessionDto
import com.intellij.openapi.Disposable
import com.intellij.ide.util.PropertiesComponent
import com.intellij.openapi.actionSystem.DataSink
import com.intellij.openapi.actionSystem.UiDataProvider
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Cloud workspace editor: the workspace's root sessions on the left, the ordinary
 * [ai.kilocode.client.session.SessionUi] on
 * the right, using the same editor chrome and rows as a local worktree. Only backend capabilities
 * differ: Cloud has no local create/delete/rename/fork controls.
 */
class HostedWorkspaceEditorPanel @RequiresEdt constructor(
    parent: Disposable,
    private val project: Project,
    private val ref: HostedWorkspaceRefDto,
    name: String?,
    branch: String? = null,
) : WorkspaceSessionEditorPanel(parent), UiDataProvider {
    private val hosted = project.service<KiloHostedService>()
    private val cs = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val empty = JBLabel(KiloBundle.message("hosted.workspace.empty"))
    private val header = WorkspaceSessionHeader()
    private val compute = ActiveListBadgeCell()
    private val price = JBLabel().apply { isVisible = false }
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

    init {
        project.service<WorktreeEditorMatchers>().register(HostedWorkspaceEditorMatcher)
        compute.update(HostedWorkspaceStatus.LOADING.badge())
        header.addAction(compute)
        header.addAction(price)
        header.update(null, null, HostedWorkspaceTitle.text(dto.name, dto.branch, ref.workspaceID))
        val key = "kilo.hosted.sessionList.${ref.key}"
        initialize(
            content = manager.component,
            header = header,
            open = { row, focus -> sessions.firstOrNull { it.id == row.key }?.let { open(it, focus) } },
        )
        visibility(
            load = { done -> done(PropertiesComponent.getInstance(project).getValue(key)?.toBooleanStrictOrNull()) },
            save = { value -> PropertiesComponent.getInstance(project).setValue(key, value.toString()) },
        )
        // First paint has no transcript yet; keep the hint centred instead of tucked in a corner.
        manager.component.addToCenter(empty.align(HAlign.CENTER, VAlign.CENTER))
        manager.onPresent = { key -> key?.let { list.select(it) } }
        manager.onListChanged = { if (started) sync(select = false) }
        cs.launch {
            hosted.state.collect { state ->
                withContext(Dispatchers.Main) {
                    if (Disposer.isDisposed(this@HostedWorkspaceEditorPanel)) return@withContext
                    if (state.signedOut || !hosted.enabled()) {
                        observation?.let(Disposer::dispose)
                        observation = null
                        selected = null
                        return@withContext
                    }
                    applyStatus()
                }
            }
        }
        cs.launch {
            val service = project.service<KiloSessionService>()
            combine(service.activity, service.statuses) { _, _ -> Unit }.collect {
                withContext(Dispatchers.Main) {
                    if (started && !Disposer.isDisposed(this@HostedWorkspaceEditorPanel)) sync(select = false)
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
        manager.onPresent = null
        manager.onListChanged = null
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
        cs.launch {
            try {
                val item = hosted.workspace(ref)
                val loaded = hosted.sessions(ref, item)
                hosted.status(ref)
                withContext(Dispatchers.Main) {
                    if (Disposer.isDisposed(this@HostedWorkspaceEditorPanel)) return@withContext
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
                    if (Disposer.isDisposed(this@HostedWorkspaceEditorPanel)) return@withContext
                    compute.update(HostedWorkspaceStatus.UNAVAILABLE.badge())
                    compute.toolTipText = KiloBundle.message("hosted.workspace.status.error", e.message ?: "")
                }
            }
        }
    }

    @RequiresEdt
    private fun applyStatus() {
        val state = hosted.state.value
        manager.setPreparation(selected?.let { state.failure(it) ?: state.preparation(it) })
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
        val kinds = manager.activity()
        val titles = manager.titles()
        val rows = HistoryTime.sorted(sessions.map(::HostedHistoryItem)).map {
            WorkspaceSessionRow(it, kinds[it.id], live = titles[it.id],
                search = listOfNotNull(it.title, it.id, it.session.nativeSessionID).joinToString(" "))
        }
        val current = manager.currentKey()?.takeIf { key -> key != SessionHost.NEW && sessions.any { it.id == key } }
        val initial = current ?: if (select) sessions.maxByOrNull { it.updated }?.id else null
        list.update(rows, initial?.let { ActiveListSelection.Key(it) } ?: ActiveListSelection.Preserve)
        syncToggle(sessions.mapTo(mutableSetOf()) { it.id }, kinds, current)
        if (!select || initial == null) return
        sessions.firstOrNull { it.id == initial }?.takeIf {
            manager.currentKey() != initial || observation == null
        }?.let { open(it, focus = false) }
    }

    @RequiresEdt
    private fun open(item: HostedWorkspaceSessionDto, focus: Boolean) {
        if (selected != item.id || observation == null) {
            observation?.let(Disposer::dispose)
            observation = hosted.observe(ref, item.nativeSessionID, this)
        }
        selected = item.id
        val ref = SessionRef.Hosted(ref.providerID, ref.workspaceID, item.nativeSessionID, item.title)
        manager.show(ref, focus)
        applyStatus()
    }
}
