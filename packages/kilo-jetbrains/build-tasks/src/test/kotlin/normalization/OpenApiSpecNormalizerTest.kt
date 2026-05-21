package normalization

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.gradle.api.GradleException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class OpenApiSpecNormalizerTest {
    @Test
    fun `renames configured duplicate tags and linked operations`() {
        val raw = """
            {
              "paths": {
                "/pty": {
                  "get": {
                    "tags": ["pty"],
                    "operationId": "pty.list"
                  }
                },
                "/pty/{ptyID}/connect": {
                  "get": {
                    "tags": ["pty"],
                    "operationId": "pty.connect"
                  }
                }
              },
              "tags": [
                { "name": "pty", "description": "PTY routes." },
                { "name": "pty", "description": "PTY WebSocket route." }
              ]
            }
        """.trimIndent()

        val root = obj(OpenApiSpecNormalizer.normalize(raw))
        val tags = arr(root["tags"]).map { text(obj(it)["name"]) }
        val paths = obj(root["paths"])
        val pty = obj(obj(paths["/pty"])["get"])
        val link = obj(obj(paths["/pty/{ptyID}/connect"])["get"])

        assertEquals(listOf("pty", "pty-connect"), tags)
        assertEquals(listOf("pty"), arr(pty["tags"]).map(::text))
        assertEquals(listOf("pty-connect"), arr(link["tags"]).map(::text))
    }

    @Test
    fun `keeps specs without duplicate configured tags unchanged`() {
        val raw = """
            {
              "tags": [
                { "name": "pty", "description": "PTY routes." }
              ]
            }
        """.trimIndent()

        assertEquals(raw, OpenApiSpecNormalizer.normalize(raw))
    }

    @Test
    fun `fails when configured operation for renamed tag is absent`() {
        val raw = """
            {
              "paths": {},
              "tags": [
                { "name": "pty", "description": "PTY routes." },
                { "name": "pty", "description": "PTY WebSocket route." }
              ]
            }
        """.trimIndent()

        val err = assertFailsWith<GradleException> {
            OpenApiSpecNormalizer.normalize(raw)
        }

        assertTrue(err.message?.contains("Expected one OpenAPI operation 'pty.connect'") == true)
    }

    private fun obj(raw: String) = Json.parseToJsonElement(raw) as JsonObject

    private fun obj(element: JsonElement?) = element as JsonObject

    private fun arr(element: JsonElement?) = element as JsonArray

    private fun text(element: JsonElement?) = (element as JsonPrimitive).content
}
