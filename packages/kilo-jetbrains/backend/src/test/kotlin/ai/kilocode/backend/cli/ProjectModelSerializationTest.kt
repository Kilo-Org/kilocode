package ai.kilocode.backend.cli

import ai.kilocode.jetbrains.api.infrastructure.Serializer
import ai.kilocode.jetbrains.api.model.Agent
import ai.kilocode.jetbrains.api.model.AppSkills200ResponseInner
import ai.kilocode.jetbrains.api.model.Command
import ai.kilocode.jetbrains.api.model.ProviderList200Response
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Verifies that project-level API model classes serialize/deserialize
 * correctly using the production [Serializer.kotlinxSerializationJson].
 */
class ProjectModelSerializationTest {

    private val json = Serializer.kotlinxSerializationJson

    // ------ ProviderList200Response ------

    @Test
    fun `empty provider list`() {
        val src = """{"all":[],"default":{},"connected":[]}"""
        val obj = json.decodeFromString<ProviderList200Response>(src)
        assertTrue(obj.all.isEmpty())
        assertTrue(obj.default.isEmpty())
        assertTrue(obj.connected.isEmpty())
    }

    @Test
    fun `provider list with models`() {
        val src = """{
            "all": [{
                "id": "anthropic",
                "name": "Anthropic",
                "source": "api",
                "env": ["ANTHROPIC_API_KEY"],
                "options": {},
                "models": {
                    "claude-4": {
                        "id": "claude-4",
                        "providerID": "anthropic",
                        "name": "Claude 4",
                        "api": {"id": "anthropic", "url": "", "npm": ""},
                        "capabilities": {
                            "temperature": true,
                            "reasoning": true,
                            "attachment": true,
                            "toolcall": true,
                            "input": {"text": true, "audio": false, "image": false, "video": false, "pdf": false},
                            "output": {"text": true, "audio": false, "image": false, "video": false, "pdf": false},
                            "interleaved": {"field":"reasoning_content"}
                        },
                        "cost": {"input": 0, "output": 0, "cache": {"read": 0, "write": 0}},
                        "limit": {"context": 200000, "output": 16000},
                        "status": "active",
                        "options": {},
                        "headers": {},
                        "release_date": "2025-05-01"
                    }
                }
            }],
            "default": {"code": "anthropic/claude-4"},
            "connected": ["anthropic"]
        }"""
        val obj = json.decodeFromString<ProviderList200Response>(src)
        assertEquals(1, obj.all.size)
        assertEquals("anthropic", obj.all[0].id)
        assertEquals("Anthropic", obj.all[0].name)
        val model = obj.all[0].models["claude-4"]
        assertNotNull(model)
        assertEquals("Claude 4", model.name)
        assertTrue(model.capabilities.attachment)
        assertTrue(model.capabilities.reasoning)
        assertTrue(model.capabilities.toolcall)
        assertEquals("anthropic/claude-4", obj.default["code"])
        assertEquals(listOf("anthropic"), obj.connected)
    }

    @Test
    fun `provider list with isFree and status`() {
        val src = """{
            "all": [{
                "id": "free-provider",
                "name": "Free",
                "source": "api",
                "env": [],
                "options": {},
                "models": {
                    "free-model": {
                        "id": "free-model",
                        "providerID": "free-provider",
                        "name": "Free Model",
                        "api": {"id": "free-provider", "url": "", "npm": ""},
                        "capabilities": {
                            "temperature": false,
                            "reasoning": false,
                            "attachment": false,
                            "toolcall": false,
                            "input": {"text": true, "audio": false, "image": false, "video": false, "pdf": false},
                            "output": {"text": true, "audio": false, "image": false, "video": false, "pdf": false},
                            "interleaved": {"field":"reasoning_content"}
                        },
                        "cost": {"input": 0, "output": 0, "cache": {"read": 0, "write": 0}},
                        "limit": {"context": 8000, "output": 4000},
                        "status": "beta",
                        "options": {},
                        "headers": {},
                        "release_date": "2025-01-01",
                        "isFree": true
                    }
                }
            }],
            "default": {},
            "connected": []
        }"""
        val obj = json.decodeFromString<ProviderList200Response>(src)
        val model = obj.all[0].models["free-model"]!!
        assertEquals(true, model.isFree)
        assertEquals(
            ai.kilocode.jetbrains.api.model.Model.Status.BETA,
            model.status,
        )
    }

    @Test
    fun `provider list ignores unknown fields`() {
        val src = """{
            "all": [],
            "default": {},
            "connected": [],
            "future_field": "value"
        }"""
        val obj = json.decodeFromString<ProviderList200Response>(src)
        assertTrue(obj.all.isEmpty())
    }

    // ------ Agent ------

    @Test
    fun `agent with all modes`() {
        for (mode in listOf("primary", "subagent", "all")) {
            val src = """{"name":"test","mode":"$mode","permission":[],"options":{}}"""
            val obj = json.decodeFromString<Agent>(src)
            assertEquals("test", obj.name)
            assertEquals(mode, obj.mode.value)
        }
    }

    @Test
    fun `agent with optional fields`() {
        val src = """{
            "name": "code",
            "displayName": "Code Agent",
            "description": "Writes code",
            "mode": "primary",
            "native": true,
            "hidden": false,
            "color": "#FF5733",
            "deprecated": false,
            "permission": [],
            "options": {},
            "steps": 5
        }"""
        val obj = json.decodeFromString<Agent>(src)
        assertEquals("Code Agent", obj.displayName)
        assertEquals("Writes code", obj.description)
        assertEquals(true, obj.native)
        assertEquals(false, obj.hidden)
        assertEquals("#FF5733", obj.color)
        assertEquals(5, obj.steps)
    }

    @Test
    fun `agent minimal`() {
        val src = """{"name":"ask","mode":"primary","permission":[],"options":{}}"""
        val obj = json.decodeFromString<Agent>(src)
        assertEquals("ask", obj.name)
        assertNull(obj.displayName)
        assertNull(obj.hidden)
    }

    @Test
    fun `agent list`() {
        val src = """[
            {"name":"code","mode":"primary","permission":[],"options":{}},
            {"name":"helper","mode":"subagent","hidden":true,"permission":[],"options":{}}
        ]"""
        val list = json.decodeFromString<List<Agent>>(src)
        assertEquals(2, list.size)
        assertEquals(Agent.Mode.PRIMARY, list[0].mode)
        assertEquals(Agent.Mode.SUBAGENT, list[1].mode)
        assertEquals(true, list[1].hidden)
    }

    // ------ Command ------

    @Test
    fun `command with source enum`() {
        for ((src, expected) in listOf(
            "command" to Command.Source.COMMAND,
            "mcp" to Command.Source.MCP,
            "skill" to Command.Source.SKILL,
        )) {
            val json = """{"name":"test","template":"","hints":[],"source":"$src"}"""
            val obj = this.json.decodeFromString<Command>(json)
            assertEquals(expected, obj.source)
        }
    }

    @Test
    fun `command with hints`() {
        val src = """{
            "name": "clear",
            "description": "Clear the conversation",
            "template": "",
            "hints": ["conversation", "reset"],
            "source": "command"
        }"""
        val obj = json.decodeFromString<Command>(src)
        assertEquals("clear", obj.name)
        assertEquals("Clear the conversation", obj.description)
        assertEquals(listOf("conversation", "reset"), obj.hints)
    }

    @Test
    fun `command list`() {
        val src = """[
            {"name":"clear","template":"","hints":[]},
            {"name":"compact","description":"Compact context","template":"","hints":["context"],"source":"command"}
        ]"""
        val list = json.decodeFromString<List<Command>>(src)
        assertEquals(2, list.size)
        assertNull(list[0].source)
        assertEquals(Command.Source.COMMAND, list[1].source)
    }

    // ------ AppSkills200ResponseInner ------

    @Test
    fun `skill roundtrip`() {
        val src = """{
            "name": "vscode-visual-regression",
            "description": "Write visual regression tests",
            "location": "file:///path/to/SKILL.md",
            "content": "# Skill content"
        }"""
        val obj = json.decodeFromString<AppSkills200ResponseInner>(src)
        assertEquals("vscode-visual-regression", obj.name)
        assertEquals("Write visual regression tests", obj.description)
        assertEquals("file:///path/to/SKILL.md", obj.location)
        assertEquals("# Skill content", obj.content)
    }

    @Test
    fun `skill list`() {
        val src = """[
            {"name":"s1","description":"d1","location":"l1","content":"c1"},
            {"name":"s2","description":"d2","location":"l2","content":"c2"}
        ]"""
        val list = json.decodeFromString<List<AppSkills200ResponseInner>>(src)
        assertEquals(2, list.size)
    }

    @Test
    fun `empty skill list`() {
        val list = json.decodeFromString<List<AppSkills200ResponseInner>>("[]")
        assertTrue(list.isEmpty())
    }
}
