package ai.kilocode.client.session

import ai.kilocode.client.ui.UiStyle
import com.intellij.ui.AnimatedIcon
import com.intellij.ui.ColorUtil
import com.intellij.util.ui.JBUI
import java.awt.Color
import java.awt.Component
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import java.awt.geom.Ellipse2D
import javax.swing.Icon
import kotlin.math.cos

/**
 * Deterministic per-subagent identity, ported field-for-field from the web client's generated
 * avatar so a subagent reads with the same recognizable shape and color slot in JetBrains as it
 * does in VS Code. See `packages/kilo-ui/src/components/agent-avatar-identity.ts` for the source of
 * truth; keep this object in lock-step with that file rather than reinterpreting the algorithm.
 */
internal object AgentAvatarIdentity {
    const val COLORS = 8
    private const val HALF = 15

    // MIN..MAX connected half-cells grown per identity (web: MIN=6, MAX=9).
    private const val MIN = 6
    private const val SPAN = 4

    private val FNV_PRIME = 16777619u
    private val SHAPE_SEED = 2166136261u
    private val TONE_SEED = 0x9747b28cu
    private val RANK_MULTIPLIER = 0x27d4eb2du

    /** [color] is the identity's preferred hue slot, or null for the neutral "unknown" glyph. */
    data class Identity(val color: Int?, val cells: Set<Int>)

    /**
     * Assigns sibling colors in spawn order: each id keeps its hashed hue while free, otherwise the
     * next free hue, so the first [COLORS] siblings never share a color. After that, colors repeat
     * and the glyph shape is what tells siblings apart. Mirrors `palette()` in
     * `agent-avatar-identity.ts`.
     */
    fun palette(ids: List<String>): Map<String, Int> {
        val used = mutableSetOf<Int>()
        val result = LinkedHashMap<String, Int>()
        for (id in ids) {
            if (result.containsKey(id)) continue
            val color = identity(id).color ?: continue
            if (used.size >= COLORS) used.clear()
            val pick = (0 until COLORS).map { (color + it) % COLORS }.firstOrNull { it !in used } ?: continue
            used.add(pick)
            result[id] = pick
        }
        return result
    }

    /** Mirrors `identity()` in `agent-avatar-identity.ts`. */
    fun identity(id: String): Identity {
        val known = id.trim().isNotEmpty() && id != "unknown"
        if (!known) {
            val neutral = setOf(4, 7, 10, 13)
            return Identity(null, expand { it in neutral })
        }
        val shape = fnv(id, SHAPE_SEED)
        val tone = fnv(id, TONE_SEED)
        val count = MIN + (tone % SPAN.toUInt()).toInt()
        fun rank(index: Int): UInt = (shape xor (index + 1).toUInt()) * RANK_MULTIPLIER
        val lit = mutableSetOf(2 + (shape % 5u).toInt() * 3)
        while (lit.size < count) {
            val edge = (0 until HALF).filter { index ->
                if (index in lit) return@filter false
                if (index == 0 || index == 12) return@filter false
                val row = index / 3
                val col = index % 3
                (col > 0 && (index - 1) in lit) ||
                    (col < 2 && (index + 1) in lit) ||
                    (row > 0 && (index - 3) in lit) ||
                    (row < 4 && (index + 3) in lit)
            }
            val next = edge.reduce { best, index -> if (rank(index) > rank(best)) index else best }
            lit.add(next)
        }
        val color = ((tone shr 4) % COLORS.toUInt()).toInt()
        return Identity(color, expand { it in lit })
    }

    /** 32-bit FNV-1a-style hash, matching the JS `Math.imul` + `>>> 0` unsigned overflow semantics. */
    private fun fnv(input: String, seed: UInt): UInt {
        var hash = seed
        for (ch in input) hash = (hash xor ch.code.toUInt()) * FNV_PRIME
        return hash
    }

    /**
     * Mirrors three half-grid columns into a five-column grid, like [SpinnerIcon]'s 4x4 grid. [half]
     * is indexed on a 5-row, 3-column grid (0..14); column `c` maps to full-grid columns `c` and
     * `4 - c`, so column 2 only maps to the center column.
     */
    private fun expand(half: (Int) -> Boolean): Set<Int> = (0 until 25).filter { index ->
        val x = index % 5
        half((index / 5) * 3 + minOf(x, 4 - x))
    }.toSet()
}

/**
 * Renders [AgentAvatarIdentity] as an inline row icon: a 5x5 dot grid with the four corners
 * removed, matching the web client's generated avatar (see
 * `packages/kilo-ui/src/components/agent-avatar.tsx` and `agent-avatar.css`). The static icon shows
 * the identity at rest; the running icon additionally pulses the faint surrounding dots so the
 * recognizable lit glyph stays solid while the subagent is active — never the only signal of state,
 * since callers keep their own adjacent status text/icon.
 *
 * Built on [com.intellij.ui.AnimatedIcon], the same platform pattern [SpinnerIcon] uses, so it
 * animates automatically inside list cell renderers that opt in via
 * `AnimatedIcon.ANIMATION_IN_RENDERER_ALLOWED` and needs no timer, coroutine, or disposal.
 */
internal object AgentAvatar {
    private val CORNERS = setOf(0, 4, 20, 24)
    private val GRID = (0 until 25).filter { it !in CORNERS }
    private const val VIEWBOX = 19f
    private const val PITCH = 4f
    private const val RADIUS = 1.5f

    private const val FRAMES = 14
    private const val CYCLE_MS = 1400
    private val DELAY = CYCLE_MS / FRAMES
    private const val UNLIT_LO = 0.1
    private const val UNLIT_HI = 0.45
    private const val LIT_ALPHA = 1.0
    private const val STATIC_UNLIT_ALPHA = 0.1

    /** Static glyph for [id], used at rest (pending/completed/error/cancelled). */
    fun static(id: String, color: Int? = null): Icon {
        val identity = AgentAvatarIdentity.identity(id)
        return Frame(identity.cells, color ?: identity.color, frame = null)
    }

    /** Animated glyph for [id], used while the subagent is actively running. */
    fun running(id: String, color: Int? = null): Icon {
        val identity = AgentAvatarIdentity.identity(id)
        val resolved = color ?: identity.color
        return AnimatedIcon(DELAY, *Array(FRAMES) { Frame(identity.cells, resolved, it) })
    }

    /** Ease-in-out 0..1..0 wave, matching the web client's CSS `ease-in-out` opacity pulses. */
    private fun ease(t: Float): Float = ((1f - cos(2.0 * Math.PI * t)) / 2.0).toFloat()

    /**
     * Per-cell phase fraction, matching the web client's `-(((cell * 7) % 11) / 11) * 1.4s` negative
     * animation-delay: a negative delay shifts the effective local time forward by the same amount,
     * so each cell's progress is `frame/FRAMES + phase(cell)`.
     */
    private fun phase(cell: Int): Float = ((cell * 7) % 11) / 11f

    private fun colorFor(index: Int?): Color = if (index == null) UiStyle.Colors.weak() else UiStyle.Colors.avatarHue(index)

    private class Frame(
        private val cells: Set<Int>,
        private val color: Int?,
        private val frame: Int?,
    ) : Icon {
        override fun getIconWidth() = JBUI.scale(16)

        override fun getIconHeight() = JBUI.scale(16)

        override fun paintIcon(c: Component?, g: Graphics, x: Int, y: Int) {
            val g2 = g.create() as Graphics2D
            try {
                g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
                g2.translate(x, y)
                val scale = iconWidth / VIEWBOX
                val base = colorFor(color)
                val diameter = RADIUS * 2f * scale
                for (cell in GRID) {
                    val lit = cell in cells
                    val alpha = when {
                        lit -> LIT_ALPHA
                        frame == null -> STATIC_UNLIT_ALPHA
                        else -> UNLIT_LO + (UNLIT_HI - UNLIT_LO) * ease(frame.toFloat() / FRAMES + phase(cell))
                    }
                    g2.color = ColorUtil.withAlpha(base, alpha)
                    val cx = ((cell % 5) * PITCH + RADIUS) * scale
                    val cy = ((cell / 5) * PITCH + RADIUS) * scale
                    g2.fill(Ellipse2D.Float(cx - diameter / 2f, cy - diameter / 2f, diameter, diameter))
                }
            } finally {
                g2.dispose()
            }
        }
    }
}
