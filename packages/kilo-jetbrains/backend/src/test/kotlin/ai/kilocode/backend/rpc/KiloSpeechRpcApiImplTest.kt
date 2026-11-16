package ai.kilocode.backend.rpc

import ai.kilocode.backend.app.KiloAppState
import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.testing.FakeCliServer
import ai.kilocode.backend.testing.MockCliServer
import ai.kilocode.backend.testing.TestLog
import ai.kilocode.rpc.dto.SpeechModelDto
import ai.kilocode.rpc.dto.SpeechRequestDto
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.Base64
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class KiloSpeechRpcApiImplTest {
    private val mock = MockCliServer()
    private val log = TestLog()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val apps = mutableListOf<KiloBackendAppService>()

    @AfterTest
    fun tearDown() = runBlocking {
        apps.forEach { it.dispose() }
        apps.clear()
        scope.cancel()
        mock.close()
    }

    @Test
    fun `lists models and transcribes WAV bytes through core`() = runBlocking {
        mock.transcriptionModels = """[{"id":"speech/model","name":"Speech Model"}]"""
        mock.transcription = """{"text":"dictated prompt"}"""
        val rpc = KiloAppRpcApiImpl(app())
        val dir = "/test project"

        assertEquals(listOf(SpeechModelDto("speech/model", "Speech Model")), rpc.transcriptionModels(dir))
        val result = rpc.transcribe(
            dir,
            SpeechRequestDto(byteArrayOf(1, 2, 3), "speech/model", prompt = "Kilo prompt"),
        )

        assertEquals("dictated prompt", result.text)
        assertEquals("directory=/test project", query(requireNotNull(mock.lastTranscriptionModelsPath)))
        assertEquals("directory=/test project", query(requireNotNull(mock.lastTranscriptionPath)))
        val body = Json.parseToJsonElement(requireNotNull(mock.lastTranscriptionBody)).jsonObject
        assertEquals("speech/model", body.getValue("model").jsonPrimitive.content)
        assertEquals("Kilo prompt", body.getValue("prompt").jsonPrimitive.content)
        val audio = body.getValue("input_audio").jsonObject
        assertEquals("wav", audio.getValue("format").jsonPrimitive.content)
        assertEquals(Base64.getEncoder().encodeToString(byteArrayOf(1, 2, 3)), audio.getValue("data").jsonPrimitive.content)
    }

    @Test
    fun `bounds a stalled transcription request`() = runBlocking {
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        mock.transcriptionEntered = entered
        mock.transcriptionRelease = release
        val rpc = KiloAppRpcApiImpl(app(), speechTimeout = 1)

        try {
            assertFailsWith<java.io.IOException> {
                rpc.transcribe(null, SpeechRequestDto(byteArrayOf(1), "speech/model"))
            }
            assertTrue(entered.await(5, TimeUnit.SECONDS))
        } finally {
            release.countDown()
        }
    }

    @Test
    fun `caps a large core error response`() = runBlocking {
        val body = "x".repeat(100_000)
        mock.transcription = body
        mock.transcriptionStatus = 500
        val rpc = KiloAppRpcApiImpl(app())

        val err = assertFailsWith<java.io.IOException> {
            rpc.transcribe(null, SpeechRequestDto(byteArrayOf(1), "speech/model"))
        }

        assertEquals("Kilo Core request failed (500): ${body.take(1_000)}", err.message)
    }

    private suspend fun app(): KiloBackendAppService {
        val app = KiloBackendAppService.create(scope, FakeCliServer(mock), log).also { apps.add(it) }
        app.connect()
        val state = assertNotNull(
            withTimeoutOrNull(35_000) {
                app.appState.first {
                    it is KiloAppState.Ready || it is KiloAppState.Error || it is KiloAppState.MigrationRequired
                }
            },
            "App startup timed out in ${app.appState.value}; logs=${log.messages}",
        )
        assertIs<KiloAppState.Ready>(state, "App startup failed; logs=${log.messages}")
        return app
    }

    private fun query(path: String): String =
        URLDecoder.decode(path.substringAfter('?'), StandardCharsets.UTF_8)
}
