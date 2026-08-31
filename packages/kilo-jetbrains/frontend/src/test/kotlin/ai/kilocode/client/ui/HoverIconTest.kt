package ai.kilocode.client.ui

import ai.kilocode.client.util.edtWait
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.JBUI
import javax.swing.Icon
import javax.swing.JButton
import javax.swing.JPanel
import java.awt.Component
import java.awt.Graphics

class HoverIconTest : BasePlatformTestCase() {

    fun `test icon only button is square`() = edtWait {
        val icon = HoverIcon().apply { icon = square(16) }

        val size = icon.preferredSize

        assertEquals(size.height, size.width)
    }

    fun `test match sizes to the height a labelled button would get`() = edtWait {
        val labelled = JButton("Label").also { iconButton(it) }
        val icon = HoverIcon().apply {
            this.icon = square(16)
            match = true
        }

        assertEquals(labelled.preferredSize.height, icon.preferredSize.height)
        assertEquals(icon.preferredSize.height, icon.preferredSize.width)
    }

    fun `test match height does not follow the icon size`() = edtWait {
        // A labelled sibling rarely carries the same icon size as the icon-only action beside it, so
        // folding this button's own icon into the measurement makes the two drift apart on any LAF
        // whose font is shorter than either icon. The matched height must depend only on font+insets.
        val small = HoverIcon().apply {
            icon = square(8)
            match = true
        }
        val large = HoverIcon().apply {
            icon = square(64)
            match = true
        }

        assertEquals(small.preferredSize.height, large.preferredSize.height)
    }

    fun `test match ignores the icon while the plain square path still tracks it`() = edtWait {
        val matched = HoverIcon().apply {
            icon = square(64)
            match = true
        }
        val square = HoverIcon().apply { icon = square(64) }

        // Only `match` opts out of icon-driven sizing; the default square path must still grow.
        assertTrue(square.preferredSize.height > matched.preferredSize.height)
    }

    fun `test measuring does not mutate this button`() = edtWait {
        val icon = HoverIcon().apply {
            this.icon = square(16)
            match = true
        }
        // AbstractButton.setText fires a text property change and calls revalidate()/repaint(). Doing
        // that from a size query invalidates this control and its ancestors on every layout pass, so
        // measurement must not touch this button's own text at all.
        val changes = mutableListOf<String>()
        icon.addPropertyChangeListener("text") { changes += "${it.oldValue} -> ${it.newValue}" }
        JPanel().add(icon)

        repeat(5) { icon.preferredSize }

        assertEquals("measuring must not reassign text: $changes", emptyList<String>(), changes)
        assertTrue("measuring must not leave text behind", icon.text.isNullOrEmpty())
    }

    fun `test match height survives a look and feel change`() = edtWait {
        val icon = HoverIcon().apply {
            this.icon = square(16)
            match = true
        }
        val before = icon.preferredSize.height

        // updateUI drops the cached probe; the next measurement rebuilds it under the current LAF.
        icon.updateUI()

        assertEquals(before, icon.preferredSize.height)
        assertTrue(icon.text.isNullOrEmpty())
    }

    private fun square(px: Int): Icon = object : Icon {
        override fun paintIcon(c: Component?, g: Graphics?, x: Int, y: Int) = Unit
        override fun getIconWidth(): Int = JBUI.scale(px)
        override fun getIconHeight(): Int = JBUI.scale(px)
    }
}
