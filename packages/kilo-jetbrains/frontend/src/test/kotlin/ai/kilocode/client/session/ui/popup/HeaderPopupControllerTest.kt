package ai.kilocode.client.session.ui.popup

import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.views.base.PartView
import ai.kilocode.client.testing.TestUiTimers
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase

@Suppress("DEPRECATION")
class HeaderPopupControllerTest : BasePlatformTestCase() {
    private lateinit var timers: TestUiTimers
    private val controllers = mutableListOf<HeaderPopupController>()
    private val views = mutableListOf<TestView>()

    override fun setUp() {
        super.setUp()
        timers = TestUiTimers()
    }

    override fun tearDown() {
        try {
            controllers.forEach { Disposer.dispose(it) }
            views.filterNot { Disposer.isDisposed(it) }.forEach { Disposer.dispose(it) }
        } finally {
            controllers.clear()
            views.clear()
            super.tearDown()
        }
    }

    fun `test guard is disposed between repeated hover cycles`() {
        val controller = controller()
        val view = view()

        controller.show(view)
        val first = guard(controller)
        assertNotNull(first)

        controller.notifyExit(view)

        assertNull(guard(controller))
        assertTrue(Disposer.isDisposed(first!!))

        controller.show(view)
        val second = guard(controller)
        assertNotNull(second)
        assertNotSame(first, second)

        controller.hideAll()

        assertNull(guard(controller))
        assertTrue(Disposer.isDisposed(second!!))
    }

    fun `test disposing hovered view clears pending guard and suppresses popup`() {
        val controller = controller()
        val view = view()

        controller.show(view)
        val hook = guard(controller)
        assertNotNull(hook)

        Disposer.dispose(view)
        timers.advanceBy(500)

        assertNull(guard(controller))
        assertNull(target(controller))
        assertTrue(Disposer.isDisposed(hook!!))
        assertEquals(0, view.requests)
    }

    fun `test an overlay suppresses the hover popup`() {
        var overlay = false
        val controller = controller { overlay }
        val view = view()

        overlay = true
        controller.show(view)

        // A blocking overlay leaves no target pending and the dwell never asks for a popup body.
        assertNull(target(controller))
        assertNull(guard(controller))
        timers.advanceBy(500)
        assertEquals(0, view.requests)
    }

    fun `test an overlay appearing during the dwell cancels the popup`() {
        var overlay = false
        val controller = controller { overlay }
        val view = view()

        controller.show(view)
        assertNotNull(target(controller))

        overlay = true
        timers.advanceBy(500)

        assertNull(target(controller))
        assertEquals(0, view.requests)
    }

    private fun controller(suppressed: () -> Boolean = { false }): HeaderPopupController {
        val item = HeaderPopupController(timers, suppressed)
        controllers.add(item)
        return item
    }

    private fun view(): TestView {
        val item = TestView()
        views.add(item)
        return item
    }

    private fun guard(controller: HeaderPopupController): Disposable? = field(controller, "guard")

    private fun target(controller: HeaderPopupController): PartView? = field(controller, "target")

    private inline fun <reified T> field(controller: HeaderPopupController, name: String): T? {
        val field = HeaderPopupController::class.java.getDeclaredField(name)
        field.isAccessible = true
        return field.get(controller) as? T
    }

    private class TestView : PartView() {
        override val contentId = "test"
        var requests = 0
            private set

        override fun update(content: Content) {}

        override fun headerPopup(): HeaderPopupRequest? {
            requests++
            return null
        }
    }
}
