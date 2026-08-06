package ai.kilocode.backend.migration

import ai.kilocode.backend.testing.TestLog
import java.io.File
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

/**
 * Branch coverage for [KiloBackendLegacyMigrationStoreService.resolveSource]: file-backed,
 * raw v5, and none. Uses the injectable overload so no real home directory is touched.
 */
class LegacyMigrationSourceTest {

    private fun env(dir: File) = mapOf("KILO_CONFIG_DIR" to dir.absolutePath)

    private fun emptySources(): LegacyV5Sources {
        val home = Files.createTempDirectory("kilo-v5-empty-home").toFile()
        val cfg = Files.createTempDirectory("kilo-v5-empty-config").toFile()
        return LegacyV5Sources(home, cfg)
    }

    private fun rawSources(): LegacyV5Sources {
        val home = Files.createTempDirectory("kilo-v5-raw-home").toFile()
        val cfg = Files.createTempDirectory("kilo-v5-raw-config").toFile()
        val settings = home.resolve(".kilocode/globalStorage/settings")
        settings.mkdirs()
        settings.resolve("mcp_settings.json").writeText("""{"mcpServers":{"tool":{"command":"npx"}}}""")
        return LegacyV5Sources(home, cfg)
    }

    @Test
    fun `file present with includeFile returns file backed and skips raw import`() {
        val dir = Files.createTempDirectory("kilo-migration-config").toFile()
        dir.resolve("legacy-settings.json").writeText(
            """{"providerProfiles":"{\"currentApiConfigName\":\"p\",\"apiConfigs\":{\"p\":{\"apiProvider\":\"anthropic\",\"apiKey\":\"sk\"}}}"}"""
        )
        // Empty raw sources: if the importer were consulted the result would be None, so a
        // FileBacked result proves the file short-circuit took priority.
        val source = KiloBackendLegacyMigrationStoreService.resolveSource(TestLog(), true, env(dir), emptySources())
        assertIs<LegacyMigrationSource.FileBacked>(source)
        assertTrue(LegacyMigrationEngine(source.store, NoopLegacyMigrationBackend()).detect().hasData)
    }

    @Test
    fun `file absent and raw present returns v5 raw with data`() {
        val dir = Files.createTempDirectory("kilo-migration-config").toFile()
        val source = KiloBackendLegacyMigrationStoreService.resolveSource(TestLog(), false, env(dir), rawSources())
        assertIs<LegacyMigrationSource.V5Raw>(source)
        assertTrue(LegacyMigrationEngine(source.store, NoopLegacyMigrationBackend()).detect().hasData)
    }

    @Test
    fun `both absent returns none without data`() {
        val dir = Files.createTempDirectory("kilo-migration-config").toFile()
        val source = KiloBackendLegacyMigrationStoreService.resolveSource(TestLog(), false, env(dir), emptySources())
        assertIs<LegacyMigrationSource.None>(source)
        assertFalse(LegacyMigrationEngine(source.store, NoopLegacyMigrationBackend()).detect().hasData)
    }

    @Test
    fun `raw present but empty import returns none`() {
        val dir = Files.createTempDirectory("kilo-migration-config").toFile()
        val home = Files.createTempDirectory("kilo-v5-emptyraw-home").toFile()
        val cfg = Files.createTempDirectory("kilo-v5-emptyraw-config").toFile()
        // A present-but-empty tasks directory makes anyPresent() true while the import stays empty.
        home.resolve(".kilocode/globalStorage/tasks").mkdirs()
        val source = KiloBackendLegacyMigrationStoreService.resolveSource(TestLog(), false, env(dir), LegacyV5Sources(home, cfg))
        assertIs<LegacyMigrationSource.None>(source)
    }
}
