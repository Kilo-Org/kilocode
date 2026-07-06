package ai.kilocode.backend.app

import ai.kilocode.backend.testing.MockCliServer
import ai.kilocode.backend.testing.TestLog
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.ModelSelectionDto
import ai.kilocode.rpc.dto.PromptDto
import ai.kilocode.rpc.dto.PromptPartDto
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.OkHttpClient
import java.util.concurrent.CountDownLatch
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class KiloBackendChatManagerTest {

    private val mock = MockCliServer()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    @AfterTest
    fun tearDown() {
        scope.cancel()
        mock.close()
    }

    @Test
    fun `compact posts summarize request with selected model`() {
        val port = mock.start()
        val chat = KiloBackendChatManager(scope, TestLog())
        chat.start(OkHttpClient(), port, MutableSharedFlow())

        chat.compact("ses_abc", "/test/project", ModelSelectionDto("anthropic", "claude-4"))

        assertEquals(1, mock.requestCount("/session/ses_abc/summarize"))
        assertNotNull(mock.lastSummarizePath)
        assertTrue(mock.lastSummarizePath!!.startsWith("/session/ses_abc/summarize?directory="))
        assertEquals("""{"providerID":"anthropic","modelID":"claude-4"}""", mock.lastSummarizeBody)
    }

    @Test
    fun `revert posts message boundary and returns updated session`() {
        val port = mock.start()
        val chat = KiloBackendChatManager(scope, TestLog())
        chat.start(OkHttpClient(), port, MutableSharedFlow())

        val session = chat.revert("ses_abc", "/test/project", "msg_user", "prt_text")

        assertEquals(1, mock.requestCount("/session/ses_abc/revert"))
        assertNotNull(mock.lastRevertPath)
        assertTrue(mock.lastRevertPath!!.startsWith("/session/ses_abc/revert?directory="))
        assertEquals("""{"messageID":"msg_user","partID":"prt_text"}""", mock.lastRevertBody)
        assertEquals("msg_user", session.revert?.messageID)
    }

    @Test
    fun `unrevert posts empty body and returns updated session`() {
        val port = mock.start()
        val chat = KiloBackendChatManager(scope, TestLog())
        chat.start(OkHttpClient(), port, MutableSharedFlow())

        val session = chat.unrevert("ses_abc", "/test/project")

        assertEquals(1, mock.requestCount("/session/ses_abc/unrevert"))
        assertNotNull(mock.lastUnrevertPath)
        assertTrue(mock.lastUnrevertPath!!.startsWith("/session/ses_abc/unrevert?directory="))
        assertEquals("", mock.lastUnrevertBody)
        assertEquals("ses_test", session.id)
    }

    @Test
    fun `enhance prompt posts scoped request and returns rewritten text`() = runBlocking {
        val port = mock.start()
        val chat = KiloBackendChatManager(scope, TestLog())
        chat.start(OkHttpClient(), port, MutableSharedFlow())
        mock.enhanced = """{"text":"Use a focused implementation plan"}"""

        val result = chat.enhancePrompt("/test/project", "make a plan")

        assertEquals("Use a focused implementation plan", result)
        assertEquals(1, mock.requestCount("/enhance-prompt"))
        assertTrue(mock.lastEnhancePath!!.startsWith("/enhance-prompt?directory="))
        assertEquals("""{"text":"make a plan"}""", mock.lastEnhanceBody)
    }

    @Test
    fun `enhance prompt hides provider response details`() = runBlocking {
        val port = mock.start()
        val chat = KiloBackendChatManager(scope, TestLog())
        chat.start(OkHttpClient(), port, MutableSharedFlow())
        mock.enhanceStatus = 500
        mock.enhanced = """{"error":"provider unavailable"}"""

        val error = assertFailsWith<RuntimeException> {
            chat.enhancePrompt("/test/project", "make a plan")
        }

        assertEquals("Enhance prompt failed: HTTP 500", error.message)
    }

    @Test
    fun `prompt failure includes CLI response body summary`() {
        val port = mock.start()
        val chat = KiloBackendChatManager(scope, TestLog())
        chat.start(OkHttpClient(), port, MutableSharedFlow())
        mock.promptStatus = 400
        mock.promptResponse = """{"issues":[{"message":"invalid source type"}]}"""

        val error = assertFailsWith<RuntimeException> {
            chat.prompt("ses_abc", "/test/project", PromptDto(parts = listOf(PromptPartDto(type = "text", text = "hello"))))
        }

        assertTrue(error.message!!.contains("prompt_async failed: HTTP 400"), error.message)
        assertTrue(error.message!!.contains("chars="), error.message)
    }

    @Test
    fun `enhance prompt cancels the HTTP request with its coroutine`() = runBlocking {
        val port = mock.start()
        val chat = KiloBackendChatManager(scope, TestLog())
        chat.start(OkHttpClient(), port, MutableSharedFlow())
        val gate = CountDownLatch(1)
        mock.responseGate = gate
        val request = async(Dispatchers.Default) { chat.enhancePrompt("/test/project", "make a plan") }
        assertTrue(mock.awaitRequestCount("/enhance-prompt", 1))

        request.cancelAndJoin()
        gate.countDown()

        assertTrue(request.isCancelled)
    }

    @Test
    fun `malformed session error logs warning and keeps collecting`() = runBlocking {
        val port = mock.start()
        val log = TestLog()
        val sse = MutableSharedFlow<SseEvent>(replay = 8)
        val chat = KiloBackendChatManager(scope, log)
        chat.start(OkHttpClient(), port, sse)

        val received = async(start = CoroutineStart.UNDISPATCHED) { withTimeout(5_000) { chat.events.first() } }
        withTimeout(5_000) { sse.subscriptionCount.first { it > 0 } }
        sse.emit(SseEvent("session.error", """{"payload":{"properties":{"sessionID":"ses_abc","error":42}}}"""))
        sse.emit(SseEvent("session.turn.open", """{"payload":{"properties":{"sessionID":"ses_abc"}}}"""))

        val event = received.await()
        assertTrue(event is ChatEventDto.TurnOpen)
        assertEquals("ses_abc", event.sessionID)
        assertTrue(log.messages.any { it.contains("route=chat-events parse=false type=session.error") }, log.messages.joinToString("\n"))
    }
}
