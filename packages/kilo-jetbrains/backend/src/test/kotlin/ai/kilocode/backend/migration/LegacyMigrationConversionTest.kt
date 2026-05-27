package ai.kilocode.backend.migration

import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Tests for provider, MCP, custom-mode, and settings conversion logic.
 */
class LegacyMigrationConversionTest {

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
        val result = LegacyMigrationConverters.convertCustomMode(mode)
        assertEquals("Short desc", result["description"]?.jsonPrimitive?.content)
        assertEquals("primary", result["mode"]?.jsonPrimitive?.content)
        assertTrue(result["prompt"]?.jsonPrimitive?.content?.contains("You are helpful.") == true)
    }

    @Test
    fun `convertCustomMode - description falls back to whenToUse`() {
        val mode = LegacyCustomMode("s", "N", "Role", null, "When to use", null, listOf())
        val result = LegacyMigrationConverters.convertCustomMode(mode)
        assertEquals("When to use", result["description"]?.jsonPrimitive?.content)
    }

    @Test
    fun `convertCustomMode - description falls back to roleDefinition truncated`() {
        val role = "X".repeat(200)
        val mode = LegacyCustomMode("s", "N", role, null, null, null, listOf())
        val result = LegacyMigrationConverters.convertCustomMode(mode)
        assertEquals(120, result["description"]?.jsonPrimitive?.content?.length)
    }

    @Test
    fun `convertCustomMode - customInstructions appended to prompt`() {
        val mode = LegacyCustomMode("s", "N", "Role.", "Custom extra.", null, null, listOf())
        val prompt = LegacyMigrationConverters.convertCustomMode(mode)["prompt"]?.jsonPrimitive?.content!!
        assertTrue(prompt.contains("Role."))
        assertTrue(prompt.contains("Custom extra."))
        assertTrue(prompt.contains("USER'S CUSTOM INSTRUCTIONS"))
    }

    @Test
    fun `convertCustomModePermissions - read edit groups`() {
        val groups: List<Any> = listOf("read", "edit")
        val perm = LegacyMigrationConverters.convertCustomModePermissions(groups)
        assertEquals("allow", perm["read"]?.jsonPrimitive?.content)
        assertEquals("allow", perm["edit"]?.jsonPrimitive?.content)
        assertEquals("deny", perm["bash"]?.jsonPrimitive?.content)
        assertEquals("deny", perm["skill"]?.jsonPrimitive?.content)
    }

    @Test
    fun `convertCustomModePermissions - browser and command both map to bash`() {
        val groups: List<Any> = listOf("browser", "command")
        val perm = LegacyMigrationConverters.convertCustomModePermissions(groups)
        assertEquals("allow", perm["bash"]?.jsonPrimitive?.content)
    }

    @Test
    fun `convertCustomModePermissions - mcp maps to skill`() {
        val perm = LegacyMigrationConverters.convertCustomModePermissions(listOf("mcp"))
        assertEquals("allow", perm["skill"]?.jsonPrimitive?.content)
    }

    @Test
    fun `convertCustomModePermissions - fileRegex produces object permission`() {
        val groups: List<Any> = listOf(Pair("edit", mapOf("fileRegex" to "\\.md$")))
        val perm = LegacyMigrationConverters.convertCustomModePermissions(groups)
        val editPerm = perm["edit"]?.jsonObject
        assertNotNull(editPerm)
        assertEquals("allow", editPerm["\\.md$"]?.jsonPrimitive?.content)
        assertEquals("deny", editPerm["*"]?.jsonPrimitive?.content)
    }

    // -----------------------------------------------------------------------
    // Auto-approval
    // -----------------------------------------------------------------------

    @Test
    fun `convertAutoApproval - master allow with no command lists writes scalar allow`() {
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
        val conv = LegacyMigrationConverters.convertAutoApproval(settings, sel)
        assertNotNull(conv.config)
        assertEquals("allow", conv.config!!["permission"]?.jsonPrimitive?.content)
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
        val conv = LegacyMigrationConverters.convertAutoApproval(settings, sel)
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
        val conv = LegacyMigrationConverters.convertAutoApproval(settings, sel)
        val perm = conv.config!!["permission"]?.jsonObject!!
        assertEquals("allow", perm["read"]?.jsonPrimitive?.content)
        assertEquals("allow", perm["external_directory"]?.jsonPrimitive?.content)
    }

    @Test
    fun `convertAutoApproval - write permission`() {
        val settings = LegacySettings(null, null, null, null, null, alwaysAllowWrite = true, null, null, null, null, null, null)
        val sel = MigrationAutoApprovalSelections(false, false, writePermission = true, false, false, false)
        val conv = LegacyMigrationConverters.convertAutoApproval(settings, sel)
        assertEquals("allow", conv.config!!["permission"]?.jsonObject?.get("edit")?.jsonPrimitive?.content)
    }
}
