package ai.kilocode.backend.cli

import ai.kilocode.backend.testing.TestLog
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.apache.commons.compress.archivers.tar.TarArchiveEntry
import org.apache.commons.compress.archivers.tar.TarArchiveOutputStream
import org.apache.commons.compress.compressors.gzip.GzipCompressorOutputStream
import org.junit.jupiter.api.io.TempDir
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.RandomAccessFile
import java.security.MessageDigest
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class KiloCliDownloaderTest {
    @TempDir
    lateinit var dir: File

    @Test
    fun `downloads extracts and caches pinned cli`() = runBlocking {
        MockWebServer().use { server ->
            val bytes = archive()
            server.enqueue(metadata(bytes))
            server.enqueue(MockResponse().setResponseCode(200).setBody(Buffer().write(bytes)))
            val seen = mutableListOf<CliDownload>()
            val log = TestLog()
            val cli = KiloCliDownloader(
                log = log,
                root = dir,
                baseUrl = server.url("/release").toString(),
                api = server.url("/api").toString(),
            ).resolve("1.2.3", onProgress = { seen.add(it) })

            assertTrue(cli.isFile)
            assertEquals(File(File(dir, "1.2.3"), KiloCliPlatform.current()).absolutePath, cli.parentFile.parentFile.absolutePath)
            assertEquals("#!/bin/sh\n", cli.readText())
            assertTrue(File(cli.parentFile, "kilo-sandbox-mutation-worker.js").isFile)
            assertEquals("/api/v1.2.3", server.takeRequest().path)
            assertEquals("/release/v1.2.3/kilo-${KiloCliPlatform.current()}.${KiloCliPlatform.archive()}", server.takeRequest().path)
            assertEquals(CliDownload(0, "1.2.3", KiloCliPlatform.current()), seen.first())
            assertTrue(seen.any { it.percent == 100 && it.version == "1.2.3" && it.platform == KiloCliPlatform.current() })
            assertTrue(
                log.messages.any {
                    it.startsWith("INFO: Kilo CLI 1.2.3 for ${KiloCliPlatform.current()} is not cached; downloading new release into ") &&
                        it.contains("/.tmp/")
                }
            )
            assertTrue(log.messages.any { it.contains("Kilo CLI path diagnostics:") && it.contains("cacheRoot=${dir.absolutePath}") })
            assertTrue(log.messages.any { it.contains("Kilo CLI cache target:") && it.contains("exe=${cli.absolutePath}") })
            assertTrue(log.messages.any { it.contains("Kilo CLI cache lock path:") && it.contains(File(dir, ".lock").canonicalPath) })

            val cachedProgress = mutableListOf<CliDownload>()
            val cached = KiloCliDownloader(
                log = log,
                root = dir,
                baseUrl = server.url("/release").toString(),
                api = server.url("/api").toString(),
            ).resolve("1.2.3", onProgress = { cachedProgress.add(it) })
            assertEquals(cli.absolutePath, cached.absolutePath)
            assertEquals(2, server.requestCount)
            assertTrue(cachedProgress.isEmpty())
            assertContains(log.messages, "INFO: Using cached Kilo CLI 1.2.3 for ${KiloCliPlatform.current()} at ${cli.absolutePath}")

            File(cli.parentFile.parentFile, ".complete").writeText("ok\n")
            server.enqueue(metadata(bytes))
            server.enqueue(MockResponse().setResponseCode(200).setBody(Buffer().write(bytes)))
            val stale = KiloCliDownloader(
                log = log,
                root = dir,
                baseUrl = server.url("/release").toString(),
                api = server.url("/api").toString(),
            ).resolve("1.2.3")
            assertEquals(cli.absolutePath, stale.absolutePath)
            assertEquals(4, server.requestCount)

            server.enqueue(metadata(bytes))
            server.enqueue(MockResponse().setResponseCode(200).setBody(Buffer().write(bytes)))
            val forced = KiloCliDownloader(
                log = log,
                root = dir,
                baseUrl = server.url("/release").toString(),
                api = server.url("/api").toString(),
            ).resolve("1.2.3", force = true)
            assertEquals(cli.absolutePath, forced.absolutePath)
            assertEquals(6, server.requestCount)
        }
    }

    @Test
    fun `prunes stale versions and removes the extracted archive`() = runBlocking {
        MockWebServer().use { server ->
            val stale = File(File(dir, "0.0.1"), KiloCliPlatform.current())
            assertTrue(stale.mkdirs())
            File(stale, "leftover").writeText("old")

            val bytes = archive()
            server.enqueue(metadata(bytes))
            server.enqueue(MockResponse().setResponseCode(200).setBody(Buffer().write(bytes)))
            val cli = KiloCliDownloader(
                root = dir,
                baseUrl = server.url("/release").toString(),
                api = server.url("/api").toString(),
            ).resolve("1.2.3")

            assertTrue(cli.isFile)
            assertFalse(File(dir, "0.0.1").exists())
            val archived = File(cli.parentFile.parentFile, "kilo-${KiloCliPlatform.current()}.${KiloCliPlatform.archive()}")
            assertFalse(archived.exists())
        }
    }

    @Test
    fun `forced resolve re-downloads and keeps only the active version`() = runBlocking {
        MockWebServer().use { server ->
            val first = archive("#!/bin/old\n")
            val next = archive("#!/bin/new\n")
            server.enqueue(metadata(first))
            server.enqueue(MockResponse().setResponseCode(200).setBody(Buffer().write(first)))
            server.enqueue(metadata(next))
            server.enqueue(MockResponse().setResponseCode(200).setBody(Buffer().write(next)))
            val cli = KiloCliDownloader(
                root = dir,
                baseUrl = server.url("/release").toString(),
                api = server.url("/api").toString(),
            )
            val old = cli.resolve("1.2.3")
            assertEquals("#!/bin/old\n", old.readText())
            assertEquals(2, server.requestCount)

            val forced = cli.resolve("1.2.3", force = true)
            assertTrue(forced.isFile)
            assertEquals("#!/bin/new\n", forced.readText())
            assertEquals(4, server.requestCount)
            assertEquals(listOf("1.2.3"), dir.listFiles()?.filter { it.isDirectory && !it.name.startsWith(".") }?.map { it.name })
        }
    }

    @Test
    fun `forced resolve keeps the existing cli when download fails`() = runBlocking {
        MockWebServer().use { server ->
            val bytes = archive("#!/bin/old\n")
            server.enqueue(metadata(bytes))
            server.enqueue(MockResponse().setResponseCode(200).setBody(Buffer().write(bytes)))
            server.enqueue(metadata(bytes))
            server.enqueue(MockResponse().setResponseCode(503).setBody("unavailable"))

            val cli = KiloCliDownloader(
                root = dir,
                baseUrl = server.url("/release").toString(),
                api = server.url("/api").toString(),
            ).resolve("1.2.3")
            val ex = assertFailsWith<IllegalStateException> {
                KiloCliDownloader(
                    root = dir,
                    baseUrl = server.url("/release").toString(),
                    api = server.url("/api").toString(),
                ).resolve("1.2.3", force = true)
            }

            assertContains(ex.message.orEmpty(), "Failed to download")
            assertTrue(cli.isFile)
            assertEquals("#!/bin/old\n", cli.readText())
            assertTrue(File(cli.parentFile.parentFile, ".complete").isFile)
        }
    }

    @Test
    fun `rejects cli archive with mismatched digest`() = runBlocking {
        MockWebServer().use { server ->
            val bytes = archive()
            server.enqueue(metadata("sha256:${sha256("different".toByteArray())}"))
            server.enqueue(MockResponse().setResponseCode(200).setBody(Buffer().write(bytes)))

            val ex = assertFailsWith<IllegalStateException> {
                KiloCliDownloader(
                    root = dir,
                    baseUrl = server.url("/release").toString(),
                    api = server.url("/api").toString(),
                ).resolve("1.2.3")
            }

            assertContains(ex.message.orEmpty(), "digest mismatch")
            assertFalse(File(File(File(dir, "1.2.3"), KiloCliPlatform.current()), ".complete").exists())
        }
    }

    @Test
    fun `fails clearly and logs when the release has no matching asset`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse().setResponseCode(200).setBody(
                    """{"assets":[{"name":"other.zip","digest":"sha256:${"a".repeat(64)}"}]}"""
                )
            )
            val log = TestLog()
            val ex = assertFailsWith<IllegalStateException> {
                KiloCliDownloader(
                    log = log,
                    root = dir,
                    baseUrl = server.url("/release").toString(),
                    api = server.url("/api").toString(),
                ).resolve("1.2.3")
            }
            val name = "kilo-${KiloCliPlatform.current()}.${KiloCliPlatform.archive()}"
            assertContains(ex.message.orEmpty(), "has no asset named $name")
            assertContains(ex.message.orEmpty(), "other.zip")
            assertTrue(log.messages.any { it.contains("has no asset named $name") })
        }
    }

    @Test
    fun `fails clearly and logs when the asset has no digest`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse().setResponseCode(200).setBody(
                    """{"assets":[{"name":"kilo-${KiloCliPlatform.current()}.${KiloCliPlatform.archive()}"}]}"""
                )
            )
            val log = TestLog()
            val ex = assertFailsWith<IllegalStateException> {
                KiloCliDownloader(
                    log = log,
                    root = dir,
                    baseUrl = server.url("/release").toString(),
                    api = server.url("/api").toString(),
                ).resolve("1.2.3")
            }
            assertContains(ex.message.orEmpty(), "has no digest yet")
            assertTrue(log.messages.any { it.contains("has no digest yet") })
        }
    }

    @Test
    fun `reports github api rate limits while resolving metadata`() = runBlocking {
        MockWebServer().use { server ->
            val reset = 1_800_000_000L
            server.enqueue(
                MockResponse()
                    .setResponseCode(403)
                    .setHeader("X-RateLimit-Limit", "60")
                    .setHeader("X-RateLimit-Remaining", "0")
                    .setHeader("X-RateLimit-Used", "60")
                    .setHeader("X-RateLimit-Reset", reset.toString())
                    .setBody("API rate limit exceeded")
            )
            val log = TestLog()

            val ex = assertFailsWith<IllegalStateException> {
                KiloCliDownloader(
                    log = log,
                    root = dir,
                    baseUrl = server.url("/release").toString(),
                    api = server.url("/api").toString(),
                ).resolve("1.2.3")
            }

            assertContains(ex.message.orEmpty(), "GitHub API rate limit exceeded")
            assertContains(ex.message.orEmpty(), "remaining=0")
            assertContains(ex.message.orEmpty(), "reset=2027-01-15T08:00:00Z")
            assertTrue(log.messages.any { it.contains("GitHub API rate limit hit") && it.contains("remaining=0") })
            assertEquals("/api/v1.2.3", server.takeRequest().path)
            assertEquals(1, server.requestCount)
        }
    }

    @Test
    fun `cache lock times out clearly when already held in this process`() = runBlocking {
        assertTrue(dir.mkdirs() || dir.isDirectory)
        val file = File(dir, ".lock")
        val log = TestLog()
        RandomAccessFile(file, "rw").channel.use { channel ->
            channel.lock().use {
                val ex = assertFailsWith<IllegalStateException> {
                    KiloCliDownloader(
                        log = log,
                        root = dir,
                        lockTimeoutMs = 50,
                    ).resolve("1.2.3")
                }

                assertContains(ex.message.orEmpty(), "Timed out waiting for Kilo CLI cache lock")
                assertContains(ex.message.orEmpty(), file.canonicalPath)
                assertTrue(log.messages.any { it.contains("Waiting for Kilo CLI cache lock") && it.contains(file.canonicalPath) })
                assertTrue(log.messages.any { it.contains("Timed out waiting for Kilo CLI cache lock") && it.contains(file.canonicalPath) })
            }
        }
    }

    private fun archive(script: String = "#!/bin/sh\n"): ByteArray {
        val files = mapOf(
            "bin/${KiloCliPlatform.exe()}" to script.toByteArray(),
            "bin/kilo-sandbox-mutation-worker.js" to "worker\n".toByteArray(),
        )
        if (KiloCliPlatform.archive() == "zip") return zip(files)
        return tar(files)
    }

    private fun metadata(bytes: ByteArray) = metadata("sha256:${sha256(bytes)}")

    private fun metadata(digest: String) = MockResponse().setResponseCode(200).setBody(
        """{"assets":[{"name":"kilo-${KiloCliPlatform.current()}.${KiloCliPlatform.archive()}","digest":"$digest"}]}"""
    )

    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(bytes)
        .joinToString("") { "%02x".format(it.toInt() and 0xff) }

    private fun zip(files: Map<String, ByteArray>): ByteArray {
        val out = ByteArrayOutputStream()
        ZipOutputStream(out).use { zip ->
            files.forEach { entry ->
                zip.putNextEntry(ZipEntry(entry.key))
                zip.write(entry.value)
                zip.closeEntry()
            }
        }
        return out.toByteArray()
    }

    private fun tar(files: Map<String, ByteArray>): ByteArray {
        val out = ByteArrayOutputStream()
        GzipCompressorOutputStream(out).use { gzip ->
            TarArchiveOutputStream(gzip).use { tar ->
                files.forEach { entry ->
                    val item = TarArchiveEntry(entry.key)
                    item.size = entry.value.size.toLong()
                    tar.putArchiveEntry(item)
                    tar.write(entry.value)
                    tar.closeArchiveEntry()
                }
            }
        }
        return out.toByteArray()
    }
}
