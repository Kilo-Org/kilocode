package ai.kilocode.client.ui

import com.intellij.ui.AnimatedIcon
import com.intellij.util.concurrency.annotations.RequiresEdt
import javax.swing.Icon

/** Native animation outside renderers; time-based static frames inside a shared list/tree clock. */
internal interface AnimationIcon : Icon {
    fun frames(): Array<AnimatedIcon.Frame>

    @RequiresEdt
    fun frame(time: Long): Frame {
        val frames = frames()
        val duration = frames.sumOf { it.delay.coerceAtLeast(1).toLong() }
        var offset = Math.floorMod(time, duration)
        for (frame in frames) {
            val delay = frame.delay.coerceAtLeast(1)
            if (offset < delay) return Frame(frame.icon, if (frames.size > 1) (delay - offset).toInt() else null)
            offset -= delay
        }
        error("Animation must contain a frame")
    }

    data class Frame(val icon: Icon, val delay: Int?)

    // The native vararg copy happens once at construction, never on a frame tick.
    @Suppress("SpreadOperator")
    class Cycle(delay: Int, vararg icons: Icon) : AnimatedIcon(delay, *icons), AnimationIcon {
        override fun frames(): Array<AnimatedIcon.Frame> = getFrames()
    }

    /** Keep the platform's theme-dependent frames and delays without using its internal spinner API. */
    class Progress : AnimatedIcon.Default(), AnimationIcon {
        override fun frames(): Array<AnimatedIcon.Frame> = getFrames()
    }
}

@RequiresEdt
internal fun animationFrame(icon: Icon?, time: Long): Icon? = when (icon) {
    is AnimationIcon -> icon.frame(time).icon
    is LiveBadgeIcon -> animationFrame(icon.icon, time).let { frame ->
        if (frame === icon.icon) icon else LiveBadgeIcon(frame ?: icon.icon, icon.paint)
    }
    else -> icon
}

@RequiresEdt
internal fun animationDelay(icon: Icon?, time: Long): Int? = when (icon) {
    is AnimationIcon -> icon.frame(time).delay
    is LiveBadgeIcon -> animationDelay(icon.icon, time)
    else -> null
}
