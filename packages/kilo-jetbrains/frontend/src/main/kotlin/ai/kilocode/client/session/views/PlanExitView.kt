package ai.kilocode.client.session.views

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.base.PartView
import com.intellij.ui.HyperlinkLabel
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout

/**
 * Renders a completed [plan_exit] tool call as a link-styled "Plan is ready" item.
 *
 * No click handler is installed in this pass — the link styling indicates an affordance
 * for future file navigation. Use [canRender] to check eligibility before creating.
 */
class PlanExitView(tool: Tool) : PartView() {

    override val contentId: String = tool.id

    private val link = HyperlinkLabel(KiloBundle.message("plan.exit.ready"))

    init {
        layout = BorderLayout()
        border = JBUI.Borders.empty(
            JBUI.scale(SessionUiStyle.View.CARD_VERTICAL_PADDING),
            JBUI.scale(SessionUiStyle.View.CARD_HORIZONTAL_PADDING),
        )
        add(link, BorderLayout.WEST)
    }

    override fun update(content: Content) {
        // No mutable state to sync; plan_exit only has one terminal state (COMPLETED).
    }

    override fun dumpLabel(): String = "PlanExitView#$contentId(${link.text})"

    companion object {
        fun canRender(tool: Tool): Boolean =
            tool.name == "plan_exit" && tool.state == ToolExecState.COMPLETED
    }
}
