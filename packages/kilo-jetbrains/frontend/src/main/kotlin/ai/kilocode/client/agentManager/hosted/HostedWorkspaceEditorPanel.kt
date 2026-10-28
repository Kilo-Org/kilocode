package ai.kilocode.client.agentManager.hosted

import ai.kilocode.client.app.KiloHostedService
import ai.kilocode.client.agentManager.worktree.WorktreeEditorMatchers
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionHost
import ai.kilocode.client.session.SessionRef
import ai.kilocode.client.session.SessionUi
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.list.ActiveList
import ai.kilocode.client.ui.list.ActiveListBadge
import ai.kilocode.client.ui.list.ActiveListConfig
import ai.kilocode.client.ui.list.ActiveListItem
import ai.kilocode.client.ui.list.ActiveListSelection
import ai.kilocode.client.ui.list.ActiveListSurface
import ai.kilocode.client.ui.list.activeListToolWindowBackground
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import ai.kilocode.rpc.dto.HostedWorkspaceSessionDto
import ai.kilocode.rpc.dto.HostedWorkspaceStatusDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.ui.OnePixelSplitter
import com.intellij.ui.components.ActionLink
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.components.BorderLayoutPanel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Dimension
import javax.swing.JComponent
import javax.swing.JPanel

/**
 * Cloud workspace editor: the workspace's root sessions on the left, the ordinary [SessionUi] on
 * the right. Modelled on the worktree session tab so session selection and transcript behaviour stay
 * familiar, without worktree-only create/delete/rename/fork controls.
 */
class HostedWorkspaceEditorPanel(
    parent: Disposable,
    private val project: Project,
    private val ref: HostedWorkspaceRefDto,
    name: String?,
) : BorderLayoutPanel(), Disposable {
    init {
        Disposer.register(parent, this)
    }

    private val hosted = project.service<KiloHostedService>()
    private val cs = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val right = JPanel(BorderLayout())
    private val empty = JBLabel(KiloBundle.message("hosted.workspace.empty"))
    private val title = JBLabel(name?.takeIf { it.isNotBlank() } ?: ref.workspaceID)
    private val compute = JBLabel(KiloBundle.message("hosted.workspace.status.loading"))
    private val preparation = JBLabel()
    private val manager = HostedWorkspaceEditorManager(
        parent = parent,
        project = project,
        workspace = hostedWorkspaceRoot(project),
        presentUi = { ui -> present(ui) },
    )
    private val list = ActiveList(
        KiloBundle.message("hosted.workspace.sessions.empty"),
        cfg = ActiveListConfig(
            title = ai.kilocode.client.ui.list.ActiveListWeight.PLAIN,
            description = false,
            hoverActions = false,
        ),
        surface = ActiveListSurface.ToolWindow,
        showSearch = false,
        onCell = { _, _ -> },
        onOpen = { row, focus -> (row as? HostedSessionRow)?.let { open(it.item, focus) } },
    )

    private var sessions: List<HostedWorkspaceSessionDto> = emptyList()
    private var status: HostedWorkspaceStatusDto? = null
    private var systemJob: Job? = null
    private var selected: String? = null
    private var started = false

    init {
        isOpaque = true
        project.service<WorktreeEditorMatchers>().register(HostedWorkspaceEditorMatcher)
        title.toolTipText = ref.key
        compute.toolTipText = KiloBundle.message("hosted.workspace.status.tooltip")
        preparation.isVisible = false
        val splitter = OnePixelSplitter(false, 0.25f)
        splitter.setHonorComponentsMinimumSize(true)
        list.minimumSize = Dimension(0, 0)
        splitter.firstComponent = list
        splitter.secondComponent = right
        addToTop(header())
        addToCenter(splitter)
        present(null)
        addHierarchyListener { event ->
            if (event.changeFlags and java.awt.event.HierarchyEvent.SHOWING_CHANGED.toLong() == 0L) return@addHierarchyListener
            if (isShowing) start()
        }
    }

    override fun getBackground(): Color = activeListToolWindowBackground()

    override fun dispose() {
        cs.cancel()
    }

    @RequiresEdt
    fun preferredFocus(): JComponent = manager.component

    @RequiresEdt
    private fun start() {
        if (started) return
        started = true
        reload()
    }

    @RequiresEdt
    private fun reload() {
        compute.text = KiloBundle.message("hosted.workspace.status.loading")
        cs.launch {
            try {
                val loaded = hosted.sessions(ref)
                val next = runCatching { hosted.status(ref) }.getOrNull()
                withContext(Dispatchers.Main) {
                    if (Disposer.isDisposed(this@HostedWorkspaceEditorPanel)) return@withContext
                    sessions = loaded
                    status = next
                    applyStatus()
                    sync()
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    if (Disposer.isDisposed(this@HostedWorkspaceEditorPanel)) return@withContext
                    compute.text = KiloBundle.message("hosted.workspace.status.error", e.message ?: "")
                }
            }
        }
    }

    @RequiresEdt
    private fun applyStatus() {
        val item = status ?: run {
            compute.text = KiloBundle.message("hosted.workspace.status.unknown")
            return
        }
        val rate = item.rateMicrodollarsPerHour?.let { rate ->
            KiloBundle.message("hosted.workspace.status.rate", formatRate(rate))
        }
        compute.text = listOfNotNull(item.computeStatus, item.computeDetail.takeIf { it.isNotBlank() }, rate)
            .joinToString(" · ")
    }

    private fun formatRate(microdollars: Long): String =
        "$" + String.format("%.2f", microdollars / 1_000_000.0) + "/h"

    @RequiresEdt
    private fun sync() {
        val kinds = manager.activity()
        val titles = manager.titles()
        val rows = sessions.map { HostedSessionRow(it, kinds[it.id], titles[it.id]) }
        val current = manager.currentKey()?.takeIf { it != SessionHost.NEW }
        val initial = current ?: sessions.maxByOrNull { it.updated }?.id
        list.update(rows, initial?.let { ActiveListSelection.Key(it) } ?: ActiveListSelection.Preserve)
        if (initial != null && manager.currentKey() != initial) open(sessions.first { it.id == initial }, focus = false)
    }

    @RequiresEdt
    private fun open(item: HostedWorkspaceSessionDto, focus: Boolean) {
        selected = item.id
        val ref = SessionRef.Hosted(ref.providerID, ref.workspaceID, item.nativeSessionID, item.title)
        manager.show(ref, focus)
        bindSystem(item)
    }

    private fun bindSystem(item: HostedWorkspaceSessionDto) {
        systemJob?.cancel()
        preparation.isVisible = false
        systemJob = cs.launch {
            try {
                hosted.systemEvents(ref, item.nativeSessionID).collect { event ->
                    val text = listOfNotNull(
                        event.step?.takeIf { it.isNotBlank() },
                        event.message?.takeIf { it.isNotBlank() },
                        event.sandboxStatus?.takeIf { it.isNotBlank() },
                    ).distinct().joinToString(" · ")
                    withContext(Dispatchers.Main) {
                        if (selected != item.id) return@withContext
                        preparation.text = text
                        preparation.isVisible = text.isNotBlank()
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // System status is supplementary; the transcript and native events still work.
                withContext(Dispatchers.Main) {
                    if (selected != item.id) return@withContext
                    preparation.isVisible = false
                }
            }
        }
    }

    @RequiresEdt
    private fun present(ui: SessionUi?) {
        right.removeAll()
        right.add(ui ?: empty, BorderLayout.CENTER)
        right.revalidate()
        right.repaint()
    }

    private fun header(): JComponent = BorderLayoutPanel().apply {
        isOpaque = false
        border = JBUI.Borders.empty(UiStyle.Gap.SM)
        addToLeft(title)
        addToCenter(JPanel(BorderLayout()).apply {
            isOpaque = false
            add(compute, BorderLayout.WEST)
        })
        addToRight(
            ActionLink(KiloBundle.message("hosted.workspace.refresh")) {
                hosted.refresh(project.basePath.orEmpty())
                reload()
            },
        )
    }

    private inner class HostedSessionRow(
        val item: HostedWorkspaceSessionDto,
        private val kind: ai.kilocode.client.session.SessionActivityKind?,
        private val live: String?,
    ) : ActiveListItem {
        override val key: String get() = item.id
        override val identity: Any get() = item.id
        override val title: String get() = live?.takeIf { it.isNotBlank() } ?: item.title?.takeIf { it.isNotBlank() }
            ?: KiloBundle.message("hosted.workspace.session.untitled")
        override val description: String? get() = item.createdOnPlatform.takeIf { it.isNotBlank() }
        override val tooltip: String? get() = title
        override val badges: List<ActiveListBadge>
            get() = listOfNotNull(kind?.let { ActiveListBadge(it.label(), it.style()) })
        override val search: String get() = listOfNotNull(item.title, item.id, item.nativeSessionID).joinToString(" ")
        override fun equals(other: Any?): Boolean {
            val row = other as? HostedSessionRow ?: return false
            return item == row.item && kind == row.kind && title == row.title
        }

        override fun hashCode(): Int = 31 * item.hashCode() + (kind?.hashCode() ?: 0)
    }
}
