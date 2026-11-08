package ai.kilocode.rpc.dto

import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFalse

/**
 * The generated `toString` of a data class prints every field. This DTO travels through RPC logging
 * and exception messages, so the OAuth client secret must not be one of them.
 */
class McpOAuthDtoTest {
    @Test
    fun `toString redacts the client secret`() {
        val text = McpOAuthDto(
            enabled = true,
            clientId = "abc",
            clientSecret = "super-secret-value",
            scope = "read",
            callbackPort = 19876,
            redirectUri = "http://127.0.0.1:19876/cb",
        ).toString()

        assertFalse(text.contains("super-secret-value"), "the client secret must not be printed: $text")
        assertContains(text, "clientSecret=***")
        // The non-sensitive fields stay readable so the value is still useful in a log.
        assertContains(text, "clientId=abc")
        assertContains(text, "scope=read")
        assertContains(text, "callbackPort=19876")
    }

    @Test
    fun `toString keeps a null secret distinguishable from a redacted one`() {
        assertContains(McpOAuthDto(enabled = true, clientId = "abc").toString(), "clientSecret=null")
    }

    @Test
    fun `equality still covers the client secret`() {
        val base = McpOAuthDto(enabled = true, clientSecret = "one")

        assertEquals(base, McpOAuthDto(enabled = true, clientSecret = "one"))
        assertFalse(base == McpOAuthDto(enabled = true, clientSecret = "two"))
    }
}
