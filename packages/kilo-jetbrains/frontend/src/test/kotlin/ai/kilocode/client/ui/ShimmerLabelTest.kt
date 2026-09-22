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

    private fun timer(label: ShimmerLabel): Timer {
        val field = ShimmerLabel::class.java.getDeclaredField("animationTimer")
        field.isAccessible = true
        return field.get(label) as Timer
    }
}
