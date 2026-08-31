package ai.kilocode.backend.provider

import ai.kilocode.backend.app.KiloAppState
import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.testing.FakeCliServer
import ai.kilocode.backend.testing.MockCliServer
import ai.kilocode.backend.testing.TestLog
import ai.kilocode.rpc.dto.CustomModelDto
import ai.kilocode.rpc.dto.CustomModelFetchDto
import ai.kilocode.rpc.dto.CustomProviderSaveDto
import ai.kilocode.rpc.dto.ProviderConnectDto
import ai.kilocode.rpc.dto.ProviderDisconnectDto
import ai.kilocode.rpc.dto.ProviderEnableDto
import kotlinx.coroutines.async
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
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
    fun `connecting provider stores credentials and reloads connected state`() = runBlocking {
        mock.providers = """{
            "all":[{"id":"openai","name":"OpenAI","source":"custom","models":{}}],
            "default":{},
            "connected":[],
            "failed":[]
        }""".trimIndent()
        mock.providersAfterAuthPut = """{
            "all":[{"id":"openai","name":"OpenAI","source":"custom","models":{}}],
            "default":{},
            "connected":["openai"],
            "failed":[]
        }""".trimIndent()
        val manager = manager()

        mock.resetCounts()
        val result = manager.connect(ProviderConnectDto("/test", "openai", "sk-test", mapOf("baseURL" to "https://api.openai.com/v1")))

        assertNull(result.error)
        assertContains(mock.lastAuthPutBody.orEmpty(), "\"key\":\"sk-test\"")
        assertContains(mock.lastAuthPutBody.orEmpty(), "\"baseURL\":\"https://api.openai.com/v1\"")
        assertEquals(listOf("openai"), result.state.connected)
        assertEquals(1, mock.requestCount("/global/dispose"))
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
    fun `saving custom provider without models returns error and does not patch config`() = runBlocking {
        val manager = manager()

        mock.resetCounts()
        val result = manager.saveCustom(
            CustomProviderSaveDto("/test", "my-openai", "My OpenAI", "https://api.example.com/v1"),
        )

        assertEquals("At least one model ID is required.", result.error)
        assertNull(mock.lastConfigPatchBody)
        assertEquals(0, mock.requestCount("/global/dispose"))
    }

    @Test
    fun `saving custom provider with a model patches config and reloads provider`() = runBlocking {
        mock.providers = """{
            "all":[{"id":"my-openai","name":"My OpenAI","source":"config","models":{"gpt-4o":{"id":"gpt-4o","name":"gpt-4o"}}}],
            "default":{},
            "connected":[],
            "failed":[]
        }""".trimIndent()
        val manager = manager()

        mock.resetCounts()
        val result = manager.saveCustom(
            CustomProviderSaveDto(
                "/test",
                "my-openai",
                "My OpenAI",
                "https://api.example.com/v1",
                apiKey = "sk-test",
                models = listOf(CustomModelDto("gpt-4o", "gpt-4o")),
            ),
        )

        assertNull(result.error)
        assertContains(mock.lastConfigPatchBody.orEmpty(), "\"my-openai\"")
        assertContains(mock.lastConfigPatchBody.orEmpty(), "\"@ai-sdk/openai-compatible\"")
        assertContains(mock.lastConfigPatchBody.orEmpty(), "\"gpt-4o\"")
        assertContains(mock.lastAuthPutBody.orEmpty(), "\"key\":\"sk-test\"")
        assertTrue(result.state.providers.any { it.id == "my-openai" })
        assertEquals(1, mock.requestCount("/global/dispose"))
    }

    @Test
    fun `saving custom provider with blank env var clears existing env from config`() = runBlocking {
        // The config schema only allows nulling a whole provider entry, not a single field inside
        // one, so clearing "env" requires deleting and recreating the entry. This exercises that
        // two-step flow through MockCliServer's own JSON-merge-patch simulation of the real config
        // endpoint, rather than asserting on a single "env":null patch body the real CLI would 400 on.
        mock.config = """{
            "provider":{
                "my-openai":{"name":"My OpenAI","npm":"@ai-sdk/openai-compatible","options":{"baseURL":"http://localhost:11434"},"env":["OLD_VAR"]}
            }
        }""".trimIndent()
        mock.providers = """{
            "all":[{"id":"my-openai","name":"My OpenAI","source":"config","models":{"gpt-4o":{"id":"gpt-4o","name":"gpt-4o"}}}],
            "default":{},
            "connected":[],
            "failed":[]
        }""".trimIndent()
        val manager = manager()

        mock.resetCounts()
        val result = manager.saveCustom(
            CustomProviderSaveDto(
                "/test",
                "my-openai",
                "My OpenAI",
                "https://api.example.com/v1",
                apiKey = "sk-test",
                envVar = null,
                models = listOf(CustomModelDto("gpt-4o", "gpt-4o")),
            ),
        )

        assertNull(result.error)
        assertContains(mock.lastConfigPatchBody.orEmpty(), "\"my-openai\"")
        assertFalse(mock.lastConfigPatchBody.orEmpty().contains("\"env\""))
        assertContains(mock.lastAuthPutBody.orEmpty(), "\"key\":\"sk-test\"")
        val state = manager.state("/test")
        assertEquals(emptyList<String>(), state.config["my-openai"]?.env.orEmpty())
    }

    @Test
    fun `clearing an env var keeps hand-authored headers on the provider entry`() = runBlocking {
        // Deleting the entry to clear "env" also drops every other key on it. The dialog has no
        // headers field, so headers only ever come from a hand-edited kilo.json and must survive
        // the recreate patch instead of being silently wiped by an unrelated env var change.
        mock.config = """{
            "provider":{
                "my-openai":{"name":"My OpenAI","npm":"@ai-sdk/openai-compatible","options":{"baseURL":"http://localhost:11434"},"env":["OLD_VAR"],"headers":{"X-Custom":"abc-123"}}
            }
        }""".trimIndent()
        mock.providers = """{
            "all":[{"id":"my-openai","name":"My OpenAI","source":"config","models":{"gpt-4o":{"id":"gpt-4o","name":"gpt-4o"}}}],
            "default":{},
            "connected":[],
            "failed":[]
        }""".trimIndent()
        val manager = manager()

        mock.resetCounts()
        val result = manager.saveCustom(
            CustomProviderSaveDto(
                "/test",
                "my-openai",
                "My OpenAI",
                "https://api.example.com/v1",
                apiKey = "sk-test",
                envVar = null,
                models = listOf(CustomModelDto("gpt-4o", "gpt-4o")),
            ),
        )

        assertNull(result.error)
        val state = manager.state("/test")
        assertEquals(emptyList<String>(), state.config["my-openai"]?.env.orEmpty())
        assertEquals(mapOf("X-Custom" to "abc-123"), state.config["my-openai"]?.headers)
    }

    @Test
    fun `saving custom provider without an existing env var does not delete the entry first`() = runBlocking {
        // Deleting first is only needed to clear a previously-set env var. Doing it unconditionally
        // would risk wiping fields the save patch doesn't set (e.g. a hand-authored
        // whitelist/blacklist) on every ordinary save, and would leave the provider entry missing
        // if the recreate patch failed, so this must stay a no-op when there is nothing to clear.
        mock.config = """{
            "provider":{
                "my-openai":{"name":"My OpenAI","npm":"@ai-sdk/openai-compatible","options":{"baseURL":"http://localhost:11434"}}
            }
        }""".trimIndent()
        mock.providers = """{
            "all":[{"id":"my-openai","name":"My OpenAI","source":"config","models":{"gpt-4o":{"id":"gpt-4o","name":"gpt-4o"}}}],
            "default":{},
            "connected":[],
            "failed":[]
        }""".trimIndent()
        val manager = manager()

        mock.resetCounts()
        val result = manager.saveCustom(
            CustomProviderSaveDto(
                "/test",
                "my-openai",
                "My OpenAI",
                "https://api.example.com/v1",
                apiKey = "sk-test",
                envVar = null,
                models = listOf(CustomModelDto("gpt-4o", "gpt-4o")),
            ),
        )

        assertNull(result.error)
        assertContains(mock.lastAuthPutBody.orEmpty(), "\"key\":\"sk-test\"")
        // Exactly one GET (the pre-check) + one PATCH (the recreate) + one GET (the trailing
        // reload) hit /global/config; a fourth request would mean a delete patch also fired.
        assertEquals(3, mock.requestCount("/global/config"))
    }

    @Test
    fun `disconnecting env backed openai compatible custom provider deletes config and auth`() = runBlocking {
        mock.config = """{
            "provider":{
                "local-openai":{"name":"Local OpenAI","npm":"@ai-sdk/openai-compatible","options":{"baseURL":"http://localhost:11434"},"env":["API_KEY"]}
            }
        }""".trimIndent()
        mock.providers = """{
            "all":[{"id":"local-openai","name":"Local OpenAI","source":"env","key":"sk-env","models":{}}],
            "default":{},
            "connected":["local-openai"],
            "failed":[]
        }""".trimIndent()
        val manager = manager()

        mock.resetCounts()
        val result = manager.disconnect(ProviderDisconnectDto("/test", "local-openai"))

        assertNull(result.error)
        assertContains(mock.lastConfigPatchBody.orEmpty(), "\"local-openai\":null")
        assertEquals("/auth/local-openai", mock.lastAuthDeletePath)
    }

    @Test
    fun `disconnecting env only catalog provider still returns configured by environment error`() = runBlocking {
        mock.providers = """{
            "all":[{"id":"anthropic","name":"Anthropic","source":"env","key":"sk-env","models":{}}],
            "default":{},
            "connected":["anthropic"],
            "failed":[]
        }""".trimIndent()
        val manager = manager()

        mock.resetCounts()
        val result = manager.disconnect(ProviderDisconnectDto("/test", "anthropic"))

        assertEquals("Provider is configured by environment variables.", result.error)
        assertNull(mock.lastConfigPatchBody)
    }

    @Test
    fun `fetch uses env var value for authorization when no key is typed`() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody("""{"data":[{"id":"gpt-4o"}]}"""))
        server.start()
        val manager = manager()

        try {
            val result = manager.fetch(
                CustomModelFetchDto(baseUrl = server.url("/v1").toString(), directory = "/test", env = "API_KEY"),
                env = mapOf("API_KEY" to "sk-env"),
            )

            assertEquals(listOf("gpt-4o"), result.models)
            assertNull(result.error)
            assertFalse(result.envMissing)
            assertEquals("Bearer sk-env", server.takeRequest().getHeader("Authorization"))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun `fetch falls back to stored provider key when key and env are absent`() = runBlocking {
        mock.providers = """{
            "all":[{"id":"my-openai","name":"My OpenAI","source":"api","key":"sk-stored","models":{}}],
            "default":{},
            "connected":["my-openai"],
            "failed":[]
        }""".trimIndent()
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody("""{"data":[{"id":"gpt-4o"}]}"""))
        server.start()
        val manager = manager()

        try {
            val result = manager.fetch(
                CustomModelFetchDto(baseUrl = server.url("/v1").toString(), directory = "/test", providerId = "my-openai"),
                env = emptyMap(),
            )

            assertEquals(listOf("gpt-4o"), result.models)
            assertEquals("Bearer sk-stored", server.takeRequest().getHeader("Authorization"))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun `fetch marks env missing and sends request without authorization when env var is unset`() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody("""{"data":[{"id":"local-model"}]}"""))
        server.start()
        val manager = manager()

        try {
            val result = manager.fetch(
                CustomModelFetchDto(baseUrl = server.url("/v1").toString(), directory = "/test", env = "MISSING_KEY"),
                env = emptyMap(),
            )

            assertEquals(listOf("local-model"), result.models)
            assertTrue(result.envMissing)
            assertNull(server.takeRequest().getHeader("Authorization"))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun `fetch forwards custom headers to the models request`() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody("""{"data":[]}"""))
        server.start()
        val manager = manager()

        try {
            manager.fetch(
                CustomModelFetchDto(
                    baseUrl = server.url("/v1").toString(),
                    directory = "/test",
                    headers = mapOf("X-Custom" to "abc-123"),
                ),
                env = emptyMap(),
            )

            assertEquals("abc-123", server.takeRequest().getHeader("X-Custom"))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun `fetch prefers typed api key over env var and stored key`() = runBlocking {
        mock.providers = """{
            "all":[{"id":"my-openai","name":"My OpenAI","source":"api","key":"sk-stored","models":{}}],
            "default":{},
            "connected":["my-openai"],
            "failed":[]
        }""".trimIndent()
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody("""{"data":[]}"""))
        server.start()
        val manager = manager()

        try {
            manager.fetch(
                CustomModelFetchDto(
                    baseUrl = server.url("/v1").toString(),
                    directory = "/test",
                    providerId = "my-openai",
                    apiKey = "sk-typed",
                    env = "API_KEY",
                ),
                env = mapOf("API_KEY" to "sk-env"),
            )

            assertEquals("Bearer sk-typed", server.takeRequest().getHeader("Authorization"))
        } finally {
            server.shutdown()
        }
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
