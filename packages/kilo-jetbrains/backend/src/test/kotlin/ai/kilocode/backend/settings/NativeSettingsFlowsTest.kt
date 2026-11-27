package ai.kilocode.backend.settings

import ai.kilocode.backend.app.KiloAccountSettings
import ai.kilocode.backend.marketplace.KiloBackendMarketplaceManager
import ai.kilocode.backend.provider.KiloBackendProviderSettingsManager
import ai.kilocode.backend.rpc.KiloAgentBehaviorRpcApiImpl
import ai.kilocode.backend.v2.V2Client
import ai.kilocode.rpc.dto.*
import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.nio.file.Files
import kotlin.test.*
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*

class NativeSettingsFlowsTest {
    private fun serve(
        handler: (HttpExchange, JsonObject) -> JsonElement,
        block: suspend (V2Client) -> Unit,
    ) = runBlocking {
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { exchange ->
            try {
                val bytes = exchange.requestBody.reader().readText()
                val out =
                    handler(
                        exchange,
                        if (bytes.isEmpty()) emptyObject
                        else Json.parseToJsonElement(bytes).jsonObject,
                    )
                val response = out.toString().toByteArray()
                exchange.sendResponseHeaders(200, response.size.toLong())
                exchange.responseBody.use { it.write(response) }
            } catch (e: Throwable) {
                exchange.sendResponseHeaders(500, 0)
                exchange.responseBody.use { it.write(e.toString().toByteArray()) }
            }
        }
        server.start()
        try {
            block(V2Client("http://127.0.0.1:${server.address.port}", "Basic fixture"))
        } finally {
            server.stop(0)
        }
    }

    private fun data(raw: String) = buildJsonObject { put("data", Json.parseToJsonElement(raw)) }

    private fun output(raw: String) = buildJsonObject {
        put("output", Json.parseToJsonElement(raw))
    }

    @Test
    fun `gateway sign in displays the user code rather than the poll code and loads the active team`() =
        serve({ exchange, body ->
            when (exchange.requestURI.path) {
                "/api/integration/kilo" ->
                    data("""{"methods":[{"id":"gateway-device","type":"oauth"}]}""")
                "/api/integration/kilo/connect/oauth" -> {
                    assertEquals("gateway-device", body.text("methodID"))
                    data(
                        """{"attemptID":"attempt","mode":"auto","url":"https://example.org/device?code=USER-CODE","instructions":"Enter code: polling-code","time":{"expires":${System.currentTimeMillis()+60000}}}"""
                    )
                }
                "/api/integration/kilo/connect/oauth/attempt" -> data("""{"status":"complete"}""")
                "/api/rpc/kilocode.gateway/authStatus" -> output("""{"authenticated":true}""")
                "/api/rpc/kilocode.gateway/profile" ->
                    output(
                        """{"email":"fixture@example.org","name":"Fixture","hasPersonalAccount":true,"organizationID":"team","organizations":[{"id":"team","name":"Team","role":"member"}]}"""
                    )
                "/api/rpc/kilocode.gateway/balance" -> output("""{"balance":10.5}""")
                "/api/rpc/kilocode.gateway/kiloPass" -> output("null")
                else -> error(exchange.requestURI.path)
            }
        }) { api ->
            val account = KiloAccountSettings { api }
            assertEquals("USER-CODE", account.startLogin("/repo").code)
            val profile = assertNotNull(account.completeLogin("/repo"))
            assertEquals("team", profile.currentOrgId)
            assertEquals(10.5, profile.balance?.balance)
        }

    @Test
    fun `custom model fetch sends the stored key only to its saved provider URL`() =
        serve({ exchange, _ ->
            val url = "http://127.0.0.1:${exchange.localAddress.port}/saved"
            when (exchange.requestURI.path) {
                "/api/provider" -> data("""[{"id":"fixture","settings":{"baseURL":"$url"}}]""")
                "/api/credential" ->
                    data(
                        """[{"integrationID":"fixture","active":true,"value":{"type":"key","key":"fixture-key"}}]"""
                    )
                "/saved/models" -> {
                    assertEquals(
                        "Bearer fixture-key",
                        exchange.requestHeaders.getFirst("Authorization"),
                    )
                    data("""[{"id":"saved"}]""")
                }
                "/changed/models" -> {
                    assertNull(exchange.requestHeaders.getFirst("Authorization"))
                    data("""[{"id":"changed"}]""")
                }
                else -> error(exchange.requestURI.path)
            }
        }) { api ->
            val base =
                api.data("provider.list")
                    .jsonArray
                    .single()
                    .jsonObject
                    .obj("settings")
                    .required("baseURL")
            val req = CustomModelFetchDto(base, "/repo", "fixture")
            val manager = KiloBackendProviderSettingsManager { api }
            assertEquals(listOf("saved"), manager.fetch(req, emptyMap()).models)
            assertEquals(
                listOf("changed"),
                manager
                    .fetch(req.copy(baseUrl = base.removeSuffix("saved") + "changed"), emptyMap())
                    .models,
            )
        }

    @Test
    fun `commands can edit scoped manifests but not files elsewhere in the project`() {
        val repo = Files.createTempDirectory("kilo-command-manifest").toRealPath()
        try {
            val command = repo.resolve(".kilo2/commands/fixture.md")
            val other = repo.resolve("unrelated.md")
            Files.writeString(other, "original")
            serve({ exchange, _ ->
                when (exchange.requestURI.path) {
                    "/api/rpc/kilocode.settings/target" ->
                        buildJsonObject {
                            put(
                                "output",
                                buildJsonObject {
                                    put("path", repo.resolve("global/kilo2.json").toString())
                                },
                            )
                        }
                    "/api/command" ->
                        data(
                            """[{"name":"fixture","description":"Fixture"},{"name":"builtin","template":"read only"}]"""
                        )
                    else -> error(exchange.requestURI.path)
                }
            }) { api ->
                val behavior = KiloAgentBehaviorRpcApiImpl { api }
                assertFalse(
                    behavior.saveCommands(repo.toString(), mapOf(other.toString() to "changed"))
                )
                assertTrue(
                    behavior.saveCommands(repo.toString(), mapOf(command.toString() to "body"))
                )
                val files = behavior.commandFiles(repo.toString()).associateBy { it.name }
                assertTrue(files.getValue("fixture").editable)
                assertEquals("body", files.getValue("fixture").content)
                assertTrue(files.getValue("builtin").builtin)
                assertFalse(behavior.removeCommand(repo.toString(), other.toString()))
                assertTrue(behavior.removeCommand(repo.toString(), command.toString()))
                assertEquals("original", Files.readString(other))
            }
        } finally {
            repo.toFile().deleteRecursively()
        }
    }

    @Test
    fun `MCP OAuth presents the URL and uses the discovered integration and attempt in that location`() =
        serve({ exchange, body ->
            assertEquals("location[directory]=/repo", exchange.requestURI.query)
            when (exchange.requestURI.path) {
                "/api/mcp" ->
                    data(
                        """[{"name":"fixture","integrationID":"scoped-id","status":{"status":"connected"}}]"""
                    )
                "/api/integration/scoped-id" ->
                    data("""{"methods":[{"id":"method-id","type":"oauth"}]}""")
                "/api/integration/scoped-id/connect/oauth" -> {
                    assertEquals("method-id", body.text("methodID"))
                    data(
                        """{"attemptID":"attempt-id","url":"https://example.org/sign-in","mode":"auto"}"""
                    )
                }
                "/api/integration/scoped-id/connect/oauth/attempt-id" ->
                    data("""{"status":"complete"}""")
                "/api/experimental/mcp/fixture/connect" -> JsonNull
                else -> error(exchange.requestURI.path)
            }
        }) { api ->
            val behavior = KiloAgentBehaviorRpcApiImpl { api }
            kotlinx.coroutines.coroutineScope {
                val url =
                    async(start = CoroutineStart.UNDISPATCHED) { behavior.mcpAuthEvents().first() }
                assertEquals("connected", behavior.mcpAuthenticate("/repo", "fixture").status)
                assertEquals(
                    McpAuthEventDto("fixture", "https://example.org/sign-in", true),
                    url.await(),
                )
            }
        }

    @Test
    fun `marketplace install references the registry item and selected option rather than replaying content`() =
        serve({ exchange, body ->
            val input = body.obj("input")
            when (exchange.requestURI.path) {
                "/api/rpc/kilocode.marketplace/list" ->
                    if (input.text("kind") != "mcp") output("""{"items":[],"failures":[]}""")
                    else
                        output(
                            """{"items":[{"registry":"catalog","kind":"mcp","id":"sample","name":"Sample","description":"test","options":[{"name":"remote","parameters":[]}]}],"failures":[]}"""
                        )
                "/api/rpc/kilocode.marketplace/installed" ->
                    output(
                        """[{"registry":"catalog","kind":"mcp","id":"sample","scope":"global"}]"""
                    )
                "/api/rpc/kilocode.marketplace/install" -> {
                    assertEquals("catalog", input.text("registry"))
                    assertEquals("remote", input.text("option"))
                    assertEquals(mapOf("host" to "localhost").asJson(), input.obj("params"))
                    assertNull(input["content"])
                    output("""{"id":"sample"}""")
                }
                "/api/rpc/kilocode.marketplace/uninstall" -> {
                    assertEquals("global", input.text("scope"))
                    output("{}")
                }
                else -> error(exchange.requestURI.path)
            }
        }) { api ->
            val marketplace = KiloBackendMarketplaceManager { api }
            val item = marketplace.list("/repo").items.single()
            assertTrue(item.installedGlobal)
            assertFalse(item.installedProject)
            assertTrue(
                marketplace
                    .install(
                        "/repo",
                        item,
                        "project",
                        mapOf("__method" to "remote", "host" to "localhost"),
                    )
                    .success
            )
            assertTrue(marketplace.remove("/repo", item.id, item.type, "global").success)
        }

    @Test
    fun `partial MCP settings patch and authentication removal preserve other fields`() {
        assertEquals(
            """{"disabled":true}""",
            McpSettingsCodec.write(McpConfigDto(enabled = false)).toString(),
        )
        assertEquals(
            JsonNull,
            McpSettingsCodec.write(McpConfigDto(oauth = McpOAuthDto(clear = true)))["oauth"],
        )
        val server =
            McpConfigDto(
                "remote",
                url = "https://example.org",
                oauth = McpOAuthDto(true, "id", "secret", scope = "read", callbackPort = 1234),
            )
        assertEquals(server, McpSettingsCodec.read(McpSettingsCodec.write(server)))
    }
}
