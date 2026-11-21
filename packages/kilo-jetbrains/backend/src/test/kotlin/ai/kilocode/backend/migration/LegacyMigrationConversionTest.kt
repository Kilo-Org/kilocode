package ai.kilocode.backend.migration

import ai.kilocode.backend.migration.LegacyMigrationConverters.PermissionEntry
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Tests for provider, MCP, custom-mode, and settings conversion logic.
 */
class LegacyMigrationConversionTest {

    /** Every converted mode lacks a `skill` grant, so it carries this warning in addition. */
    private val skillWarning = "Skills are not available: no legacy group grants them"

    // -----------------------------------------------------------------------
    // Provider mapping
    // -----------------------------------------------------------------------

    @Test
    fun `convertProvider - api-key provider builds api auth`() {
        val settings = buildJsonObject {
            put("apiProvider", "anthropic")
            put("apiKey", "sk-ant-abc")
        }
        val result = LegacyMigrationConverters.convertProvider("anthropic-profile", settings) { null }
        assertEquals(MigrationItemStatus.success, result.status)
        assertNotNull(result.auth)
        assertEquals("api", result.auth!!["type"]?.jsonPrimitive?.content)
        assertEquals("sk-ant-abc", result.auth["key"]?.jsonPrimitive?.content)
        assertNull(result.config)
    }

    @Test
    fun `convertProvider - kilo provider builds OAuth auth with 1-year expiry`() {
        val settings = buildJsonObject {
            put("apiProvider", "kilocode")
            put("kilocodeToken", "tok-123")
        }
        val result = LegacyMigrationConverters.convertProvider("kilo-profile", settings) { null }
        assertEquals(MigrationItemStatus.success, result.status)
        val auth = result.auth!!
        assertEquals("oauth", auth["type"]?.jsonPrimitive?.content)
        assertEquals("tok-123", auth["access"]?.jsonPrimitive?.content)
        assertEquals("tok-123", auth["refresh"]?.jsonPrimitive?.content)
        val expires = auth["expires"]?.jsonPrimitive?.content?.toLongOrNull() ?: 0L
        assertTrue(expires > System.currentTimeMillis())
    }

    @Test
    fun `convertProvider - unsupported provider returns warning`() {
        val settings = buildJsonObject {
            put("apiProvider", "glama")
            put("apiKey", "k")
        }
        val result = LegacyMigrationConverters.convertProvider("p", settings) { null }
        assertEquals(MigrationItemStatus.warning, result.status)
        assertNull(result.auth)
    }

    @Test
    fun `convertProvider - unknown provider returns warning`() {
        val settings = buildJsonObject { put("apiProvider", "totally-unknown-provider") }
        val result = LegacyMigrationConverters.convertProvider("p", settings) { null }
        assertEquals(MigrationItemStatus.warning, result.status)
    }

    @Test
    fun `convertProvider - no api key returns warning`() {
        val settings = buildJsonObject { put("apiProvider", "anthropic") }
        val result = LegacyMigrationConverters.convertProvider("p", settings) { null }
        assertEquals(MigrationItemStatus.warning, result.status)
    }

    @Test
    fun `convertProvider - vertex skips auth and writes config`() {
        val settings = buildJsonObject {
            put("apiProvider", "vertex")
            put("vertexProjectId", "my-project")
            put("vertexRegion", "us-central1")
        }
        val result = LegacyMigrationConverters.convertProvider("p", settings) { null }
        assertEquals(MigrationItemStatus.success, result.status)
        assertNull(result.auth)
        assertNotNull(result.config)
        val opts = result.config!!["provider"]?.jsonObject?.get("google-vertex")?.jsonObject?.get("options")?.jsonObject
        assertEquals("my-project", opts?.get("project")?.jsonPrimitive?.content)
        assertEquals("us-central1", opts?.get("location")?.jsonPrimitive?.content)
    }

    @Test
    fun `convertProvider - vertex with inline credentials returns warning`() {
        val settings = buildJsonObject {
            put("apiProvider", "vertex")
            put("vertexProjectId", "p")
            put("vertexJsonCredentials", "{\"type\":\"service_account\"}")
        }
        val result = LegacyMigrationConverters.convertProvider("p", settings) { null }
        assertEquals(MigrationItemStatus.warning, result.status)
    }

    @Test
    fun `convertProvider - base URL config patch written for openai`() {
        val settings = buildJsonObject {
            put("apiProvider", "openai")
            put("openAiApiKey", "sk-x")
            put("openAiBaseUrl", "https://my.openai.com/v1")
        }
        val result = LegacyMigrationConverters.convertProvider("p", settings) { null }
        assertEquals(MigrationItemStatus.success, result.status)
        assertNotNull(result.config)
        val opts = result.config!!["provider"]?.jsonObject?.get("openai-compatible")?.jsonObject?.get("options")?.jsonObject
        assertEquals("https://my.openai.com/v1", opts?.get("baseURL")?.jsonPrimitive?.content)
    }

    @Test
    fun `convertProvider - OAuth secret provider uses oauthRaw callback`() {
        val settings = buildJsonObject { put("apiProvider", "openai-codex") }
        val oauthJson = """{"access_token":"acc","refresh_token":"ref","expires":9999999999000}"""
        val result = LegacyMigrationConverters.convertProvider("p", settings) { if (it == "openai-codex-oauth-credentials") oauthJson else null }
        assertEquals(MigrationItemStatus.success, result.status)
        val auth = result.auth!!
        assertEquals("oauth", auth["type"]?.jsonPrimitive?.content)
        assertEquals("acc", auth["access"]?.jsonPrimitive?.content)
    }

    // -----------------------------------------------------------------------
    // MCP conversion
    // -----------------------------------------------------------------------

    @Test
    fun `convertMcpServer - stdio becomes local`() {
        val server = LegacyMcpServer(
            type = null,
            command = "npx",
            args = listOf("-y", "my-tool"),
            url = null, env = null, headers = null, disabled = null, timeout = null,
        )
        val result = LegacyMigrationConverters.convertMcpServer("my-tool", server)!!
        assertEquals("local", result["type"]?.jsonPrimitive?.content)
        val cmd = result["command"]
        assertNotNull(cmd)
    }

    @Test
    fun `convertMcpServer - sse becomes remote`() {
        val server = LegacyMcpServer(type = "sse", command = null, args = null, url = "https://example.com/mcp", env = null, headers = null, disabled = null, timeout = null)
        val result = LegacyMigrationConverters.convertMcpServer("remote", server)!!
        assertEquals("remote", result["type"]?.jsonPrimitive?.content)
        assertEquals("https://example.com/mcp", result["url"]?.jsonPrimitive?.content)
    }

    @Test
    fun `convertMcpServer - streamable-http becomes remote`() {
        val server = LegacyMcpServer(type = "streamable-http", command = null, args = null, url = "https://api.example.com/mcp", env = null, headers = null, disabled = null, timeout = null)
        val result = LegacyMigrationConverters.convertMcpServer("s", server)!!
        assertEquals("remote", result["type"]?.jsonPrimitive?.content)
    }

    @Test
    fun `convertMcpServer - timeout seconds to milliseconds`() {
        val server = LegacyMcpServer(type = null, command = "node", args = null, url = null, env = null, headers = null, disabled = null, timeout = 30)
        val result = LegacyMigrationConverters.convertMcpServer("t", server)!!
        assertEquals("30000", result["timeout"]?.jsonPrimitive?.content)
    }

    @Test
    fun `convertMcpServer - disabled true sets enabled false`() {
        val server = LegacyMcpServer(type = null, command = "node", args = null, url = null, env = null, headers = null, disabled = true, timeout = null)
        val result = LegacyMigrationConverters.convertMcpServer("d", server)!!
        assertEquals("false", result["enabled"]?.jsonPrimitive?.content)
    }

    @Test
    fun `convertMcpServer - missing url for sse returns null`() {
        val server = LegacyMcpServer(type = "sse", command = null, args = null, url = null, env = null, headers = null, disabled = null, timeout = null)
        assertNull(LegacyMigrationConverters.convertMcpServer("no-url", server))
    }

    // -----------------------------------------------------------------------
    // Custom mode / agent
    // -----------------------------------------------------------------------

    @Test
    fun `convertCustomMode - description from description field`() {
        val mode = LegacyCustomMode(
            slug = "my-mode",
            name = "My Mode",
            roleDefinition = "You are helpful.",
            customInstructions = null,
            whenToUse = null,
            description = "Short desc",
            groups = listOf("read", "edit"),
        )
        val result = LegacyMigrationConverters.convertCustomMode(mode, emptyList(), false)
        assertEquals("Short desc", result.agent["description"]?.jsonPrimitive?.content)
        assertEquals("primary", result.agent["mode"]?.jsonPrimitive?.content)
        assertTrue(result.agent["prompt"]?.jsonPrimitive?.content?.contains("You are helpful.") == true)
    }

    @Test
    fun `convertCustomMode - description falls back to whenToUse`() {
        val mode = LegacyCustomMode("s", "N", "Role", null, "When to use", null, listOf())
        val result = LegacyMigrationConverters.convertCustomMode(mode, emptyList(), false)
        assertEquals("When to use", result.agent["description"]?.jsonPrimitive?.content)
    }

    @Test
    fun `convertCustomMode - description falls back to roleDefinition truncated`() {
        val role = "X".repeat(200)
        val mode = LegacyCustomMode("s", "N", role, null, null, null, listOf())
        val result = LegacyMigrationConverters.convertCustomMode(mode, emptyList(), false)
        assertEquals(120, result.agent["description"]?.jsonPrimitive?.content?.length)
    }

    @Test
    fun `convertCustomMode - customInstructions appended to prompt`() {
        val mode = LegacyCustomMode("s", "N", "Role.", "Custom extra.", null, null, listOf())
        val prompt = LegacyMigrationConverters.convertCustomMode(mode, emptyList(), false).agent["prompt"]?.jsonPrimitive?.content!!
        assertTrue(prompt.contains("Role."))
        assertTrue(prompt.contains("Custom extra."))
        assertTrue(prompt.contains("USER'S CUSTOM INSTRUCTIONS"))
    }

    @Test
    fun `convertCustomModePermissions - read edit groups`() {
        val groups: List<Any> = listOf("read", "edit")
        val result = LegacyMigrationConverters.convertCustomModePermissions(groups, emptyList(), false)
        val perm = result.permission
        assertEquals("allow", perm["read"]?.jsonPrimitive?.content)
        assertEquals("allow", perm["edit"]?.jsonPrimitive?.content)
        assertEquals("deny", perm["bash"]?.jsonPrimitive?.content)
        assertEquals("deny", perm["browser_open"]?.jsonPrimitive?.content)
        assertEquals("deny", perm["skill"]?.jsonPrimitive?.content)
        assertEquals(listOf(skillWarning), result.warnings)
    }

    @Test
    fun `convertCustomModePermissions - browser maps to browser_open`() {
        val result = LegacyMigrationConverters.convertCustomModePermissions(listOf("browser"), emptyList(), false)
        assertEquals("allow", result.permission["browser_open"]?.jsonPrimitive?.content)
        assertEquals("deny", result.permission["bash"]?.jsonPrimitive?.content)
        assertEquals("deny", result.permission["skill"]?.jsonPrimitive?.content)
        assertEquals(listOf(skillWarning), result.warnings)
    }

    @Test
    fun `convertCustomMode - browser group writes browser_open`() {
        val mode = LegacyCustomMode("b", "B", "Role.", null, null, null, listOf("browser"))
        val perm = LegacyMigrationConverters.convertCustomMode(mode, emptyList(), false).agent["permission"]?.jsonObject
        assertNotNull(perm)
        assertEquals("allow", perm["browser_open"]?.jsonPrimitive?.content)
        assertEquals("deny", perm["bash"]?.jsonPrimitive?.content)
    }

    @Test
    fun `convertCustomModePermissions - command maps to bash`() {
        val result = LegacyMigrationConverters.convertCustomModePermissions(listOf("command"), emptyList(), false)
        assertEquals("allow", result.permission["bash"]?.jsonPrimitive?.content)
        assertEquals("deny", result.permission["browser_open"]?.jsonPrimitive?.content)
        assertEquals("deny", result.permission["skill"]?.jsonPrimitive?.content)
        assertEquals(listOf(skillWarning), result.warnings)
    }

    @Test
    fun `convertCustomModePermissions - mcp grants tools of migrated servers`() {
        val result = LegacyMigrationConverters.convertCustomModePermissions(
            listOf("mcp"),
            mcpServers = listOf("github", "my server"),
            mcpAvailable = true,
        )
        assertEquals("allow", result.permission["github_*"]?.jsonPrimitive?.content)
        assertEquals("allow", result.permission["my_server_*"]?.jsonPrimitive?.content)
        assertEquals("deny", result.permission["skill"]?.jsonPrimitive?.content)
        assertEquals(listOf(skillWarning), result.warnings)
    }

    @Test
    fun `convertCustomModePermissions - mcp fileRegex asks for every migrated server and warns`() {
        val pattern = "\\.md${'$'}"
        val groups: List<Any> = listOf(Pair("mcp", mapOf("fileRegex" to pattern)))
        val result = LegacyMigrationConverters.convertCustomModePermissions(
            groups,
            mcpServers = listOf("github", "my server"),
            mcpAvailable = true,
        )
        assertEquals("ask", result.permission["github_*"]?.jsonPrimitive?.content)
        assertEquals("ask", result.permission["my_server_*"]?.jsonPrimitive?.content)
        assertEquals("deny", result.permission["skill"]?.jsonPrimitive?.content)
        assertEquals(listOf("File restriction not migrated; mcp set to ask: $pattern", skillWarning), result.warnings)
    }

    @Test
    fun `convertCustomModePermissions - unreadable mcp options without migrated servers warn only that no server was migrated`() {
        val groups: List<Any> = listOf(Pair("mcp", mapOf("__unparsed" to "true")))
        val result = LegacyMigrationConverters.convertCustomModePermissions(
            groups,
            emptyList(),
            mcpAvailable = true,
        )
        assertTrue(result.permission.keys.none { it.endsWith("_*") })
        assertEquals("deny", result.permission["skill"]?.jsonPrimitive?.content)
        assertEquals(listOf("MCP access not migrated: no MCP server was migrated", skillWarning), result.warnings)
    }

    @Test
    fun `convertCustomModePermissions - mode without mcp group denies skill and server tools`() {
        val result = LegacyMigrationConverters.convertCustomModePermissions(
            listOf("read"),
            mcpServers = listOf("github", "my server"),
            mcpAvailable = true,
        )
        assertEquals("deny", result.permission["github_*"]?.jsonPrimitive?.content)
        assertEquals("deny", result.permission["my_server_*"]?.jsonPrimitive?.content)
        assertEquals("deny", result.permission["skill"]?.jsonPrimitive?.content)
        assertEquals(listOf(skillWarning), result.warnings)
    }

    @Test
    fun `convertCustomModePermissions - fileRegex suffix becomes glob allow after deny`() {
        val groups: List<Any> = listOf(Pair("edit", mapOf("fileRegex" to "\\.md$")))
        val result = LegacyMigrationConverters.convertCustomModePermissions(groups, emptyList(), false)
        val editPerm = result.permission["edit"]?.jsonObject
        assertNotNull(editPerm)
        assertEquals("deny", editPerm["*"]?.jsonPrimitive?.content)
        assertEquals("allow", editPerm["*.md"]?.jsonPrimitive?.content)
        assertEquals("*", editPerm.keys.first())
        assertEquals(listOf(skillWarning), result.warnings)
    }

    @Test
    fun `convertCustomModePermissions - fileRegex alternation becomes multiple globs`() {
        val groups: List<Any> = listOf(Pair("edit", mapOf("fileRegex" to "\\.(md|txt)$")))
        val editPerm = LegacyMigrationConverters.convertCustomModePermissions(groups, emptyList(), false).permission["edit"]?.jsonObject
        assertNotNull(editPerm)
        assertEquals("deny", editPerm["*"]?.jsonPrimitive?.content)
        assertEquals("allow", editPerm["*.md"]?.jsonPrimitive?.content)
        assertEquals("allow", editPerm["*.txt"]?.jsonPrimitive?.content)
    }

    @Test
    fun `convertCustomModePermissions - untranslatable fileRegex asks before edit and warns`() {
        val groups: List<Any> = listOf(Pair("edit", mapOf("fileRegex" to "[a-z]+\\.ts$")))
        val result = LegacyMigrationConverters.convertCustomModePermissions(groups, emptyList(), false)
        assertEquals("ask", result.permission["edit"]?.jsonPrimitive?.content)
        assertTrue(result.warnings.isNotEmpty())
    }

    @Test
    fun `convertCustomModePermissions - fileRegex word boundary escape is not migrated`() {
        val groups: List<Any> = listOf(Pair("edit", mapOf("fileRegex" to "\\.md\\b")))
        val result = LegacyMigrationConverters.convertCustomModePermissions(groups, emptyList(), false)
        assertEquals("ask", result.permission["edit"]?.jsonPrimitive?.content)
        assertTrue(result.warnings.isNotEmpty())
    }

    @Test
    fun `convertCustomModePermissions - fileRegex arm ending with space star is not migrated`() {
        val groups: List<Any> = listOf(Pair("edit", mapOf("fileRegex" to "^docs/a .*$")))
        val result = LegacyMigrationConverters.convertCustomModePermissions(groups, emptyList(), false)
        assertEquals("ask", result.permission["edit"]?.jsonPrimitive?.content)
        assertTrue(result.warnings.isNotEmpty())
    }

    @Test
    fun `convertCustomModePermissions - mcp group without migrated servers does not add a server warning`() {
        val result = LegacyMigrationConverters.convertCustomModePermissions(
            listOf("mcp"),
            emptyList(),
            mcpAvailable = false,
        )
        assertEquals(listOf(skillWarning), result.warnings)
        assertTrue(result.permission.keys.none { it.endsWith("_*") })
    }

    @Test
    fun `convertCustomModePermissions - mcp group without migrated servers warns only when the store had one`() {
        val groups: List<Any> = listOf("mcp")
        val available = LegacyMigrationConverters.convertCustomModePermissions(groups, emptyList(), mcpAvailable = true)
        assertEquals(listOf("MCP access not migrated: no MCP server was migrated", skillWarning), available.warnings)
        assertTrue(available.permission.keys.none { it.endsWith("_*") })

        val absent = LegacyMigrationConverters.convertCustomModePermissions(groups, emptyList(), mcpAvailable = false)
        assertEquals(listOf(skillWarning), absent.warnings)
        assertTrue(absent.permission.keys.none { it.endsWith("_*") })
    }

    @Test
    fun `convertCustomModePermissions - unknown group writes no permission key and warns`() {
        val result = LegacyMigrationConverters.convertCustomModePermissions(listOf("read", "- edit"), emptyList(), false)
        val perm = result.permission
        assertEquals(setOf("read", "edit", "bash", "browser_open", "skill"), perm.keys)
        assertEquals("allow", perm["read"]?.jsonPrimitive?.content)
        assertEquals("deny", perm["edit"]?.jsonPrimitive?.content)
        assertFalse(perm.keys.any { it.contains("- edit") })
        assertEquals(listOf("Group not migrated; \"- edit\" ignored", skillWarning), result.warnings)
    }

    @Test
    fun `convertCustomModePermissions - digit only fileRegex arm is not migrated`() {
        val groups: List<Any> = listOf(Pair("edit", mapOf("fileRegex" to "^123$")))
        val result = LegacyMigrationConverters.convertCustomModePermissions(groups, emptyList(), false)
        assertEquals("ask", result.permission["edit"]?.jsonPrimitive?.content)
        assertEquals(
            listOf("File restriction not migrated; edit set to ask: ^123$", skillWarning),
            result.warnings,
        )
    }

    @Test
    fun `convertCustomModePermissions - unanchored numeric fileRegex still translates`() {
        val groups: List<Any> = listOf(Pair("edit", mapOf("fileRegex" to "123")))
        val result = LegacyMigrationConverters.convertCustomModePermissions(groups, emptyList(), false)
        val editPerm = result.permission["edit"]?.jsonObject
        assertNotNull(editPerm)
        assertEquals("deny", editPerm["*"]?.jsonPrimitive?.content)
        assertEquals("allow", editPerm["*123*"]?.jsonPrimitive?.content)
        assertEquals(listOf(skillWarning), result.warnings)
    }

    @Test
    fun `fileRegexToGlobs - digit only arm returns null`() {
        assertNull(fileRegexToGlobs("^123$"))
        assertNull(fileRegexToGlobs("^(123|456)$"))
        assertEquals(listOf("*123*"), fileRegexToGlobs("123"))
    }

    // -----------------------------------------------------------------------
    // custom_modes.yaml parser
    // -----------------------------------------------------------------------

    @Test
    fun `parseCustomModesYaml - nested group with fileRegex and description`() {
        val yaml = """
            customModes:
              - slug: docwriter
                name: Doc Writer
                roleDefinition: You write documentation.
                groups:
                  - read
                  - - edit
                    - fileRegex: "\\.md${'$'}"
                      description: "Markdown files only"
                  - browser
                  - mcp
        """.trimIndent()
        val modes = LegacyMigrationConverters.parseCustomModesYaml(yaml)
        assertEquals(1, modes.size)
        assertEquals(
            listOf(
                "read",
                Pair("edit", mapOf("fileRegex" to "\\.md$", "description" to "Markdown files only")),
                "browser",
                "mcp",
            ),
            modes[0].groups,
        )
    }

    @Test
    fun `parseCustomModesYaml - nested group permissions restrict edit to markdown`() {
        val yaml = """
            customModes:
              - slug: docwriter
                name: Doc Writer
                roleDefinition: You write documentation.
                groups:
                  - read
                  - - edit
                    - fileRegex: "\\.md${'$'}"
                      description: "Markdown files only"
                  - browser
                  - mcp
        """.trimIndent()
        val mode = LegacyMigrationConverters.parseCustomModesYaml(yaml).single()
        val result = LegacyMigrationConverters.convertCustomModePermissions(mode.groups, emptyList(), false)
        val editPerm = result.permission["edit"]?.jsonObject
        assertNotNull(editPerm)
        assertEquals("deny", editPerm["*"]?.jsonPrimitive?.content)
        assertEquals("allow", editPerm["*.md"]?.jsonPrimitive?.content)
        assertEquals("deny", result.permission["bash"]?.jsonPrimitive?.content)
        assertFalse(result.permission.keys.any { it.contains("- edit") })
        assertFalse(result.permission.keys.any { it == "fileRegex" || it == "description" })
        assertEquals("allow", result.permission["browser_open"]?.jsonPrimitive?.content)
        assertEquals("deny", result.permission["skill"]?.jsonPrimitive?.content)
        assertEquals(listOf(skillWarning), result.warnings)
    }

    @Test
    fun `parseCustomModesYaml - unreadable group option lines migrate the group to ask`() {
        val yaml = """
            customModes:
              - slug: nested
                name: Nested
                roleDefinition: You edit nested files.
                groups:
                  - - edit
                      - fileRegex: \.md${'$'}
              - slug: flat
                name: Flat
                roleDefinition: You edit flat files.
                groups:
                  - - edit
                    fileRegex: \.ts${'$'}
        """.trimIndent()
        val modes = LegacyMigrationConverters.parseCustomModesYaml(yaml)
        assertEquals(2, modes.size)
        for (mode in modes) {
            assertEquals(listOf<Any>(Pair("edit", mapOf("__unparsed" to "true"))), mode.groups)
            val result = LegacyMigrationConverters.convertCustomModePermissions(mode.groups, emptyList(), false)
            assertEquals("ask", result.permission["edit"]?.jsonPrimitive?.content)
            assertEquals(listOf("Group options not migrated; edit set to ask", skillWarning), result.warnings)
        }
    }

    @Test
    fun `parseCustomModesYaml - unreadable mcp option line sets server tools to ask`() {
        val yaml = """
            customModes:
              - slug: restricted
                name: Restricted
                roleDefinition: You read files.
                groups:
                  - read
                  - - mcp
                      - fileRegex: \.md${'$'}
        """.trimIndent()
        val mode = LegacyMigrationConverters.parseCustomModesYaml(yaml).single()
        assertEquals(listOf<Any>("read", Pair("mcp", mapOf("__unparsed" to "true"))), mode.groups)
        val result = LegacyMigrationConverters.convertCustomModePermissions(mode.groups, mcpServers = listOf("github"), mcpAvailable = true)
        assertEquals("ask", result.permission["github_*"]?.jsonPrimitive?.content)
        assertEquals("deny", result.permission["skill"]?.jsonPrimitive?.content)
        assertEquals("deny", result.permission["bash"]?.jsonPrimitive?.content)
        assertEquals(listOf("Group options not migrated; mcp set to ask", skillWarning), result.warnings)
    }

    @Test
    fun `parseCustomModes - unknown json group option narrows the group to ask`() {
        val raw = """{"customModes":[{"slug":"json","name":"Json","roleDefinition":"You edit files.","groups":["read",["edit",{"regex":"\\.md$"}]]}]}"""
        val mode = LegacyMigrationConverters.parseCustomModes(raw).orEmpty().single()
        val result = LegacyMigrationConverters.convertCustomModePermissions(mode.groups, emptyList(), false)
        assertEquals("allow", result.permission["read"]?.jsonPrimitive?.content)
        assertEquals("ask", result.permission["edit"]?.jsonPrimitive?.content)
        assertEquals(listOf("Group options not migrated; edit set to ask", skillWarning), result.warnings)
    }

    @Test
    fun `parseCustomModes - known json group options keep the fileRegex translation`() {
        val raw = """{"customModes":[{"slug":"known","name":"Known","roleDefinition":"You edit files.","groups":["read",["edit",{"fileRegex":"\\.md$","description":"Markdown"}]]}]}"""
        val mode = LegacyMigrationConverters.parseCustomModes(raw).orEmpty().single()
        val result = LegacyMigrationConverters.convertCustomModePermissions(mode.groups, emptyList(), false)
        val editPerm = result.permission["edit"]?.jsonObject
        assertNotNull(editPerm)
        assertEquals("deny", editPerm["*"]?.jsonPrimitive?.content)
        assertEquals("allow", editPerm["*.md"]?.jsonPrimitive?.content)
        assertEquals(listOf(skillWarning), result.warnings)
    }

    @Test
    fun `parseCustomModesYaml - flow style groups list`() {
        val yaml = """
            customModes:
              - slug: flow
                name: Flow
                roleDefinition: You are flow.
                groups: [read, edit]
        """.trimIndent()
        val modes = LegacyMigrationConverters.parseCustomModesYaml(yaml)
        assertEquals(1, modes.size)
        assertEquals(listOf<Any>("read", "edit"), modes[0].groups)
    }

    @Test
    fun `parseCustomModesYaml - trailing comment after flow style groups is dropped`() {
        val yaml = """
            customModes:
              - slug: commented
                name: Commented
                roleDefinition: You are commented.
                groups: [read, edit] # tools
        """.trimIndent()
        val modes = LegacyMigrationConverters.parseCustomModesYaml(yaml)
        assertEquals(1, modes.size)
        assertEquals(listOf<Any>("read", "edit"), modes[0].groups)
    }

    @Test
    fun `parseCustomModesYaml - trailing comment after nested group option is dropped`() {
        val yaml = """
            customModes:
              - slug: docwriter
                name: Doc Writer
                roleDefinition: You write documentation.
                groups:
                  - read
                  - - edit
                    - fileRegex: \.md${'$'} # docs
                  - browser
        """.trimIndent()
        val mode = LegacyMigrationConverters.parseCustomModesYaml(yaml).single()
        assertEquals(
            listOf("read", Pair("edit", mapOf("fileRegex" to "\\.md$")), "browser"),
            mode.groups,
        )
        val editPerm = LegacyMigrationConverters.convertCustomModePermissions(mode.groups, emptyList(), false).permission["edit"]?.jsonObject
        assertEquals(
            buildJsonObject {
                put("*", "deny")
                put("*.md", "allow")
            },
            editPerm,
        )
    }

    @Test
    fun `parseCustomModesYaml - hash inside a quoted scalar is kept`() {
        val yaml = """
            customModes:
              - slug: quoted
                name: Quoted
                roleDefinition: You are quoted.
                description: "a # b"
        """.trimIndent()
        val mode = LegacyMigrationConverters.parseCustomModesYaml(yaml).single()
        assertEquals("a # b", mode.description)
    }

    @Test
    fun `parseCustomModesYaml - hash inside a block scalar is kept`() {
        val yaml = """
            customModes:
              - slug: blockhash
                name: Block Hash
                roleDefinition: You are a block scalar.
                customInstructions: |
                  Keep the # heading
                  # trailing note
        """.trimIndent()
        val mode = LegacyMigrationConverters.parseCustomModesYaml(yaml).single()
        assertEquals("Keep the # heading\n# trailing note", mode.customInstructions)
    }

    @Test
    fun `parseCustomModesYaml - unconsumed group block line becomes a reported group`() {
        val yaml = """
            customModes:
              - slug: partial
                name: Partial
                roleDefinition: You are partial.
                groups:
                  - read
                  tools: edit
                  - browser
        """.trimIndent()
        val mode = LegacyMigrationConverters.parseCustomModesYaml(yaml).single()
        assertEquals(listOf<Any>("read", "tools: edit", "browser"), mode.groups)
        val result = LegacyMigrationConverters.convertCustomModePermissions(mode.groups, emptyList(), false)
        assertEquals(listOf("Group not migrated; \"tools: edit\" ignored", skillWarning), result.warnings)
        assertFalse(result.permission.keys.any { it == "tools: edit" })
        assertEquals("deny", result.permission["edit"]?.jsonPrimitive?.content)
    }

    @Test
    fun `parseCustomModesYaml - comment line inside groups block keeps the block open`() {
        val yaml = """
            customModes:
              - slug: annotated
                name: Annotated
                roleDefinition: You are annotated.
                groups:
                  - read
                  # tools this mode may use
                  - browser
        """.trimIndent()
        val mode = LegacyMigrationConverters.parseCustomModesYaml(yaml).single()
        assertEquals(listOf<Any>("read", "browser"), mode.groups)
        val result = LegacyMigrationConverters.convertCustomModePermissions(mode.groups, emptyList(), false)
        assertEquals("allow", result.permission["read"]?.jsonPrimitive?.content)
        assertEquals("allow", result.permission["browser_open"]?.jsonPrimitive?.content)
        assertEquals("deny", result.permission["edit"]?.jsonPrimitive?.content)
        assertEquals("deny", result.permission["skill"]?.jsonPrimitive?.content)
        assertEquals(listOf(skillWarning), result.warnings)
    }

    @Test
    fun `parseCustomModesYaml - apostrophe in prose text does not hide a trailing comment`() {
        val yaml = """
            customModes:
              - slug: prose
                name: Prose
                roleDefinition: You're a writer. # role
                description: It's fine # note
        """.trimIndent()
        val mode = LegacyMigrationConverters.parseCustomModesYaml(yaml).single()
        assertEquals("You're a writer.", mode.roleDefinition)
        assertEquals("It's fine", mode.description)
    }

    // -----------------------------------------------------------------------
    // Auto-approval
    // -----------------------------------------------------------------------

    @Test
    fun `convertAutoApproval - command rules with no command lists grant only bash`() {
        val settings = LegacySettings(
            autoApprovalEnabled = true,
            allowedCommands = emptyList(),
            deniedCommands = emptyList(),
            alwaysAllowReadOnly = null, alwaysAllowReadOnlyOutsideWorkspace = null,
            alwaysAllowWrite = null, alwaysAllowExecute = null,
            alwaysAllowMcp = null, alwaysAllowModeSwitch = null, alwaysAllowSubtasks = null,
            language = null, autocomplete = null,
        )
        val sel = MigrationAutoApprovalSelections(commandRules = true, readPermission = false, writePermission = false, executePermission = false, mcpPermission = false, taskPermission = false)
        val conv = LegacyMigrationConverters.convertAutoApproval(settings, sel, emptyList())
        assertNotNull(conv.config)
        val perm = conv.config!!["permission"]?.jsonObject
        assertNotNull(perm)
        assertEquals("allow", perm["bash"]?.jsonPrimitive?.content)
        assertFalse(perm.containsKey("read"))
        assertFalse(perm.containsKey("edit"))
        assertFalse(perm.containsKey("external_directory"))
    }

    @Test
    fun `convertAutoApproval - command rules keep read and write asks`() {
        val settings = LegacySettings(
            autoApprovalEnabled = true,
            allowedCommands = emptyList(),
            deniedCommands = emptyList(),
            alwaysAllowReadOnly = false, alwaysAllowReadOnlyOutsideWorkspace = null,
            alwaysAllowWrite = false, alwaysAllowExecute = null,
            alwaysAllowMcp = null, alwaysAllowModeSwitch = null, alwaysAllowSubtasks = null,
            language = null, autocomplete = null,
        )
        val sel = MigrationAutoApprovalSelections(commandRules = true, readPermission = true, writePermission = true, executePermission = false, mcpPermission = false, taskPermission = false)
        val conv = LegacyMigrationConverters.convertAutoApproval(settings, sel, emptyList())
        val perm = conv.config!!["permission"]?.jsonObject
        assertNotNull(perm)
        assertEquals("ask", perm["read"]?.jsonPrimitive?.content)
        assertEquals("ask", perm["edit"]?.jsonPrimitive?.content)
        assertEquals("allow", perm["bash"]?.jsonPrimitive?.content)
    }

    @Test
    fun `convertCustomModePermissions - built-in ask mode groups migrate without bash allow`() {
        val mode = LegacyMigrationConverters.buildMergedNativeMode(null, null, "ask")!!
        val conversion = LegacyMigrationConverters.convertCustomMode(mode, listOf("github"), true)
        val perm = conversion.agent["permission"]?.jsonObject
        assertNotNull(perm)
        assertEquals("allow", perm["read"]?.jsonPrimitive?.content)
        assertEquals("allow", perm["browser_open"]?.jsonPrimitive?.content)
        assertEquals("allow", perm["github_*"]?.jsonPrimitive?.content)
        assertEquals("deny", perm["bash"]?.jsonPrimitive?.content)
        assertEquals("deny", perm["skill"]?.jsonPrimitive?.content)
        assertEquals(listOf(skillWarning), conversion.warnings)
        assertTrue(perm.entries.none { it.key == "bash" && it.value.jsonPrimitive.content == "allow" })
    }

    @Test
    fun `convertAutoApproval - command allow deny lists write bash rules`() {
        val settings = LegacySettings(
            autoApprovalEnabled = true,
            allowedCommands = listOf("git", "npm run"),
            deniedCommands = listOf("rm"),
            alwaysAllowReadOnly = null, alwaysAllowReadOnlyOutsideWorkspace = null,
            alwaysAllowWrite = null, alwaysAllowExecute = null,
            alwaysAllowMcp = null, alwaysAllowModeSwitch = null, alwaysAllowSubtasks = null,
            language = null, autocomplete = null,
        )
        val sel = MigrationAutoApprovalSelections(commandRules = true, readPermission = false, writePermission = false, executePermission = false, mcpPermission = false, taskPermission = false)
        val conv = LegacyMigrationConverters.convertAutoApproval(settings, sel, emptyList())
        val perm = conv.config!!["permission"]?.jsonObject
        val bash = perm?.get("bash")?.jsonObject
        assertNotNull(bash)
        assertEquals("allow", bash["git *"]?.jsonPrimitive?.content)
        assertEquals("allow", bash["npm run *"]?.jsonPrimitive?.content)
        assertEquals("deny", bash["rm *"]?.jsonPrimitive?.content)
    }

    @Test
    fun `convertAutoApproval - read permission`() {
        val settings = LegacySettings(null, null, null, alwaysAllowReadOnly = true, alwaysAllowReadOnlyOutsideWorkspace = true, null, null, null, null, null, null, null)
        val sel = MigrationAutoApprovalSelections(false, readPermission = true, false, false, false, false)
        val conv = LegacyMigrationConverters.convertAutoApproval(settings, sel, emptyList())
        val perm = conv.config!!["permission"]?.jsonObject!!
        assertEquals("allow", perm["read"]?.jsonPrimitive?.content)
        assertEquals("allow", perm["external_directory"]?.jsonPrimitive?.content)
    }

    @Test
    fun `convertAutoApproval - write permission`() {
        val settings = LegacySettings(null, null, null, null, null, alwaysAllowWrite = true, null, null, null, null, null, null)
        val sel = MigrationAutoApprovalSelections(false, false, writePermission = true, false, false, false)
        val conv = LegacyMigrationConverters.convertAutoApproval(settings, sel, emptyList())
        assertEquals("allow", conv.config!!["permission"]?.jsonObject?.get("edit")?.jsonPrimitive?.content)
    }

    private fun mcpOnlySettings(alwaysAllowMcp: Boolean?): LegacySettings = LegacySettings(
        autoApprovalEnabled = null,
        allowedCommands = null,
        deniedCommands = null,
        alwaysAllowReadOnly = null,
        alwaysAllowReadOnlyOutsideWorkspace = null,
        alwaysAllowWrite = null,
        alwaysAllowExecute = null,
        alwaysAllowMcp = alwaysAllowMcp,
        alwaysAllowModeSwitch = null,
        alwaysAllowSubtasks = null,
        language = null,
        autocomplete = null,
    )

    private val MCP_ONLY_SELECTION = MigrationAutoApprovalSelections(
        commandRules = false,
        readPermission = false,
        writePermission = false,
        executePermission = false,
        mcpPermission = true,
        taskPermission = false,
    )

    @Test
    fun `convertAutoApproval - mcp switch writes per-server keys`() {
        val conv = LegacyMigrationConverters.convertAutoApproval(
            mcpOnlySettings(true),
            MCP_ONLY_SELECTION,
            listOf("github", "my server"),
        )
        val perm = conv.config!!["permission"]?.jsonObject
        assertNotNull(perm)
        assertEquals("allow", perm["github_*"]?.jsonPrimitive?.content)
        assertEquals("allow", perm["my_server_*"]?.jsonPrimitive?.content)
        assertFalse(perm.containsKey("skill"))
        assertEquals(
            listOf(PermissionEntry("MCP permission", MigrationItemStatus.success)),
            conv.results,
        )
    }

    @Test
    fun `convertAutoApproval - mcp switch off writes ask`() {
        val conv = LegacyMigrationConverters.convertAutoApproval(
            mcpOnlySettings(false),
            MCP_ONLY_SELECTION,
            listOf("github"),
        )
        assertEquals("ask", conv.config!!["permission"]?.jsonObject?.get("github_*")?.jsonPrimitive?.content)
        assertEquals(
            listOf(PermissionEntry("MCP permission", MigrationItemStatus.success)),
            conv.results,
        )
    }

    @Test
    fun `convertAutoApproval - mcp switch unset with servers writes no key and reports success`() {
        val conv = LegacyMigrationConverters.convertAutoApproval(
            mcpOnlySettings(null),
            MCP_ONLY_SELECTION,
            listOf("github", "my server"),
        )
        assertNull(conv.config)
        assertEquals(
            listOf(PermissionEntry("MCP permission", MigrationItemStatus.success)),
            conv.results,
        )
    }

    @Test
    fun `convertAutoApproval - mcp switch without migrated servers warns with the reason`() {
        val conv = LegacyMigrationConverters.convertAutoApproval(
            mcpOnlySettings(true),
            MCP_ONLY_SELECTION,
            emptyList(),
        )
        assertNull(conv.config)
        assertEquals(
            listOf(
                PermissionEntry(
                    "MCP permission",
                    MigrationItemStatus.warning,
                    "MCP auto-approval was not applied: no MCP server was migrated",
                ),
            ),
            conv.results,
        )
    }

    @Test
    fun `convertAutoApproval - mcp switch unset without migrated servers reports success`() {
        val conv = LegacyMigrationConverters.convertAutoApproval(
            mcpOnlySettings(null),
            MCP_ONLY_SELECTION,
            emptyList(),
        )
        assertNull(conv.config)
        assertEquals(
            listOf(PermissionEntry("MCP permission", MigrationItemStatus.success)),
            conv.results,
        )
    }
}
