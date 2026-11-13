package ai.kilocode.client.ui.tree

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.UiStyle
import com.intellij.openapi.actionSystem.ActionGroup
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DataKey
import com.intellij.openapi.actionSystem.ToggleAction
import com.intellij.openapi.project.DumbAware
import com.intellij.ui.scale.JBUIScale
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.ColorIcon

internal object ActiveTreeColors {
    val keys = UiStyle.Colors.sections.keys.toList()

    fun color(key: String?) = key?.let(UiStyle.Colors.sections::get)

    @RequiresEdt
    fun group(data: DataKey<String>, current: (String) -> String?, change: (String, String) -> Unit): ActionGroup =
        object : ActionGroup(), DumbAware {
            private val actions = keys.map { key ->
                object : ToggleAction(KiloBundle.message("activeTree.color.$key")), DumbAware {
                    override fun getActionUpdateThread() = ActionUpdateThread.EDT

                    override fun isSelected(e: AnActionEvent) = e.getData(data)?.let(current) == key

                    override fun setSelected(e: AnActionEvent, state: Boolean) {
                        if (!state) return
                        e.getData(data)?.let { change(it, key) }
                    }

                    override fun update(e: AnActionEvent) {
                        super.update(e)
                        e.presentation.isEnabled = e.getData(data) != null
                        e.presentation.icon = JBUIScale.scaleIcon(ColorIcon(SIZE, SIZE, DOT, DOT,
                            UiStyle.Colors.sections.getValue(key), false, DOT))
                    }
                }
            }.toTypedArray()

            override fun getChildren(e: AnActionEvent?) = actions
        }

    private const val SIZE = 16
    private const val DOT = 12
}
