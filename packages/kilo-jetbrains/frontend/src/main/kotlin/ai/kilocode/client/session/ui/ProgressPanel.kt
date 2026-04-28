package ai.kilocode.client.session.ui

import ai.kilocode.client.session.model.SessionModel
import ai.kilocode.client.session.model.SessionModelEvent
import ai.kilocode.client.session.model.SessionState
import com.intellij.openapi.Disposable
import com.intellij.ui.AnimatedIcon
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.FlowLayout

/**
 * Progress footer rendered at the bottom of the session transcript while the
 * agent is working.
 *
 * Reacts to [SessionModelEvent.StateChanged]:
 * - [SessionState.Busy] → shows an animated spinner and [SessionState.Busy.text]
 * - Any other state → hidden
 *
 * Owned by [SessionPanel], which always re-anchors it as the last child so it
 * appears below all turn views inside the scroll pane.
 */
class ProgressPanel(
    model: SessionModel,
    parent: Disposable,
) : SessionLayoutPanel() {

    private val label = JBLabel().apply {
        foreground = UIUtil.getContextHelpForeground()
        font = JBUI.Fonts.label()
    }

    init {
        isOpaque = false
        isVisible = false
        layout = FlowLayout(FlowLayout.LEFT, JBUI.scale(6), 0)
        border = JBUI.Borders.empty(JBUI.scale(6), 0, JBUI.scale(4), 0)

        add(JBLabel(AnimatedIcon.Default()))
        add(label)

        model.addListener(parent) { event ->
            if (event is SessionModelEvent.StateChanged) onState(event.state)
        }
    }

    /** Exposed for test assertions. */
    fun labelText(): String = label.text

    private fun onState(state: SessionState) {
        when (state) {
            is SessionState.Busy -> {
                label.text = state.text
                isVisible = true
            }
            else -> isVisible = false
        }
        revalidate()
        repaint()
    }
}
