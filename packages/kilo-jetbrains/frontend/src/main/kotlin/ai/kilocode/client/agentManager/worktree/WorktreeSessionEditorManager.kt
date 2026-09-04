package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.KiloNotifications
import ai.kilocode.client.agentManager.AgentManagerHost
import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.onboarding.providers.v5migration.KiloMigrationService
import ai.kilocode.client.onboarding.providers.v5migration.MigrationUiController
import ai.kilocode.client.onboarding.providers.v5migration.MigrationUiState
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.session.SessionHost
import ai.kilocode.client.session.SessionManager
import ai.kilocode.client.session.SessionRef
import ai.kilocode.client.session.SessionUi
import ai.kilocode.client.session.SessionUiFactory
import ai.kilocode.client.session.controller.PromptSelection
import ai.kilocode.client.session.controller.SessionController
import ai.kilocode.client.session.history.HistoryTime
import ai.kilocode.client.session.history.LocalHistoryItem
import ai.kilocode.client.session.ui.empty.EmptySessionPanel
import ai.kilocode.client.util.UiTimerSource
import ai.kilocode.client.util.UiTimers
import ai.kilocode.client.util.edt
import ai.kilocode.client.vfs.KiloVfsManager
import ai.kilocode.rpc.dto.RenameWorktreeResultDto
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.WorktreeDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.IdeFocusManager
import com.intellij.util.concurrency.annotations.RequiresEdt
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import java.awt.BorderLayout
import javax.swing.JComponent
import javax.swing.JPanel

open class WorktreeSessionEditorManager(
    parent: Disposable,
    project: Project,
    private val worktree: Workspace,
    private val list: WorktreeSessionListController,
    private val session: String? = null,
    private val del: (String, (Boolean, String?) -> Unit) -> Unit = list::delete,
    create: (Project, Workspace, SessionManager, SessionRef?, UiTimerSource) -> SessionUi =
        { project, workspace, manager, ref, timers ->
            service<SessionUiFactory>().create(project, workspace, manager, ref, timers)
        },
    resolve: (String) -> Workspace = { dir -> service<KiloWorkspaceService>().workspace(dir) },
    status: () -> Map<String, SessionActivityKind> = { project.service<KiloSessionService>().activitySnapshot() },
    timers: UiTimerSource = UiTimers,
    request: (JComponent) -> Unit = { focus ->
        ApplicationManager.getApplication().invokeLater({
            IdeFocusManager.getInstance(project).requestFocusInProject(focus, project)
        }, ModalityState.defaultModalityState())
    },
    private val notify: (String, String?) -> Unit = { title, content -> KiloNotifications.error(project, title, content) },
    private val cs: CoroutineScope = service<SessionUiFactory>().scope(),
    private val migration: MigrationUiController = service<KiloMigrationService>(),
    private val adopt: suspend (String, String, String) -> RenameWorktreeResultDto = { dir, path, name ->
        service<KiloWorktreeService>().adopt(dir, path, name)
    },
    private val onAdopted: (WorktreeDto) -> Unit = { updated ->
        service<WorktreeNameCache>().put(updated)
        if (!project.isDisposed) {
            project.service<KiloVfsManager>().updatePresentation(WorktreeSessionEditorKind.ID, worktreeSessionParams(updated))
        }
    },
    // Whether this tab's directory is the repo's main working tree rather than a linked worktree.
    // `git worktree list` answers this from any of the repo's worktrees, so no separate "repo root"
    // is needed -- just the tab's own directory.
    private val resolveBase: suspend (String) -> Boolean = { dir ->
        service<KiloWorktreeService>().list(dir).worktrees
            .firstOrNull { normalizeWorktreePath(it.path) == normalizeWorktreePath(dir) }
            ?.main == true
    },
    private val moveHost: (String?, String, String) -> Unit = { id, dir, surface ->
        project.service<AgentManagerHost>().move(id, dir, surface)
    },
    private val newWorktreeHost: () -> Unit = {
        project.service<AgentManagerHost>().newWorktree()
    },
) : SessionHost(project, worktree, create, resolve, status, timers, request) {
    // Both the branch dock and the New Worktree / Move to Worktree flows only make sense from the
    // base checkout -- a linked worktree's own editor tab keeps today's plain session view. Resolved
    // once in start(), before the first session opens; see resolveBase().
    private var resolvedBase = false
    private var baseResolved = false
    // The answer lands on the EDT after the lookup coroutine has already finished, so a second start()
    // in between would launch a second lookup and open the first session twice. This spans the whole
    // gap; the job's own lifetime does not.
    private var resolving = false
    override val showsBranchDock: Boolean get() = base()
    override val supportsNewWorktree: Boolean get() = base()
    override val supportsMoveToWorktree: Boolean get() = base()
    override val hostedInEditorTab: Boolean get() = true
    private val right = JPanel(BorderLayout())
    private val deleting = linkedSetOf<String>()
    private var last: String? = null
    private var pending = false
    private var adopted = false
    private var adopting = false
    private var startedOnce = false
    private var migrationActive = false
    private var migrationJob: Job? = null
    var onPresent: ((String?) -> Unit)? = null
    var onListChanged: (() -> Unit)? = null

    val component: JPanel get() = right

    init {
        Disposer.register(parent, this)
        bindMigration()
    }

    /** Whether this tab's directory is the repo's main working tree; see [resolveBase]. */
    @RequiresEdt
    open fun base(): Boolean = resolvedBase

    @RequiresEdt
    override fun newWorktree() {
        if (base()) newWorktreeHost()
    }

    @RequiresEdt
    override fun moveToWorktree(sessionId: String?, directory: String) {
        if (base()) moveHost(sessionId, directory, "worktree_editor")
    }

    @RequiresEdt
    fun start() {
        startedOnce = true
        if (baseResolved) {
            startSessions()
            return
        }
        // A start() that arrives mid-lookup needs nothing: the lookup in flight opens the first session
        // when it lands, and that is what this call would have done itself.
        if (resolving) return
        resolving = true
        cs.launch {
            val resolved = runCatching { resolveBase(worktree.directory) }.getOrDefault(false)
            edt({ !Disposer.isDisposed(this@WorktreeSessionEditorManager) }) {
                resolving = false
                resolvedBase = resolved
                baseResolved = true
                startSessions()
            }
        }
    }

    @RequiresEdt
    private fun startSessions() {
        list.reload {
            val target = session
            if (target != null) {
                openSession(SessionRef.Local(target), false)
                return@reload
            }
            val dto = latest()
            if (dto != null) openSession(SessionRef.Local(dto), false) else newSession(false)
        }
    }

    /**
     * While the backend is paused for legacy migration, list/create fail and the editor can only
     * show the empty session panel. Once migration finishes the backend is ready, so re-run [start]
     * to create/open the real session — but only for an editor the user has actually opened
     * ([startedOnce]), never for background worktree editor tabs.
     */
    private fun bindMigration() {
        migrationJob = cs.launch {
            migration.state.collect { state ->
                edt {
                    when (state) {
                        is MigrationUiState.Needed -> migrationActive = true
                        is MigrationUiState.Hidden -> {
                            if (migrationActive && startedOnce) start()
                            migrationActive = false
                        }
                    }
                }
            }
        }
    }

    @RequiresEdt
    override fun dispose() {
        migrationJob?.cancel()
        super.dispose()
    }

    @RequiresEdt
    open fun hasPendingNew(): Boolean = pending

    @RequiresEdt
    open fun deleting(): Set<String> = deleting

    @RequiresEdt
    override fun emptyPanel(parent: Disposable, controller: SessionController): EmptySessionPanel = EmptySessionPanel(
        parent,
        controller,
        recents = emptyList(),
        history = { showHistory() },
        timers = timers,
        minimal = true,
    )

    @RequiresEdt
    override fun newSession() {
        newSession(focus = true)
    }

    @RequiresEdt
    open fun newSession(focus: Boolean) {
        if (pending) return
        pending = true
        onListChanged?.invoke()
        list.create { session ->
            pending = false
            if (session != null) {
                openSession(SessionRef.Local(session), focus)
                consumePendingPrompt()
            } else {
                // The backend could not create a session yet (e.g. it is paused for legacy
                // migration). Show the empty session panel so the worktree editor mirrors the tool
                // window instead of a blank panel; WorktreeSessionEditorPanel re-runs start() once
                // migration finishes to create the real session.
                if (currentUi() == null) showBlank()
                onListChanged?.invoke()
            }
        }
    }

    /** Sends the New Worktree dialog's queued prompt into this worktree's first session, once. */
    @RequiresEdt
    private fun consumePendingPrompt() {
        val prompt = service<PendingWorktreePrompt>().take(worktree.directory) ?: return
        currentUi()?.submitPrompt(
            prompt.text,
            PromptSelection(prompt.agent, prompt.provider, prompt.model, prompt.variant),
        )
    }

    @RequiresEdt
    override fun showHistory(back: (() -> Unit)?) {
        list.reload()
        onListChanged?.invoke()
    }

    @RequiresEdt
    override fun activityChanged() {
        super.activityChanged()
        val id = currentUi()?.id
        if (last == null && id != null) {
            last = id
            list.reload { onListChanged?.invoke(); maybeAdoptName() }
            return
        }
        last = id
        onListChanged?.invoke()
        maybeAdoptName()
    }

    /**
     * When the first session in this worktree receives an agent-generated title, hand that title to
     * the worktree so its header stops showing the default branch name. The backend only applies it
     * while the worktree is still default, so a name the user chose is never overwritten. Runs at
     * most once per manager — a resolved adopt (applied or skipped) latches [adopted].
     */
    @RequiresEdt
    private fun maybeAdoptName() {
        if (adopted || adopting) return
        val title = adoptTitle() ?: return
        adopting = true
        val path = worktree.directory
        cs.launch {
            val result = adopt(path, path, title)
            edt {
                adopting = false
                val updated = result.worktree
                when {
                    updated != null -> {
                        adopted = true
                        onAdopted(updated)
                    }
                    result.error == null -> adopted = true // already has a custom name; stop trying
                }
            }
        }
    }

    /**
     * Title of the earliest-created session that already has an agent-generated name, preferring
     * live open sessions over the last listed snapshot. Sessions start with a "New session - <ISO>"
     * placeholder ([isDefaultSessionTitle]); those are skipped so the worktree adopts the real title
     * the agent produces, not the placeholder.
     */
    @RequiresEdt
    private fun adoptTitle(): String? {
        val live = titles()
        return list.sessions()
            .sortedBy { it.time.created }
            .firstNotNullOfOrNull { s ->
                (live[s.id]?.takeIf { it.isNotBlank() } ?: s.title.takeIf { it.isNotBlank() })
                    ?.takeUnless(::isDefaultSessionTitle)
            }
    }

    @RequiresEdt
    open fun deleteSessions(ids: List<String>) {
        val active = ids.filter { it != NEW && it !in deleting }.distinct()
        if (active.isEmpty()) return
        val key = currentKey()
        val names = active.associateWith(::title)
        deleting.addAll(active)
        val target = if (key in active) next(key) else null
        onListChanged?.invoke()
        active.forEach { id ->
            val name = names[id] ?: title(id)
            del(id) { ok, err ->
                deleting.remove(id)
                onListChanged?.invoke()
                if (!ok) notify(KiloBundle.message("worktree.session.delete.failed.title", name), err)
            }
        }
        active.forEach(::forceSession)
        if (key in active) {
            if (target != null) openSession(SessionRef.Local(target)) else newSession()
        }
    }

    @RequiresEdt
    open fun renameSession(id: String, title: String) {
        val name = title.trim()
        if (id == NEW || name.isBlank()) return
        list.rename(id, name) { ok, err ->
            onListChanged?.invoke()
            if (ok) return@rename
            notify(KiloBundle.message("worktree.session.rename.failed.title", name), err)
        }
        onListChanged?.invoke()
    }

    @RequiresEdt
    override fun present(ui: SessionUi?) {
        right.removeAll()
        if (ui != null) right.add(ui, BorderLayout.CENTER)
        right.revalidate()
        right.repaint()
        last = ui?.id
        onPresent?.invoke(currentKey())
    }

    @RequiresEdt
    override fun onSessionsChanged() {
        list.reload { onListChanged?.invoke(); maybeAdoptName() }
    }

    @RequiresEdt
    private fun latest(): SessionDto? {
        return list.sessions()
            .filter { it.id !in deleting }
            .maxByOrNull { it.time.updated }
    }

    @RequiresEdt
    private fun next(key: String?): SessionDto? {
        val rows = HistoryTime.sorted(list.sessions().map { LocalHistoryItem(it) })
            .map { it.session }
        val idx = rows.indexOfFirst { it.id == key }
        if (idx < 0) return rows.firstOrNull { it.id !in deleting }
        return rows.drop(idx + 1).firstOrNull { it.id !in deleting }
            ?: rows.take(idx).asReversed().firstOrNull { it.id !in deleting }
    }

    @RequiresEdt
    private fun title(id: String): String {
        return list.session(id)
            ?.title
            ?.takeIf { it.isNotBlank() }
            ?: KiloBundle.message("worktree.session.untitled")
    }
}

// Mirrors the CLI's Session.isDefaultTitle (packages/opencode/src/session/session.ts): a session
// keeps a "New session - <ISO>" / "Child session - <ISO>" placeholder until the agent names it.
private val DEFAULT_SESSION_TITLE =
    Regex("^(New session - |Child session - )\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$")

internal fun isDefaultSessionTitle(title: String): Boolean = DEFAULT_SESSION_TITLE.matches(title)
