package ai.kilocode.client.ui

// Backported from IntelliJ platform master
// (com.intellij.ui.components.ShimmerLabel, platform/platform-api/src/com/intellij/ui/components/ShimmerLabel.kt),
// pinned at commit 0e263ac63a0fd0602f2fb112d468e5f3d8759def. Copyright 2000-2026 JetBrains
// s.r.o. and contributors, used under the Apache 2.0 license. Backported because the class
// does not exist in the 2026.1 platform this plugin targets (it landed on master 2026-08-02,
// IJPL-251862). `copyable` tracks copyable mode locally because `JBLabel.getEditorPane()` is
// also absent from 2026.1.

import com.intellij.openapi.util.NlsContexts
import com.intellij.openapi.util.SystemInfo
import com.intellij.ui.ColorUtil
import com.intellij.ui.DrawUtil
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.NamedColorUtil
import com.intellij.util.ui.TimerUtil
import java.awt.Color
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.LinearGradientPaint
import java.awt.Rectangle
import javax.swing.Icon
import javax.swing.SwingUtilities
import javax.swing.plaf.basic.BasicGraphicsUtils
import javax.swing.plaf.basic.BasicHTML

/**
 * A [JBLabel] that can paint its text with a moving highlight ("shimmer") to indicate that the activity
 * described by the label is in progress (for example, a streaming response or a long-running scan)
 * in places where a progress icon would be too heavy.
 *
 * While [isShimmering] is `true`, the text is painted in the inactive (secondary) foreground color and
 * a highlight of the label's foreground color sweeps across it. While it is `false`, the label paints
 * exactly like a [JBLabel].
 *
 * The shimmer is applied to plain text of an enabled label only: HTML text, disabled labels, and labels
 * in [setCopyable] mode are painted normally even while [isShimmering] is `true`. The animation is suppressed
 * in power-save mode and in a remote desktop session.
 */
open class ShimmerLabel @JvmOverloads constructor(
    @NlsContexts.Label text: String = "",
    icon: Icon? = null,
    horizontalAlignment: Int = LEADING,
) : JBLabel(text, icon, horizontalAlignment) {
    private var animationStartedAtNanos = System.nanoTime()
    private var copyable = false

    private val animationTimer = TimerUtil.createNamedTimer("ShimmerLabel", FRAME_DELAY_MS) {
        repaint()
    }

    /**
     * Starts or stops the shimmer animation. The animation restarts from the beginning each time the value
     * changes from `false` to `true`. Must be accessed on the EDT, like any other Swing state.
     */
    var isShimmering: Boolean = false
        set(value) {
            if (field == value) return
            field = value
            if (value) {
                animationStartedAtNanos = System.nanoTime()
            }
            updateTimer()
            repaint()
        }

    override fun setCopyable(copyable: Boolean): JBLabel {
        this.copyable = copyable
        return super.setCopyable(copyable)
    }

    override fun addNotify() {
        super.addNotify()
        updateTimer()
    }

    override fun removeNotify() {
        animationTimer.stop()
        super.removeNotify()
    }

    override fun paintComponent(g: Graphics) {
        val text = text
        if (!isShimmering || !isEnabled || text.isNullOrEmpty() || DrawUtil.isSimplifiedUI() ||
            getClientProperty(BasicHTML.propertyKey) != null || copyable
        ) {
            super.paintComponent(g)
            return
        }

        val g2 = g.create() as Graphics2D
        try {
            if (isOpaque) {
                g2.color = background
                g2.fillRect(0, 0, width, height)
            }
            g2.font = font
            val fm = getFontMetrics(font)
            val insets = insets
            val viewR = Rectangle(insets.left, insets.top, width - insets.left - insets.right, height - insets.top - insets.bottom)
            val iconR = Rectangle()
            val textR = Rectangle()
            val paintedIcon = icon
            val clippedText = SwingUtilities.layoutCompoundLabel(
                this, fm, text, paintedIcon,
                verticalAlignment, horizontalAlignment,
                verticalTextPosition, horizontalTextPosition,
                viewR, iconR, textR, iconTextGap,
            )
            paintedIcon?.paintIcon(this, g2, iconR.x, iconR.y)
            val foreground = foreground ?: JBColor.GRAY
            val baseColor = NamedColorUtil.getInactiveTextColor()
            g2.paint = shimmerPaint(
                textStart = textR.x.toFloat(),
                textWidth = textR.width.toFloat(),
                progress = animationProgress(),
                baseColor = baseColor,
                highlightColor = ColorUtil.mix(baseColor, foreground, HIGHLIGHT_FOREGROUND_MIX),
            )
            BasicGraphicsUtils.drawStringUnderlineCharAt(
                this, g2, clippedText, mnemonicIndex(),
                textR.x.toFloat(), (textR.y + fm.ascent).toFloat(),
            )
        } finally {
            g2.dispose()
        }
    }

    private fun mnemonicIndex(): Int = if (SystemInfo.isMac) -1 else displayedMnemonicIndex

    private fun updateTimer() {
        if (isDisplayable && isShimmering && !DrawUtil.isSimplifiedUI()) {
            animationTimer.start()
        } else {
            animationTimer.stop()
        }
    }

    private fun animationProgress(): Float {
        val elapsed = System.nanoTime() - animationStartedAtNanos
        return (elapsed % ANIMATION_DURATION_NANOS).toFloat() / ANIMATION_DURATION_NANOS
    }
}

private fun shimmerPaint(
    textStart: Float,
    textWidth: Float,
    progress: Float,
    baseColor: Color,
    highlightColor: Color,
): LinearGradientPaint {
    val shimmerWidth = (textWidth * SHIMMER_WIDTH_FACTOR).coerceAtLeast(1f)
    val gradientStart = textStart - shimmerWidth + (textWidth + shimmerWidth) * progress
    return LinearGradientPaint(
        gradientStart,
        0f,
        gradientStart + shimmerWidth,
        0f,
        floatArrayOf(0f, 0.5f, 1f),
        arrayOf(baseColor, highlightColor, baseColor),
    )
}

private const val ANIMATION_DURATION_NANOS = 1_000_000_000L
private const val FRAME_DELAY_MS = 16
private const val SHIMMER_WIDTH_FACTOR = 0.4f
private const val HIGHLIGHT_FOREGROUND_MIX = 0.8
