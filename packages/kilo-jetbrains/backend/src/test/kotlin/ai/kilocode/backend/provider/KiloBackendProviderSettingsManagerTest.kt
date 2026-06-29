package ai.kilocode.backend.provider

import ai.kilocode.backend.app.KiloAppState
import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.testing.FakeCliServer
import ai.kilocode.backend.testing.MockCliServer
import ai.kilocode.backend.testing.TestLog
import ai.kilocode.rpc.dto.ProviderDisconnectDto
import ai.kilocode.rpc.dto.ProviderEnableDto
import kotlinx.coroutines.async
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import java.util.concurrent.CountDownLatch
import kotlin.system.measureTimeMillis
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class KiloBackendProviderSettingsManagerTest {

    private val mock = MockCliServer()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    @AfterTest
    fun tearDown() {
        scope.cancel()
        mock.close()
    }

    @Test
    fun `disconnecting available catalog provider returns error without mutation`() = runBlocking {
        mock.providers = """{
            "all":[{"id":"cloudflare-ai-gateway","name":"Cloudflare AI Gateway","source":"custom","models":{}}],
            "default":{},
            "connected":[],
            "failed":[]
        }""".trimIndent()
        mock.providerAuth = """{"cloudflare-ai-gateway":[{"type":"api","label":"API key"}]}"""
        val manager = manager()

        mock.resetCounts()
        val result = manager.disconnect(ProviderDisconnectDto("/test", "cloudflare-ai-gateway"))

        assertEquals("Provider is not connected.", result.error)
        assertNull(mock.lastConfigPatchBody)
        assertNull(mock.lastAuthDeletePath)
        assertEquals(0, mock.requestCount("/global/dispose"))
    }

    @Test
    fun `disconnecting openai compatible custom provider deletes config and auth`() = runBlocking {
        mock.config = """{
            "model":"test/model",
            "provider":{
                "local-openai":{"name":"Local OpenAI","npm":"@ai-sdk/openai-compatible","options":{"baseURL":"http://localhost:11434"}}
            }
        }""".trimIndent()
        mock.providers = """{
            "all":[{"id":"local-openai","name":"Local OpenAI","source":"config","models":{}}],
            "default":{},
            "connected":["local-openai"],
            "failed":[]
        }""".trimIndent()
        val manager = manager()

        mock.resetCounts()
        val result = manager.disconnect(ProviderDisconnectDto("/test", "local-openai"))

        assertNull(result.error)
        assertContains(mock.lastConfigPatchBody.orEmpty(), "\"local-openai\":null")
        assertNull(mock.lastWorkspaceConfigPatchBody)
        assertEquals("/auth/local-openai", mock.lastAuthDeletePath)
        assertEquals(1, mock.requestCount("/global/dispose"))
    }

    @Test
    fun `state marks provider config scopes`() = runBlocking {
        mock.config = """{
            "provider":{
                "global-openai":{"name":"Global OpenAI","npm":"@ai-sdk/openai-compatible","options":{"baseURL":"https://global.test"}},
                "overridden-openai":{"name":"Global Override","npm":"@ai-sdk/openai-compatible","options":{"baseURL":"https://global.test"}}
            },
            "disabled_providers":["global-disabled"],
            "enabled_providers":["global-enabled"]
        }""".trimIndent()
        mock.workspaceConfig = """{
            "provider":{
                "global-openai":{"name":"Global OpenAI","npm":"@ai-sdk/openai-compatible","options":{"baseURL":"https://global.test"}},
                "overridden-openai":{"name":"Workspace Override","npm":"@ai-sdk/openai-compatible","options":{"baseURL":"https://workspace.test"}},
                "workspace-openai":{"name":"Workspace OpenAI","npm":"@ai-sdk/openai-compatible","options":{"baseURL":"https://workspace.test"}}
            },
            "disabled_providers":["global-disabled","workspace-disabled"],
            "enabled_providers":["global-enabled","workspace-enabled"]
        }""".trimIndent()
        val manager = manager()

        val state = manager.state("/test")

        assertEquals("global", state.config["global-openai"]?.scope)
        assertEquals("workspace", state.config["overridden-openai"]?.scope)
        assertEquals("workspace", state.config["workspace-openai"]?.scope)
        assertEquals(listOf("global"), state.disabledScopes["global-disabled"])
        assertEquals(listOf("workspace"), state.disabledScopes["workspace-disabled"])
        assertEquals(listOf("global"), state.enabledScopes["global-enabled"])
        assertEquals(listOf("workspace"), state.enabledScopes["workspace-enabled"])
    }

    @Test
    fun `disconnecting workspace openai compatible custom provider patches workspace config`() = runBlocking {
        mock.workspaceConfig = """{
            "provider":{
                "local-openai":{"name":"Local OpenAI","npm":"@ai-sdk/openai-compatible","options":{"baseURL":"http://localhost:11434"}}
            }
        }""".trimIndent()
        mock.providers = """{
            "all":[{"id":"local-openai","name":"Local OpenAI","source":"config","models":{}}],
            "default":{},
            "connected":["local-openai"],
            "failed":[]
        }""".trimIndent()
        val manager = manager()

        mock.resetCounts()
        val result = manager.disconnect(ProviderDisconnectDto("/test project", "local-openai"))

        assertNull(result.error)
        assertNull(mock.lastConfigPatchBody)
        assertEquals("/config?directory=%2Ftest+project", mock.lastWorkspaceConfigPatchPath)
        assertContains(mock.lastWorkspaceConfigPatchBody.orEmpty(), "\"local-openai\":null")
        assertEquals("/auth/local-openai", mock.lastAuthDeletePath)
        assertEquals(1, mock.requestCount("/global/dispose"))
    }

    @Test
    fun `disconnecting workspace configured provider patches workspace disabled providers`() = runBlocking {
        mock.config = """{"disabled_providers":["global-disabled"]}"""
        mock.workspaceConfig = """{
            "provider":{"anthropic":{"name":"Anthropic","npm":"@ai-sdk/anthropic"}},
            "disabled_providers":["global-disabled","workspace-disabled"]
        }""".trimIndent()
        mock.providers = """{
            "all":[{"id":"anthropic","name":"Anthropic","source":"config","models":{}}],
            "default":{},
            "connected":[],
            "failed":[]
        }""".trimIndent()
        val manager = manager()

        mock.resetCounts()
        val result = manager.disconnect(ProviderDisconnectDto("/test", "anthropic"))

        assertNull(result.error)
        assertNull(mock.lastConfigPatchBody)
        assertContains(mock.lastWorkspaceConfigPatchBody.orEmpty(), "\"anthropic\"")
        assertContains(mock.lastWorkspaceConfigPatchBody.orEmpty(), "\"workspace-disabled\"")
        assertFalse(mock.lastWorkspaceConfigPatchBody.orEmpty().contains("global-disabled"))
        assertEquals(1, mock.requestCount("/global/dispose"))
    }

    @Test
    fun `enabling workspace disabled provider patches workspace disabled providers`() = runBlocking {
        mock.config = """{"disabled_providers":["global-disabled"]}"""
        mock.workspaceConfig = """{"disabled_providers":["global-disabled","workspace-disabled","anthropic"]}"""
        mock.providers = """{
            "all":[{"id":"anthropic","name":"Anthropic","source":"config","models":{}}],
            "default":{},
            "connected":[],
            "failed":[]
        }""".trimIndent()
        val manager = manager()

        mock.resetCounts()
        val result = manager.enable(ProviderEnableDto("/test", "anthropic"))

        assertNull(result.error)
        assertNull(mock.lastConfigPatchBody)
        assertContains(mock.lastWorkspaceConfigPatchBody.orEmpty(), "\"workspace-disabled\"")
        assertFalse(mock.lastWorkspaceConfigPatchBody.orEmpty().contains("anthropic"))
        assertFalse(mock.lastWorkspaceConfigPatchBody.orEmpty().contains("global-disabled"))
        assertEquals(1, mock.requestCount("/global/dispose"))
    }

    @Test
    fun `disconnecting kilo gateway returns error without logout`() = runBlocking {
        mock.providers = """{
            "all":[{"id":"kilo","name":"Kilo Gateway","source":"custom","models":{}}],
            "default":{},
            "connected":["kilo"],
            "failed":[]
        }""".trimIndent()
        val manager = manager()

        mock.resetCounts()
        val result = manager.disconnect(ProviderDisconnectDto("/test", "kilo"))

        assertEquals("Kilo Gateway cannot be disconnected from provider settings.", result.error)
        assertFalse(result.profileCleared)
        assertNull(mock.lastAuthDeletePath)
        assertEquals(0, mock.requestCount("/auth/kilo"))
        assertEquals(0, mock.requestCount("/global/dispose"))
    }

    @Test
    fun `state waits through dispose triggered reload`() = runBlocking {
        mock.providers = """{
            "all":[{"id":"openai","name":"OpenAI","source":"custom","models":{}}],
            "default":{},
            "connected":["openai"],
            "failed":[]
        }""".trimIndent()
        val app = app()
        val manager = KiloBackendProviderSettingsManager(app)
        assertTrue(mock.awaitSseConnection())
        val gate = CountDownLatch(1)
        mock.responseGate = gate

        try {
            mock.pushEvent("global.disposed", "{}")
            withTimeout(5_000) {
                app.appState.first { it is KiloAppState.Loading }
            }

            val state = async { manager.state("/test") }
            delay(200)
            assertFalse(state.isCompleted)

            gate.countDown()
            val result = withTimeout(10_000) { state.await() }
            assertEquals(listOf("openai"), result.connected)
            assertEquals(1, result.providers.size)
        } finally {
            mock.responseGate = null
            gate.countDown()
        }
    }

    @Test
    fun `awaitReady returns immediately when ready`() = runBlocking {
        val app = app()

        val elapsed = measureTimeMillis {
            app.awaitReady()
        }

        assertTrue(elapsed < 500, "awaitReady should not wait when already ready, elapsed=${elapsed}ms")
    }

    @Test
    fun `awaitReady fails fast when disconnected`() = runBlocking {
        val app = KiloBackendAppService.create(scope, FakeCliServer(mock), TestLog())

        val elapsed = measureTimeMillis {
            assertFailsWith<IllegalStateException> {
                app.awaitReady()
            }
        }

        assertTrue(elapsed < 500, "awaitReady should fail fast when disconnected, elapsed=${elapsed}ms")
    }

    private suspend fun manager(): KiloBackendProviderSettingsManager {
        return KiloBackendProviderSettingsManager(app())
    }

    private suspend fun app(): KiloBackendAppService {
        val app = KiloBackendAppService.create(scope, FakeCliServer(mock), TestLog())
        app.connect()
        withTimeout(10_000) {
            app.appState.first { it is KiloAppState.Ready }
        }
        return app
    }
}
