package ai.kilocode.client.speech

import org.junit.jupiter.api.Test
import java.io.ByteArrayInputStream
import javax.sound.sampled.AudioFormat
import javax.sound.sampled.AudioSystem
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals

class SpeechRecorderTest {
    @Test
    fun `encodes captured PCM as a readable WAV file`() {
        val format = AudioFormat(AudioFormat.Encoding.PCM_SIGNED, 16000f, 16, 1, 2, 16000f, false)
        val pcm = ByteArray(3200) { index -> (index % 127).toByte() }

        val data = wav(pcm, format)
        val stream = AudioSystem.getAudioInputStream(ByteArrayInputStream(data))

        stream.use {
            assertEquals(format.sampleRate, it.format.sampleRate)
            assertEquals(format.sampleSizeInBits, it.format.sampleSizeInBits)
            assertEquals(format.channels, it.format.channels)
            assertEquals(format.isBigEndian, it.format.isBigEndian)
            assertContentEquals(pcm, it.readAllBytes())
        }
    }
}
