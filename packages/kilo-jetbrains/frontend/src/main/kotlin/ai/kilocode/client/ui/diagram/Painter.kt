package ai.kilocode.client.ui.diagram

import java.awt.Graphics2D

internal interface Painter {
    fun accepts(art: Art): Boolean
    fun size(art: Art): Size
    fun paint(g: Graphics2D, art: Art, palette: Palette)
}

internal object Painters {
    private val all = listOf<Painter>(ScenePainter)

    /**
     * Never throws: an [Art] no painter accepts draws nothing and measures empty.
     *
     * `first { }` here would turn a future art type without a painter into an exception on the EDT, in
     * paint and in sizing, where there is no way back to the source fallback.
     */
    fun of(art: Art): Painter = all.firstOrNull { it.accepts(art) } ?: Blank

    private object Blank : Painter {
        override fun accepts(art: Art) = false

        override fun size(art: Art) = Size(0.0, 0.0)

        override fun paint(g: Graphics2D, art: Art, palette: Palette) = Unit
    }
}
