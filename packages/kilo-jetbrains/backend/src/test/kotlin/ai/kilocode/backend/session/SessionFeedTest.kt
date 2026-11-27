package ai.kilocode.backend.session

import ai.kilocode.backend.v2.V2Client
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.DiffFileDto
import ai.kilocode.rpc.dto.EditorContextDto
import ai.kilocode.rpc.dto.PartSourceDto
import ai.kilocode.rpc.dto.PartSourceTextDto
import ai.kilocode.rpc.dto.PermissionAlwaysRulesDto
import ai.kilocode.rpc.dto.PermissionReplyDto
import ai.kilocode.rpc.dto.PromptDto
import ai.kilocode.rpc.dto.PromptPartDto
import ai.kilocode.rpc.dto.QuestionReplyDto
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.util.Base64
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SessionFeedTest {
    private fun json(text: String) = Json.parseToJsonElement(text).jsonObject

    @Test
    fun `live fragment identities survive history load across mixed text reasoning and tools`() = runBlocking {
        val feed = SessionFeed("ses_s") { error("unexpected fetch") }
        val history = SessionTranscript("ses_s", "msg_user").message(json("""{"id":"msg_reply","type":"assistant","time":{"created":123},"content":[{"type":"reasoning","text":"thinking"},{"id":"call","type":"tool","name":"task","state":{"status":"completed","input":{},"metadata":{"sessionID":"ses_child"},"content":[{"type":"text","text":"done"}]}},{"type":"text","text":"first"},{"type":"text","text":"last"}]}"""))!!
        assertEquals("msg_user", history.info.parentID)
        assertEquals("ses_child", history.parts[1].metadata["sessionId"])
        for ((index, type, ordinal) in listOf(Triple(0,"reasoning",0), Triple(2,"text",0), Triple(3,"text",1))) {
            val fragment = feed.receive(json("""{"type":"session.$type.delta","data":{"sessionID":"ses_s","assistantMessageID":"msg_reply","ordinal":$ordinal,"delta":"token"}}""")).single() as ChatEventDto.PartDelta
            assertEquals(history.parts[index].id, fragment.partID)
            assertEquals("token", fragment.delta)
        }
        assertTrue(feed.receive(json("""{"type":"session.text.delta","data":{"sessionID":"ses_other"}}""")).isEmpty())
    }

    @Test
    fun `reconnect reloads both pages and removes deleted messages and resolved requests`() = runBlocking {
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        var second = false
        val path = "/api/session/ses_s"
        val form = """{"id":"frm_a","sessionID":"ses_s","title":"Continue?","fields":[{"type":"boolean","key":"ok"}]}"""
        val permission = """{"id":"per_b","sessionID":"ses_s","action":"edit","resources":["a"]}"""
        fun user(id: String) = """{"type":"user","id":"msg_$id","text":"$id","time":{"created":1}}"""
        val requests = mutableListOf<String>()
        server.createContext("/") { x ->
            requests += x.requestURI.toString()
            val body = when (x.requestURI.path) {
                path -> """{"data":{"id":"ses_s","projectID":"p","location":{"directory":"/fixture"},"time":{"created":0,"updated":1}}}"""
                "$path/message" -> when {
                    second -> """{"data":[${user("b")},{"id":"msg_idle","type":"idle","time":{"created":2},"outcome":"failed","error":{"type":"provider","message":"unavailable"}}],"cursor":{}}"""
                    x.requestURI.query.contains("cursor=") -> """{"data":[${user("b")}],"cursor":{}}"""
                    else -> """{"data":[${user("a")}],"cursor":{"next":"page2"}}"""
                }
                "$path/permission" -> if (second) """{"data":[]}""" else """{"data":[$permission]}"""
                "$path/form" -> if (second) """{"data":[]}""" else """{"data":[$form]}"""
                "$path/inbox" -> """{"data":[]}"""
                "/api/session/active" -> if (second) """{"data":{}}""" else """{"data":{"ses_s":{"type":"running"}}}"""
                else -> error("Unexpected call: ${x.requestURI}")
            }.toByteArray()
            x.sendResponseHeaders(200, body.size.toLong()); x.responseBody.use { it.write(body) }
        }
        server.start()
        try {
            val api = V2Client("http://127.0.0.1:${server.address.port}", "Basic test")
            val feed = SessionFeed("ses_s") { api }
            val connected = fields("type" to "server.connected")
            val initial = feed.receive(connected)
            assertEquals(listOf("msg_a", "msg_b"), initial.filterIsInstance<ChatEventDto.MessageUpdated>().map { it.info.id })
            assertEquals("busy", initial.filterIsInstance<ChatEventDto.SessionStatusChanged>().single().status.type)
            assertTrue(requests.any { "cursor=page2" in it && "order=" !in it })
            assertEquals("frm_a", initial.filterIsInstance<ChatEventDto.QuestionAsked>().single().request.id)
            second = true
            val recovered = feed.receive(connected)
            assertTrue(ChatEventDto.MessageRemoved("ses_s", "msg_a") in recovered)
            assertTrue(ChatEventDto.PermissionReplied("ses_s", "per_b") in recovered)
            assertTrue(ChatEventDto.QuestionRejected("ses_s", "frm_a") in recovered)
            assertEquals("idle", recovered.filterIsInstance<ChatEventDto.SessionStatusChanged>().single().status.type)
            assertEquals("unavailable", recovered.filterIsInstance<ChatEventDto.Error>().single().error?.message)
        } finally { server.stop(0) }
    }

    @Test
    fun `form reply uses native field keys option values and typed defaults`() {
        val form = json("""{"id":"frm_q","sessionID":"ses_s","title":"Options","fields":[{"key":"mode","type":"string","options":[{"label":"Fast","value":"fast"}]},{"key":"count","type":"integer"},{"key":"extra","type":"multiselect","options":[{"value":"x","label":"X"}]},{"key":"guarded","type":"string","when":[{"key":"mode","op":"neq","value":"fast"}]},{"type":"boolean","key":"internal","hidden":true,"default":false}]}""")
        assertEquals(4, formDto(form).questions.size)
        assertEquals(json("""{"mode":"fast","count":12,"extra":["x","other"],"internal":false}"""),
            formAnswer(form, QuestionReplyDto(listOf(listOf("Fast"), listOf("12"), listOf("X","other"), listOf("ignored")))))
    }

    @Test
    fun `prompt preserves explicit ranged file and makes editor context available to model`() {
        val uri = "file:///project/example.kt?start=2&end=3"
        val prompt = promptBody(PromptDto(listOf(PromptPartDto("text", "Explain @example.kt"), PromptPartDto("file", url = uri,
            source = PartSourceDto("file", PartSourceTextDto("@example.kt", 8.0, 19.0), path = "/project/example.kt"))),
            editorContext = EditorContextDto(activeFile = "example.kt"), messageID = "msg_input", noReply = true))
        assertEquals("false", prompt.str("resume")); assertEquals("msg_input", prompt.str("id"))
        val attachment = prompt.items("files")[0].jsonObject
        assertEquals(uri, attachment.str("uri")); assertEquals("@example.kt", attachment.obj("mention")?.str("text"))
        val context = prompt.items("files")[1].jsonObject.required("uri").substringAfter(";base64,")
        assertEquals("example.kt", json(String(Base64.getDecoder().decode(context), Charsets.UTF_8)).str("activeFile"))
    }

    @Test
    fun `sensitive permission cannot be auto approved and unoffered patterns cannot be persisted`() = runBlocking {
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        val writes = mutableListOf<String>()
        server.createContext("/api/permission/request") { x ->
            val text = """{"data":[{"id":"per_a","sessionID":"ses_s","action":"browser_sensitive","resources":["private"],"save":[]}]}""".toByteArray()
            x.sendResponseHeaders(200, text.size.toLong()); x.responseBody.use { it.write(text) }
        }
        server.createContext("/api/session/ses_s/permission/per_a/reply") { x ->
            writes += x.requestBody.reader().readText(); x.sendResponseHeaders(204, -1); x.close()
        }
        server.start()
        try {
            val api = V2Client("http://127.0.0.1:${server.address.port}", "Basic test")
            val requests = SessionRequests { api }
            assertFailsWith<IllegalArgumentException> { requests.replyPermission("per_a", "/p", PermissionReplyDto("once")) }
            assertFailsWith<IllegalArgumentException> { requests.saveRules("per_a", "/p", PermissionAlwaysRulesDto(listOf("*"))) }
            assertTrue(writes.isEmpty())
            requests.replyPermission("per_a", "/p", PermissionReplyDto("once", interactive = true))
            assertEquals(listOf("""{"decision":"once"}"""), writes)
        } finally { server.stop(0) }
    }

    @Test
    fun `board owner cursor and job identity survive native RPC envelopes`() {
        val board = json("""{"ownerSessionID":"ses_root","revision":5,"cursor":"m2","hasMore":true,"messages":[{"id":"m2","timestamp":100,"from":"main","to":"ALL","body":"next","type":"ASK","reply_to":"m1"}]}""")
        assertEquals("m2", boardDto("ses_root", board).cursor)
        assertEquals("m1", boardDto("ses_root", board).messages.single().reply_to)
        assertFailsWith<IllegalStateException> { boardDto("ses_child", board) }
        val job = jobDto(json("""{"id":"child","sessionID":"child","parentSessionID":"root","status":"completed","background":true,"time":{"started":12,"completed":34}}"""))
        assertTrue(job.background); assertEquals("root", job.parentSessionId); assertEquals(34L,job.completedAt)
    }

    @Test
    fun `full historical diff preserves missing newlines and rejects partial patches`() {
        val file = DiffFileDto("a", 1, 1, "--- a\n+++ a\n@@ -1,2 +1,2 @@\n line\n-old\n\\ No newline at end of file\n+new\n")
        val sides = fullFileSides(file)!!
        assertEquals("line\nold", sides.before); assertEquals("line\nnew\n", sides.after)
        assertNull(fullFileSides(file.copy(patch = file.patch!!.replace("-1,2", "-5,2"))))
    }
}
