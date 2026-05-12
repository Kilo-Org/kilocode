package ai.kilocode.client.session.ui

import ai.kilocode.client.session.model.SessionModel
import ai.kilocode.client.session.model.SessionModelEvent
import ai.kilocode.client.session.model.SessionState
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionEditorStyleTarget
import ai.kilocode.client.ui.UiStyle
import com.intellij.openapi.Disposable
import com.intellij.ui.AnimatedIcon
import com.intellij.ui.components.JBLabel
import java.awt.FlowLayout

/**
 * Progress footer rendered at the bottom of the session transcript while the
 * agent is working.
 *
 * Reacts to [SessionModelEvent.StateChanged]:
 * - [SessionState.Busy] → shows an animated spinner and [SessionState.Busy.text]
 * - Any other state -> hidden
 *
 * Owned by [SessionMessageListPanel], which always re-anchors it as the last child so it
 * appears below all turn views inside the scroll pane.
 */
class ProgressPanel(
    model: SessionModel,
    parent: Disposable,
) : SessionLayoutPanel(), SessionEditorStyleTarget {

    private val label = JBLabel().apply {
        foreground = UiStyle.Colors.weak()
    }

    init {
        isOpaque = false
        isVisible = false
        layout = FlowLayout(FlowLayout.LEFT, UiStyle.Gap.md(), 0)
        applyStyle(SessionEditorStyle.current())

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
            is SessionState.Loading -> isVisible = false
            else -> isVisible = false
        }
        revalidate()
        repaint()
    }

    override fun applyStyle(style: SessionEditorStyle) {
        label.font = style.uiFont
        revalidate()
        repaint()
    }
}
