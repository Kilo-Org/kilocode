package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.rpc.dto.RunConfigDto
import ai.kilocode.rpc.dto.RunProcessState
import ai.kilocode.rpc.dto.RunStateDto
import com.intellij.icons.AllIcons
import com.intellij.ide.ui.ProductIcons
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.project.DumbAwareAction
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
                // An orphan row is a process the backend found still alive after its Run tab was gone,
                // so there is no console to bring to the front.
                if (!state.orphan) {
                    group.add(
                        action(KiloBundle.message("worktree.run.output", state.name), AllIcons.Debugger.Console) { output(state) },
                    )
                }
            }
            group.addSeparator(KiloBundle.message("worktree.run.section.start"))
        }
        val running = states.map { it.id }.toSet()
        for (cfg in configs) {
            // Badged over the run action icon rather than WorktreeIcons.runIndicator's neutral triangle:
            // every other row here is a green Execute glyph, so a started row reads as one of them
            // wearing the live dot instead of a different icon altogether.
            val icon = if (cfg.id in running) WorktreeIcons.live(AllIcons.Actions.Execute) else AllIcons.Actions.Execute
            val text = cfg.via?.let { KiloBundle.message("worktree.run.via", cfg.type, it) } ?: cfg.type
            group.add(action(cfg.name, icon, description = text) { run(cfg) })
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

    /**
     * Dumb-aware, matching how the platform treats its own run actions: `ExecutorAction`,
     * `RunConfigurationsComboBoxAction`, and `BaseRunConfigurationAction` are all `DumbAware` so the
     * run UI stays live during indexing, and the decision about whether a given configuration may
     * actually start is made separately, against `ConfigurationType.isDumbAware`.
     *
     * We keep the first half and cannot express the second: these items carry `RunConfigDto`s fetched
     * over RPC rather than local `RunnerAndConfigurationSettings`, so there is no `ConfigurationType`
     * to consult, and the host project's dumb state describes the wrong project anyway — the run
     * happens in the worktree. So readiness is the backend's call, surfaced through the existing
     * `worktree.run.failed` notification rather than a dead menu item.
     */
    private fun action(
        text: String,
        icon: Icon?,
        description: String? = null,
        enabled: Boolean = true,
        handler: () -> Unit,
    ): AnAction = object : DumbAwareAction(text, description, icon) {
        override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

        override fun update(e: AnActionEvent) {
            e.presentation.isEnabled = enabled
        }

        override fun actionPerformed(e: AnActionEvent) = handler()
    }
}
