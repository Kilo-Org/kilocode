package ai.kilocode.rpc.dto

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class HostedDtoTest {
    @Test
    fun `workspace and session identities have distinct discriminators`() {
        val workspace = HostedIDs.workspace("cloud", "wrk_1")
        val session = HostedIDs.session("cloud", "wrk_1", "ses_1")

        assertEquals("cloud" to "wrk_1", HostedIDs.parseWorkspace(workspace))
        assertTrue(HostedIDs.isWorkspace(workspace))
        assertFalse(HostedIDs.isSession(workspace))
        assertEquals(Triple("cloud", "wrk_1", "ses_1"), HostedIDs.parseSession(session))
        assertTrue(HostedIDs.isSession(session))
        assertFalse(HostedIDs.isWorkspace(session))
    }

    @Test
    fun `workspace parser rejects malformed identities`() {
        listOf(
            "",
            "hosted",
            "hosted:cloud",
            "other:cloud:wrk_1",
            "hosted::wrk_1",
            "hosted:   :wrk_1",
            "hosted:cloud:",
            "hosted:cloud:   ",
            "hosted:cloud:wrk_1:ses_1",
        ).forEach { id ->
            assertNull(HostedIDs.parseWorkspace(id), id)
            assertFalse(HostedIDs.isWorkspace(id), id)
        }
    }
}
