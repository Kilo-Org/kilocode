package ai.kilocode.client.session.views.tool

import ai.kilocode.cli.KiloCliParser
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class KiloCliParserTest {
    @Test
    fun `tag extracts trimmed tool xml value`() {
        val text = """
            <path>
              /tmp/example.txt
            </path>
            <type>file</type>
        """.trimIndent()

        assertEquals("/tmp/example.txt", KiloCliParser.tag(text, "path"))
        assertEquals("file", KiloCliParser.tag(text, "type"))
    }

    @Test
    fun `tag returns null for blank or missing value`() {
        assertNull(KiloCliParser.tag("<path>   </path>", "path"))
        assertNull(KiloCliParser.tag("<type>file</type>", "path"))
    }
}
