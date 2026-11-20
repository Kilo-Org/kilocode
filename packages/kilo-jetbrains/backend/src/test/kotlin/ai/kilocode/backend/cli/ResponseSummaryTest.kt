package ai.kilocode.backend.cli

import kotlin.test.Test
import kotlin.test.assertEquals

class ResponseSummaryTest {

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
