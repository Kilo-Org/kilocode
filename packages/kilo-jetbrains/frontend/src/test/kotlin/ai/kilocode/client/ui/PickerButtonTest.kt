package ai.kilocode.client.ui

import com.intellij.testFramework.fixtures.BasePlatformTestCase

class PickerButtonTest : BasePlatformTestCase() {

    fun `test pick close restores focus only when a value is chosen`() {
        var calls = 0
        val button = PickerButton().apply { onPickClose = { calls++ } }

        button.pickClosed(false)
        assertEquals(0, calls)

        button.pickClosed(true)
        assertEquals(1, calls)
    }
}
