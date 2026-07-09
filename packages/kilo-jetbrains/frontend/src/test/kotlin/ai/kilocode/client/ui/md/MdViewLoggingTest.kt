package ai.kilocode.client.ui.md

import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase

@Suppress("UnstableApiUsage")
class MdViewLoggingTest : BasePlatformTestCase() {

    fun `test invalid font family does not throw while building override sheet`() {
        val view = MdViewFactory.html()
        try {
            view.codeFont = "broken'font"
            view.set("`x`")

            assertTrue(view.overrideSheet().contains("broken\\'font"))
            assertTrue(view.html().contains("<code style=\"color:"))
        } finally {
            Disposer.dispose(view)
        }
    }
}
