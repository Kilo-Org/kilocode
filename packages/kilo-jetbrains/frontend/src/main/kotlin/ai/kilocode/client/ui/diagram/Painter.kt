package ai.kilocode.client.ui.diagram

import java.awt.Graphics2D

internal interface Painter {
    fun accepts(art: Art): Boolean
    fun size(art: Art): Size
    fun paint(g: Graphics2D, art: Art, palette: Palette)
}

internal object Painters {
    private val all = listOf<Painter>(ScenePainter)

    fun of(art: Art) = all.first { it.accepts(art) }
}
