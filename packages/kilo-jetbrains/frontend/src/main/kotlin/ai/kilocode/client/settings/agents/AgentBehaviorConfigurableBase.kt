package ai.kilocode.client.settings.agents

import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.settings.base.DraftReadyConfigurable
import ai.kilocode.client.settings.base.SettingsListPanel
import ai.kilocode.log.KiloLog
import com.intellij.openapi.application.EDT
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.application.asContextElement
import com.intellij.openapi.components.service
import com.intellij.openapi.project.ProjectManager
import com.intellij.platform.project.projectIdOrNull
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.swing.JComponent

abstract class AgentBehaviorConfigurableBase<T : JComponent> : DraftReadyConfigurable<T>() {
    final override fun create(cs: CoroutineScope): T {
        val projects = ProjectManager.getInstance().openProjects.filter { !it.isDefault }
        val ctx = project?.takeIf { !it.isDefault }
        val selected = ctx ?: projects.singleOrNull() ?: projects.firstOrNull()
        val hint = selected?.basePath.orEmpty()
        val ui = create(cs, hint)
        if (hint.isBlank()) {
            LOG.warn("agent behavior settings directory unavailable projects=${projects.size}")
            return ui
        }
        (ui as? SettingsListPanel)?.deferInitialReload()
        cs.launch {
            val dir = service<KiloWorkspaceService>().resolveProjectDirectory(selected?.projectIdOrNull(), hint)
            LOG.info("agent behavior settings directory selected dir=$dir hint=$hint context=${ctx == selected} projects=${projects.size}")
            withContext(Dispatchers.EDT + ModalityState.any().asContextElement()) {
                update(ui, dir)
                (ui as? SettingsListPanel)?.reload()
            }
        }
        return ui
    }

    override fun onReadyComponentCreated(component: JComponent) {
        if (component is SettingsListPanel && component.hasPendingInitialReload()) return
        (component as? SettingsListPanel)?.reload()
    }

    protected abstract fun create(cs: CoroutineScope, dir: String): T

    protected open fun update(ui: T, dir: String) = Unit

    private companion object {
        val LOG = KiloLog.create(AgentBehaviorConfigurableBase::class.java)
    }
}
