package ai.kilocode.client.ui.md

import ai.kilocode.client.session.ui.style.SessionEditorStyle
import com.intellij.testFramework.fixtures.BasePlatformTestCase

class MdViewFactoryTest : BasePlatformTestCase() {
    fun `test create returns hybrid renderer`() {
        assertInstanceOf(MdViewFactory.create(), MdViewHybrid::class.java)
    }

    fun `test hybrid returns hybrid renderer`() {
        assertInstanceOf(MdViewFactory.hybrid(), MdViewHybrid::class.java)
    }

    fun `test html returns hybrid renderer`() {
        assertInstanceOf(MdViewFactory.html(), MdViewHybrid::class.java)
    }

    fun `test create applies supplied session style`() {
        val style = SessionEditorStyle.create(family = "Courier New", size = 22)
        val view = MdViewFactory.create(style)

        assertEquals(style.transcriptFont.name, view.font.name)
        assertEquals(22, view.font.size)
        assertEquals("Courier New", view.codeFont)
    }
}
