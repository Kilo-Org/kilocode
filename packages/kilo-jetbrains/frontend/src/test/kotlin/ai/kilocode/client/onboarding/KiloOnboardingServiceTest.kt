package ai.kilocode.client.onboarding

import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.UIUtil
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking

@Suppress("UnstableApiUsage")
class KiloOnboardingServiceTest : BasePlatformTestCase() {

    private lateinit var scope: CoroutineScope
    private lateinit var app: MutableStateFlow<KiloAppStateDto>
    private val telemetry = mutableListOf<Pair<String, Map<String, String>>>()

    override fun setUp() {
        super.setUp()
        scope = CoroutineScope(SupervisorJob())
        app = MutableStateFlow(KiloAppStateDto(KiloAppStatusDto.DISCONNECTED))
        telemetry.clear()
    }

    override fun tearDown() {
        try {
            scope.cancel()
        } finally {
            super.tearDown()
        }
    }

    private fun settle() = runBlocking {
        repeat(3) {
            delay(50)
            UIUtil.dispatchAllInvocationEvents()
        }
    }

    private fun service(vararg providers: OnboardingProvider) = KiloOnboardingService(
        scope,
        providers.toList(),
        app,
    ) { event, props -> telemetry.add(event to props) }

    fun `test detection aggregates all providers in order and skips nulls`() {
        val a = FakeOnboardingProvider("a").apply { need = OnboardingNeed("A", "a detail") }
        val b = FakeOnboardingProvider("b") // need stays null
        val c = FakeOnboardingProvider("c").apply { need = OnboardingNeed("C", "c detail") }
        val svc = service(a, b, c)
        settle()

        assertEquals(listOf("a", "c"), svc.steps.value.map { it.id })
    }

    fun `test app state change re-detects`() {
        val a = FakeOnboardingProvider("a")
        val svc = service(a)
        settle()
        assertTrue(svc.steps.value.isEmpty())

        a.need = OnboardingNeed("A", "a detail")
        app.value = KiloAppStateDto(KiloAppStatusDto.READY)
        settle()
        assertEquals(listOf("a"), svc.steps.value.map { it.id })
    }

    fun `test provider invalidate signal re-detects`() {
        val invalidate = MutableSharedFlow<Unit>()
        val a = FakeOnboardingProvider("a", invalidateFlow = invalidate)
        val svc = service(a)
        settle()
        assertTrue(svc.steps.value.isEmpty())

        a.need = OnboardingNeed("A", "a detail")
        scope.launch { invalidate.emit(Unit) }
        settle()
        assertEquals(listOf("a"), svc.steps.value.map { it.id })
    }

    fun `test identical detection does not re-emit steps`() {
        val invalidate = MutableSharedFlow<Unit>()
        val a = FakeOnboardingProvider("a", invalidateFlow = invalidate).apply {
            need = OnboardingNeed("A", "a detail")
        }
        val svc = service(a)
        settle()
        val first = svc.steps.value

        scope.launch { invalidate.emit(Unit) }
        settle()
        assertSame(first, svc.steps.value)
    }

    fun `test later defers for this run and calls provider later`() {
        val a = FakeOnboardingProvider("a").apply { need = OnboardingNeed("A", "a detail") }
        val svc = service(a)
        settle()
        assertEquals(1, svc.steps.value.size)

        svc.later()
        settle()

        assertEquals(1, a.laters.size)
        assertTrue(svc.steps.value.isEmpty())

        // Deferred for this run: re-detecting (e.g. via another app-state change) must not bring it back.
        app.value = KiloAppStateDto(KiloAppStatusDto.READY)
        settle()
        assertTrue(svc.steps.value.isEmpty())
    }

    fun `test later keeps the step offered when the provider could not resume`() {
        val a = FakeOnboardingProvider("a").apply {
            need = OnboardingNeed("A", "a detail")
            laterResult = false
        }
        val svc = service(a)
        settle()

        svc.later()
        settle()

        // A blocking step's later() is what unpauses the app. If that failed the step must stay
        // visible, otherwise the app is paused with no UI left to resolve it.
        assertEquals(1, a.laters.size)
        assertEquals(listOf("a"), svc.steps.value.map { it.id })

        // Not deferred either: a later re-detect still offers it.
        app.value = KiloAppStateDto(KiloAppStatusDto.READY)
        settle()
        assertEquals(listOf("a"), svc.steps.value.map { it.id })
    }

    fun `test reoffer clears the deferral and offers the step again`() {
        val a = FakeOnboardingProvider("a").apply { need = OnboardingNeed("A", "a detail") }
        val svc = service(a)
        settle()

        svc.later()
        settle()
        assertTrue(svc.steps.value.isEmpty())

        svc.reoffer("a")
        settle()

        assertEquals(listOf("a"), svc.steps.value.map { it.id })
    }

    fun `test reoffer of a step that was never deferred does nothing`() {
        val a = FakeOnboardingProvider("a")
        val svc = service(a)
        settle()

        svc.reoffer("a")
        settle()

        assertTrue(svc.steps.value.isEmpty())
    }

    fun `test skipAll calls skip on every current step`() {
        val a = FakeOnboardingProvider("a").apply { need = OnboardingNeed("A", "a detail") }
        val b = FakeOnboardingProvider("b").apply { need = OnboardingNeed("B", "b detail") }
        val svc = service(a, b)
        settle()
        assertEquals(2, svc.steps.value.size)

        svc.skipAll()
        settle()

        assertEquals(1, a.skips.size)
        assertEquals(1, b.skips.size)
    }

    fun `test provider lookup by id`() {
        val a = FakeOnboardingProvider("a")
        val svc = service(a)
        assertSame(a, svc.provider("a"))
        assertNull(svc.provider("missing"))
    }

    fun `test onboarding shown telemetry fires once when steps first appear`() {
        val a = FakeOnboardingProvider("a")
        val svc = service(a)
        settle()

        a.need = OnboardingNeed("A", "a detail")
        app.value = KiloAppStateDto(KiloAppStatusDto.READY)
        settle()

        val shown = telemetry.filter { it.first == "Onboarding Shown" }
        assertEquals(1, shown.size)
        assertEquals("1", shown.single().second["stepCount"])
    }
}
