package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.rpc.dto.RunConfigDto
import ai.kilocode.rpc.dto.RunProcessState
import ai.kilocode.rpc.dto.RunStateDto
import com.intellij.execution.runners.ExecutionUtil
import com.intellij.icons.AllIcons
import com.intellij.ide.ui.ProductIcons
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DefaultActionGroup
import javax.swing.Icon

/**
 * Builds the action group for the worktree Run popup: a "Running" section with stop/output
 * rows per live process, a "Start" section listing the supported run configurations, Build and
 * Rebuild rows when the project has a buildable external project, and a trailing
 * "Open in New Frame" escape hatch for full run/debug support.
 */
internal object WorktreeRunPopup {
    fun group(
        configs: List<RunConfigDto>,
        error: String?,
        states: List<RunStateDto>,
        run: (RunConfigDto) -> Unit,
        stop: (RunStateDto) -> Unit,
        output: (RunStateDto) -> Unit,
        frame: () -> Unit,
        buildable: Boolean,
        build: (Boolean) -> Unit,
    ): DefaultActionGroup {
        val group = DefaultActionGroup()
        if (states.isNotEmpty()) {
            group.addSeparator(KiloBundle.message("worktree.run.section.running"))
            for (state in states) {
                // Mirrors the platform Stop button: it turns into Kill once the process is
                // terminating, and stays disabled when the handler cannot be force-killed.
                val terminating = state.state == RunProcessState.STOPPING
                group.add(
                    action(
                        KiloBundle.message(if (terminating) "worktree.run.kill" else "worktree.run.stop", state.name),
                        if (terminating) AllIcons.Debugger.KillProcess else AllIcons.Actions.Suspend,
                        enabled = !terminating || state.killable,
                    ) { stop(state) },
                )
                group.add(
                    action(KiloBundle.message("worktree.run.output", state.name), AllIcons.Debugger.Console) { output(state) },
                )
            }
            group.addSeparator(KiloBundle.message("worktree.run.section.start"))
        }
        val running = states.map { it.id }.toSet()
        for (cfg in configs) {
            val icon = if (cfg.id in running) ExecutionUtil.getLiveIndicator(AllIcons.Actions.Execute) else AllIcons.Actions.Execute
            group.add(action(cfg.name, icon, description = cfg.type) { run(cfg) })
        }
        if (configs.isEmpty()) {
            group.add(action(error ?: KiloBundle.message("worktree.run.empty"), null, enabled = false) {})
        }
        if (buildable) {
            group.addSeparator()
            group.add(action(KiloBundle.message("worktree.run.build"), AllIcons.Actions.Compile) { build(false) })
            group.add(action(KiloBundle.message("worktree.run.rebuild"), AllIcons.Actions.Rebuild) { build(true) })
        }
        group.addSeparator()
        group.add(action(KiloBundle.message("worktree.run.open.frame"), ProductIcons.getInstance().productIcon) { frame() })
        return group
    }

    private fun action(
        text: String,
        icon: Icon?,
        description: String? = null,
        enabled: Boolean = true,
        handler: () -> Unit,
    ): AnAction = object : AnAction(text, description, icon) {
        override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

        override fun update(e: AnActionEvent) {
            e.presentation.isEnabled = enabled
        }

        override fun actionPerformed(e: AnActionEvent) = handler()
    }
}
