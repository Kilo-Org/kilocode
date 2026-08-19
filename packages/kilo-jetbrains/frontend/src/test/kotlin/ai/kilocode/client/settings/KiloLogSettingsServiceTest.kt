package ai.kilocode.client.settings

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.log.LogConfig
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.yield

class KiloLogSettingsServiceTest : BasePlatformTestCase() {

    private lateinit var scope: CoroutineScope
    private lateinit var rpc: FakeAppRpcApi
    private lateinit var app: KiloAppService
    private lateinit var settings: KiloLogSettingsService

    override fun setUp() {
        super.setUp()
        scope = CoroutineScope(SupervisorJob())
        rpc = FakeAppRpcApi()
        app = KiloAppService(scope, rpc)
        settings = KiloLogSettingsService()
    }

    override fun tearDown() {
        try {
            scope.cancel()
            LogConfig.apply(null, null, null)
        } finally {
            super.tearDown()
        }
    }

    fun `test apply persists saved values locally and pushes to backend`() = runBlocking(Dispatchers.Default) {
        settings.update(LogConfig.LogLevel.ERROR, LogConfig.ContentMode.PREVIEW, 25)
        settings.apply(app)

        withTimeout(5_000) {
            while (rpc.logConfigs.isEmpty()) yield()
        }

        assertEquals(LogConfig.LogLevel.ERROR, LogConfig.level())
        assertEquals(LogConfig.ContentMode.PREVIEW, LogConfig.contentMode())
        assertEquals(25, LogConfig.previewMax())

        val dto = rpc.logConfigs.single()
        assertEquals("ERROR", dto.level)
        assertEquals("PREVIEW", dto.contentMode)
        assertEquals(25, dto.previewMax)
    }
}
