package ai.kilocode.client.ui

import ai.kilocode.client.ui.layout.Stack
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBFont
import com.intellij.util.ui.JBUI
import java.awt.Color
import java.awt.Dimension
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.GridBagLayout
import java.awt.RenderingHints
import javax.swing.JPanel

internal class DiffStatBadge(
    additions: Int,
    deletions: Int,
    private val variant: Variant = Variant.REGULAR,
    /** Extra trailing padding, as an unscaled [UiStyle.Gap] step. */
    private val inset: Int = 0,
    // When false the badge paints only its text, without the rounded background pill or padding.
    private val fill: Boolean = true,
) : JPanel(GridBagLayout()), DiffBadge {
    constructor(additions: Int, deletions: Int) : this(additions, deletions, Variant.REGULAR, 0)

    internal enum class Variant {
        REGULAR,
        COMPACT;

        /** Unscaled pill height, for the borders and insets that scale what they are handed. */
        fun size() = when (this) {
            REGULAR -> 16
            COMPACT -> 14
        }

        fun height() = JBUI.scale(size())

        fun gap() = when (this) {
            REGULAR -> UiStyle.Gap.sm()
            COMPACT -> UiStyle.Gap.xs()
        }

        /** Unscaled horizontal padding step; [JBUI.Borders] scales what it is handed. */
        fun pad() = UiStyle.Gap.SM
    }

    // JBFont rescales itself when the IDE font changes, so assigning it once is enough for the text.
    private val removed = JBLabel().apply {
        foreground = UiStyle.Colors.removedForeground()
        font = JBFont.small()
    }
    private val added = JBLabel().apply {
        foreground = UiStyle.Colors.addedForeground()
        font = JBFont.small()
    }
    private lateinit var row: Stack

    /**
     * Marks the counts as belonging to a branch that no longer merges into its base.
     *
     * Painted as a filled circle behind the pill, offset so part of it clears the pill's trailing edge. The
     * pill keeps its own background, its geometry, and its text, so the marker reads as something sitting
     * behind the badge rather than as another figure inside it — a row scanned from the left still reads the
     * counts first and the state of the merge after them.
     *
     * The room it needs is trailing padding, which is why it cannot cover a neighbour and why the counts do
     * not shift when it appears.
     */
    var conflict: Boolean = false
        set(value) {
            if (field == value) return
            field = value
            syncScale()
            revalidate()
            repaint()
        }

    init {
        isOpaque = false
        row = Stack.horizontal(variant.gap()).next(removed).next(added)
        add(row)
        syncScale()
        update(additions, deletions)
    }

    override fun updateUI() {
        super.updateUI()
        // JPanel's constructor runs updateUI() before the fields above exist.
        if (this::row.isInitialized) syncScale()
    }

    /** A layout manager captures its gap once, so re-derive the spacing for the current scale. */
    private fun syncScale() {
        border = if (fill) {
            JBUI.Borders.empty(0, variant.pad(), 0, variant.pad() + inset + overhang())
        } else {
            JBUI.Borders.empty()
        }
        row.space = variant.gap()
    }

    override fun getPreferredSize(): Dimension {
        val dim = super.getPreferredSize()
        return Dimension(dim.width, variant.height())
    }

    /**
     * Unscaled room past the pill for the part of the conflict marker that clears it.
     *
     * A third of the marker's diameter rather than the half that would centre it on the pill's edge: sunk
     * that much deeper, the circle's arc meets the pill's own trailing cap at a shallow angle and the two
     * read as one swollen end rather than as a disc parked behind a pill.
     *
     * Zero without a pill to sit behind: a fill-less badge paints text alone, and a circle behind bare text
     * would be a blob with nothing to explain it.
     */
    private fun overhang() = if (conflict && fill) variant.size() / 3 else 0

    override fun update(additions: Int, deletions: Int) {
        removed.isVisible = deletions > 0
        added.isVisible = additions > 0
        if (removed.isVisible) removed.text = "-$deletions"
        if (added.isVisible) added.text = "+$additions"
    }

    override fun paintComponent(g: Graphics) {
        if (!fill) {
            super.paintComponent(g)
            return
        }
        val g2 = g.create() as Graphics2D
        try {
            val over = JBUI.scale(overhang())
            val w = maxOf(0, width - JBUI.scale(inset) - over)
            val h = minOf(height, variant.height())
            val y = (height - h) / 2
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            if (over > 0) {
                // Drawn first so the pill covers it: the circle is the pill's own trailing cap shifted out
                // by [overhang], which leaves the two curves crossing rather than a tab stuck on the side.
                g2.color = UiStyle.Badge.ActivityError.bg()
                g2.fillOval(w + over - h, y, h, h)
            }
            g2.color = backgroundColor()
            g2.fillRoundRect(0, y, w, h, h, h)
        } finally {
            g2.dispose()
        }
        super.paintComponent(g)
    }

    internal fun removedLabelForTest() = removed

    internal fun addedLabelForTest() = added
}

private fun backgroundColor(): Color = JBColor.namedColor(
    "Kilo.DiffStat.background",
    JBColor(Color(0x26, 0x26, 0x26), Color(0x26, 0x26, 0x26)),
)
