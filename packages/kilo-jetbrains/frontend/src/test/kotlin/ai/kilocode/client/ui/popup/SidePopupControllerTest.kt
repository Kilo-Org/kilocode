package ai.kilocode.client.ui.popup

import ai.kilocode.client.testing.TestUiTimers
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.UIUtil
import java.awt.Color
import javax.swing.JComponent
import javax.swing.JPanel

/**
 * The dwell and lifetime contract both the chat cards and the worktree rows depend on. These stop short of
 * a real balloon — placement answers null, the way it does whenever the surface is off screen — so the
 * tests stay headless while still covering every path that has to release a guard or a body.
 */
@Suppress("DEPRECATION")
class SidePopupControllerTest : BasePlatformTestCase() {
    private lateinit var timers: TestUiTimers
    private val controllers = mutableListOf<SidePopupController>()
    private val owners = mutableListOf<Disposable>()
    private var builds = 0
    private var places = 0
    private val bodies = mutableListOf<Disposable>()

    override fun setUp() {
        super.setUp()
        timers = TestUiTimers()
        builds = 0
        places = 0
        bodies.clear()
    }

    override fun tearDown() {
        try {
            controllers.forEach { Disposer.dispose(it) }
            owners.filterNot { Disposer.isDisposed(it) }.forEach { Disposer.dispose(it) }
        } finally {
            controllers.clear()
            owners.clear()
            super.tearDown()
        }
    }

    fun `test nothing is built before the dwell elapses`() {
        val controller = controller()
        val owner = owner()

        controller.show("row", owner) { request() }

        assertEquals(0, builds)
        timers.advanceBy(499)
        assertEquals(0, builds)

        timers.advanceBy(1)
        // A pointer crossing rows must not pay for a body it will never show.
        assertEquals(1, builds)
    }

    fun `test a list waits twice as long before building anything`() {
        val controller = controller(dwell = SidePopupController.LIST_MS)
        val owner = owner()

        controller.show("row", owner) { request() }

        // The dwell a transcript card uses is not enough here: the pointer travels across neighbouring
        // rows to reach its target, and each one would otherwise flash a popup on the way past.
        timers.advanceBy(SidePopupController.SHOW_MS.toLong())
        assertEquals(0, builds)

        timers.advanceBy(SidePopupController.SHOW_MS.toLong())
        assertEquals(1, builds)
    }

    fun `test leaving before the dwell cancels the popup outright`() {
        val controller = controller()
        val owner = owner()
        controller.show("row", owner) { request() }

        controller.notifyExit("row")
        timers.advanceBy(500)

        assertEquals(0, builds)
        assertNull(field<Any>(controller, "target"))
    }

    fun `test placement returning null tears everything down`() {
        val controller = controller()
        val owner = owner()
        controller.show("row", owner) { request() }

        timers.advanceBy(500)

        assertEquals(1, builds)
        assertEquals(1, places)
        // Nothing to sit beside, so the attempt must not leave a target or guard behind.
        assertNull(field<Any>(controller, "target"))
        assertNull(field<Disposable>(controller, "guard"))
        assertFalse(controller.showing())
        // The body was built before placement failed, and chat bodies hang editors off it, so a popup
        // that never opened still has to release it.
        val body = bodies.single()
        assertTrue("the unplaced body must be disposed", Disposer.isDisposed(body))
        assertNull(field<Disposable>(controller, "body"))
    }

    fun `test guard is released and replaced across hover cycles`() {
        val controller = controller()
        val owner = owner()

        controller.show("row", owner) { request() }
        val first = field<Disposable>(controller, "guard") ?: error("expected a guard")

        controller.notifyExit("row")
        assertNull(field<Disposable>(controller, "guard"))
        assertTrue(Disposer.isDisposed(first))

        controller.show("row", owner) { request() }
        val second = field<Disposable>(controller, "guard") ?: error("expected a fresh guard")
        assertNotSame(first, second)

        controller.hideAll()
        assertNull(field<Disposable>(controller, "guard"))
        assertTrue(Disposer.isDisposed(second))
    }

    fun `test disposing the owner suppresses a pending popup`() {
        val controller = controller()
        val owner = owner()
        controller.show("row", owner) { request() }

        Disposer.dispose(owner)
        timers.advanceBy(500)

        // The list or card went away while the dwell was running; the body must never be built.
        assertEquals(0, builds)
        assertNull(field<Any>(controller, "target"))
        assertNull(field<Disposable>(controller, "guard"))
    }

    fun `test hovering a different row restarts the dwell for that row`() {
        val controller = controller()
        val owner = owner()
        controller.show("a", owner) { request() }
        timers.advanceBy(400)

        controller.show("b", owner) { request() }
        timers.advanceBy(400)
        assertEquals("the second row's dwell must start over rather than inherit the first's", 0, builds)

        timers.advanceBy(100)
        assertEquals(1, builds)
    }

    fun `test repeated hover of the same row keeps one dwell running`() {
        val controller = controller()
        val owner = owner()
        controller.show("row", owner) { request() }
        timers.advanceBy(400)

        controller.show("row", owner) { request() }
        timers.advanceBy(100)

        // A mouse move within the same row should not push the popup further away.
        assertEquals(1, builds)
    }

    fun `test a request with nothing to show hides instead of opening`() {
        val controller = controller()
        val owner = owner()
        controller.show("row", owner) { null }

        timers.advanceBy(500)

        assertEquals(0, builds)
        assertNull(field<Any>(controller, "target"))
    }

    private fun controller(dwell: Int = SidePopupController.SHOW_MS): SidePopupController {
        val item = SidePopupController(timers, dwell)
        controllers.add(item)
        return item
    }

    private fun owner(): Disposable {
        val item = Disposer.newDisposable("owner")
        owners.add(item)
        Disposer.register(testRootDisposable, item)
        return item
    }

    private fun request() = SidePopupRequest(
        build = {
            builds++
            content()
        },
        place = {
            places++
            null
        },
    )

    private fun content(): SidePopupContent {
        val disposable = Disposer.newDisposable("body")
        bodies.add(disposable)
        return object : SidePopupContent {
            override val component: JComponent = JPanel()
            override val disposable: Disposable = disposable
            override val background: Color = UIUtil.getPanelBackground()
            override fun fitWithin(width: Int, height: Int) = Unit
        }
    }

    private inline fun <reified T> field(controller: SidePopupController, name: String): T? {
        val field = SidePopupController::class.java.getDeclaredField(name)
        field.isAccessible = true
        return field.get(controller) as? T
    }
}
