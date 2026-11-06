package ai.kilocode.client.session

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class SessionRefHostedTest {
    @Test
    fun `hosted identity includes provider workspace and native session`() {
        val ref = SessionRef.Hosted("cloud", "wrk_1", "ses_1")

        assertEquals(SessionRef.Type.HOSTED, ref.type)
        assertEquals("hosted:cloud:wrk_1:ses_1", ref.key)
        assertEquals("hosted:cloud:wrk_1", ref.workspaceKey)
        assertTrue(ref.key != SessionRef.Hosted("cloud", "wrk_2", "ses_1").key)
    }

    @Test
    fun `hosted identity round trips and legacy cloud import is unchanged`() {
        val parsed = SessionRef.from("hosted:cloud:wrk_1:ses_1")
        assertIs<SessionRef.Hosted>(parsed)
        assertEquals("cloud", parsed.providerID)
        assertEquals("wrk_1", parsed.workspaceID)
        assertEquals("ses_1", parsed.sessionID)

        val cloud = SessionRef.from("cloud:abc")
        assertIs<SessionRef.Cloud>(cloud)
        assertEquals("cloud:abc", cloud.key)
    }
}
