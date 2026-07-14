package ai.kilocode.backend.migration

import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class LegacyV5ImporterTest {
    @Test
    fun `imports raw v5 files into legacy settings shape`() {
        val home = Files.createTempDirectory("kilo-v5-home").toFile()
        val cfg = Files.createTempDirectory("kilo-v5-config").toFile()
        val root = home.resolve(".kilocode")
        val storage = root.resolve("globalStorage")
        storage.resolve("settings").mkdirs()
        storage.resolve("tasks/task-1").mkdirs()
        cfg.resolve("options").mkdirs()

        root.resolve("secrets.json").writeText("""
            {
              "kilo-code": {
                "roo_cline_config_api_config": "{\"currentApiConfigName\":\"p\",\"apiConfigs\":{\"p\":{\"apiProvider\":\"anthropic\",\"apiKey\":\"sk\",\"apiModelId\":\"claude\"}}}",
                "openai-codex-oauth-credentials": "{\"access\":\"token\"}"
              }
            }
        """.trimIndent())
        storage.resolve("settings/mcp_settings.json").writeText("""{"mcpServers":{"tool":{"command":"npx"}}}""")
        storage.resolve("settings/custom_modes.yaml").writeText("""
customModes:
  - slug: helper
    name: Helper
    roleDefinition: Help.
    groups: [read]
        """.trimIndent())
        storage.resolve("tasks/task-1/api_conversation_history.json").writeText("""[{"role":"user","content":"Fix it"}]""")
        cfg.resolve("options/kilocode-extension-storage.xml").writeText("""
<application>
  <component name="ExtensionStorageService">
    <option name="storageMap">
      <map>
        <entry key="kilo-code" value="{&quot;taskHistory&quot;:&quot;[{\&quot;id\&quot;:\&quot;task-1\&quot;,\&quot;task\&quot;:\&quot;Fix it\&quot;,\&quot;workspace\&quot;:\&quot;/tmp/project\&quot;,\&quot;ts\&quot;:1700000000000}]&quot;,&quot;kilo-code.language&quot;:&quot;en&quot;,&quot;customModePrompts&quot;:&quot;{}&quot;}" />
      </map>
    </option>
  </component>
</application>
        """.trimIndent())

        val obj = LegacyV5Importer(LegacyV5Sources(home, cfg)).import()
        assertNotNull(obj["providerProfiles"])
        assertEquals("{\"access\":\"token\"}", obj["oauth"]!!.jsonObject["openai-codex-oauth-credentials"]!!.jsonPrimitive.content)
        assertNotNull(obj["mcpSettings"])
        assertNotNull(obj["customModes"])
        assertEquals(JsonPrimitive("en"), obj["globalState"]!!.jsonObject["kilo-code.language"])
        assertNotNull(obj["taskHistory"])
        assertNotNull(obj["conversations"]!!.jsonObject["task-1"])

        val detection = LegacyMigrationEngine(InMemoryLegacyMigrationStore(obj), NoopLegacyMigrationBackend()).detect()
        assertTrue(detection.hasData)
        assertEquals(1, detection.providers.size)
        assertEquals(1, detection.mcpServers.size)
        assertEquals(1, detection.customModes.size)
        assertEquals(1, detection.sessions.size)
        assertEquals("en", detection.settings!!.language)
    }

    @Test
    fun `resolves alternate extension id by content`() {
        val home = Files.createTempDirectory("kilo-v5-home").toFile()
        val cfg = Files.createTempDirectory("kilo-v5-config").toFile()
        val root = home.resolve(".kilocode")
        root.mkdirs()
        root.resolve("secrets.json").writeText("""
            { "other": { "roo_cline_config_api_config": "{\"currentApiConfigName\":\"p\",\"apiConfigs\":{}}" } }
        """.trimIndent())

        val obj = LegacyV5Importer(LegacyV5Sources(home, cfg)).import()
        assertNotNull(obj["providerProfiles"])
    }

    @Test
    fun `synthesized history title strips task wrapper`() {
        val home = Files.createTempDirectory("kilo-v5-home").toFile()
        val cfg = Files.createTempDirectory("kilo-v5-config").toFile()
        val task = home.resolve(".kilocode/globalStorage/kilo code.kilo-code/tasks/task-1")
        task.mkdirs()
        task.resolve("api_conversation_history.json").writeText("""[
            {"role":"user","content":[{"type":"text","text":"<task>create sample skills</task>"},{"type":"text","text":"<environment_details>\n# Current Workspace Directory (/tmp/project) Files\n</environment_details>"}]}
        ]""".trimIndent())

        val obj = LegacyV5Importer(LegacyV5Sources(home, cfg)).import()
        val history = kotlinx.serialization.json.Json.parseToJsonElement(obj["taskHistory"]!!.jsonPrimitive.content).jsonArray
        assertEquals("create sample skills", history[0].jsonObject["task"]!!.jsonPrimitive.content)
    }

    @Test
    fun `imports scoped mcp and custom modes`() {
        val home = Files.createTempDirectory("kilo-v5-home").toFile()
        val cfg = Files.createTempDirectory("kilo-v5-config").toFile()
        val scoped = home.resolve(".kilocode/globalStorage/kilo code.kilo-code/settings")
        scoped.mkdirs()
        scoped.resolve("mcp_settings.json").writeText("""{"mcpServers":{"tool":{"command":"npx"}}}""")
        scoped.resolve("custom_modes.yaml").writeText("""
customModes:
  - slug: helper
    name: Helper
    roleDefinition: Help.
    groups: [read]
        """.trimIndent())

        val obj = LegacyV5Importer(LegacyV5Sources(home, cfg)).import()
        assertNotNull(obj["mcpSettings"])
        assertNotNull(obj["customModes"])

        val detection = LegacyMigrationEngine(InMemoryLegacyMigrationStore(obj), NoopLegacyMigrationBackend()).detect()
        assertEquals(1, detection.mcpServers.size)
        assertEquals(1, detection.customModes.size)
    }

    @Test
    fun `scan fallback derives ts from ui messages`() {
        val home = Files.createTempDirectory("kilo-v5-home").toFile()
        val cfg = Files.createTempDirectory("kilo-v5-config").toFile()
        val task = home.resolve(".kilocode/globalStorage/kilo code.kilo-code/tasks/task-1")
        task.mkdirs()
        task.resolve("api_conversation_history.json").writeText("""[
            {"role":"user","content":[{"type":"text","text":"<task>do it</task>"},{"type":"text","text":"<environment_details>\n# Current Workspace Directory (/tmp/project) Files\n</environment_details>"}]}
        ]""".trimIndent())
        task.resolve("ui_messages.json").writeText("""[{"ts":1700000000123,"type":"say","say":"text","text":"do it"}]""")

        val obj = LegacyV5Importer(LegacyV5Sources(home, cfg)).import()
        val history = kotlinx.serialization.json.Json.parseToJsonElement(obj["taskHistory"]!!.jsonPrimitive.content).jsonArray
        assertEquals("/tmp/project", history[0].jsonObject["workspace"]!!.jsonPrimitive.content)
        assertEquals(1700000000123L, history[0].jsonObject["ts"]!!.jsonPrimitive.content.toLong())
    }

    @Test
    fun `empty stored history falls back to scanning task directories`() {
        val home = Files.createTempDirectory("kilo-v5-home").toFile()
        val cfg = Files.createTempDirectory("kilo-v5-config").toFile()
        val task = home.resolve(".kilocode/globalStorage/kilo code.kilo-code/tasks/task-1")
        task.mkdirs()
        task.resolve("api_conversation_history.json").writeText("""[
            {"role":"user","content":[{"type":"text","text":"<task>do it</task>"},{"type":"text","text":"<environment_details>\n# Current Workspace Directory (/tmp/project) Files\n</environment_details>"}]}
        ]""".trimIndent())
        cfg.resolve("options").mkdirs()
        cfg.resolve("options/kilocode-extension-storage.xml").writeText("""
<application>
  <component name="ExtensionStorageService">
    <option name="storageMap">
      <map>
        <entry key="kilo-code" value="{&quot;taskHistory&quot;:&quot;[]&quot;}" />
      </map>
    </option>
  </component>
</application>
        """.trimIndent())

        val obj = LegacyV5Importer(LegacyV5Sources(home, cfg)).import()
        val history = kotlinx.serialization.json.Json.parseToJsonElement(obj["taskHistory"]!!.jsonPrimitive.content).jsonArray
        assertEquals("task-1", history[0].jsonObject["id"]!!.jsonPrimitive.content)
        assertNotNull(obj["conversations"]!!.jsonObject["task-1"])
    }

    @Test
    fun `metadata import does not retain conversation contents`() {
        val home = Files.createTempDirectory("kilo-v5-home").toFile()
        val cfg = Files.createTempDirectory("kilo-v5-config").toFile()
        val task = home.resolve(".kilocode/globalStorage/tasks/task-1")
        task.mkdirs()
        task.resolve("api_conversation_history.json").writeText("""[{"role":"user","content":"secret conversation"}]""")
        cfg.resolve("options").mkdirs()
        cfg.resolve("options/kilocode-extension-storage.xml").writeText("""
<application>
  <component name="ExtensionStorageService">
    <option name="storageMap">
      <map>
        <entry key="kilo-code" value="{&quot;taskHistory&quot;:&quot;[{\&quot;id\&quot;:\&quot;task-1\&quot;,\&quot;task\&quot;:\&quot;Fix\&quot;,\&quot;workspace\&quot;:\&quot;/tmp/project\&quot;,\&quot;ts\&quot;:1700000000000}]&quot;}" />
      </map>
    </option>
  </component>
</application>
        """.trimIndent())

        val obj = LegacyV5Importer(LegacyV5Sources(home, cfg)).import(includeConversations = false)
        assertEquals("", obj["conversations"]!!.jsonObject["task-1"]!!.jsonPrimitive.content)
    }

    @Test
    fun `metadata import skips history entries without conversation files`() {
        val home = Files.createTempDirectory("kilo-v5-home").toFile()
        val cfg = Files.createTempDirectory("kilo-v5-config").toFile()
        val task = home.resolve(".kilocode/globalStorage/tasks/task-1")
        task.mkdirs()
        task.resolve("api_conversation_history.json").writeText("""[{"role":"user","content":"present"}]""")
        cfg.resolve("options").mkdirs()
        cfg.resolve("options/kilocode-extension-storage.xml").writeText("""
<application>
  <component name="ExtensionStorageService">
    <option name="storageMap">
      <map>
        <entry key="kilo-code" value="{&quot;taskHistory&quot;:&quot;[{\&quot;id\&quot;:\&quot;task-1\&quot;,\&quot;task\&quot;:\&quot;One\&quot;,\&quot;workspace\&quot;:\&quot;/tmp/project\&quot;,\&quot;ts\&quot;:1700000000000},{\&quot;id\&quot;:\&quot;missing\&quot;,\&quot;task\&quot;:\&quot;Missing\&quot;,\&quot;workspace\&quot;:\&quot;/tmp/project\&quot;,\&quot;ts\&quot;:1700000000001}]&quot;}" />
      </map>
    </option>
  </component>
</application>
        """.trimIndent())

        val obj = LegacyV5Importer(LegacyV5Sources(home, cfg)).import(includeConversations = false)
        val conv = obj["conversations"]!!.jsonObject
        assertEquals(setOf("task-1"), conv.keys)
    }

    @Test
    fun `scan fallback skips sessions without workspace`() {
        val home = Files.createTempDirectory("kilo-v5-home").toFile()
        val cfg = Files.createTempDirectory("kilo-v5-config").toFile()
        val task = home.resolve(".kilocode/globalStorage/kilo code.kilo-code/tasks/task-nows")
        task.mkdirs()
        task.resolve("api_conversation_history.json").writeText("""[
            {"role":"user","content":[{"type":"text","text":"just a question with no workspace marker"}]}
        ]""".trimIndent())

        val obj = LegacyV5Importer(LegacyV5Sources(home, cfg)).import()
        assertNull(obj["taskHistory"])
        assertTrue((obj["conversations"] as? kotlinx.serialization.json.JsonObject)?.isEmpty() ?: true)
    }
}
