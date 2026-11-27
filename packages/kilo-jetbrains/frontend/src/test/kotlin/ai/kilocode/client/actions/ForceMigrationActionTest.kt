package ai.kilocode.client.actions

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.onboarding.FakeOnboardingProvider
import ai.kilocode.client.onboarding.KiloOnboardingService
import ai.kilocode.client.onboarding.OnboardingNeed
import ai.kilocode.client.onboarding.providers.v5migration.KiloMigrationService
import ai.kilocode.client.onboarding.providers.v5migration.MigrationOnboardingProvider
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.FakeMigrationRpcApi
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.actionSystem.ActionUiKind
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.Presentation
import com.intellij.openapi.application.ApplicationManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.testFramework.replaceService
import com.intellij.util.ui.UIUtil
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking

@Suppress("UnstableApiUsage")
class ForceMigrationActionTest : BasePlatformTestCase() {

    private lateinit var scope: CoroutineScope
    private lateinit var appRpc: FakeAppRpcApi
    private lateinit var rpc: FakeMigrationRpcApi
    private lateinit var provider: FakeOnboardingProvider
    private lateinit var onboarding: KiloOnboardingService

    override fun setUp() {
        super.setUp()
        scope = CoroutineScope(SupervisorJob())
        appRpc = FakeAppRpcApi()
        rpc = FakeMigrationRpcApi()
        provider = FakeOnboardingProvider(MigrationOnboardingProvider.ID).apply {
            need = OnboardingNeed("Migrate", "detail")
        }
        onboarding = KiloOnboardingService(
            scope,
            listOf(provider),
            MutableStateFlow(KiloAppStateDto(KiloAppStatusDto.MIGRATION_REQUIRED)),
        ) { _, _ -> }

        val app = ApplicationManager.getApplication()
        app.replaceService(KiloAppService::class.java, KiloAppService(scope, appRpc), testRootDisposable)
        app.replaceService(KiloMigrationService::class.java, KiloMigrationService(scope, rpc), testRootDisposable)
        app.replaceService(KiloOnboardingService::class.java, onboarding, testRootDisposable)
    }

    override fun tearDown() {
        try {
            scope.cancel()
        } finally {
            super.tearDown()
        }
    }

    fun `test rerun clears a previous later so the wizard is offered again`() {
        settle()
        onboarding.later()
        settle()
        assertTrue("step must be deferred before the rerun", onboarding.steps.value.isEmpty())

        run(confirmed = true)

        assertEquals(listOf(MigrationOnboardingProvider.ID), onboarding.steps.value.map { it.id })
        assertEquals(1, rpc.resetStatusCalls.size)
        assertEquals(1, appRpc.restarts)
    }

    fun `test cancelling the confirmation changes nothing`() {
        settle()
        onboarding.later()
        settle()

        run(confirmed = false)

        assertTrue(onboarding.steps.value.isEmpty())
        assertEquals(0, rpc.resetStatusCalls.size)
        assertEquals(0, appRpc.restarts)
    }

    private fun run(confirmed: Boolean) {
        val action = ForceMigrationAction().apply { confirm = { confirmed } }
        val event = AnActionEvent.createEvent(
            DataContext.EMPTY_CONTEXT,
            Presentation().apply { copyFrom(action.templatePresentation) },
            ActionPlaces.TOOLWINDOW_TITLE,
            ActionUiKind.NONE,
            null,
        )
        action.actionPerformed(event)
        settle()
    }

    private fun settle() = runBlocking {
        repeat(3) {
            delay(50)
            UIUtil.dispatchAllInvocationEvents()
        }
    }
}
