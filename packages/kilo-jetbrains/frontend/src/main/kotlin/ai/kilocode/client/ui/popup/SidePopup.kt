package ai.kilocode.client.ui.popup

import com.intellij.openapi.Disposable
import com.intellij.openapi.ui.popup.Balloon
import java.awt.Color
import java.awt.Point
import javax.swing.JComponent

/**
 * The body of a side popup, as [SidePopupController] needs to see it: something to show, a lifetime to
 * end when the popup closes, a fill color to match, and a way to be clamped to the room available.
 *
 * An interface rather than a concrete type so the controller can live in this package without depending
 * on the session UI, whose `HeaderPopupBody` is the main implementation.
 */
internal interface SidePopupContent {
    val component: JComponent
    val disposable: Disposable
    val background: Color

    /** Clamps the body to the space available beside the subject, in already-scaled device px. */
    fun fitWithin(width: Int, height: Int)
}

/** Resolved balloon placement, in [pane] coordinates. */
internal class SidePopupSpot(
    val pane: JComponent,
    val point: Point,
    val position: Balloon.Position,
    val distance: Int,
)

/**
 * One popup: how to build its body, where to put it once built, and a hook for when it appeared.
 *
 * [place] runs after [build] because placement depends on the body's measured height, and it may answer
 * null when the subject is not on screen — there is then nothing to sit beside.
 */
internal class SidePopupRequest(
    val build: () -> SidePopupContent,
    val place: (SidePopupContent) -> SidePopupSpot?,
    val shown: () -> Unit = {},
)
