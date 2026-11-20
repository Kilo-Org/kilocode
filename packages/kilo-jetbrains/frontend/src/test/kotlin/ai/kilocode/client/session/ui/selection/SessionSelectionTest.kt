package ai.kilocode.client.session.ui.selection

import ai.kilocode.client.session.ui.style.SessionEditorStyle
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBTextArea
import java.awt.event.MouseEvent

@Suppress("UnstableApiUsage")
class SessionSelectionTest : BasePlatformTestCase() {
    fun `test selecting second text component clears first`() {
        val selection = SessionSelection()
        val one = JBTextArea("first value")
        val two = JBTextArea("second value")
        selection.register(one)
        selection.register(two)

        one.select(0, 5)
        two.select(0, 6)

        assertNull(one.selectedText)
        assertEquals("second", two.selectedText)
        assertEquals("second", selection.selectedText())
    }

    fun `test clearing active selection disables copy text`() {
        val selection = SessionSelection()
        val area = JBTextArea("selected value")
        selection.register(area)

        area.select(0, 8)
        area.select(0, 0)

        assertNull(selection.selectedText())
    }

    fun `test starting mouse selection clears previous text component immediately`() {
        val selection = SessionSelection()
        val one = JBTextArea("first value")
        val two = JBTextArea("second value")
        selection.register(one)
        selection.register(two)

        one.select(0, 5)
        val event = MouseEvent(two, MouseEvent.MOUSE_PRESSED, System.currentTimeMillis(), 0, 1, 1, 1, false)
        for (listener in two.mouseListeners) listener.mousePressed(event)

        assertNull(one.selectedText)
        assertNull(selection.selectedText())
    }

    fun `test unregistering active selection clears active state`() {
        val selection = SessionSelection()
        val area = JBTextArea("selected value")
        val reg = selection.register(area)

        area.select(0, 8)
        Disposer.dispose(reg)

        assertNull(selection.selectedText())
    }

    fun `test applyStyle updates swing selection colors`() {
        val selection = SessionSelection()
        val area = JBTextArea("selected value")
        selection.register(area)
        selection.applyStyle(SessionEditorStyle.current())

        assertNotNull(area.selectionColor)
        assertNotNull(area.selectedTextColor)
    }
}
