package ai.kilocode.client.agentManager.hosted

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class HostedMessageIdTest {
    @Test
    fun `message ID matches the Cloud schema`() {
        val id = hostedMessageID(0x1a1a2392348L)

        assertEquals(30, id.length)
        assertTrue(Regex("^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$").matches(id))
        assertEquals("msg_01a1a2392348", id.take(16))
    }

    @Test
    fun `message IDs are unique`() {
        val ids = List(100) { hostedMessageID() }

        assertEquals(ids.size, ids.toSet().size)
        assertNotEquals(hostedMessageID(1), hostedMessageID(1))
    }
}
