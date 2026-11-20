package ai.kilocode.backend.cli

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class ResponseSummaryTest {

    @Test
    fun `body name keeps a valid identifier`() {
        assertEquals("ConfigJsonError", bodyName("""{"name":"ConfigJsonError"}"""))
    }

    @Test
    fun `body name drops a name with a space`() {
        assertNull(bodyName("""{"name":"Bad Request"}"""))
    }

    @Test
    fun `body name drops a name longer than 64 characters`() {
        assertNull(bodyName("""{"name":"${"A".repeat(65)}"}"""))
    }

    @Test
    fun `body name drops a name that is not a string`() {
        assertNull(bodyName("""{"name":{"message":"x"}}"""))
        assertNull(bodyName("""{"name":42}"""))
    }

    @Test
    fun `body name drops a json boolean`() {
        assertNull(bodyName("""{"name":true}"""))
        assertNull(bodyName("""{"name":false}"""))
    }

    @Test
    fun `body name drops a non json body`() {
        assertNull(bodyName("not json at all"))
    }

    @Test
    fun `body name drops a json array body`() {
        assertNull(bodyName("""[{"name":"ConfigJsonError"}]"""))
    }

    @Test
    fun `json error object keeps its short name`() {
        val body = """{"name":"ConfigJsonError","data":{"message":"x"}}"""

        assertEquals("ConfigJsonError chars=${body.length}", bodySummary(body))
    }

    @Test
    fun `name with a space is dropped`() {
        val body = """{"name":"Bad Request"}"""

        assertEquals("chars=${body.length}", bodySummary(body))
    }

    @Test
    fun `name longer than 64 characters is dropped`() {
        val body = """{"name":"${"A".repeat(65)}"}"""

        assertEquals("chars=${body.length}", bodySummary(body))
    }

    @Test
    fun `name that is not a string is dropped`() {
        val objectName = """{"name":{"message":"x"}}"""
        val numericName = """{"name":42}"""

        assertEquals("chars=${objectName.length}", bodySummary(objectName))
        assertEquals("chars=${numericName.length}", bodySummary(numericName))
    }

    @Test
    fun `json boolean name is dropped`() {
        val trueName = """{"name":true}"""
        val falseName = """{"name":false}"""

        assertEquals("chars=${trueName.length}", bodySummary(trueName))
        assertEquals("chars=${falseName.length}", bodySummary(falseName))
    }

    @Test
    fun `non json body has no name`() {
        val body = "not json at all"

        assertEquals("chars=${body.length}", bodySummary(body))
    }

    @Test
    fun `json array body has no name`() {
        val body = """[{"name":"ConfigJsonError"}]"""

        assertEquals("chars=${body.length}", bodySummary(body))
    }
}
