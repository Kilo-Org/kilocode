package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.util.edt
import ai.kilocode.rpc.dto.OrphanRemoveResultDto
import com.intellij.notification.Notification
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.Disposable
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.text.StringUtil
import com.intellij.ui.EditorNotificationPanel
import com.intellij.util.concurrency.annotations.RequiresEdt
import kotlinx.coroutines.launch

/**
 * Warning banner for leftover worktree folders (see [ai.kilocode.rpc.dto.OrphanDto]), modelled on
 * [GhBanner]'s warning treatment. Count comes from [WorktreeController.orphans] — the same [reload]
 * that fills the worktree list — so the banner and the list can never disagree about which paths are
 * orphans. Sizes are requested lazily off the EDT and cached until the orphan path set changes.
 */
internal class OrphanBanner(
    private val project: Project,
    private val controller: WorktreeController,
    parent: Disposable,
) : EditorNotificationPanel(Status.Warning) {
    private var syncedCount = -1
    private var syncedSize: Long? = null
    private var syncedPending = false

    /** Path set the cached [sizes] answer for. Empty until the first size pass lands. */
    private var sizedPaths: Set<String> = emptySet()
    private var sizes: Map<String, Long> = emptyMap()

    /** Path set a size fetch is currently in flight for, or null when none is running. */
    private var requested: Set<String>? = null

    /**
     * Path set whose size pass came back with nothing at all. Kept so a failed walk is not retried on
     * every [refresh] — the banner drops the size claim instead, and a changed orphan set asks again.
     */
    private var failed: Set<String>? = null

    init {
        refresh()
    }

    /** Re-reads [WorktreeController.orphans] and updates the banner. Call after every [reload]. */
    @RequiresEdt
    fun refresh() {
        val orphans = controller.orphans
        if (orphans.isEmpty()) {
            sizedPaths = emptySet()
            sizes = emptyMap()
            requested = null
            failed = null
            if (isVisible) {
                isVisible = false
                changed()
            }
            return
        }
        val paths = orphans.mapTo(HashSet()) { it.path }
        if (paths != sizedPaths && paths != requested && paths != failed) {
            requested = paths
            failed = null
            requestSizes(paths)
        }
        // Only a pass that measured *every* path is a total worth showing. orphanSizes omits paths it
        // could not walk and answers empty for a failed batch, so summing a partial answer would
        // report a confident "0 B" (or a silent undercount) for folders that are actually large.
        val total = if (paths == sizedPaths && sizes.keys.containsAll(paths)) sizes.values.sum() else null
        // No total yet, but a walk is still running: say it is being calculated. Once the walk has
        // settled without a full answer, drop the size claim entirely rather than keep promising one.
        val pending = total == null && requested != null
        val dirty = orphans.size != syncedCount || total != syncedSize || pending != syncedPending
        if (dirty) sync(orphans.size, total, pending)
        if (!isVisible) {
            isVisible = true
            changed()
            return
        }
        if (dirty) changed()
    }

    private fun sync(count: Int, total: Long?, pending: Boolean) {
        clear()
        val summary = KiloBundle.message("worktree.orphans.summary", count)
        text(
            when {
                total != null -> KiloBundle.message("worktree.orphans.summarySize", count, StringUtil.formatFileSize(total))
                // Sizing is a background fs walk (see requestSizes/refresh above) — while it is in
                // flight, say so instead of showing the count as if it were the final answer.
                pending -> "$summary \u00b7 ${KiloBundle.message("worktree.orphans.calculating")}"
                else -> summary
            },
        )
        createActionLabel(KiloBundle.message("worktree.orphans.resolve")) { openDialog() }
        syncedCount = count
        syncedSize = total
        syncedPending = pending
    }

    private fun requestSizes(paths: Set<String>) {
        service<KiloAppService>().scope.launch {
            val result = service<KiloWorktreeService>().orphanSizes(controller.directory, paths.toList())
            edt {
                if (requested != paths) return@edt
                // A wholly empty answer means the walk failed, not that the folders are empty. Remember
                // the failure instead of caching it as a 0-byte answer, so refresh stops claiming a size
                // without re-running the failing walk on every reload.
                if (result.isEmpty()) {
                    failed = paths
                } else {
                    sizedPaths = paths
                    sizes = result
                }
                requested = null
                refresh()
            }
        }
    }

    @RequiresEdt
    private fun openDialog() {
        val dialog = OrphanDialog(this, project, controller.orphans, sizes)
        if (!dialog.showAndGet()) return
        val selected = dialog.result()
        if (selected.isNullOrEmpty()) return
        // The apparent size of what was asked to be removed, from the same cache the dialog showed —
        // not a promise of freed disk space (APFS clones/reflinks and block rounding can differ), just
        // the number the user already saw and agreed to.
        val requestedSize = selected.sumOf { sizes[it] ?: 0L }
        service<KiloAppService>().scope.launch {
            val result = service<KiloWorktreeService>().removeOrphans(controller.directory, selected)
            edt {
                notify(result.results, requestedSize)
                controller.reload()
            }
        }
    }

    private fun notify(results: List<OrphanRemoveResultDto>, requestedSize: Long) {
        val ok = results.count { it.ok }
        val total = results.size
        val (type, title) = when {
            ok == total -> NotificationType.INFORMATION to
                KiloBundle.message("worktree.orphans.notification.success", ok, StringUtil.formatFileSize(requestedSize))
            ok > 0 -> NotificationType.WARNING to
                KiloBundle.message("worktree.orphans.notification.partial", ok, total, total - ok)
            else -> NotificationType.ERROR to KiloBundle.message("worktree.orphans.notification.failure")
        }
        val notification = NotificationGroupManager.getInstance().getNotificationGroup("Kilo Code")
            ?.createNotification(title, "", type)
            ?: Notification("Kilo Code", title, "", type)
        notification.notify(project)
    }

    private fun changed() {
        parent?.revalidate()
        parent?.repaint()
    }
}
