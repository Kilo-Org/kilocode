package ai.kilocode.client.session.views.base

import ai.kilocode.client.util.edtWait
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.UiStyle
import com.intellij.icons.AllIcons
import com.intellij.ide.ui.laf.darcula.ui.DarculaButtonUI
import com.intellij.openapi.application.ApplicationManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBTextArea
import java.awt.BorderLayout
import java.awt.Container
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.JLabel
import javax.swing.JPanel

@Suppress("UnstableApiUsage")
class DialogViewTest : BasePlatformTestCase() {

    // ------ initial state ------

    fun `test empty card does not render a header row by default`() {
        edt {
            val panel = DialogView()
            assertTrue("Root layout should be BorderLayout", panel.layout is BorderLayout)
            assertNull("Header row should be omitted until header content exists", headerRow(panel))
        }
    }

    fun `test setHeader sets the header text`() {
        edt {
            val panel = DialogView()
            panel.setHeader("My Title")
            val bold = findAll<JBTextArea>(panel).firstOrNull { it.font.isBold }
            assertNotNull("Bold header text area should be present", bold)
            assertEquals("My Title", bold!!.text)
        }
    }

    fun `test setHeader with description shows description`() {
        edt {
            val panel = DialogView()
            panel.setHeader("Title", "Hint text")
            val desc = findAll<JBTextArea>(panel).firstOrNull { it.text == "Hint text" }
            assertNotNull("Description text area should be present", desc)
        }
    }

    fun `test setHeader without description hides description`() {
        edt {
            val panel = DialogView()
            panel.setHeader("Title")
            val areas = findAll<JBTextArea>(panel)
            val nonBold = areas.filter { !it.font.isBold }
            // description should either be hidden or blank
            assertTrue("Non-bold text areas should be hidden or empty", nonBold.all { !it.isVisible || it.text.isBlank() })
        }
    }

    fun `test setHeader with blank title hides header text`() {
        edt {
            val panel = DialogView()
            panel.setHeader("", "Stopped")
            val areas = findAll<JBTextArea>(panel)

            assertTrue("Blank header text area should be hidden", areas.filter { it.text.isBlank() }.all { !it.isVisible })
            assertNotNull("Description should remain visible", areas.firstOrNull { it.text == "Stopped" && it.isVisible })
        }
    }

    fun `test setOutlined toggles outline color`() {
        edt {
            val panel = InspectDialogView()

            assertNotNull(panel.line())
            panel.setOutlined(false)
            assertNull(panel.line())
            panel.setOutlined(true)
            assertNotNull(panel.line())
        }
    }

    fun `test setDescription with blank hides description`() {
        edt {
            val panel = DialogView()
            panel.setHeader("Title", "some text")
            panel.setDescription("")
            val areas = findAll<JBTextArea>(panel)
            val desc = areas.firstOrNull { !it.font.isBold }
            assertTrue("Description should be hidden when blank", desc == null || !desc.isVisible)
        }
    }

    fun `test setDescription with null hides description`() {
        edt {
            val panel = DialogView()
            panel.setHeader("Title", "some text")
            panel.setDescription(null)
            val areas = findAll<JBTextArea>(panel)
            val desc = areas.firstOrNull { !it.font.isBold }
            assertTrue("Description should be hidden when null", desc == null || !desc.isVisible)
        }
    }

    // ------ setTopPanel ------

    fun `test setTopPanel adds component before header`() {
        edt {
            val panel = DialogView()
            panel.setHeader("Title")
            val top = JLabel("top")
            panel.setTopPanel(top)

            val north = region(panel, BorderLayout.NORTH) as Container
            val comps = north.components.toList()
            val topIdx = comps.indexOf(top)
            val headerRow = headerRow(panel)
            val headerIdx = if (headerRow != null) comps.indexOf(headerRow) else comps.indexOfFirst { it is JPanel }
            assertTrue("top should appear before headerText row", topIdx >= 0 && topIdx < headerIdx)
        }
    }

    fun `test setTopPanel null removes top component`() {
        edt {
            val panel = DialogView()
            val top = JLabel("top")
            panel.setTopPanel(top)
            panel.setTopPanel(null)

            assertNull("top should be removed after setTopPanel(null)", find(panel, top))
        }
    }

    fun `test setTopPanel replaces previous top without duplicates`() {
        edt {
            val panel = DialogView()
            val first = JLabel("first")
            val second = JLabel("second")
            panel.setTopPanel(first)
            panel.setTopPanel(second)

            assertNull("first top should be gone after replacement", find(panel, first))
            assertNotNull("second top should be present", find(panel, second))
        }
    }

    // ------ setContent ------

    fun `test setContent adds component after description`() {
        edt {
            val panel = DialogView()
            val body = JLabel("body")
            panel.setContent(body)
            assertNotNull("body should be in the tree", find(panel, body))
            assertSame("body should be in root center", body, region(panel, BorderLayout.CENTER))
        }
    }

    fun `test setContent null removes content`() {
        edt {
            val panel = DialogView()
            val body = JLabel("body")
            panel.setContent(body)
            panel.setContent(null)
            assertNull("body should be removed after setContent(null)", find(panel, body))
        }
    }

    fun `test setContent replaces previous content without duplicates`() {
        edt {
            val panel = DialogView()
            val first = JLabel("first body")
            val second = JLabel("second body")
            panel.setContent(first)
            panel.setContent(second)
            assertNull("first body should be gone", find(panel, first))
            assertNotNull("second body should be present", find(panel, second))
        }
    }

    fun `test setContent adds header spacer in north stack`() {
        edt {
            val panel = DialogView()
            panel.setContent(JLabel("body"))

            val north = region(panel, BorderLayout.NORTH) as Container
            val filler = north.components.last()
            assertEquals(UiStyle.Gap.lg(), filler.preferredSize.height)
            assertEquals(0, filler.preferredSize.width)
        }
    }

    fun `test disabling side padding removes only those card insets`() {
        edt {
            val panel = DialogView()
            panel.setContent(JLabel("body"))
            panel.setContentPadding(left = false, right = false)

            val ins = panel.border.getBorderInsets(panel)
            assertEquals(0, ins.left)
            assertEquals(0, ins.right)
            assertEquals(UiStyle.Gap.pad(), ins.top)
            assertEquals(UiStyle.Gap.lg(), ins.bottom)
        }
    }

    fun `test disabling top and bottom padding removes those card insets`() {
        edt {
            val panel = DialogView()
            panel.setContent(JLabel("body"))
            panel.setContentPadding(top = false, bottom = false)

            val ins = panel.border.getBorderInsets(panel)
            assertEquals(0, ins.top)
            assertEquals(0, ins.bottom)
            assertEquals(UiStyle.Gap.pad(), ins.left)
            assertEquals(UiStyle.Gap.pad(), ins.right)
        }
    }

    fun `test disabling side padding keeps header and footer side insets`() {
        edt {
            val panel = DialogView()
            panel.setHeader("Title")
            panel.setContent(JLabel("body"))
            panel.setContentPadding(left = false, right = false)
            panel.setActions(listOf(DialogView.Action("ok", "OK", primary = true) {}))

            val north = region(panel, BorderLayout.NORTH) as JPanel
            val footer = region(panel, BorderLayout.SOUTH) as JPanel
            assertEquals(UiStyle.Gap.pad(), north.border.getBorderInsets(north).left)
            assertEquals(UiStyle.Gap.pad(), footer.border.getBorderInsets(footer).left)
        }
    }

    // ------ setActions ------

    fun `test setActions renders one button per action`() {
        edt {
            val panel = DialogView()
            panel.setActions(listOf(
                DialogView.Action("a", "Cancel", primary = false) {},
                DialogView.Action("b", "OK", primary = true) {},
            ))
            val btns = actionButtons(panel)
            assertEquals(2, btns.size)
            assertNotNull(btns["Cancel"])
            assertNotNull(btns["OK"])
        }
    }

    fun `test primary action has DarculaButtonUI default style key`() {
        edt {
            val panel = DialogView()
            panel.setActions(listOf(DialogView.Action("ok", "OK", primary = true) {}))
            val btn = actionButton(panel, "OK")
            assertEquals(true, btn.getClientProperty(DarculaButtonUI.DEFAULT_STYLE_KEY))
        }
    }

    fun `test non-primary action does not have DarculaButtonUI default style key`() {
        edt {
            val panel = DialogView()
            panel.setActions(listOf(DialogView.Action("cancel", "Cancel", primary = false) {}))
            val btn = actionButton(panel, "Cancel")
            val key = btn.getClientProperty(DarculaButtonUI.DEFAULT_STYLE_KEY)
            assertTrue("Non-primary should not have default style key", key == null || key == false)
        }
    }

    fun `test action button click invokes handler`() {
        edt {
            var clicked = false
            val panel = DialogView()
            panel.setActions(listOf(DialogView.Action("ok", "OK", primary = true) { clicked = true }))
            actionButton(panel, "OK").doClick()
            assertTrue("handler should have been invoked", clicked)
        }
    }

    fun `test action button click returns focus to session prompt`() {
        edt {
            var focused = false
            val panel = DialogView(focus = { focused = true })
            val root = JPanel(BorderLayout())
            root.add(panel)
            panel.setActions(listOf(DialogView.Action("ok", "OK", primary = true) {}))

            actionButton(panel, "OK").doClick()

            assertTrue("button action should request prompt focus through the session manager", focused)
        }
    }

    fun `test setActionEnabled disables and enables button`() {
        edt {
            val panel = DialogView()
            panel.setActions(listOf(DialogView.Action("ok", "OK", primary = true, enabled = true) {}))
            panel.setActionEnabled("ok", false)
            assertFalse(actionButton(panel, "OK").isEnabled)
            panel.setActionEnabled("ok", true)
            assertTrue(actionButton(panel, "OK").isEnabled)
        }
    }

    fun `test setActions empty removes all action buttons`() {
        edt {
            val panel = DialogView()
            panel.setActions(listOf(DialogView.Action("ok", "OK", primary = true) {}))
            panel.setActions(emptyList())
            assertTrue("action buttons should be removed", actionButtons(panel).isEmpty())
            assertNull("footer should be removed when empty", region(panel, BorderLayout.SOUTH))
        }
    }

    fun `test action buttons are non-opaque so no stray fill frame`() {
        edt {
            val panel = DialogView()
            panel.setActions(listOf(
                DialogView.Action("a", "A", primary = false) {},
                DialogView.Action("b", "B", primary = true) {},
            ))
            // Non-opaque so Swing does not fill the rectangular bounds with the component
            // background before DarculaButtonUI paints the rounded shape. That rectangle leaked
            // as a stray frame around the button in the Islands Light theme.
            assertFalse(actionButton(panel, "A").isOpaque)
            assertFalse(actionButton(panel, "B").isOpaque)
        }
    }

    // ------ structure ------

    fun `test header row uses icon west and text stack center`() {
        edt {
            val panel = DialogView()
            panel.setHeaderIcon(AllIcons.General.Warning)
            val header = headerRow(panel)!!
            val layout = header.layout as BorderLayout
            val west = layout.getLayoutComponent(BorderLayout.WEST)
            val center = layout.getLayoutComponent(BorderLayout.CENTER) as Container
            assertTrue("icon should be the direct west component", west is JBLabel)
            val icon = west as JBLabel
            assertEquals("icon should be horizontally centered", JBLabel.CENTER, icon.horizontalAlignment)
            assertEquals("icon should be vertically centered", JBLabel.CENTER, icon.verticalAlignment)
            assertEquals("icon gap should use the next standard spacing step", UiStyle.Gap.md(), layout.hgap)
            assertTrue("center should contain header and description text", findAll<JBTextArea>(center).size >= 2)
        }
    }

    fun `test header row has no west icon gap without icon`() {
        edt {
            val panel = DialogView()
            panel.setHeader("Title")
            val header = headerRow(panel)!!
            val west = (header.layout as BorderLayout).getLayoutComponent(BorderLayout.WEST)
            assertNull("header should not reserve icon space when icon is absent", west)
        }
    }

    fun `test action footer is in south with buttons east`() {
        edt {
            val panel = DialogView()
            panel.setActions(listOf(DialogView.Action("ok", "OK", primary = true) {}))
            val btn = actionButton(panel, "OK")
            val footer = region(panel, BorderLayout.SOUTH) as JPanel
            val row = (footer.layout as BorderLayout).getLayoutComponent(BorderLayout.EAST) as JPanel
            assertNotNull("button should be in footer east row", find(row, btn))
        }
    }

    fun `test action footer has top gap matching panel vertical padding`() {
        edt {
            val panel = DialogView()
            panel.setActions(listOf(DialogView.Action("ok", "OK", primary = true) {}))

            val footer = region(panel, BorderLayout.SOUTH) as JPanel
            val ins = footer.border.getBorderInsets(footer)
            assertEquals(UiStyle.Gap.lg(), ins.top)
        }
    }

    fun `test card top padding uses next spacing step`() {
        edt {
            val panel = DialogView()
            val ins = panel.border.getBorderInsets(panel)

            assertEquals(UiStyle.Gap.pad(), ins.top)
            assertEquals(UiStyle.Gap.pad(), ins.left)
            assertEquals(UiStyle.Gap.lg(), ins.bottom)
            assertEquals(UiStyle.Gap.pad(), ins.right)
        }
    }

    fun `test action left alone attaches footer west`() {
        edt {
            val panel = DialogView()
            val left = JLabel("left")
            panel.setActionLeft(left)
            val footer = region(panel, BorderLayout.SOUTH) as JPanel
            val west = (footer.layout as BorderLayout).getLayoutComponent(BorderLayout.WEST) as Container
            assertNotNull("action left should be in footer west", find(west, left))
        }
    }

    fun `test action left component is transparent`() {
        edt {
            val panel = DialogView()
            val left = JPanel()
            panel.setActionLeft(left)
            assertFalse("action left should be transparent", left.isOpaque)
        }
    }

    fun `test footer adds bottom padding gap after side actions`() {
        edt {
            val panel = DialogView()
            panel.setActionLeft(JLabel("left"))
            panel.setActions(listOf(DialogView.Action("ok", "OK", primary = true) {}))

            val footer = region(panel, BorderLayout.SOUTH) as JPanel
            val west = (footer.layout as BorderLayout).getLayoutComponent(BorderLayout.WEST) as Container
            val filler = west.components.toList().firstOrNull { it.preferredSize.width == UiStyle.Gap.pad() }
            assertNotNull("side actions should include trailing gap", filler)
            assertEquals(0, filler!!.preferredSize.height)
        }
    }

    fun `test setActionLeft null removes left-only footer`() {
        edt {
            val panel = DialogView()
            panel.setActionLeft(JLabel("left"))
            panel.setActionLeft(null)
            assertNull("footer should be removed when action left is cleared", region(panel, BorderLayout.SOUTH))
        }
    }

    // ------ header icon ------

    fun `test setHeaderIcon adds icon to the left side of header row`() {
        edt {
            val panel = DialogView()
            panel.setHeaderIcon(AllIcons.General.Warning, "warning")

            val labels = findAll<JBLabel>(panel).filter { it.icon != null && it.isVisible }
            assertEquals("Expected one header icon", 1, labels.size)
            assertSame(AllIcons.General.Warning, labels[0].icon)
            assertEquals("warning", labels[0].toolTipText)
        }
    }

    fun `test setHeaderIcon null hides header icon`() {
        edt {
            val panel = DialogView()
            panel.setHeaderIcon(AllIcons.General.Warning)
            panel.setHeaderIcon(null)

            val labels = findAll<JBLabel>(panel).filter { it.icon != null && it.isVisible }
            assertTrue("Header icon should be hidden after setHeaderIcon(null)", labels.isEmpty())
        }
    }

    // ------ applyStyle: UI fonts ----

    fun `test applyStyle applies headerFont to header and secondary font to description`() {
        edt {
            val panel = DialogView()
            panel.setHeader("Title", "Hint")
            val style = SessionEditorStyle.current()
            panel.applyStyle(style)
            val areas = findAll<JBTextArea>(panel)
            val header = areas.first { it.text == "Title" }
            val desc = areas.first { it.text == "Hint" }

            assertEquals("headerText should use headerFont", style.headerFont, header.font)
            assertEquals("descriptionText should use secondary text font", SessionUiStyle.Text.Secondary.font(style), desc.font)
        }
    }

    fun `test applyStyle does not apply editor font family to header or description`() {
        edt {
            val panel = DialogView()
            panel.setHeader("Title", "Hint")
            val style = SessionEditorStyle.create(family = "Courier New", size = 20)
            panel.applyStyle(style)
            val areas = findAll<JBTextArea>(panel)
            val header = areas.first { it.text == "Title" }
            val desc = areas.first { it.text == "Hint" }

            assertFalse("headerText should not use editor font family", header.font.name == "Courier New")
            assertFalse("descriptionText should not use editor font family", desc.font.name == "Courier New")
        }
    }

    fun `test description uses same vertical stacking as option descriptions`() {
        edt {
            val panel = DialogView()
            panel.setHeader("Title", "Hint")
            val desc = findAll<JBTextArea>(panel).firstOrNull { it.text == "Hint" }
            assertNotNull(desc)
            val ins = desc!!.border.getBorderInsets(desc)
            assertEquals("description should not add extra top padding", 0, ins.top)
        }
    }

    // ------ helpers ------

    private fun <T> edt(block: () -> T): T = edtWait(block)

    private fun region(panel: DialogView, region: String) = (panel.layout as BorderLayout).getLayoutComponent(region)

    private fun headerRow(panel: DialogView): JPanel? {
        val north = region(panel, BorderLayout.NORTH) as? Container ?: return null
        return north.components.filterIsInstance<JPanel>().firstOrNull { it.layout is BorderLayout }
    }

    private fun find(root: Container, target: JComponent): JComponent? {
        if (root === target) return target
        for (child in root.components) {
            if (child === target) return target
            if (child is Container) {
                val found = find(child, target)
                if (found != null) return found
            }
        }
        return null
    }

    private fun find(root: JPanel, target: JButton): JButton? {
        for (child in root.components) {
            if (child === target) return target
            if (child is JPanel) {
                val found = find(child, target)
                if (found != null) return found
            }
        }
        return null
    }

    private fun actionButton(panel: DialogView, text: String): JButton = actionButtons(panel)[text]!!

    private fun actionButtons(panel: DialogView): Map<String, JButton> = findAll<JButton>(panel).associateBy { it.text }

    private inline fun <reified T> findAll(root: Container): List<T> = findAllCls(root, T::class.java)

    private fun <T> findAllCls(root: Container, cls: Class<T>): List<T> {
        val result = mutableListOf<T>()
        if (cls.isInstance(root)) result.add(cls.cast(root))
        for (child in root.components) {
            if (child is Container) result.addAll(findAllCls(child, cls))
        }
        return result
    }

    private class InspectDialogView : DialogView() {
        fun line() = outlineColor()
    }
}
