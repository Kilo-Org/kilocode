package ai.kilocode.client.session.views.base

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
class BaseQuestionViewTest : BasePlatformTestCase() {

    // ------ initial state ------

    fun `test header and description text areas are in the component tree by default`() {
        edt {
            val panel = BaseQuestionView()
            val areas = findAll<JBTextArea>(panel)
            assertTrue("Should have at least 2 text areas (header + description)", areas.size >= 2)
        }
    }

    fun `test setHeader sets the header text`() {
        edt {
            val panel = BaseQuestionView()
            panel.setHeader("My Title")
            val bold = findAll<JBTextArea>(panel).firstOrNull { it.font.isBold }
            assertNotNull("Bold header text area should be present", bold)
            assertEquals("My Title", bold!!.text)
        }
    }

    fun `test setHeader with description shows description`() {
        edt {
            val panel = BaseQuestionView()
            panel.setHeader("Title", "Hint text")
            val desc = findAll<JBTextArea>(panel).firstOrNull { it.text == "Hint text" }
            assertNotNull("Description text area should be present", desc)
        }
    }

    fun `test setHeader without description hides description`() {
        edt {
            val panel = BaseQuestionView()
            panel.setHeader("Title")
            val areas = findAll<JBTextArea>(panel)
            val nonBold = areas.filter { !it.font.isBold }
            // description should either be hidden or blank
            assertTrue("Non-bold text areas should be hidden or empty", nonBold.all { !it.isVisible || it.text.isBlank() })
        }
    }

    fun `test setDescription with blank hides description`() {
        edt {
            val panel = BaseQuestionView()
            panel.setHeader("Title", "some text")
            panel.setDescription("")
            val areas = findAll<JBTextArea>(panel)
            val desc = areas.firstOrNull { !it.font.isBold }
            assertTrue("Description should be hidden when blank", desc == null || !desc.isVisible)
        }
    }

    fun `test setDescription with null hides description`() {
        edt {
            val panel = BaseQuestionView()
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
            val panel = BaseQuestionView()
            val top = JLabel("top")
            panel.setTopPanel(top)

            val col = findCol(panel)!!
            val comps = col.components.toList()
            val topIdx = comps.indexOf(top)
            // header row is the JPanel containing the header text area
            val headerRow = findAll<JBTextArea>(panel).firstOrNull { it.font.isBold }?.parent as? JPanel
            val headerIdx = if (headerRow != null) comps.indexOf(headerRow) else comps.indexOfFirst { it is JPanel }
            assertTrue("top should appear before headerText row", topIdx >= 0 && topIdx < headerIdx)
        }
    }

    fun `test setTopPanel null removes top component`() {
        edt {
            val panel = BaseQuestionView()
            val top = JLabel("top")
            panel.setTopPanel(top)
            panel.setTopPanel(null)

            assertNull("top should be removed after setTopPanel(null)", find(panel, top))
        }
    }

    fun `test setTopPanel replaces previous top without duplicates`() {
        edt {
            val panel = BaseQuestionView()
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
            val panel = BaseQuestionView()
            val body = JLabel("body")
            panel.setContent(body)
            assertNotNull("body should be in the tree", find(panel, body))
        }
    }

    fun `test setContent null removes content`() {
        edt {
            val panel = BaseQuestionView()
            val body = JLabel("body")
            panel.setContent(body)
            panel.setContent(null)
            assertNull("body should be removed after setContent(null)", find(panel, body))
        }
    }

    fun `test setContent replaces previous content without duplicates`() {
        edt {
            val panel = BaseQuestionView()
            val first = JLabel("first body")
            val second = JLabel("second body")
            panel.setContent(first)
            panel.setContent(second)
            assertNull("first body should be gone", find(panel, first))
            assertNotNull("second body should be present", find(panel, second))
        }
    }

    // ------ setActions ------

    fun `test setActions renders one button per action`() {
        edt {
            val panel = BaseQuestionView()
            panel.setActions(listOf(
                BaseQuestionView.Action("a", "Cancel", primary = false) {},
                BaseQuestionView.Action("b", "OK", primary = true) {},
            ))
            val btns = panel.actionButtonsForTest()
            assertEquals(2, btns.size)
            assertNotNull(btns["a"])
            assertNotNull(btns["b"])
            assertEquals("Cancel", btns["a"]!!.text)
            assertEquals("OK", btns["b"]!!.text)
        }
    }

    fun `test primary action has DarculaButtonUI default style key`() {
        edt {
            val panel = BaseQuestionView()
            panel.setActions(listOf(BaseQuestionView.Action("ok", "OK", primary = true) {}))
            val btn = panel.actionButtonsForTest()["ok"]!!
            assertEquals(true, btn.getClientProperty(DarculaButtonUI.DEFAULT_STYLE_KEY))
        }
    }

    fun `test non-primary action does not have DarculaButtonUI default style key`() {
        edt {
            val panel = BaseQuestionView()
            panel.setActions(listOf(BaseQuestionView.Action("cancel", "Cancel", primary = false) {}))
            val btn = panel.actionButtonsForTest()["cancel"]!!
            val key = btn.getClientProperty(DarculaButtonUI.DEFAULT_STYLE_KEY)
            assertTrue("Non-primary should not have default style key", key == null || key == false)
        }
    }

    fun `test action button click invokes handler`() {
        edt {
            var clicked = false
            val panel = BaseQuestionView()
            panel.setActions(listOf(BaseQuestionView.Action("ok", "OK", primary = true) { clicked = true }))
            panel.actionButtonsForTest()["ok"]!!.doClick()
            assertTrue("handler should have been invoked", clicked)
        }
    }

    fun `test setActionEnabled disables and enables button`() {
        edt {
            val panel = BaseQuestionView()
            panel.setActions(listOf(BaseQuestionView.Action("ok", "OK", primary = true, enabled = true) {}))
            panel.setActionEnabled("ok", false)
            assertFalse(panel.actionButtonsForTest()["ok"]!!.isEnabled)
            panel.setActionEnabled("ok", true)
            assertTrue(panel.actionButtonsForTest()["ok"]!!.isEnabled)
        }
    }

    fun `test setActions empty removes all action buttons`() {
        edt {
            val panel = BaseQuestionView()
            panel.setActions(listOf(BaseQuestionView.Action("ok", "OK", primary = true) {}))
            panel.setActions(emptyList())
            assertTrue("actionButtonsForTest should be empty", panel.actionButtonsForTest().isEmpty())
        }
    }

    fun `test action buttons use question card surface background`() {
        edt {
            val panel = BaseQuestionView()
            panel.setActions(listOf(
                BaseQuestionView.Action("a", "A", primary = false) {},
                BaseQuestionView.Action("b", "B", primary = true) {},
            ))
            val btns = panel.actionButtonsForTest()
            assertEquals(SessionUiStyle.View.surface(), btns["a"]!!.background)
            assertEquals(SessionUiStyle.View.surface(), btns["b"]!!.background)
        }
    }

    // ------ ordering ------

    fun `test content appears after description in col`() {
        edt {
            val panel = BaseQuestionView()
            val body = JLabel("body")
            panel.setContent(body)
            val col = findCol(panel)!!
            val comps = col.components.toList()
            val descIdx = comps.indexOfFirst { it is JBTextArea && !(it).font.isBold }
            val bodyIdx = comps.indexOf(body)
            assertTrue("body should appear after description", descIdx < bodyIdx)
        }
    }

    fun `test action footer appears after content`() {
        edt {
            val panel = BaseQuestionView()
            val body = JLabel("body")
            panel.setContent(body)
            panel.setActions(listOf(BaseQuestionView.Action("ok", "OK", primary = true) {}))
            val col = findCol(panel)!!
            val comps = col.components.toList()
            val bodyIdx = comps.indexOf(body)
            val btn = panel.actionButtonsForTest()["ok"]!!
            // find the footer panel that contains the button
            val footerIdx = comps.indexOfFirst { it is JPanel && find(it, btn) != null }
            assertTrue("footer should appear after body", bodyIdx < footerIdx)
        }
    }

    // ------ header icon ------

    fun `test setHeaderIcon adds icon to the left side of header row`() {
        edt {
            val panel = BaseQuestionView()
            panel.setHeaderIcon(AllIcons.General.Warning, "warning")

            val labels = findAll<JBLabel>(panel).filter { it.icon != null && it.isVisible }
            assertEquals("Expected one header icon", 1, labels.size)
            assertSame(AllIcons.General.Warning, labels[0].icon)
            assertEquals("warning", labels[0].toolTipText)
        }
    }

    fun `test setHeaderIcon null hides header icon`() {
        edt {
            val panel = BaseQuestionView()
            panel.setHeaderIcon(AllIcons.General.Warning)
            panel.setHeaderIcon(null)

            val labels = findAll<JBLabel>(panel).filter { it.icon != null && it.isVisible }
            assertTrue("Header icon should be hidden after setHeaderIcon(null)", labels.isEmpty())
        }
    }

    // ------ applyStyle: UI fonts ----

    fun `test applyStyle applies headerFont to header and hintFont to description`() {
        edt {
            val panel = BaseQuestionView()
            panel.setHeader("Title", "Hint")
            val style = SessionEditorStyle.current()
            panel.applyStyle(style)

            assertEquals("headerText should use headerFont", style.headerFont, panel.headerFont())
            assertEquals("descriptionText should use hintFont", style.hintFont, panel.descriptionFont())
        }
    }

    fun `test applyStyle does not apply editor font family to header or description`() {
        edt {
            val panel = BaseQuestionView()
            panel.setHeader("Title", "Hint")
            val style = SessionEditorStyle.create(family = "Courier New", size = 20)
            panel.applyStyle(style)

            assertFalse("headerText should not use editor font family", panel.headerFont().name == "Courier New")
            assertFalse("descriptionText should not use editor font family", panel.descriptionFont().name == "Courier New")
        }
    }

    fun `test description uses same vertical stacking as option descriptions`() {
        edt {
            val panel = BaseQuestionView()
            panel.setHeader("Title", "Hint")
            val desc = findAll<JBTextArea>(panel).firstOrNull { it.text == "Hint" }
            assertNotNull(desc)
            val ins = desc!!.border.getBorderInsets(desc)
            assertEquals("description should not add extra top padding", 0, ins.top)
        }
    }

    // ------ helpers ------

    private fun <T> edt(block: () -> T): T {
        var result: T? = null
        ApplicationManager.getApplication().invokeAndWait { result = block() }
        @Suppress("UNCHECKED_CAST")
        return result as T
    }

    private fun findCol(panel: BaseQuestionView): JPanel? {
        for (child in panel.components) {
            if (child is JPanel) return child
        }
        return null
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

    private inline fun <reified T> findAll(root: Container): List<T> = findAllCls(root, T::class.java)

    private fun <T> findAllCls(root: Container, cls: Class<T>): List<T> {
        val result = mutableListOf<T>()
        if (cls.isInstance(root)) result.add(cls.cast(root))
        for (child in root.components) {
            if (child is Container) result.addAll(findAllCls(child, cls))
        }
        return result
    }
}
