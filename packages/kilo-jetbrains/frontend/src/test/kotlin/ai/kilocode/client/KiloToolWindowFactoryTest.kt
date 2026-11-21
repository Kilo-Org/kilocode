package ai.kilocode.client

import ai.kilocode.client.agentManager.SidePanelKeys
import ai.kilocode.client.agentManager.SidePanelMode
import ai.kilocode.client.agentManager.applySidePanelMode
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.telemetry.KiloTelemetryService
import ai.kilocode.client.telemetry.Telemetry
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.util.edtWait
import ai.kilocode.rpc.dto.TelemetryCaptureDto
import com.intellij.openapi.application.Application
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ex.ApplicationEx
import com.intellij.openapi.project.Project
import com.intellij.openapi.progress.ProcessCanceledException
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.ToolWindow
import com.intellij.testFramework.replaceService
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.content.ContentFactory
import java.lang.reflect.InvocationTargetException
import java.lang.reflect.Proxy
import javax.swing.JPanel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.cancel
import kotlin.test.assertFailsWith

class KiloToolWindowFactoryTest : BasePlatformTestCase() {
    private lateinit var coroutines: TestCoroutines

    override fun setUp() {
        super.setUp()
        coroutines = TestCoroutines()
    }

    override fun tearDown() {
        try {
            coroutines.close()
        } finally {
            super.tearDown()
        }
    }

    fun `test content labels are short`() {
        assertEquals("Chat", KiloBundle.message("sidePanel.mode.branch"))
        assertEquals("Agents", KiloBundle.message("sidePanel.mode.agentManager"))
    }

    fun `test content records side panel mode`() = edtWait {
        val content = ContentFactory.getInstance().createContent(JPanel(), "Chat", false)

        content.applySidePanelMode(SidePanelMode.CHAT)

        assertEquals(SidePanelMode.CHAT, content.getUserData(SidePanelKeys.CONTENT_MODE))
    }

    fun `test telemetry tolerates a missing service lookup during unload`() {
        application {
            assertFalse(ApplicationManager.getApplication().isDisposed)
            Telemetry.send("Tool Window Setup Failed")
        }
    }

    fun `test the fake application matches the platform application type`() {
        val app = ApplicationManager.getApplication()
        application {
            // Cancellation/JFR hooks read the application as ApplicationEx from other threads.
            val proxy = ApplicationManager.getApplication()
            assertTrue(proxy is ApplicationEx)
            assertTrue(proxy == proxy)
            assertFalse(proxy == app)
            assertEquals(System.identityHashCode(proxy), proxy.hashCode())
            assertTrue(proxy.toString().startsWith("ApplicationEx test delegate@"))
        }
    }

    fun `test telemetry keeps initializing lookup and delivers available events`() {
        val rpc = FakeAppRpcApi()
        val service = KiloTelemetryService(coroutines.scope, rpc)
        var calls = 0
        application(telemetry = { calls++; service }) {
            assertNull(ApplicationManager.getApplication().getServiceIfCreated(KiloTelemetryService::class.java))
            assertSame(service, KiloTelemetryService.getInstance())
            assertEquals(1, calls)
        }

        ApplicationManager.getApplication().replaceService(KiloTelemetryService::class.java, service, testRootDisposable)
        Telemetry.send("Tool Window Opened", mapOf("projectResolved" to "true"))
        coroutines.drain()
        assertEquals(listOf(TelemetryCaptureDto("Tool Window Opened", mapOf("projectResolved" to "true"))), rpc.telemetry)
    }

    fun `test telemetry does not hide service initialization errors`() {
        val error = IllegalStateException("telemetry initialization failed")
        application(telemetry = { throw error }) {
            assertSame(error, assertFailsWith<IllegalStateException> { Telemetry.send("Tool Window Opened") })
        }
    }

    fun `test canceled tool window creation propagates cancellation`() {
        coroutines.scope.cancel()
        val service = KiloToolWindowSetupService(project, coroutines.scope)
        val window = window()
        assertFailsWith<CancellationException> { service.create(window) }
    }

    fun `test tool window creation propagates cancellation from service lookup`() {
        val service = KiloToolWindowSetupService(project, coroutines.scope)
        val window = window()
        for (error in listOf(CancellationException("plugin unload"), ProcessCanceledException())) {
            application(failure = KiloWorkspaceService::class.java to error) {
                assertSame(error, assertFailsWith<CancellationException> { service.create(window) })
            }
        }
    }

    fun `test canceled tool window setup does not create UI or report failure`() = edtWait {
        coroutines.scope.cancel()
        val service = KiloToolWindowSetupService(project, coroutines.scope)
        val workspace = KiloWorkspaceService(coroutines.scope, FakeWorkspaceRpcApi()).workspace("/test")
        val window = window()
        val setup = KiloToolWindowSetupService::class.java.getDeclaredMethod(
            "setup", Project::class.java, ToolWindow::class.java, Workspace::class.java,
        ).apply { isAccessible = true }
        val error = assertFailsWith<InvocationTargetException> { setup.invoke(service, project, window, workspace) }
        assertTrue(error.cause is CancellationException)
    }

    private fun application(
        telemetry: () -> KiloTelemetryService? = { null },
        failure: Pair<Class<*>, Throwable>? = null,
        block: () -> Unit,
    ) {
        val app = ApplicationManager.getApplication()
        // Cancellation and JFR hooks reach the application from other threads through
        // ApplicationManagerEx.getApplicationEx(), so the delegate has to implement that interface too.
        val delegate = Proxy.newProxyInstance(
            ApplicationEx::class.java.classLoader,
            arrayOf(Application::class.java, ApplicationEx::class.java),
        ) { proxy, method, args ->
            val arguments = args ?: emptyArray()
            when {
                method.declaringClass == Any::class.java ->
                    when (method.name) {
                        "equals" -> proxy === arguments.singleOrNull()
                        "hashCode" -> System.identityHashCode(proxy)
                        "toString" -> "ApplicationEx test delegate@${Integer.toHexString(System.identityHashCode(proxy))}"
                        else -> forward(app, method, arguments)
                    }

                method.name == "getService" && arguments.size == 1 -> {
                    val type = arguments[0] as Class<*>
                    if (failure != null && type == failure.first) throw failure.second
                    if (type == KiloTelemetryService::class.java) type.cast(telemetry())
                    else forward(app, method, arguments)
                }

                method.name == "getServiceIfCreated" && arguments.size == 1 -> {
                    val type = arguments[0] as Class<*>
                    if (type == KiloTelemetryService::class.java) null
                    else forward(app, method, arguments)
                }

                else -> forward(app, method, arguments)
            }
        } as Application
        val parent = Disposer.newDisposable()
        try {
            // Model the nullable lookup contract without unregistering/recreating a light service.
            ApplicationManager.setApplication(delegate, parent)
            block()
        } finally {
            Disposer.dispose(parent)
        }
    }

    private fun forward(app: Any, method: java.lang.reflect.Method, args: Array<Any?>): Any? =
        try {
            method.invoke(app, *args)
        } catch (error: InvocationTargetException) {
            throw error.targetException
        }

    private fun window(): ToolWindow = Proxy.newProxyInstance(
        ToolWindow::class.java.classLoader,
        arrayOf(ToolWindow::class.java),
    ) { _, method, _ -> throw AssertionError("Unexpected tool window access: ${method.name}") } as ToolWindow
}
