package ai.kilocode.client.session.ui

import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.LayeredOverlayPanel
import java.awt.Color

class SessionRootPanel(
    private val sessionOverlay: Overlay = Overlay(),
    private val sessionBlocker: Blocker = Blocker(),
) : LayeredOverlayPanel(overlay = sessionOverlay, blocker = sessionBlocker) {
    init {
        content.isOpaque = false
    }

    override fun isOpaque(): Boolean {
        return true
    }

    override fun getBackground(): Color {
        return SessionUiStyle.Colors.sessionBackground()
    }

    override val overlay: Overlay get() = sessionOverlay

    override val blocker: Blocker get() = sessionBlocker

    class Overlay : LayeredOverlayPanel.Overlay()

    class Blocker : LayeredOverlayPanel.Blocker() {
        override fun getBackground(): Color {
            return SessionUiStyle.Colors.sessionBackground()
        }
    }
}
