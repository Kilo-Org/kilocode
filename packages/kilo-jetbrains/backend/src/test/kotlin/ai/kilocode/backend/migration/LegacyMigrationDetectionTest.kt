package ai.kilocode.backend.migration

import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Tests for LegacyMigrationEngine.detect() using the production file-backed store.
 */
class LegacyMigrationDetectionTest {

    private fun engine(configure: LegacySettingsFileFixture.() -> Unit = {}): Pair<LegacyMigrationEngine, LegacySettingsFileFixture> {
        val fixture = LegacySettingsFileFixture().apply(configure)
        val store = fixture.store()
        val backend = NoopLegacyMigrationBackend()
        return LegacyMigrationEngine(store, backend) to fixture
    }

    // -----------------------------------------------------------------------
    // Providers from legacy secret JSON
    // -----------------------------------------------------------------------

    @Test
    fun `detect - providers from legacy secret JSON`() {
        val (eng, _) = engine {
            providerProfiles = """
                {
                  "currentApiConfigName": "anthropic-profile",
                  "apiConfigs": {
                    "anthropic-profile": {
                      "apiProvider": "anthropic",
                      "apiKey": "sk-ant-abc123",
                      "apiModelId": "claude-3-5-sonnet-20241022"
                    }
                  }
                }
            """.trimIndent()
        }
        val result = eng.detect()
        assertEquals(1, result.providers.size)
        val p = result.providers[0]
        assertEquals("anthropic-profile", p.profileName)
        assertEquals("anthropic", p.provider)
        assertTrue(p.hasApiKey)
        assertTrue(p.supported)
        assertEquals("Anthropic", p.newProviderName)
        assertTrue(result.hasData)
    }

    @Test
    fun `detect - unsupported provider flagged as unsupported`() {
        val (eng, _) = engine {
            providerProfiles = """
                {
                  "currentApiConfigName": "my-glama",
                  "apiConfigs": {
                    "my-glama": { "apiProvider": "glama", "apiKey": "x" }
                  }
                }
            """.trimIndent()
        }
        val result = eng.detect()
        assertEquals(1, result.providers.size)
        assertFalse(result.providers[0].supported)
    }

    @Test
    fun `detect - unknown provider flagged as unsupported`() {
        val (eng, _) = engine {
            providerProfiles = """
                {
                  "currentApiConfigName": "mystery",
                  "apiConfigs": {
                    "mystery": { "apiProvider": "mystery-provider-x", "apiKey": "k" }
                  }
                }
            """.trimIndent()
        }
        val p = eng.detect().providers[0]
        assertFalse(p.supported)
        assertNull(p.newProviderName)
    }

    @Test
    fun `detect - no api key means hasApiKey false`() {
        val (eng, _) = engine {
            providerProfiles = """
                {
                  "currentApiConfigName": "empty",
                  "apiConfigs": {
                    "empty": { "apiProvider": "anthropic" }
                  }
                }
            """.trimIndent()
        }
        assertFalse(eng.detect().providers[0].hasApiKey)
    }

    // -----------------------------------------------------------------------
    // MCP servers
    // -----------------------------------------------------------------------

    @Test
    fun `detect - MCP servers from JSON`() {
        val (eng, _) = engine {
            mcpSettings = """
                {
                  "mcpServers": {
                    "my-tool": { "command": "npx", "args": ["-y", "my-tool"] },
                    "remote-tool": { "type": "sse", "url": "https://example.com/mcp", "disabled": true }
                  }
                }
            """.trimIndent()
        }
        val result = eng.detect()
        assertEquals(2, result.mcpServers.size)
        val local = result.mcpServers.find { it.name == "my-tool" }!!
        assertEquals("stdio", local.type)
        assertNull(local.disabled)
        val remote = result.mcpServers.find { it.name == "remote-tool" }!!
        assertEquals("sse", remote.type)
        assertEquals(true, remote.disabled)
    }

    // -----------------------------------------------------------------------
    // Custom modes
    // -----------------------------------------------------------------------

    @Test
    fun `detect - custom modes from JSON`() {
        val (eng, _) = engine {
            customModes = """
                {
                  "customModes": [
                    { "slug": "my-mode", "name": "My Mode", "roleDefinition": "You are helpful.", "groups": ["read", "edit"] }
                  ]
                }
            """.trimIndent()
        }
        val result = eng.detect()
        assertEquals(1, result.customModes.size)
        assertEquals("my-mode", result.customModes[0].slug)
        assertEquals("My Mode", result.customModes[0].name)
        assertNull(result.customModes[0].nativeSlug)
    }

    @Test
    fun `detect - custom modes from YAML`() {
        val (eng, _) = engine {
            customModes = """
customModes:
  - slug: yaml-mode
    name: YAML Mode
    roleDefinition: |
      You are a YAML assistant.
    groups:
      - read
      - edit
""".trimIndent()
        }
        val result = eng.detect()
        assertEquals(1, result.customModes.size)
        assertEquals("yaml-mode", result.customModes[0].slug)
    }

    @Test
    fun `detect - native mode slug not included in custom modes`() {
        val (eng, _) = engine {
            customModes = """
                {
                  "customModes": [
                    { "slug": "code", "name": "Code Custom", "roleDefinition": "modified", "groups": [] }
                  ]
                }
            """.trimIndent()
        }
        val result = eng.detect()
        // "code" is a native slug — it should appear as a modified native mode under "code-custom"
        val withNative = result.customModes.filter { it.nativeSlug != null }
        assertEquals(1, withNative.size)
        assertEquals("code-custom", withNative[0].slug)
        assertEquals("code", withNative[0].nativeSlug)
    }

    // -----------------------------------------------------------------------
    // Settings
    // -----------------------------------------------------------------------

    @Test
    fun `detect - settings from global state keys`() {
        val (eng, _) = engine {
            globalState["kilo-code.autoApprovalEnabled"] = JsonPrimitive("true")
            globalState["alwaysAllowReadOnly"] = JsonPrimitive("true")
            globalState["kilo-code.language"] = JsonPrimitive("en")
        }
        val result = eng.detect()
        assertNotNull(result.settings)
        assertEquals(true, result.settings!!.autoApprovalEnabled)
        assertEquals(true, result.settings!!.alwaysAllowReadOnly)
        assertEquals("en", result.settings!!.language)
    }

    // -----------------------------------------------------------------------
    // Sessions
    // -----------------------------------------------------------------------

    @Test
    fun `detect - sessions listed only when conversation exists`() {
        val (eng, _) = engine {
            taskHistory = """[
                {"id": "task-1", "task": "Fix bug", "workspace": "/tmp/project", "ts": 1700000000000},
                {"id": "task-2", "task": "Add feature", "workspace": "/tmp/project", "ts": 1700000001000}
            ]""".trimIndent()
            conversations["task-1"] = """[{"role":"user","content":"Fix the bug"}]"""
            // task-2 has no conversation file — should not appear
        }
        val result = eng.detect()
        assertEquals(1, result.sessions.size)
        assertEquals("task-1", result.sessions[0].id)
        assertEquals("Fix bug", result.sessions[0].title)
    }

    @Test
    fun `detect - hasData false when nothing present`() {
        val (eng, _) = engine {}
        assertFalse(eng.detect().hasData)
    }

    // -----------------------------------------------------------------------
    // Default model
    // -----------------------------------------------------------------------

    @Test
    fun `detect - default model resolved from active profile`() {
        val (eng, _) = engine {
            providerProfiles = """
                {
                  "currentApiConfigName": "openai-profile",
                  "apiConfigs": {
                    "openai-profile": {
                      "apiProvider": "openai-native",
                      "openAiNativeApiKey": "sk-x",
                      "apiModelId": "gpt-4o"
                    }
                  }
                }
            """.trimIndent()
        }
        val result = eng.detect()
        assertNotNull(result.defaultModel)
        assertEquals("gpt-4o", result.defaultModel!!.model)
        assertEquals("OpenAI", result.defaultModel!!.provider)
    }

    // -----------------------------------------------------------------------
    // Status
    // -----------------------------------------------------------------------

    @Test
    fun `mark and status round-trip`() {
        val (eng, store) = engine {}
        assertNull(eng.status())
        eng.mark(LegacyMigrationStatus.Completed)
        assertEquals(LegacyMigrationStatus.Completed, eng.status())
        store.refresh()
        assertEquals(LegacyMigrationStatus.Completed, store.migrationStatus)
    }
}
