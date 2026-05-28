package ai.kilocode.backend.cli

import ai.kilocode.jetbrains.api.infrastructure.Serializer
import ai.kilocode.jetbrains.api.model.Session
import ai.kilocode.jetbrains.api.model.SessionStatus
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Verifies that session-related API model classes serialize/deserialize
 * correctly using the production [Serializer.kotlinxSerializationJson].
 */
class SessionModelSerializationTest {

    private val json = Serializer.kotlinxSerializationJson

    @Test
    fun `Session minimal`() {
        val src = """{
            "id": "ses_abc",
            "slug": "test-session",
            "projectID": "prj_123",
            "directory": "/test/project",
            "title": "My Session",
            "version": "1.0.0",
            "time": {"created": 1000, "updated": 2000}
        }"""
        val obj = json.decodeFromString<Session>(src)
        assertEquals("ses_abc", obj.id)
        assertEquals("test-session", obj.slug)
        assertEquals("prj_123", obj.projectID)
        assertEquals("/test/project", obj.directory)
        assertEquals("My Session", obj.title)
        assertEquals(1000L, obj.time.created)
        assertEquals(2000L, obj.time.updated)
        assertNull(obj.parentID)
        assertNull(obj.summary)
    }

    @Test
    fun `Session with summary`() {
        val src = """{
            "id": "ses_1",
            "slug": "s",
            "projectID": "prj_1",
            "directory": "/d",
            "title": "T",
            "version": "1.0.0",
            "time": {"created": 1, "updated": 2},
            "summary": {"additions": 10, "deletions": 5, "files": 3}
        }"""
        val obj = json.decodeFromString<Session>(src)
        assertNotNull(obj.summary)
        assertEquals(10, obj.summary!!.additions)
        assertEquals(5, obj.summary!!.deletions)
        assertEquals(3, obj.summary!!.files)
    }

    @Test
    fun `Session with parentID and archived`() {
        val src = """{
            "id": "ses_child",
            "slug": "child",
            "projectID": "prj_1",
            "directory": "/d",
            "title": "Fork",
            "version": "1.0.0",
            "time": {"created": 1, "updated": 2, "archived": 3000.0},
            "parentID": "ses_parent"
        }"""
        val obj = json.decodeFromString<Session>(src)
        assertEquals("ses_parent", obj.parentID)
        assertEquals(3000.0, obj.time.archived)
    }

    @Test
    fun `Session list`() {
        val src = """[
            {"id":"ses_1","slug":"s1","projectID":"prj","directory":"/d","title":"A","version":"1","time":{"created":1,"updated":1}},
            {"id":"ses_2","slug":"s2","projectID":"prj","directory":"/d","title":"B","version":"1","time":{"created":2,"updated":2}}
        ]"""
        val list = json.decodeFromString<List<Session>>(src)
        assertEquals(2, list.size)
        assertEquals("ses_1", list[0].id)
        assertEquals("ses_2", list[1].id)
    }

    @Test
    fun `empty session list`() {
        val list = json.decodeFromString<List<Session>>("[]")
        assertTrue(list.isEmpty())
    }

    @Test
    fun `Session ignores unknown fields`() {
        val src = """{
            "id": "ses_x",
            "slug": "x",
            "projectID": "prj_x",
            "directory": "/x",
            "title": "X",
            "version": "1",
            "time": {"created": 1, "updated": 1},
            "unknown_field": "value",
            "nested": {"a": 1}
        }"""
        val obj = json.decodeFromString<Session>(src)
        assertEquals("ses_x", obj.id)
    }

    // ------ SessionStatus ------

    @Test
    fun `SessionStatus idle`() {
        val src = """{"type":"idle","attempt":0,"message":"","next":0,"requestID":""}"""
        val obj = json.decodeFromString<SessionStatus>(src)
        assertEquals(SessionStatus.Type.IDLE, obj.type)
    }

    @Test
    fun `SessionStatus busy`() {
        val src = """{"type":"busy","attempt":0,"message":"","next":0,"requestID":""}"""
        val obj = json.decodeFromString<SessionStatus>(src)
        assertEquals(SessionStatus.Type.BUSY, obj.type)
    }

    @Test
    fun `SessionStatus retry`() {
        val src = """{"type":"retry","attempt":2,"message":"Rate limited","next":1500,"requestID":"req_1"}"""
        val obj = json.decodeFromString<SessionStatus>(src)
        assertEquals(SessionStatus.Type.RETRY, obj.type)
        assertEquals(2L, obj.attempt)
        assertEquals("Rate limited", obj.message)
        assertEquals(1500L, obj.next)
    }

    @Test
    fun `SessionStatus offline`() {
        val src = """{"type":"offline","attempt":0,"message":"Waiting for response","next":0,"requestID":"req_abc"}"""
        val obj = json.decodeFromString<SessionStatus>(src)
        assertEquals(SessionStatus.Type.OFFLINE, obj.type)
        assertEquals("req_abc", obj.requestID)
    }

    @Test
    fun `SessionStatus map`() {
        val src = """{
            "ses_1": {"type":"idle","attempt":0,"message":"","next":0,"requestID":""},
            "ses_2": {"type":"busy","attempt":0,"message":"","next":0,"requestID":""}
        }"""
        val map = json.decodeFromString<Map<String, SessionStatus>>(src)
        assertEquals(2, map.size)
        assertEquals(SessionStatus.Type.IDLE, map["ses_1"]!!.type)
        assertEquals(SessionStatus.Type.BUSY, map["ses_2"]!!.type)
    }

    @Test
    fun `empty status map`() {
        val map = json.decodeFromString<Map<String, SessionStatus>>("{}")
        assertTrue(map.isEmpty())
    }

    // ------ Large integer (Long) handling ------

    @Test
    fun `Session time created and updated deserialize as Long for values larger than Int MAX_VALUE`() {
        val big = Int.MAX_VALUE.toLong() + 12345L
        val src = """{
            "id": "ses_big",
            "slug": "big",
            "projectID": "prj",
            "directory": "/d",
            "title": "Big Times",
            "version": "1",
            "time": {"created": $big, "updated": ${big + 1L}}
        }"""
        val obj = json.decodeFromString<Session>(src)
        assertEquals(big, obj.time.created)
        assertEquals(big + 1L, obj.time.updated)
    }

    @Test
    fun `Session time millisecond epoch timestamps deserialize correctly`() {
        // Realistic millisecond timestamp: 2026-01-01T00:00:00Z = 1767139200000
        val ms = 1767139200000L
        val src = """{
            "id": "ses_ms",
            "slug": "ms",
            "projectID": "prj",
            "directory": "/d",
            "title": "MS Times",
            "version": "1",
            "time": {"created": $ms, "updated": $ms}
        }"""
        val obj = json.decodeFromString<Session>(src)
        assertEquals(ms, obj.time.created)
        assertEquals(ms, obj.time.updated)
        assertTrue(obj.time.created > Int.MAX_VALUE)
    }

    @Test
    fun `Session time defaults to 0L when fields are omitted`() {
        // The generated model has default = 0L for created and updated
        val obj = ai.kilocode.jetbrains.api.model.SessionTime()
        assertEquals(0L, obj.created)
        assertEquals(0L, obj.updated)
    }

    @Test
    fun `SessionStatus attempt and next deserialize as Long for large values`() {
        val bigAttempt = Int.MAX_VALUE.toLong() + 5L
        val bigNext = Int.MAX_VALUE.toLong() + 99999L
        val src = """{"type":"retry","attempt":$bigAttempt,"message":"Retrying","next":$bigNext,"requestID":"req_1"}"""
        val obj = json.decodeFromString<SessionStatus>(src)
        assertEquals(SessionStatus.Type.RETRY, obj.type)
        assertEquals(bigAttempt, obj.attempt)
        assertEquals(bigNext, obj.next)
    }

    @Test
    fun `SessionStatus defaults attempt and next to 0L when omitted`() {
        val src = """{"type":"idle","message":"","requestID":""}"""
        val obj = json.decodeFromString<SessionStatus>(src)
        assertEquals(0L, obj.attempt)
        assertEquals(0L, obj.next)
    }
}
