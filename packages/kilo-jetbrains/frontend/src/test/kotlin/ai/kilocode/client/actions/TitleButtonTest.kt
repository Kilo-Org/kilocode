package ai.kilocode.client.actions

import ai.kilocode.client.agentManager.SidePanelKeys
import ai.kilocode.client.agentManager.SidePanelMode
import ai.kilocode.client.session.SessionManager
import ai.kilocode.client.session.SessionRef
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.util.edtWait
import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.actionSystem.impl.ActionButtonWithText
import com.intellij.openapi.actionSystem.impl.ActionToolbarImpl
import com.intellij.openapi.actionSystem.impl.SimpleDataContext
import com.intellij.openapi.util.IconLoader
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.JBUI
import java.awt.Component
import java.awt.Container
import java.awt.GraphicsEnvironment
import java.awt.image.BufferedImage

/**
 * Verifies that [titleButton] centers the standard IntelliJ plus glyph with the label inside the
 * hover pill for the two labelled tool-window title actions, `+ Session` and `+ Worktree`.
 *
 * Each button is built through a real [ActionToolbarImpl] (same construction
 * [ai.kilocode.client.KiloToolWindowFactory] and `ToolWindowHeader` use), so the platform border,
 * look, and short-toolbar-text path all run for real; only [ActionToolbarImpl.getDataContext] is
 * swapped out, mirroring how the platform's own `ToolWindowHeader` supplies its data context. The
 * component is then painted into an off-screen image and the *painted pixels* are measured
 * directly, rather than asserting on [titleButton]'s margin/gap inputs — those numbers were
 * themselves reached by measuring real rendering (icon transparency and font metrics both affect
 * where ink actually lands, not just the logical layout box), so only a pixel-level check can
 * catch a future icon or font change reopening the asymmetry.
 */
@Suppress("UnstableApiUsage")
class TitleButtonTest : BasePlatformTestCase() {
    private lateinit var coroutines: TestCoroutines

    override fun setUp() {
        super.setUp()
        coroutines = TestCoroutines()
        // Loading an svg asset resolves to a 1x1 placeholder while the platform is headless (how CI
        // runs), which would make every padding measurement below meaningless, so switch real icon
        // loading on for this class and put the ambient state back afterwards.
        IconLoader.activate()
    }

    override fun tearDown() {
        try {
            if (GraphicsEnvironment.isHeadless()) IconLoader.deactivate()
            coroutines.close()
        } finally {
            super.tearDown()
        }
    }

    fun `test New Session button centers the plus and label`() {
        val manager = object : SessionManager {
            override fun newSession() {}
            override fun showHistory(back: (() -> Unit)?) {}
            override fun openSession(ref: SessionRef) {}
        }
        val context = SimpleDataContext.builder().add(SessionManager.KEY, manager).build()
        assertCentered(button(NewSessionAction(), "Session", context))
    }

    fun `test New Worktree button centers the plus and label`() {
        val context = SimpleDataContext.builder().add(SidePanelKeys.MODE, SidePanelMode.AGENT_MANAGER).build()
        assertCentered(button(NewWorktreeAction(), "Worktree", context))
    }

    fun `test add icon is 25 percent smaller than the platform action icon`() {
        assertEquals(JBUI.scale(UiStyle.ToolbarButton.ICON_SIZE), KiloActionIcons.add.iconWidth)
        assertEquals(JBUI.scale(UiStyle.ToolbarButton.ICON_SIZE), KiloActionIcons.add.iconHeight)
        assertEquals(JBUI.scale(16), AllIcons.General.Add.iconWidth)
        assertEquals(JBUI.scale(16), AllIcons.General.Add.iconHeight)
    }

    /**
     * Builds [action] inside a real title-bar toolbar, drives it through the platform's update
     * pass until its presentation text reaches [expectedText] (the short toolbar label), and
     * returns the resulting [ActionButtonWithText].
     */
    private fun button(action: AnAction, expectedText: String, context: DataContext): ActionButtonWithText {
        val toolbar = object : ActionToolbarImpl(ActionPlaces.TOOLWINDOW_TITLE, DefaultActionGroup(action), true) {
            override fun getDataContext(): DataContext = context
        }
        edtWait { toolbar.updateActionsImmediately() }
        val reached = coroutines.pumpUntil {
            edtWait { buttonOrNull(toolbar) }?.presentation?.text == expectedText
        }
        assertTrue("'$expectedText' button never appeared in the toolbar", reached)
        return edtWait { buttonOrNull(toolbar) } ?: error("no ActionButtonWithText for $expectedText")
    }

    private fun buttonOrNull(root: Component): ActionButtonWithText? {
        if (root is ActionButtonWithText) return root
        if (root !is Container) return null
        for (child in root.components) {
            buttonOrNull(child)?.let { return it }
        }
        return null
    }

    /**
     * Paints [button] and asserts the plus glyph and label sit centered in the hover pill: the
     * gap from the pill's left edge to the first painted pixel equals the gap from the last
     * painted pixel to the pill's right edge, within a small tolerance for font-rendering noise.
     */
    private fun assertCentered(button: ActionButtonWithText) = edtWait {
        val size = button.preferredSize
        button.size = size
        button.doLayout()
        val image = BufferedImage(size.width, size.height, BufferedImage.TYPE_INT_ARGB)
        val canvas = image.createGraphics()
        try {
            button.paint(canvas)
        } finally {
            canvas.dispose()
        }

        val insets = button.insets
        val pillLeft = insets.left
        val pillRight = size.width - insets.right

        val first = firstPaintedColumn(image, pillLeft, pillRight)
        val last = lastPaintedColumn(image, pillLeft, pillRight)
        assertTrue("nothing painted inside the pill ($pillLeft until $pillRight)", first != null && last != null)

        val leftGap = first!! - pillLeft
        val rightGap = pillRight - 1 - last!!
        // 2px tolerance absorbs font-rendering right-side-bearing noise (varies by word and by
        // platform font), while still catching the original 4-6px left/right asymmetry this test
        // guards against.
        assertTrue(
            "expected symmetric padding, got left=$leftGap right=$rightGap (pill $pillLeft until $pillRight)",
            Math.abs(leftGap - rightGap) <= 2,
        )

        val gap = firstBlankColumn(image, first, last)
        val text = firstPaintedColumn(image, gap, pillRight)
        assertNotNull("could not separate the plus icon from its label", text)

        val iconTop = firstPaintedRow(image, first, gap)
        val iconBottom = lastPaintedRow(image, first, gap)
        val textTop = firstPaintedRow(image, text!!, pillRight)
        val textBottom = lastPaintedRow(image, text, pillRight)
        assertTrue("plus icon did not paint", iconTop != null && iconBottom != null)
        assertTrue("button label did not paint", textTop != null && textBottom != null)

        val iconCenter = iconTop!! + iconBottom!!
        val textCenter = textTop!! + textBottom!!
        assertTrue(
            "expected the plus and label to share a vertical center, got icon=$iconCenter/2 text=$textCenter/2",
            Math.abs(iconCenter - textCenter) <= 2,
        )
    }

    private fun firstBlankColumn(image: BufferedImage, from: Int, to: Int): Int {
        for (x in from until to) {
            if ((0 until image.height).none { y -> (image.getRGB(x, y) ushr 24) != 0 }) return x
        }
        error("no blank column after the plus icon")
    }

    private fun firstPaintedColumn(image: BufferedImage, from: Int, to: Int): Int? {
        for (x in from until to) {
            for (y in 0 until image.height) {
                if ((image.getRGB(x, y) ushr 24) != 0) return x
            }
        }
        return null
    }

    private fun lastPaintedColumn(image: BufferedImage, from: Int, to: Int): Int? {
        for (x in to - 1 downTo from) {
            for (y in 0 until image.height) {
                if ((image.getRGB(x, y) ushr 24) != 0) return x
            }
        }
        return null
    }

    private fun firstPaintedRow(image: BufferedImage, from: Int, to: Int): Int? {
        for (y in 0 until image.height) {
            for (x in from until to) {
                if ((image.getRGB(x, y) ushr 24) != 0) return y
            }
        }
        return null
    }

    private fun lastPaintedRow(image: BufferedImage, from: Int, to: Int): Int? {
        for (y in image.height - 1 downTo 0) {
            for (x in from until to) {
                if ((image.getRGB(x, y) ushr 24) != 0) return y
            }
        }
        return null
    }
}
