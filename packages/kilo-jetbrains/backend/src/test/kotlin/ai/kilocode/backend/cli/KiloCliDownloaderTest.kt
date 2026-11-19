package ai.kilocode.backend.cli

import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.apache.commons.compress.archivers.tar.TarArchiveEntry
import org.apache.commons.compress.archivers.tar.TarArchiveOutputStream
import org.junit.Assume.assumeFalse
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.ByteArrayOutputStream
import java.nio.file.Files
import java.security.MessageDigest
import java.util.Base64
import java.util.zip.GZIPOutputStream
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class KiloCliDownloaderTest {
    @get:Rule val folder = TemporaryFolder()
    private val version = "0.0.0-v2-123"
    private val calls = mutableListOf<String>()
    private var download = archive("kilo2 v$version")
    private val root get() = folder.root.toPath()
    private val http = OkHttpClient.Builder().addInterceptor { chain ->
        calls.add(chain.request().url.toString())
        Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK")
            .body(download.toResponseBody("application/gzip".toMediaType())).build()
    }.build()
    private val downloader get() = KiloCliDownloader(root, http) { null }

    private fun pin() = CliPin(version, "linux-x64", "sha512-" + Base64.getEncoder().encodeToString(
        MessageDigest.getInstance("SHA-512").digest(download)))

    private fun archive(banner: String, other: String = "package/bin/assets/grammar.wasm"): ByteArray {
        val out = ByteArrayOutputStream()
        TarArchiveOutputStream(GZIPOutputStream(out)).use { tar ->
            mapOf("package/LICENSE" to "license", "package/bin/kilo2" to "#!/bin/sh\ntest \"\$1\" = --version || exit 2\necho '$banner'\n", other to "asset").forEach { (name, text) ->
                val bytes = text.toByteArray()
                val entry = TarArchiveEntry(name)
                entry.setModTime(0L)
                entry.size = bytes.size.toLong()
                entry.mode = if (name.endsWith("kilo2")) 493 else 420
                tar.putArchiveEntry(entry)
                tar.write(bytes)
                tar.closeArchiveEntry()
            }
        }
        return out.toByteArray()
    }

    @Test fun `exact v2 package installs sidecars reuses cache and retains working install on failure`() = runBlocking {
        assumeFalse("Unix version fixture", System.getProperty("os.name").startsWith("Windows"))
        val pin = pin()
        val progress = mutableListOf<Int>()
        val exe = downloader.resolve(pin, emptyMap(), false, progress::add)
        assertEquals(listOf(pin.tarball), calls)
        assertEquals(listOf(0, 100), listOf(progress.first(), progress.last()))
        assertEquals("asset", Files.readString(exe.parent.resolve("assets/grammar.wasm")))
        assertEquals("license", Files.readString(exe.parent.parent.resolve("LICENSE")))
        assertEquals(exe, downloader.resolve(pin, emptyMap(), false) {})
        assertEquals(1, calls.size)
        download = archive("kilo v7.0.0")
        assertFailsWith<IllegalStateException> { downloader.resolve(pin, emptyMap(), true) {} }
        assertFailsWith<IllegalStateException> { downloader.resolve(pin(), emptyMap(), true) {} }
        assertTrue(Files.readString(exe).contains("kilo2 v$version"))
        Files.writeString(exe, "broken cache")
        download = archive("kilo2 v$version")
        assertEquals(exe, downloader.resolve(pin, emptyMap(), false) {})
        assertTrue(Files.readString(exe).contains("kilo2 v$version"))
    }

    @Test fun `tampered or traversing archives never install`() = runBlocking {
        val original = pin()
        download = archive("wrong", "package/bin/../../escaped")
        val hash = assertFailsWith<IllegalStateException> { downloader.resolve(original, emptyMap(), false) {} }
        assertTrue(hash.message.orEmpty().contains("checksum mismatch"))
        val path = assertFailsWith<IllegalStateException> { downloader.resolve(pin(), emptyMap(), false) {} }
        assertTrue(path.message.orEmpty().contains("Invalid CLI archive path"))
        assertFalse(root.resolve(version).resolve("linux-x64").toFile().exists())
    }

    @Test fun `release pin rejects latest and v1`() {
        for (bad in listOf("latest", "kilo-v2", "7.2.0", "../release"))
            assertFailsWith<IllegalArgumentException> { pin().copy(version = bad) }
    }

    @Test fun `bundled package verifies and reinstalls without contacting registry`() = runBlocking {
        assumeFalse("Unix version fixture", System.getProperty("os.name").startsWith("Windows"))
        val pin = pin()
        val resource = Files.write(root.resolve("${pin.platform}.tgz"), download)
        val bundled = KiloCliDownloader(root, http) { resource.toUri().toURL() }
        val exe = bundled.resolve(pin, emptyMap(), false) {}
        Files.writeString(exe, "damaged installation")
        bundled.resolve(pin, emptyMap(), true) {}
        assertTrue(Files.readString(exe).contains("kilo2 v$version"))
        Files.write(resource, byteArrayOf(0))
        assertFailsWith<IllegalStateException> { bundled.resolve(pin, emptyMap(), true) {} }
        assertTrue(calls.isEmpty())
    }
}
