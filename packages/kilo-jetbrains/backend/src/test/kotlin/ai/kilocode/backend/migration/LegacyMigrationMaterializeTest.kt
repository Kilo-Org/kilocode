package ai.kilocode.backend.migration

import ai.kilocode.backend.testing.TestLog
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.nio.file.Files
import java.nio.file.attribute.PosixFilePermissions
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Write-on-migrate: materializing a V5Raw source writes the consolidated legacy-settings.json,
 * and finalizing then records a durable status marker that survives.
 */
class LegacyMigrationMaterializeTest {

    @Test
    fun `materialize v5 raw writes legacy settings file and finalize marks status`() {
        val dir = Files.createTempDirectory("kilo-migration-config").toFile()
        val env = mapOf("KILO_CONFIG_DIR" to dir.absolutePath)
        val log = TestLog()
        val file = dir.resolve("legacy-settings.json")

        val consolidated = buildJsonObject {
            put("providerProfiles", "{\"currentApiConfigName\":\"p\",\"apiConfigs\":{}}")
        }
        val source = LegacyMigrationSource.V5Raw(InMemoryLegacyMigrationStore(consolidated), consolidated, file)

        val store = materializeLegacyMigrationSource(source, log)
        assertTrue(file.isFile)
        val perms = runCatching { Files.getPosixFilePermissions(file.toPath()) }.getOrNull()
        if (perms != null) assertEquals(PosixFilePermissions.fromString("rw-------"), perms)
        assertEquals("{\"currentApiConfigName\":\"p\",\"apiConfigs\":{}}", store.providerProfilesRaw())

        // Re-opening the freshly written file yields the same payload.
        val reopened = LegacySettingsFileMigrationStore(file)
        assertEquals("{\"currentApiConfigName\":\"p\",\"apiConfigs\":{}}", reopened.providerProfilesRaw())

        // Finalizing writes the durable marker and status() honors it afterwards.
        KiloBackendLegacyMigrationStoreService.markStatus(log, LegacyMigrationStatus.Completed, env)
        assertEquals(LegacyMigrationStatus.Completed, KiloBackendLegacyMigrationStoreService.status(log, env))
    }

    @Test
    fun `materialize selected sessions writes full archive but returns scoped store`() {
        val home = Files.createTempDirectory("kilo-v5-home").toFile()
        val cfg = Files.createTempDirectory("kilo-v5-config").toFile()
        val dir = Files.createTempDirectory("kilo-migration-config").toFile()
        val file = dir.resolve("legacy-settings.json")
        val tasks = home.resolve(".kilocode/globalStorage/tasks")
        tasks.resolve("task-1").mkdirs()
        tasks.resolve("task-2").mkdirs()
        tasks.resolve("task-1/api_conversation_history.json").writeText("""[{"role":"user","content":"one"}]""")
        tasks.resolve("task-2/api_conversation_history.json").writeText("""[{"role":"user","content":"two"}]""")
        cfg.resolve("options").mkdirs()
        cfg.resolve("options/kilocode-extension-storage.xml").writeText("""
<application>
  <component name="ExtensionStorageService">
    <option name="storageMap">
      <map>
        <entry key="kilo-code" value="{&quot;taskHistory&quot;:&quot;[{\&quot;id\&quot;:\&quot;task-1\&quot;,\&quot;task\&quot;:\&quot;One\&quot;,\&quot;workspace\&quot;:\&quot;/tmp/project\&quot;,\&quot;ts\&quot;:1700000000000},{\&quot;id\&quot;:\&quot;task-2\&quot;,\&quot;task\&quot;:\&quot;Two\&quot;,\&quot;workspace\&quot;:\&quot;/tmp/project\&quot;,\&quot;ts\&quot;:1700000000001}]&quot;}" />
      </map>
    </option>
  </component>
</application>
        """.trimIndent())

        val logs = mutableListOf<String>()
        val sources = LegacyV5Sources(home, cfg) { logs.add(it) }
        val root = LegacyV5Importer(sources).import(includeConversations = false)
        val source = LegacyMigrationSource.V5Raw(
            InMemoryLegacyMigrationStore(root),
            root,
            file,
            sources,
        )
        logs.clear()
        val store = materializeLegacyMigrationSource(source, TestLog(), setOf("task-1"))

        assertEquals(1, logs.count { it.contains("reading taskConversation id=task-1") })
        assertEquals(1, logs.count { it.contains("reading taskConversation id=task-2") })
        assertEquals("""[{"role":"user","content":"one"}]""", store.taskConversationRaw("task-1"))
        assertNull(store.taskConversationRaw("task-2"))
        val archived = LegacySettingsFileMigrationStore.json.parseToJsonElement(file.readText()).jsonObject["conversations"]!!.jsonObject
        assertEquals("""[{"role":"user","content":"one"}]""", archived["task-1"]!!.jsonPrimitive.content)
        assertEquals("""[{"role":"user","content":"two"}]""", archived["task-2"]!!.jsonPrimitive.content)
    }

    @Test
    fun `scoped raw v5 store rejects traversal session ids`() {
        val home = Files.createTempDirectory("kilo-v5-home").toFile()
        val dir = Files.createTempDirectory("kilo-migration-config").toFile()
        val file = dir.resolve("legacy-settings.json")
        val root = home.resolve(".kilocode/globalStorage")
        root.resolve("escape").mkdirs()
        root.resolve("escape/api_conversation_history.json").writeText("""[{"role":"user","content":"secret"}]""")
        val logs = mutableListOf<String>()
        val src = LegacyV5Sources(home, Files.createTempDirectory("kilo-v5-config").toFile()) { logs.add(it) }
        val obj = buildJsonObject {
            put("conversations", JsonObject(mapOf("../escape" to JsonPrimitive(""))))
        }
        val source = LegacyMigrationSource.V5Raw(InMemoryLegacyMigrationStore(obj), obj, file, src)

        val store = materializeLegacyMigrationSource(source, TestLog(), setOf("../escape"))

        assertNull(store.taskConversationRaw("../escape"))
        assertTrue(logs.none { it.contains("../escape") })
        val archived = LegacySettingsFileMigrationStore.json.parseToJsonElement(file.readText()).jsonObject["conversations"]?.jsonObject
        assertTrue(archived == null || "../escape" !in archived.keys)
    }
}
