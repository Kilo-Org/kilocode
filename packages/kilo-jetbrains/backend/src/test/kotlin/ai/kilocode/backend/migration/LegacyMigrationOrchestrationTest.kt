package ai.kilocode.backend.migration

import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Tests for LegacyMigrationEngine.migrate() orchestration and progress sink behavior.
 */
class LegacyMigrationOrchestrationTest {

    private fun setup(configure: LegacySettingsFileFixture.() -> Unit = {}): Triple<LegacyMigrationEngine, LegacySettingsFileFixture, NoopLegacyMigrationBackend> {
        val fixture = LegacySettingsFileFixture().apply(configure)
        val store = fixture.store()
        val backend = NoopLegacyMigrationBackend()
        return Triple(LegacyMigrationEngine(store, backend), fixture, backend)
    }

    private fun noSelections() = LegacyMigrationSelections(
        providers = emptyList(),
        mcpServers = emptyList(),
        customModes = emptyList(),
        sessions = emptyList(),
        defaultModel = false,
        settings = MigrationSettingsSelections(
            autoApproval = MigrationAutoApprovalSelections(false, false, false, false, false, false),
            language = false,
            autocomplete = false,
        ),
    )

    // -----------------------------------------------------------------------
    // Provider migration
    // -----------------------------------------------------------------------

    @Test
    fun `migrate - provider writes auth to backend`() {
        val (eng, _, backend) = setup {
            providerProfiles = """
                {
                  "currentApiConfigName": "p",
                  "apiConfigs": {
                    "p": { "apiProvider": "anthropic", "apiKey": "sk-ant-x" }
                  }
                }
            """.trimIndent()
        }
        val sel = noSelections().copy(providers = listOf("p"))
        val report = eng.migrate(sel)
        assertEquals(1, report.items.size)
        assertEquals(MigrationItemStatus.success, report.items[0].status)
        assertEquals(1, backend.authCalls.size)
        assertEquals("anthropic", backend.authCalls[0].first)
        assertEquals("api", backend.authCalls[0].second["type"]?.jsonPrimitive?.content)
    }

    @Test
    fun `migrate - missing profile produces error result`() {
        val (eng, _, _) = setup {}
        val sel = noSelections().copy(providers = listOf("nonexistent"))
        val report = eng.migrate(sel)
        assertEquals(MigrationItemStatus.error, report.items[0].status)
    }

    // -----------------------------------------------------------------------
    // MCP migration
    // -----------------------------------------------------------------------

    @Test
    fun `migrate - MCP servers write config batch`() {
        val (eng, _, backend) = setup {
            mcpSettings = """
                {
                  "mcpServers": {
                    "tool1": { "command": "node", "args": ["tool.js"] },
                    "tool2": { "type": "sse", "url": "https://example.com/mcp" }
                  }
                }
            """.trimIndent()
        }
        val sel = noSelections().copy(mcpServers = listOf("tool1", "tool2"))
        val report = eng.migrate(sel)
        assertEquals(2, report.items.filter { it.category == MigrationItemCategory.mcpServer && it.status == MigrationItemStatus.success }.size)
        assertEquals(1, backend.configCalls.size) // one batched patch
        val mcp = backend.configCalls[0]["mcp"]?.jsonObject
        assertTrue(mcp?.containsKey("tool1") == true)
        assertTrue(mcp?.containsKey("tool2") == true)
    }

    // -----------------------------------------------------------------------
    // Custom mode migration
    // -----------------------------------------------------------------------

    @Test
    fun `migrate - custom mode writes agent config`() {
        val (eng, _, backend) = setup {
            customModes = """
                {
                  "customModes": [
                    { "slug": "my-agent", "name": "My Agent", "roleDefinition": "You are my agent.", "groups": ["read"] }
                  ]
                }
            """.trimIndent()
        }
        val sel = noSelections().copy(customModes = listOf("my-agent"))
        val report = eng.migrate(sel)
        assertEquals(MigrationItemStatus.success, report.items[0].status)
        val patch = backend.configCalls.find { it.containsKey("agent") }
        assertNotNull(patch)
        assertTrue(patch!!["agent"]?.jsonObject?.containsKey("my-agent") == true)
    }

    // -----------------------------------------------------------------------
    // Session migration
    // -----------------------------------------------------------------------

    @Test
    fun `migrate - session imports project, session, messages, parts`() {
        val (eng, _, backend) = setup {
            taskHistory = """[{"id":"t1","task":"Do task","workspace":"/tmp","ts":1000}]"""
            conversations["t1"] = """[
                {"role":"user","content":"Fix this","ts":1000},
                {"role":"assistant","content":"Sure","ts":1001}
            ]"""
        }
        val sel = noSelections().copy(sessions = listOf(MigrationSessionSelection("t1")))
        val report = eng.migrate(sel)
        assertEquals(MigrationItemStatus.success, report.items.find { it.category == MigrationItemCategory.session }?.status)
        assertEquals(1, backend.projectCalls.size)
        assertEquals(1, backend.sessionCalls.size)
        assertEquals(2, backend.messageCalls.size)
    }

    @Test
    fun `migrate - duplicate session is silently skipped`() {
        val (eng, _, backend) = setup {
            taskHistory = """[{"id":"t1","task":"Test"}]"""
            conversations["t1"] = """[{"role":"user","content":"hello"}]"""
        }
        val sessionId = ai.kilocode.backend.migration.session.LegacySessionIds.createSessionId("t1")
        backend.existingSessionIds = setOf(sessionId)
        val sel = noSelections().copy(sessions = listOf(MigrationSessionSelection("t1")))
        val items = mutableListOf<LegacyMigrationItemProgress>()
        val sessions = mutableListOf<LegacyMigrationSessionProgress>()
        val report = eng.migrate(sel, sink(items, sessions))
        assertNull(report.items.find { it.category == MigrationItemCategory.session })
        assertEquals(emptyList(), items)
        assertEquals(emptyList(), sessions)
        assertEquals(0, backend.projectCalls.size)
        assertEquals(0, backend.sessionCalls.size)
    }

    @Test
    fun `migrate - backend session skipped skips child imports`() {
        val (eng, _, backend) = setup {
            taskHistory = """[{"id":"t1","task":"Test"}]"""
            conversations["t1"] = """[{"role":"user","content":"hello"}]"""
        }
        backend.sessionImportSkipped = true
        val sel = noSelections().copy(sessions = listOf(MigrationSessionSelection("t1")))
        val items = mutableListOf<LegacyMigrationItemProgress>()
        val sessions = mutableListOf<LegacyMigrationSessionProgress>()
        val report = eng.migrate(sel, sink(items, sessions))
        assertNull(report.items.find { it.category == MigrationItemCategory.session })
        assertEquals(0, backend.messageCalls.size)
        assertEquals(0, backend.partCalls.size)
        assertEquals(listOf(MigrationItemProgressStatus.migrating), items.map { it.status })
        assertEquals(listOf(MigrationSessionPhase.preparing, MigrationSessionPhase.storing, MigrationSessionPhase.summary), sessions.map { it.phase })
    }

    @Test
    fun `migrate - child import failure produces warning result`() {
        val (eng, _, backend) = setup {
            taskHistory = """[{"id":"t1","task":"Test"}]"""
            conversations["t1"] = """[{"role":"user","content":"hello"}]"""
        }
        backend.messageError = RuntimeException("message failed")
        val items = mutableListOf<LegacyMigrationItemProgress>()
        val report = eng.migrate(noSelections().copy(sessions = listOf(MigrationSessionSelection("t1"))), itemSink(items))
        val item = report.items.single { it.category == MigrationItemCategory.session }
        assertEquals(MigrationItemStatus.warning, item.status)
        assertEquals("message failed", item.message)
        assertEquals(MigrationItemProgressStatus.warning, items.last().status)
    }

    @Test
    fun `migrate - missing session conversation emits terminal error progress`() {
        val (eng, _, _) = setup {
            taskHistory = """[{"id":"t1","task":"Test"}]"""
        }
        val sel = noSelections().copy(sessions = listOf(MigrationSessionSelection("t1")))
        val items = mutableListOf<LegacyMigrationItemProgress>()
        eng.migrate(sel, itemSink(items))
        assertEquals(listOf(MigrationItemProgressStatus.migrating, MigrationItemProgressStatus.error), items.map { it.status })
        assertEquals("Conversation file not found", items[1].message)
    }

    @Test
    fun `migrate - autocomplete settings report success`() {
        val (eng, _, _) = setup {
            globalState["ghostServiceSettings"] = kotlinx.serialization.json.JsonObject(
                mapOf(
                    "enableAutoTrigger" to JsonPrimitive(true),
                    "enableSmartInlineTaskKeybinding" to JsonPrimitive(true),
                    "enableChatAutocomplete" to JsonPrimitive(true),
                )
            )
        }
        val sel = noSelections().copy(settings = noSelections().settings.copy(autocomplete = true))
        val report = eng.migrate(sel)
        val item = report.items.single { it.item == "Autocomplete settings" }
        assertEquals(MigrationItemStatus.success, item.status)
        assertEquals(null, item.message)
    }

    // -----------------------------------------------------------------------
    // Progress sink ordering
    // -----------------------------------------------------------------------

    @Test
    fun `migrate - progress sink called for each item`() {
        val (eng, _, _) = setup {
            providerProfiles = """{"currentApiConfigName":"p","apiConfigs":{"p":{"apiProvider":"anthropic","apiKey":"k"}}}"""
        }
        val items = mutableListOf<LegacyMigrationItemProgress>()
        val sink = object : LegacyMigrationSink {
            override fun item(progress: LegacyMigrationItemProgress) { items.add(progress) }
            override fun session(progress: LegacyMigrationSessionProgress) = Unit
        }
        eng.migrate(noSelections().copy(providers = listOf("p")), sink)
        assertEquals(2, items.size) // migrating + success
        assertEquals(MigrationItemProgressStatus.migrating, items[0].status)
        assertEquals(MigrationItemProgressStatus.success, items[1].status)
    }

    @Test
    fun `report - hasErrors is true when any item errors`() {
        val report = LegacyMigrationReport(
            listOf(
                LegacyMigrationResultItem("a", MigrationItemCategory.provider, MigrationItemStatus.success),
                LegacyMigrationResultItem("b", MigrationItemCategory.provider, MigrationItemStatus.error),
            )
        )
        assertTrue(report.hasErrors)
    }

    // -----------------------------------------------------------------------
    // Cleanup
    // -----------------------------------------------------------------------

    @Test
    fun `cleanup - legacy settings file target deletes file`() {
        val (eng, fixture, _) = setup {
            providerProfiles = """{"currentApiConfigName":"p","apiConfigs":{}}"""
        }
        val report = eng.cleanup(LegacyCleanupTargets(legacySettingsFile = true))
        assertEquals(listOf("legacySettingsFile"), report.cleaned)
        assertEquals(emptyList<String>(), report.errors)
        assertFalse(fixture.exists())
    }

    @Test
    fun `cleanup - data target preserves legacy settings file`() {
        val (eng, fixture, _) = setup {
            providerProfiles = """{"currentApiConfigName":"p","apiConfigs":{}}"""
        }
        val report = eng.cleanup(LegacyCleanupTargets(providerProfiles = true))
        assertEquals(listOf("providerProfiles"), report.cleaned)
        assertEquals(emptyList<String>(), report.errors)
        assertTrue(fixture.exists())
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private fun assertNotNull(actual: Any?) = kotlin.test.assertNotNull(actual)

    private fun itemSink(items: MutableList<LegacyMigrationItemProgress>) = object : LegacyMigrationSink {
        override fun item(progress: LegacyMigrationItemProgress) { items.add(progress) }
        override fun session(progress: LegacyMigrationSessionProgress) = Unit
    }

    private fun sink(
        items: MutableList<LegacyMigrationItemProgress>,
        sessions: MutableList<LegacyMigrationSessionProgress>,
    ) = object : LegacyMigrationSink {
        override fun item(progress: LegacyMigrationItemProgress) { items.add(progress) }
        override fun session(progress: LegacyMigrationSessionProgress) { sessions.add(progress) }
    }
}
