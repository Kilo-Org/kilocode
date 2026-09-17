package ai.kilocode.backend.rpc

import ai.kilocode.backend.app.KiloAppState
import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.testing.FakeCliServer
import ai.kilocode.backend.testing.MockCliServer
import ai.kilocode.backend.testing.TestLog
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class KiloMarketplaceRpcApiImplTest {

    private val mock = MockCliServer()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val json = Json { ignoreUnknownKeys = true }

    @AfterTest
    fun tearDown() {
        scope.cancel()
        mock.close()
    }

    @Test
    fun `list decodes items, folds installed keys, and passes through errors`() = runBlocking {
        mock.marketplaceList = """
            {
              "items": [
                {
                  "id": "context7",
                  "type": "mcp",
                  "name": "Context7",
                  "description": "Docs lookup",
                  "category": "tools",
                  "author": "Kilo",
                  "authorUrl": "https://kilo.ai",
                  "url": "https://github.com/example/context7",
                  "prerequisites": ["Node 18+"],
                  "parameters": [{"name":"API Key","key":"apiKey"}],
                  "content": [
                    {"name":"npx","content":"{\"command\":\"npx\"}","parameters":[{"name":"API Key","key":"apiKey","optional":false}]},
                    {"name":"docker","content":"{\"command\":\"docker\"}"}
                  ]
                },
                {
                  "id": "planner",
                  "type": "agent",
                  "name": "Planner",
                  "description": "Plans work",
                  "category": "agents",
                  "content": {"mode":"primary","description":"Plans","prompt":"Plan the work"}
                },
                {
                  "id": "review-skill",
                  "type": "skill",
                  "name": "Review Skill",
                  "description": "Reviews code",
                  "category": "skills",
                  "githubUrl": "https://github.com/example/review-skill",
                  "content": "https://example.com/review-skill.tar.gz"
                }
              ],
              "installed": {
                "project": {"agent:planner": {"type":"agent"}},
                "global": {"mcp:context7": {"type":"mcp"}}
              },
              "errors": ["skills catalog unavailable"]
            }
        """.trimIndent()
        val rpc = rpc()

        val result = rpc.list("/test project")

        assertEquals(listOf("skills catalog unavailable"), result.errors)
        assertEquals(3, result.items.size)

        val mcp = result.items.single { it.id == "context7" }
        assertEquals("mcp", mcp.type)
        assertTrue(mcp.installedGlobal)
        assertFalse(mcp.installedProject)
        assertEquals(listOf("npx", "docker"), mcp.methods.map { it.name })
        assertEquals(listOf("apiKey"), mcp.methods.first { it.name == "npx" }.parameters.map { it.key })
        assertEquals(listOf("apiKey"), mcp.parameters.map { it.key })
        assertEquals(listOf("Node 18+"), mcp.prerequisites)

        val agent = result.items.single { it.id == "planner" }
        assertEquals("agent", agent.type)
        assertTrue(agent.installedProject)
        assertFalse(agent.installedGlobal)
        assertTrue(agent.methods.isEmpty())
        val agentContent = json.parseToJsonElement(agent.content).jsonObject
        assertEquals("Plan the work", agentContent["prompt"]!!.jsonPrimitive.content)

        val skill = result.items.single { it.id == "review-skill" }
        assertEquals("skill", skill.type)
        assertFalse(skill.installedProject)
        assertFalse(skill.installedGlobal)
        assertEquals("https://github.com/example/review-skill", skill.githubUrl)
        assertEquals("\"https://example.com/review-skill.tar.gz\"", skill.content)

        assertEquals("directory=%2Ftest+project", mock.lastMarketplaceListPath?.substringAfter("?"))
    }

    @Test
    fun `list marks items relevant when a suggest_for filename pattern matches the workspace`() = runBlocking {
        val dir = Files.createTempDirectory("kilo-marketplace-relevance")
        try {
            Files.createDirectories(dir.resolve("src"))
            Files.writeString(dir.resolve("src/main.py"), "print('hi')")
            Files.createDirectories(dir.resolve("node_modules/some-pkg"))
            Files.writeString(dir.resolve("node_modules/some-pkg/Cargo.toml"), "[package]")
            mock.marketplaceList = """
                {
                  "items": [
                    {
                      "id": "python-agent", "type": "agent", "name": "Python Agent", "description": "d", "category": "c",
                      "content": {"mode":"primary"},
                      "suggest_for": {"filename": ["*.py"]}
                    },
                    {
                      "id": "rust-agent", "type": "agent", "name": "Rust Agent", "description": "d", "category": "c",
                      "content": {"mode":"primary"},
                      "suggest_for": {"filename": ["Cargo.toml"]}
                    },
                    {
                      "id": "go-agent", "type": "agent", "name": "Go Agent", "description": "d", "category": "c",
                      "content": {"mode":"primary"},
                      "suggest_for": {"filename": ["go.mod"]}
                    },
                    {
                      "id": "generic-agent", "type": "agent", "name": "Generic Agent", "description": "d", "category": "c",
                      "content": {"mode":"primary"}
                    }
                  ],
                  "installed": {"project":{}, "global":{}}
                }
            """.trimIndent()
            val rpc = rpc()

            val result = rpc.list(dir.toString())

            assertTrue(result.items.single { it.id == "python-agent" }.relevant)
            assertFalse(result.items.single { it.id == "rust-agent" }.relevant, "Cargo.toml only exists under node_modules, which is excluded")
            assertFalse(result.items.single { it.id == "go-agent" }.relevant)
            assertFalse(result.items.single { it.id == "generic-agent" }.relevant, "items without suggest_for are never relevant")
        } finally {
            dir.toFile().deleteRecursively()
        }
    }

    @Test
    fun `install replays item content verbatim and forwards target and parameters`() = runBlocking {
        mock.marketplaceList = """
            {"items":[{
              "id":"context7","type":"mcp","name":"Context7","description":"Docs lookup","category":"tools",
              "content":[{"name":"npx","content":"{\"command\":\"npx\"}"},{"name":"docker","content":"{\"command\":\"docker\"}"}]
            }],"installed":{"project":{},"global":{}}}
        """.trimIndent()
        mock.marketplaceInstallResult = """{"success":true,"slug":"context7","filePath":"/tmp/kilo.json","line":1}"""
        val rpc = rpc()
        val item = rpc.list("/test").items.single()

        val result = rpc.install("/test", item, "global", mapOf("apiKey" to "secret", "__method" to "npx"))

        assertTrue(result.success)
        assertEquals("context7", result.slug)
        assertEquals("/tmp/kilo.json", result.filePath)
        assertEquals(1, result.line)

        val payload = json.parseToJsonElement(mock.lastMarketplaceInstallBody!!).jsonObject
        assertEquals("global", payload["target"]!!.jsonPrimitive.content)
        val sentItem = payload["item"]!!.jsonObject
        assertEquals("mcp", sentItem["type"]!!.jsonPrimitive.content)
        assertEquals("context7", sentItem["id"]!!.jsonPrimitive.content)
        val content = sentItem["content"]!!.jsonArray
        assertEquals(2, content.size)
        assertEquals("npx", content[0].jsonObject["name"]!!.jsonPrimitive.content)
        assertEquals("docker", content[1].jsonObject["name"]!!.jsonPrimitive.content)
        val params = payload["parameters"]!!.jsonObject
        assertEquals("secret", params["apiKey"]!!.jsonPrimitive.content)
        assertEquals("npx", params["__method"]!!.jsonPrimitive.content)
    }

    @Test
    fun `install surfaces a CLI-reported failure without throwing`() = runBlocking {
        mock.marketplaceList = """
            {"items":[{"id":"context7","type":"mcp","name":"Context7","description":"d","category":"c","content":"{}"}],
             "installed":{"project":{},"global":{}}}
        """.trimIndent()
        mock.marketplaceInstallResult = """{"success":false,"slug":"context7","error":"MCP server already installed. Remove it first."}"""
        val rpc = rpc()
        val item = rpc.list("/test").items.single()

        val result = rpc.install("/test", item, "project", emptyMap())

        assertFalse(result.success)
        assertEquals("MCP server already installed. Remove it first.", result.error)
    }

    @Test
    fun `install result parsing tolerates a payload missing optional fields`() = runBlocking {
        mock.marketplaceList = """
            {"items":[{"id":"context7","type":"mcp","name":"Context7","description":"d","category":"c","content":"{}"}],
             "installed":{"project":{},"global":{}}}
        """.trimIndent()
        mock.marketplaceInstallResult = """{"success":true,"slug":"context7"}"""
        val rpc = rpc()
        val item = rpc.list("/test").items.single()

        val result = rpc.install("/test", item, "project", emptyMap())

        assertTrue(result.success)
        assertEquals("context7", result.slug)
        assertNull(result.error)
        assertNull(result.filePath)
        assertNull(result.line)
    }

    @Test
    fun `a result payload without success is treated as a failure rather than throwing`() = runBlocking {
        mock.marketplaceRemoveResult = """{}"""
        val rpc = rpc()

        val result = rpc.remove("/test", "planner", "agent", "project")

        assertFalse(result.success)
        assertEquals("", result.slug)
    }

    @Test
    fun `remove sends item id, type, and scope`() = runBlocking {
        mock.marketplaceRemoveResult = """{"success":true,"slug":"planner"}"""
        val rpc = rpc()

        val result = rpc.remove("/test", "planner", "agent", "project")

        assertTrue(result.success)
        val payload = json.parseToJsonElement(mock.lastMarketplaceRemoveBody!!).jsonObject
        assertEquals("project", payload["scope"]!!.jsonPrimitive.content)
        val item = payload["item"]!!.jsonObject
        assertEquals("planner", item["id"]!!.jsonPrimitive.content)
        assertEquals("agent", item["type"]!!.jsonPrimitive.content)
    }

    private suspend fun rpc(): KiloMarketplaceRpcApiImpl = KiloMarketplaceRpcApiImpl(app())

    private suspend fun app(): KiloBackendAppService {
        val app = KiloBackendAppService.create(scope, FakeCliServer(mock), TestLog())
        app.connect()
        withTimeout(10_000) {
            app.appState.first { it is KiloAppState.Ready }
        }
        return app
    }
}
