package ai.kilocode.client.ui.diagram.ui

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.selection.SessionCopyTarget
import ai.kilocode.client.session.views.MessageToolbar
import ai.kilocode.client.session.views.SessionViewIcons
import ai.kilocode.client.ui.ToolbarButtonAction
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.StackAxis
import com.intellij.util.concurrency.annotations.RequiresEdt
import java.awt.image.BufferedImage
import javax.swing.JComponent

/**
 * Container for one rendered diagram plus its source fallback.
 *
 * The block, not the painted [DiagramPanel], is the hover target so the floating toolbar stays put
 * while the pointer travels between the diagram and the toggle row underneath it. Copy is paired with
 * the standard open-in-editor action, matching the affordances of the code block it replaces.
 */
internal class DiagramBlock : Stack(StackAxis.VERTICAL, UiStyle.Gap.sm()), SessionCopyTarget {
    /** Source of the fence text; the owning view rebinds it as the diagram streams or updates. */
    var text: () -> String = { "" }

    /** The rendered diagram, when there is one; copy prefers it over the fence text. */
    var image: () -> BufferedImage? = { null }

    private val bar = MessageToolbar(
        text = { text() },
        image = { image() },
        actions = listOf(
            ToolbarButtonAction(SessionViewIcons.openDiff, KiloBundle.message("diagram.open")) {
                openDiagram(this, text())
            },
        ),
    )

    override val copyAnchor: JComponent get() = this

    override val copyToolbar: JComponent get() = bar

    override val copyCorner: Boolean get() = true

    @RequiresEdt
    override fun copyText() = text()
}
