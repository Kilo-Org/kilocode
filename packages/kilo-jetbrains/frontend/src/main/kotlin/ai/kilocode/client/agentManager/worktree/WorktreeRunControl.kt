package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.telemetry.Telemetry
import ai.kilocode.client.ui.ToolbarButtonAction
import ai.kilocode.client.ui.hoverTextButton
import ai.kilocode.client.util.edt
import ai.kilocode.rpc.dto.RunConfigDto
import ai.kilocode.rpc.dto.RunConfigListDto
import ai.kilocode.rpc.dto.RunStateDto
import com.intellij.execution.runners.ExecutionUtil
import com.intellij.icons.AllIcons
import com.intellij.ide.DataManager
import com.intellij.notification.Notification
import com.intellij.notification.NotificationType
import com.intellij.openapi.Disposable
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.openapi.util.Disposer
import com.intellij.ui.popup.AbstractPopup
import com.intellij.util.concurrency.annotations.RequiresEdt
import ai.kilocode.log.KiloLog
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import javax.swing.SwingConstants

/**
 * The worktree editor's Run control: a header button that opens a popup listing the project's
 * supported run configurations (see the backend `WorktreeRunAdapter`) and the processes
 * currently running in this worktree. The button shows the platform live indicator while
 * anything runs; output lives in the native Run tool window.
 */
internal class WorktreeRunControl(
    private val project: Project,
    private val parent: Disposable,
    private val worktree: String,
    private val frame: () -> Unit,
) {
    private companion object {
        private val LOG = KiloLog.create(WorktreeRunControl::class.java)
    }

    private val cs = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var states: List<RunStateDto> = emptyList() // EDT-only

    val button = hoverTextButton(
        ToolbarButtonAction(AllIcons.Actions.Execute, KiloBundle.message("worktree.run.action")) { open() },
        tooltip = KiloBundle.message("worktree.run.tooltip"),
    )

    init {
        val repo = project.basePath
        val key = normalizeWorktreePath(worktree)
        if (repo != null) {
            cs.launch {
                service<KiloRunService>().states(repo)
                    .catch { err -> LOG.warn("run states stream failed for $repo", err) }
                    .collectLatest { all ->
                        val mine = all.filter { normalizeWorktreePath(it.worktree) == key }
                        alive { sync(mine) }
                    }
            }
        }
        Disposer.register(parent) { cs.cancel() }
    }

    @RequiresEdt
    private fun sync(next: List<RunStateDto>) {
        if (states == next) return
        states = next
        button.icon = if (next.isEmpty()) AllIcons.Actions.Execute else ExecutionUtil.getLiveIndicator(AllIcons.Actions.Execute)
    }

    @RequiresEdt
    private fun open() {
        val repo = project.basePath ?: return
        cs.launch {
            val list = service<KiloRunService>().configs(repo)
            alive { popup(repo, list) }
        }
    }

    @RequiresEdt
    private fun popup(repo: String, list: RunConfigListDto) {
        val group = WorktreeRunPopup.group(
            configs = list.configs,
            error = list.error,
            states = states,
            run = { cfg -> start(repo, cfg) },
            stop = { state ->
                Telemetry.send("Worktree Run Config Stopped", mapOf("surface" to "worktree_toolbar"))
                service<KiloRunService>().stopInBackground(repo, state.id, worktree)
            },
            output = { state -> service<KiloRunService>().focusInBackground(repo, state.id, worktree) },
            frame = frame,
        )
        val popup = JBPopupFactory.getInstance().createActionGroupPopup(
            KiloBundle.message("worktree.run.popup.title"),
            group,
            DataManager.getInstance().getDataContext(button),
            JBPopupFactory.ActionSelectionAid.SPEEDSEARCH,
            true,
        )
        // Not part of the JBPopup interface, but AbstractPopup.setAdText is the platform's own
        // popup hint slot (used by IDE popups); degrade to no hint if the impl ever changes.
        (popup as? AbstractPopup)?.setAdText(KiloBundle.message("worktree.run.hint"), SwingConstants.LEFT)
        popup.showUnderneathOf(button)
    }

    private fun start(repo: String, cfg: RunConfigDto) {
        Telemetry.send("Worktree Run Config Started", mapOf("type" to cfg.type))
        service<KiloRunService>().runInBackground(repo, cfg.id, worktree) { result ->
            val error = result.error ?: return@runInBackground
            alive {
                Notification("Kilo Code", KiloBundle.message("worktree.run.failed", cfg.name, error), NotificationType.ERROR)
                    .notify(project)
            }
        }
    }

    private fun alive(block: () -> Unit) = edt({ !project.isDisposed && !Disposer.isDisposed(parent) }, block)
}
