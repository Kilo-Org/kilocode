package ai.kilocode.backend.app

import ai.kilocode.backend.testing.MockCliServer
import ai.kilocode.backend.testing.TestLog
import ai.kilocode.rpc.dto.ModelSelectionDto
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.runBlocking
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
}
