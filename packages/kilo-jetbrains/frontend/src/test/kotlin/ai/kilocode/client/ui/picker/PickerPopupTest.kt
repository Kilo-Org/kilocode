package ai.kilocode.client.ui.picker

import com.intellij.CommonBundle
import com.intellij.ide.ui.laf.darcula.ui.DarculaButtonUI
import com.intellij.openapi.application.ApplicationManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.CollectionListModel
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Component
import java.awt.Container
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.JPanel

class PickerPopupTest : BasePlatformTestCase() {

    fun `test multi picker close button uses default style`() = edt {
        val model = CollectionListModel(listOf("gemma"))
        val picker = PickerPopup(
            anchor = JButton(),
            placement = PickerPopup.Placement.UNDERNEATH,
            rows = { model.items },
            model = model,
            renderer = TestRenderer(model),
            mode = PickerPopup.Mode.Multi,
            onPrimary = {},
        )

        val foot = footer(picker)
        val btn = components(foot).filterIsInstance<JButton>().single { it.text == CommonBundle.getCloseButtonText() }

        assertEquals(true, btn.getClientProperty(DarculaButtonUI.DEFAULT_STYLE_KEY))
        assertEquals(popupBackground, btn.background)
        assertFalse(btn.isFocusable)
        assertFalse(btn.isRequestFocusEnabled)
    }

    fun `test picker row uses standard gap between check and text`() = edt {
        val model = CollectionListModel(listOf("gemma"))
        val renderer = TestRenderer(model)

        val row = row(renderer)

        assertEquals(JBUI.CurrentTheme.ActionsList.elementIconGap(), (row.layout as BorderLayout).hgap)
    }

    private fun footer(picker: PickerPopup<String>): JComponent {
        val method = PickerPopup::class.java.getDeclaredMethod("footer")
        method.isAccessible = true
        return method.invoke(picker) as JComponent
    }

    private fun row(renderer: PickerListRenderer<String>): JPanel {
        val field = PickerListRenderer::class.java.getDeclaredField("row")
        field.isAccessible = true
        return field.get(renderer) as JPanel
    }

    private fun components(component: Component): List<Component> {
        val out = mutableListOf<Component>()
        fun visit(c: Component) {
            out += c
            if (c is Container) c.components.forEach { visit(it) }
        }
        visit(component)
        return out
    }

    private fun <T> edt(block: () -> T): T {
        var result: T? = null
        ApplicationManager.getApplication().invokeAndWait { result = block() }
        @Suppress("UNCHECKED_CAST")
        return result as T
    }

    private class TestRenderer(model: CollectionListModel<String>) : PickerListRenderer<String>(
        model = model,
        checked = { false },
        sectionTitle = { _, _ -> null },
        content = JBLabel(),
    ) {
        override fun update(value: String, index: Int, selected: Boolean, focused: Boolean, foreground: Color, weak: Color) {
            (content as JBLabel).text = value
        }
    }
}
