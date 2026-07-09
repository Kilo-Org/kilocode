package normalization

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class OpenApiSpecNormalizerTest {
    @Test
    fun `strips tags from all operations`() {
        val raw = """
            {
              "paths": {
                "/pty": {
                  "get": {
                    "tags": ["pty"],
                    "operationId": "pty.list"
                  }
                },
                "/session": {
                  "post": {
                    "tags": ["session"],
                    "operationId": "session.create"
                  }
                }
              }
            }
        """.trimIndent()

        val root = obj(OpenApiSpecNormalizer.normalize(raw))
        val paths = obj(root["paths"])
        val pty = obj(obj(paths["/pty"])["get"])
        val session = obj(obj(paths["/session"])["post"])

        assertNull(pty["tags"], "tags should be stripped from pty operation")
        assertNull(session["tags"], "tags should be stripped from session operation")
    }

    @Test
    fun `leaves operations without tags unchanged`() {
        val raw = """
            {
              "paths": {
                "/health": {
                  "get": {
                    "operationId": "health.get"
                  }
                }
              }
            }
        """.trimIndent()

        val root = obj(OpenApiSpecNormalizer.normalize(raw))
        val paths = obj(root["paths"])
        val health = obj(obj(paths["/health"])["get"])

        assertNull(health["tags"])
        assertEquals("health.get", text(health["operationId"]))
    }

    @Test
    fun `removes dot schemas and rewrites refs to camelCase equivalents`() {
        val raw = """
            {
              "paths": {
                "/tui/publish": {
                  "post": {
                    "requestBody": {
                      "content": {
                        "application/json": {
                          "schema": {
                            "${'$'}ref": "#/components/schemas/Event.tui.command.execute"
                          }
                        }
                      }
                    }
                  }
                }
              },
              "components": {
                "schemas": {
                  "EventTuiCommandExecute": { "type": "object" },
                  "Event.tui.command.execute": { "type": "object" },
                  "Session": { "type": "object" }
                }
              }
            }
        """.trimIndent()

        val root = obj(OpenApiSpecNormalizer.normalize(raw))
        val schemas = obj(obj(root["components"])["schemas"])

        assertNull(schemas["Event.tui.command.execute"], "dot schema should be removed")
        assert("EventTuiCommandExecute" in schemas) { "camelCase schema should be kept" }
        assert("Session" in schemas) { "non-dot schema should be kept" }

        // Check that the $ref was rewritten
        val post = obj(obj(obj(obj(root["paths"])["/tui/publish"])["post"])["requestBody"])
        val schema = obj(obj(obj(post["content"])["application/json"])["schema"])
        assertEquals("#/components/schemas/EventTuiCommandExecute", text(schema["\$ref"]))
    }

    @Test
    fun `makes nullable profile fields nullable in kilo profile response`() {
        val raw = """
            {
              "paths": {
                "/kilo/profile": {
                  "get": {
                    "operationId": "kilo.profile",
                    "responses": {
                      "200": {
                        "content": {
                          "application/json": {
                            "schema": {
                              "type": "object",
                              "properties": {
                                "profile": { "type": "object", "properties": { "email": { "type": "string" } }, "required": ["email"], "additionalProperties": false },
                                "balance": { "type": "object", "properties": { "balance": { "type": "number" } }, "required": ["balance"], "additionalProperties": false },
                                "kiloPass": { "type": "object", "properties": { "currentPeriodBaseCreditsUsd": { "type": "number" } }, "required": ["currentPeriodBaseCreditsUsd"], "additionalProperties": false },
                                "currentOrgId": { "type": "string" }
                              },
                              "required": ["profile", "balance", "kiloPass", "currentOrgId"],
                              "additionalProperties": false
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
        """.trimIndent()

        val root = obj(OpenApiSpecNormalizer.normalize(raw))
        val schema = obj(obj(obj(obj(obj(obj(root["paths"])["/kilo/profile"])["get"])["responses"])["200"])["content"])
        val props = obj(obj(obj(schema["application/json"])["schema"])["properties"])

        // balance must be anyOf [object, null]
        val balance = obj(props["balance"])
        val balanceAnyOf = arr(balance["anyOf"])
        assertEquals(2, balanceAnyOf.size, "balance should have anyOf with 2 entries")
        val balanceTypes = balanceAnyOf.map { (it as? JsonObject)?.get("type").let { t -> (t as? JsonPrimitive)?.content } }
        assert("null" in balanceTypes) { "balance anyOf should include null but got $balanceTypes" }
        assert(balanceAnyOf.any { it is JsonObject && "properties" in it }) { "balance anyOf should include the object schema" }

        // kiloPass must be anyOf [object, null]
        val pass = obj(props["kiloPass"])
        val passAnyOf = arr(pass["anyOf"])
        assertEquals(2, passAnyOf.size, "kiloPass should have anyOf with 2 entries")
        val passTypes = passAnyOf.map { (it as? JsonObject)?.get("type").let { t -> (t as? JsonPrimitive)?.content } }
        assert("null" in passTypes) { "kiloPass anyOf should include null but got $passTypes" }
        assert(passAnyOf.any { it is JsonObject && "properties" in it }) { "kiloPass anyOf should include the object schema" }

        // currentOrgId must be anyOf [string, null]
        val orgId = obj(props["currentOrgId"])
        val orgIdAnyOf = arr(orgId["anyOf"])
        assertEquals(2, orgIdAnyOf.size, "currentOrgId should have anyOf with 2 entries")
        val orgIdTypes = orgIdAnyOf.map { (it as? JsonObject)?.get("type").let { t -> (t as? JsonPrimitive)?.content } }
        assert("null" in orgIdTypes) { "currentOrgId anyOf should include null but got $orgIdTypes" }
        assert("string" in orgIdTypes) { "currentOrgId anyOf should include string but got $orgIdTypes" }

        // profile must remain unchanged (not wrapped in anyOf)
        val profile = obj(props["profile"])
        assertNull(profile["anyOf"], "profile should not be wrapped in anyOf")
        assertEquals("object", text(profile["type"]))
    }

    @Test
    fun `leaves already-nullable fields unchanged in kilo profile response`() {
        // If nullable fields already have anyOf (i.e. the spec was generated correctly), normalizer must not double-wrap them.
        val raw = """
            {
              "paths": {
                "/kilo/profile": {
                  "get": {
                    "operationId": "kilo.profile",
                    "responses": {
                      "200": {
                        "content": {
                          "application/json": {
                            "schema": {
                              "type": "object",
                              "properties": {
                                "profile": { "type": "object", "properties": { "email": { "type": "string" } }, "required": ["email"], "additionalProperties": false },
                                "balance": { "anyOf": [{ "type": "object", "properties": { "balance": { "type": "number" } }, "required": ["balance"], "additionalProperties": false }, { "type": "null" }] },
                                "kiloPass": { "anyOf": [{ "type": "object", "properties": { "currentPeriodBaseCreditsUsd": { "type": "number" } }, "required": ["currentPeriodBaseCreditsUsd"], "additionalProperties": false }, { "type": "null" }] },
                                "currentOrgId": { "anyOf": [{ "type": "string" }, { "type": "null" }] }
                              },
                              "required": ["profile", "balance", "kiloPass", "currentOrgId"],
                              "additionalProperties": false
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
        """.trimIndent()

        val root = obj(OpenApiSpecNormalizer.normalize(raw))
        val schema = obj(obj(obj(obj(obj(obj(root["paths"])["/kilo/profile"])["get"])["responses"])["200"])["content"])
        val props = obj(obj(obj(schema["application/json"])["schema"])["properties"])

        // balance must still have exactly 2 anyOf entries (not wrapped again)
        val balance = obj(props["balance"])
        val balanceAnyOf = arr(balance["anyOf"])
        assertEquals(2, balanceAnyOf.size, "balance should still have exactly 2 anyOf entries, not be double-wrapped")
        val pass = obj(props["kiloPass"])
        val passAnyOf = arr(pass["anyOf"])
        assertEquals(2, passAnyOf.size, "kiloPass should still have exactly 2 anyOf entries, not be double-wrapped")
    }

    @Test
    fun `deduplicates root-level tags array`() {
        val raw = """
            {
              "paths": {},
              "tags": [
                { "name": "pty", "description": "PTY routes." },
                { "name": "pty", "description": "PTY WebSocket route." },
                { "name": "session", "description": "Session routes." }
              ]
            }
        """.trimIndent()

        val root = obj(OpenApiSpecNormalizer.normalize(raw))
        val tags = arr(root["tags"]).map { text(obj(it)["name"]) }

        assertEquals(listOf("pty", "session"), tags, "duplicate pty tag should be removed")
    }

    private fun obj(raw: String) = Json.parseToJsonElement(raw) as JsonObject

    private fun obj(element: JsonElement?) = element as JsonObject

    private fun arr(element: JsonElement?) = element as JsonArray

    private fun text(element: JsonElement?) = (element as JsonPrimitive).content
}
