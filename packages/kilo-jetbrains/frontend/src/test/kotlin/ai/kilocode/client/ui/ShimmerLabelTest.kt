package ai.kilocode.client.ui

import com.intellij.testFramework.fixtures.BasePlatformTestCase
import javax.swing.JPanel
import javax.swing.Timer

class ShimmerLabelTest : BasePlatformTestCase() {
    fun `test animation timer follows display lifecycle`() {
        val host = JPanel()
        val label = ShimmerLabel("Loading")
        host.add(label)
        label.isShimmering = true

        assertFalse(timer(label).isRunning)

        host.addNotify()
        try {
            assertTrue(timer(label).isRunning)
        } finally {
            host.removeNotify()
        }

        assertFalse(timer(label).isRunning)
    }

    fun `test stopping shimmer stops animation timer while displayed`() {
        val host = JPanel()
        val label = ShimmerLabel("Loading")
        host.add(label)
        label.isShimmering = true

        host.addNotify()
        try {
            assertTrue(timer(label).isRunning)

            label.isShimmering = false

            assertFalse(timer(label).isRunning)
        } finally {
            host.removeNotify()
        }
    }

    /**
     * Reaches the private animation `Timer` via reflection rather than through
     * [ai.kilocode.client.util.UiTimerSource] (this module's usual timer seam): `ShimmerLabel` is a
     * pinned backport of the upstream IntelliJ Platform class (see its header) and builds its timer
     * directly with `TimerUtil`, so it exposes no public accessor and cannot be redirected onto the
     * seam without diverging from the upstream source it must stay in lock-step with. The running
     * flag is what this test needs to prove — that the timer starts only while displayed and
     * shimmering, and stops on `removeNotify` — so reflection is the narrowest way to observe it.
     */
    private fun timer(label: ShimmerLabel): Timer {
        val field = ShimmerLabel::class.java.getDeclaredField("animationTimer")
        field.isAccessible = true
        return field.get(label) as Timer
    }
}
