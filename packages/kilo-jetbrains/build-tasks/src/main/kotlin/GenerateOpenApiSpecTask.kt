import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.gzip.GzipCompressorInputStream
import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.provider.Property
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.Internal
import org.gradle.api.tasks.OutputFile
import org.gradle.api.tasks.TaskAction
import org.gradle.process.ExecOperations
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URI
import java.security.MessageDigest
import java.time.Instant
import java.util.zip.ZipInputStream
import javax.inject.Inject

/**
 * Generates the CLI OpenAPI spec from the pinned release binary.
 */
abstract class GenerateOpenApiSpecTask : DefaultTask() {
    companion object {
        private val DIGEST = Regex("^sha256:[a-f0-9]{64}$")
        private val JSON = Json { ignoreUnknownKeys = true }
        private const val API = "https://api.github.com/repos/Kilo-Org/kilocode/releases/tags"
    }

    @get:Input
    abstract val cliVersion: Property<String>

    @get:Internal
    abstract val token: Property<String>

    @get:Internal
    abstract val cacheDir: DirectoryProperty

    @get:OutputFile
    abstract val spec: RegularFileProperty

    @get:Inject
    abstract val exec: ExecOperations

    @TaskAction
    fun run() {
        val kilo = resolve()
        val out = ByteArrayOutputStream()
        val err = ByteArrayOutputStream()
        val result = exec.exec {
            commandLine(kilo.absolutePath, "generate")
            standardOutput = out
            errorOutput = err
            isIgnoreExitValue = true
        }
        if (result.exitValue != 0) {
            throw GradleException(
                "kilo generate failed with exit code ${result.exitValue}.\n" +
                    err.toString(Charsets.UTF_8).take(2000)
            )
        }
        val json = out.toString(Charsets.UTF_8)
        if (!json.trimStart().startsWith("{")) {
            throw GradleException(
                "kilo generate did not produce JSON.\n" +
                    "stdout: ${json.take(200)}\n" +
                    "stderr: ${err.toString(Charsets.UTF_8).take(500)}"
            )
        }
        spec.get().asFile.also { it.parentFile.mkdirs() }.writeText(json)
    }

    private fun resolve(): File {
        val version = cliVersion.get()
        val platform = platform()
        val ext = if (platform.startsWith("linux-")) "tar.gz" else "zip"
        val dir = cacheDir.dir(version).map { it.dir(platform) }.get().asFile
        val exe = File(dir, "bin/${exe()}")
        val done = File(dir, ".complete")
        val cached = done.takeIf { it.isFile }?.readText()?.trim()
        val archive = File(dir, "kilo-$platform.$ext")
        if (exe.isFile && cached != null && cached.matches(DIGEST) && matches(archive, cached)) {
            if (!windows()) exe.setExecutable(true)
            return exe
        }

        val name = "kilo-$platform.$ext"
        val digest = asset(version, name)
        if (dir.exists() && !dir.deleteRecursively()) {
            throw GradleException("Failed to delete cached pinned Kilo CLI under ${dir.absolutePath}")
        }
        if (!dir.isDirectory && !dir.mkdirs()) {
            throw GradleException("Failed to create pinned Kilo CLI cache directory ${dir.absolutePath}")
        }
        download("https://github.com/Kilo-Org/kilocode/releases/download/v$version/kilo-$platform.$ext", archive)
        verify(archive, digest)
        extract(archive, dir)
        if (!exe.isFile) throw GradleException("Downloaded CLI archive did not contain bin/${exe()}")
        if (!windows()) exe.setExecutable(true)
        done.writeText("$digest\n")
        return exe
    }

    private fun asset(version: String, name: String): String {
        val url = "$API/v$version"
        logger.lifecycle("Fetching pinned Kilo CLI release metadata from $url")
        val conn = URI(url).toURL().openConnection() as HttpURLConnection
        conn.connectTimeout = 30_000
        conn.readTimeout = 120_000
        conn.instanceFollowRedirects = true
        conn.setRequestProperty("Accept", "application/vnd.github+json")
        token.getOrNull()
            ?.trim()
            ?.takeIf { it.isNotEmpty() }
            ?.let { conn.setRequestProperty("Authorization", "Bearer $it") }
        try {
            val code = conn.responseCode
            if (code !in 200..299) {
                val info = rate(conn)
                val body = runCatching { conn.errorStream?.bufferedReader()?.use { it.readText() } }
                    .getOrNull()
                    ?.take(500)
                val detail = if (body.isNullOrBlank()) "" else ": $body"
                if (limited(conn, code)) {
                    throw GradleException(
                        "GitHub API rate limit exceeded while fetching pinned Kilo CLI release metadata ($info)$detail"
                    )
                }
                throw GradleException("Failed to fetch pinned Kilo CLI release metadata: HTTP $code from $url ($info)$detail")
            }
            val body = conn.inputStream.bufferedReader().use { it.readText() }
            val digest = JSON.parseToJsonElement(body).jsonObject["assets"]?.jsonArray
                ?.firstOrNull { it.jsonObject["name"]?.jsonPrimitive?.contentOrNull == name }
                ?.jsonObject?.get("digest")?.jsonPrimitive?.contentOrNull
                ?: throw GradleException("Pinned Kilo CLI release $version did not include $name")
            if (!digest.matches(DIGEST)) throw GradleException("Pinned Kilo CLI release $version asset $name has invalid digest")
            return digest
        } finally {
            conn.disconnect()
        }
    }

    private fun rate(conn: HttpURLConnection): String {
        val reset = conn.getHeaderField("X-RateLimit-Reset")
            ?.toLongOrNull()
            ?.let { Instant.ofEpochSecond(it).toString() }
        return "limit=${conn.getHeaderField("X-RateLimit-Limit")} remaining=${conn.getHeaderField("X-RateLimit-Remaining")} " +
            "used=${conn.getHeaderField("X-RateLimit-Used")} reset=$reset retryAfter=${conn.getHeaderField("Retry-After")}"
    }

    private fun limited(conn: HttpURLConnection, code: Int) =
        code == 429 || (code == 403 && conn.getHeaderField("X-RateLimit-Remaining") == "0")

    private fun download(url: String, file: File) {
        logger.lifecycle("Downloading pinned Kilo CLI from $url")
        val conn = URI(url).toURL().openConnection() as HttpURLConnection
        conn.connectTimeout = 30_000
        conn.readTimeout = 120_000
        conn.instanceFollowRedirects = true
        try {
            val code = conn.responseCode
            if (code !in 200..299) throw GradleException("Failed to download pinned Kilo CLI: HTTP $code from $url")
            conn.inputStream.use { input ->
                file.outputStream().use { output -> input.copyTo(output) }
            }
        } finally {
            conn.disconnect()
        }
    }

    private fun verify(file: File, digest: String) {
        val actual = sum(file)
        if (actual == digest) return
        if (file.exists() && !file.delete()) logger.warn("Failed to delete invalid pinned Kilo CLI archive ${file.absolutePath}")
        throw GradleException("Pinned Kilo CLI archive digest mismatch for ${file.name}: expected $digest, got $actual")
    }

    private fun matches(file: File, digest: String) = file.isFile && sum(file) == digest

    private fun sum(file: File) = "sha256:${sha256(file)}"

    private fun sha256(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        file.inputStream().buffered().use { input ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (true) {
                val n = input.read(buffer)
                if (n < 0) break
                md.update(buffer, 0, n)
            }
        }
        return md.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }
    }

    private fun extract(file: File, dir: File) {
        if (file.name.endsWith(".zip")) {
            ZipInputStream(file.inputStream().buffered()).use { zip ->
                while (true) {
                    val entry = zip.nextEntry ?: break
                    write(dir, entry.name, entry.isDirectory) { out -> zip.copyTo(out) }
                    zip.closeEntry()
                }
            }
            return
        }
        TarArchiveInputStream(GzipCompressorInputStream(file.inputStream().buffered())).use { tar ->
            while (true) {
                val entry = tar.nextEntry ?: break
                write(dir, entry.name, entry.isDirectory) { out -> tar.copyTo(out) }
            }
        }
    }

    private fun write(dir: File, name: String, directory: Boolean, copy: (java.io.OutputStream) -> Unit) {
        val path = if (name.startsWith("bin/")) name else "bin/$name"
        val target = File(dir, path).canonicalFile
        val base = dir.canonicalFile
        if (target != base && !target.path.startsWith(base.path + File.separator)) {
            throw GradleException("Archive entry escapes target directory: $name")
        }
        if (directory) {
            target.mkdirs()
            return
        }
        target.parentFile.mkdirs()
        target.outputStream().use(copy)
        if (!windows() && (target.name == "kilo" || target.name == "bwrap")) target.setExecutable(true)
    }

    private fun platform(): String {
        val os = System.getProperty("os.name").lowercase()
        val name = when {
            os.contains("mac") || os.contains("darwin") -> "darwin"
            os.contains("linux") -> "linux"
            os.contains("windows") -> "windows"
            else -> throw GradleException("Unsupported OS: ${System.getProperty("os.name")}")
        }
        val arch = when (System.getProperty("os.arch").lowercase()) {
            "aarch64", "arm64" -> "arm64"
            "x86_64", "amd64" -> "x64"
            else -> throw GradleException("Unsupported architecture: ${System.getProperty("os.arch")}")
        }
        return "$name-$arch"
    }

    private fun exe() = if (windows()) "kilo.exe" else "kilo"

    private fun windows() = System.getProperty("os.name").lowercase().contains("windows")
}
