package ai.kilocode.client.session

import ai.kilocode.rpc.dto.CloudSessionDto
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.SessionTimeDto
import junit.framework.TestCase

class SessionRefTest : TestCase() {

    fun `test local ref exposes type id and key`() {
        val ref = SessionRef.Local("ses_test")

        assertEquals(SessionRef.Type.LOCAL, ref.type)
        assertEquals("ses_test", ref.id)
        assertEquals("ses_test", ref.key)
        assertNull(ref.session)
    }

    fun `test metadata local ref keeps id identity`() {
        val dto = session("ses_test")
        val ref = SessionRef.Local(dto)

        assertEquals(SessionRef.Type.LOCAL, ref.type)
        assertEquals("ses_test", ref.id)
        assertEquals("ses_test", ref.key)
        assertSame(dto, ref.session)
    }

    fun `test cloud ref exposes type id and prefixed key`() {
        val dto = cloud("cloud_1")
        val ref = SessionRef.Cloud(dto)

        assertEquals(SessionRef.Type.CLOUD, ref.type)
        assertEquals("cloud_1", ref.id)
        assertEquals("cloud:cloud_1", ref.key)
        assertSame(dto, ref.session)
    }

    fun `test ref parser resolves cloud and local ids`() {
        assertEquals(SessionRef.Cloud("cloud_1"), SessionRef.from("cloud:cloud_1"))
        assertEquals(SessionRef.Local("ses_test"), SessionRef.from("ses_test"))
        assertNull(SessionRef.from(null))
        assertNull(SessionRef.from(""))
    }

    private fun session(id: String) = SessionDto(
        id = id,
        projectID = "prj",
        directory = "/test",
        title = "Session $id",
        version = "1",
        time = SessionTimeDto(created = 1.0, updated = 2.0),
    )

    private fun cloud(id: String) = CloudSessionDto(
        id = id,
        title = "Cloud $id",
        createdAt = "2026-01-01T00:00:00Z",
        updatedAt = "2026-01-02T00:00:00Z",
        version = 1.0,
    )
}
