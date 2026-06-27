package ai.kilocode.client.settings.agents

import ai.kilocode.client.settings.base.DraftReadyConfigurable
import com.intellij.openapi.project.ProjectManager
import kotlinx.coroutines.CoroutineScope
import javax.swing.JComponent

abstract class AgentBehaviorConfigurableBase<T : JComponent> : DraftReadyConfigurable<T>() {
    final override fun create(cs: CoroutineScope): T {
        val dir = ProjectManager.getInstance().openProjects.firstOrNull { !it.isDefault }?.basePath.orEmpty()
        return create(cs, dir)
    }

    protected abstract fun create(cs: CoroutineScope, dir: String): T
}
