package ai.kilocode.client.session.ui

import ai.kilocode.client.ui.picker.PickerListRenderer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.NewUI
import com.intellij.ui.components.JBList
import com.intellij.util.ui.UIUtil
import java.awt.ComponentOrientation

class PickerRowTest : BasePlatformTestCase() {
    fun `test popup row inset matches the trailing favorite hit area`() {
        val list = JBList(listOf<Any>())
        val row = PickerRow()

        row.update(list, false, false)
        if (!NewUI.isEnabled()) {
            assertEquals(0, row.insets.left)
            assertEquals(0, row.insets.right)
            return
        }
        assertEquals(PickerListRenderer.trailingInset(list), row.insets.right)

        list.componentOrientation = ComponentOrientation.RIGHT_TO_LEFT
        row.update(list, false, false)
        assertEquals(PickerListRenderer.trailingInset(list), row.insets.left)
    }

    fun `test active row remains compact without popup insets`() {
        val row = PickerRow()

        row.update(UIUtil.getPanelBackground(), null, false, false)

        assertEquals(0, row.insets.left)
        assertEquals(0, row.insets.right)
    }
}
