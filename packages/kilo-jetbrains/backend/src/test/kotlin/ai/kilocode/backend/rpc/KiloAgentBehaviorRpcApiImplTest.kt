package ai.kilocode.backend.rpc

import ai.kilocode.backend.app.KiloAppState
import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.testing.FakeCliServer
import ai.kilocode.backend.testing.MockCliServer
import ai.kilocode.backend.testing.TestLog
import ai.kilocode.rpc.dto.AgentCreateDto
import ai.kilocode.rpc.dto.McpConfigDto
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class KiloAgentBehaviorRpcApiImplTest {

    private val mock = MockCliServer()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    @AfterTest
    fun tearDown() {
        scope.cancel()
        mock.close()
    }

    @Test
    fun `agents merges SDK data with removable flags`() = runBlocking {
        mock.agents = """[
            {"name":"custom","displayName":"Custom","description":"Editable","mode":"primary","native":false,"source":"project","options":{}},
            {"name":"org","displayName":"Org","mode":"subagent","options":{"source":"organization"}},
            {"name":"builtin","displayName":"Builtin","mode":"all","native":true,"options":{}}
        ]""".trimIndent()
        val rpc = rpc()

        val agents = rpc.agents("/test")

        assertEquals(listOf("custom", "org", "builtin"), agents.map { it.name })
        assertEquals(true, agents.single { it.name == "custom" }.removable)
        assertEquals(false, agents.single { it.name == "org" }.removable)
        assertEquals(false, agents.single { it.name == "builtin" }.removable)
    }

    @Test
    fun `create and remove agent call CLI endpoints`() = runBlocking {
        val rpc = rpc()

        assertTrue(rpc.createAgent("/test project", AgentCreateDto(
            name = "custom",
            prompt = "Use the project conventions",
            mode = "subagent",
            description = "Project helper",
            scope = "global",
        )))
        assertEquals("PUT", mock.lastAgentBuilderMethod)
        assertContains(mock.lastAgentBuilderPath.orEmpty(), "/agent-builder/custom")
        assertContains(mock.lastAgentBuilderPath.orEmpty(), "directory=%2Ftest%20project")
        assertContains(mock.lastAgentBuilderBody.orEmpty(), "\"prompt\":\"Use the project conventions\"")
        assertContains(mock.lastAgentBuilderBody.orEmpty(), "\"scope\":\"global\"")

        assertTrue(rpc.removeAgent("/test", "custom"))
        assertEquals("{\"name\":\"custom\"}", mock.lastAgentRemoveBody)

        mock.agentRemoveStatus = 400
        val err = assertFailsWith<RuntimeException> {
            rpc.removeAgent("/test", "missing")
        }
        assertContains(err.message.orEmpty(), "HTTP 400")
    }

    @Test
    fun `skills and remove skill call CLI endpoints`() = runBlocking {
        val dir = Files.createTempDirectory("kilo-skill-test")
        val file = Files.createDirectories(dir.resolve("plan")).resolve("SKILL.md")
        val content = """---
            |name: plan
            |description: Plan work
            |---
            |
            |# Fresh Plan
        """.trimMargin()
        Files.writeString(file, content)
        mock.skills = """[
            {"name":"plan","description":"Plan work","location":"$file","content":"# Stale Plan"},
            {"name":"builtin","location":"builtin"}
        ]""".trimIndent()
        val rpc = rpc()

        val skills = rpc.skills("/test project")
        assertEquals(listOf("plan", "builtin"), skills.map { it.name })
        assertEquals("Plan work", skills.single { it.name == "plan" }.description)
        assertEquals(content, skills.single { it.name == "plan" }.content)
        assertEquals(true, skills.single { it.name == "plan" }.editable)
        assertEquals(false, skills.single { it.name == "builtin" }.editable)

        assertTrue(rpc.removeSkill("/test project", file.toString()))
        assertEquals("{\"location\":\"$file\"}", mock.lastSkillRemoveBody)
        assertEquals(1, mock.requestCount("/kilocode/skill/remove"))

        mock.skillRemoveStatus = 400
        val err = assertFailsWith<RuntimeException> {
            rpc.removeSkill("/test", "/tmp/missing/SKILL.md")
        }
        assertContains(err.message.orEmpty(), "HTTP 400")

        assertTrue(rpc.reloadSkills("/test project"))
        assertEquals(1, mock.requestCount("/instance/reload"))
    }

    @Test
    fun `url cached skills are read only`() = runBlocking {
        val cache = Path.of(System.getProperty("user.home"), ".cache", "kilo", "skills", "remote")
        val file = Files.createDirectories(cache).resolve("SKILL.md")
        Files.writeString(file, "# Remote")
        mock.skills = """[
            {"name":"remote","description":"Remote","location":"$file","content":"# Remote"}
        ]""".trimIndent()

        val skill = rpc().skills("/test project").single()

        assertEquals(false, skill.editable)
        assertEquals("# Remote", skill.content)
    }

    @Test
    fun `save skill supports configured markdown text and html files without reload`() = runBlocking {
        val dir = Files.createTempDirectory("kilo-skill-test")
        val file = dir.resolve("test.md")
        Files.writeString(file, "old")
        mock.skills = """[
            {"name":"test","description":"Test","location":"$file","content":"old"}
        ]""".trimIndent()
        val rpc = rpc()

        assertTrue(rpc.saveSkill("/test project", file.toString(), "new content"))
        assertEquals("new content", Files.readString(file))
        assertEquals(0, mock.requestCount("/instance/reload"))
    }

    @Test
    fun `save skill writes content without reloading instance`() = runBlocking {
        val dir = Files.createTempDirectory("kilo-skill-test")
        val file = Files.createDirectories(dir.resolve("plan")).resolve("SKILL.md")
        Files.writeString(file, "old")
        mock.skills = """[
            {"name":"plan","description":"Plan work","location":"$file","content":"old"}
        ]""".trimIndent()
        val rpc = rpc()

        assertTrue(rpc.saveSkill("/test project", file.toString(), "new content"))

        assertEquals("new content", Files.readString(file))
        assertEquals(0, mock.requestCount("/instance/reload"))
        assertFalse(rpc.saveSkill("/test project", "builtin", "nope"))
    }

    @Test
    fun `save skill rejects unknown absolute skill files`() = runBlocking {
        val dir = Files.createTempDirectory("kilo-skill-test")
        val known = Files.createDirectories(dir.resolve("known")).resolve("SKILL.md")
        val other = Files.createDirectories(dir.resolve("other")).resolve("SKILL.md")
        Files.writeString(known, "known")
        Files.writeString(other, "old")
        mock.skills = """[
            {"name":"known","description":"Known","location":"$known","content":"known"}
        ]""".trimIndent()

        assertFalse(rpc().saveSkill("/test project", other.toString(), "new content"))

        assertEquals("old", Files.readString(other))
    }

    @Test
    fun `reload skills is blocked by pending permissions`() = runBlocking {
        mock.pendingPermissions = """[
            {"id":"per_test","sessionID":"ses_test","permission":"bash","patterns":["*"],"metadata":{}}
        ]""".trimIndent()
        val rpc = rpc()

        assertFalse(rpc.reloadSkills("/test project"))

        assertEquals(1, mock.requestCount("/permission"))
        assertEquals(0, mock.requestCount("/instance/reload"))
    }

    @Test
    fun `mcp config writes global and workspace patches`() = runBlocking {
        mock.config = """{"mcp":{"global":{"type":"local","command":["node","g.js"]}}}"""
        mock.workspaceConfig = """{"mcp":{"workspace":{"type":"remote","url":"https://workspace.test"}}}"""
        val rpc = rpc()

        val initial = rpc.mcpConfig("/test dir")
        assertEquals(setOf("global", "workspace"), initial.keys)
        assertEquals("global", initial["global"]?.scope)
        assertEquals("workspace", initial["workspace"]?.scope)

        assertTrue(rpc.saveMcp("/test dir", "global-added", "global", McpConfigDto(
            type = "local",
            command = listOf("node", "server.js"),
            environment = mapOf("TOKEN" to "x"),
        )))
        assertContains(mock.lastConfigPatchBody.orEmpty(), "\"global-added\"")
        assertContains(mock.lastConfigPatchBody.orEmpty(), "\"environment\":{\"TOKEN\":\"x\"}")
        assertEquals("local", rpc.mcpConfig("/test dir")["global"]?.config?.type)
        assertEquals("local", rpc.mcpConfig("/test dir")["global-added"]?.config?.type)

        assertTrue(rpc.saveMcp("/test dir", "workspace-added", "workspace", McpConfigDto(
            type = "remote",
            url = "https://mcp.example.test",
            headers = mapOf("Authorization" to "Bearer t"),
        )))
        assertEquals("/config?directory=%2Ftest+dir", mock.lastWorkspaceConfigPatchPath)
        assertContains(mock.lastWorkspaceConfigPatchBody.orEmpty(), "\"workspace-added\"")
        assertEquals("workspace", rpc.mcpConfig("/test dir")["workspace-added"]?.scope)

        assertTrue(rpc.saveMcp("/test dir", "shared", "workspace", McpConfigDto(type = "remote", url = "https://workspace.test")))
        assertEquals("workspace", rpc.mcpConfig("/test dir")["shared"]?.scope)
        assertTrue(rpc.saveMcp("/test dir", "shared", "global", McpConfigDto(type = "local", command = listOf("node", "shared.js"))))
        assertEquals("global", rpc.mcpConfig("/test dir")["shared"]?.scope)

        assertTrue(rpc.saveMcp("/test dir", "workspace-added", "workspace", null))
        assertContains(mock.lastWorkspaceConfigPatchBody.orEmpty(), "\"workspace-added\":null")
        assertFalse(rpc.mcpConfig("/test dir").containsKey("workspace-added"))
    }

    @Test
    fun `mcp status and actions call CLI endpoints`() = runBlocking {
        mock.mcp = """{"local":{"status":"connected"},"remote":{"state":"disconnected","error":"missing auth"}}"""
        val rpc = rpc()

        val status = rpc.mcpStatus("/test")
        assertEquals("connected", status.single { it.name == "local" }.status)
        assertEquals("missing auth", status.single { it.name == "remote" }.error)

        assertTrue(rpc.mcpConnect("/test", "local server"))
        assertContains(mock.lastMcpActionPath.orEmpty(), "/mcp/local%20server/connect")
        assertTrue(rpc.mcpDisconnect("/test", "local server"))
        assertContains(mock.lastMcpActionPath.orEmpty(), "/mcp/local%20server/disconnect")
        assertTrue(rpc.mcpAuthenticate("/test", "local server"))
        assertContains(mock.lastMcpActionPath.orEmpty(), "/mcp/local%20server/auth/authenticate")
    }

    private suspend fun rpc(): KiloAgentBehaviorRpcApiImpl = KiloAgentBehaviorRpcApiImpl(app())

    private suspend fun app(): KiloBackendAppService {
        val app = KiloBackendAppService.create(scope, FakeCliServer(mock), TestLog())
        app.connect()
        withTimeout(10_000) {
            app.appState.first { it is KiloAppState.Ready }
        }
        return app
    }
}
