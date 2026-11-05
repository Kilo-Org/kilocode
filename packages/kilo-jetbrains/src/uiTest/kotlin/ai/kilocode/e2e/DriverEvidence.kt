package ai.kilocode.e2e

import java.nio.file.Files
import java.nio.file.Path
import java.security.MessageDigest
import java.time.Instant

/**
 * Builds the K1 v1 DriverResult and the driver-owned artifacts. Every string written here passes
 * through [Redactor], so credentials from the descriptor can never reach evidence.
 */
class DriverEvidence(
    private val request: DriverRequest,
    descriptor: FixtureDescriptor?,
) {
    private val redactor = Redactor(
        listOf(
            descriptor?.credentials?.apiKey,
            descriptor?.credentials?.orgId,
            descriptor?.cleanup?.token,
        ),
    )
    private val lines = mutableListOf<String>()
    private val assertions = mutableListOf<Assertion>()
    private val lastState = linkedMapOf<String, String>()
    private val logs = mutableListOf<String>()
    private val screenshots = mutableListOf<String>()
    private val snapshots = mutableListOf<String>()
    val startedAt: String = Instant.now().toString()
    val artifactsDir: Path = Path.of(request.artifactsDir)

    fun redact(value: String): String = redactor.text(value) ?: value

    var ideName: String = "IntelliJ IDEA"
    var ideVersion: String = "unknown"

    fun log(line: String) {
        lines += "${Instant.now()} $line"
    }

    fun pass(name: String, detail: String? = null) {
        assertions += Assertion(name, "passed", detail)
        log("assertion passed: $name${detail?.let { " ($it)" } ?: ""}")
    }

    fun fail(name: String, detail: String? = null) {
        assertions += Assertion(name, "failed", detail)
        log("assertion failed: $name${detail?.let { " ($it)" } ?: ""}")
    }

    fun state(key: String, value: Any?) {
        if (value == null) return
        lastState[redactor.text(key) ?: key] = redactor.text(value.toString()) ?: value.toString()
    }

    fun artifact(kind: String, file: Path): String? {
        val rel = relative(file) ?: return null
        when (kind) {
            "log" -> logs += rel
            "screenshot" -> screenshots += rel
            "snapshot" -> snapshots += rel
            else -> error("unknown artifact kind: $kind")
        }
        return rel
    }

    fun canPass(): Boolean {
        if (hasFailure()) return false
        val expected = request.scenario.expected.ui + request.scenario.expected.model
        return expected.all { name -> assertions.lastOrNull { it.name == name }?.status == "passed" }
    }

    fun hasFailure(): Boolean = assertions.any { it.status == "failed" }

    fun write(resultPath: Path) {
        val passed = canPass()
        // On a passing run only claim capabilities the adapter exercises. On a failed run echo the
        // requirements: K1 checks capabilities before outcome, so an empty list would hide the real
        // diagnostic assertion behind a capability error.
        val capabilities = if (passed) {
            request.scenario.requires.filter { it in SUPPORTED_CAPABILITIES }.distinct()
        } else {
            request.scenario.requires.distinct()
        }
        writeDriverLog()
        val result = DriverResult(
            runId = request.runId,
            scenarioId = request.scenario.id,
            lane = request.scenario.lane,
            driver = DriverInfo("jetbrains-starter", "1"),
            ide = IdeInfo(redactor.text(ideName) ?: ideName, redactor.text(ideVersion) ?: ideVersion),
            provenance = Provenance(
                clientHash = hash(System.getProperty("kilo.e2e.pluginArchive")),
                cliHash = hash(System.getProperty("kilo.e2e.cliArchive")),
            ),
            capabilities = capabilities,
            outcome = if (passed) "passed" else "failed",
            startedAt = startedAt,
            endedAt = Instant.now().toString(),
            assertions = assertions.map { it.copy(detail = redactor.text(it.detail)) },
            lastState = redactor.map(lastState),
            artifacts = Artifacts(
                logs = redactor.strings(logs.distinct()),
                screenshots = redactor.strings(screenshots.distinct()),
                snapshots = redactor.strings(snapshots.distinct()),
            ),
        )
        DriverProtocol.write(resultPath, result)
        log("wrote driver result outcome=${result.outcome}")
    }

    companion object {
        // Only list capabilities this adapter actually exercises so the K1 capability gate cannot pass
        // a scenario the driver does not implement. J2 adds "transcript.read" when it reads transcripts.
        private val SUPPORTED_CAPABILITIES = emptySet<String>()
    }

    fun copyIdeLogs(backend: Path?, frontend: Path?) {
        copyLogs("ide-backend", backend)
        copyLogs("ide-frontend", frontend)
    }

    private fun writeDriverLog() {
        val dir = Path.of(request.artifactsDir, "logs")
        runCatching {
            Files.createDirectories(dir)
            val file = dir.resolve("driver.log")
            Files.writeString(file, redactor.text(lines.joinToString("\n")) ?: "")
            artifact("log", file)
        }.onFailure {
            lines += "${Instant.now()} could not write driver.log: ${it::class.simpleName}: ${it.message}"
        }
    }

    private fun copyLogs(name: String, source: Path?) {
        if (source == null || !Files.isDirectory(source)) return
        runCatching {
            val dir = Path.of(request.artifactsDir, "logs", name)
            Files.createDirectories(dir)
            Files.list(source).use { stream ->
                stream.filter { Files.isRegularFile(it) }
                    .filter { it.fileName.toString().endsWith(".log") || it.fileName.toString().endsWith(".txt") }
                    .filter { Files.size(it) <= 8L * 1024 * 1024 }
                    .forEach { file ->
                        runCatching {
                            val target = dir.resolve(file.fileName)
                            val body = redactor.text(Files.readString(file)) ?: ""
                            Files.writeString(target, body)
                            artifact("log", target)
                        }.onFailure {
                            log("could not copy ${file.fileName}: ${it::class.simpleName}: ${it.message}")
                        }
                    }
            }
            log("copied $name logs from $source")
        }.onFailure {
            log("could not copy $name logs from $source: ${it::class.simpleName}: ${it.message}")
        }
    }

    private fun relative(file: Path): String? {
        if (!Files.exists(file)) return null
        val root = Path.of(request.runDir).toAbsolutePath().normalize()
        val target = file.toAbsolutePath().normalize()
        val rel = runCatching { root.relativize(target) }.getOrNull() ?: return null
        if (rel.startsWith("..")) return null
        return rel.toString().replace('\\', '/')
    }

    private fun hash(path: String?): String? {
        if (path.isNullOrBlank()) return null
        val file = Path.of(path)
        if (!Files.isRegularFile(file)) return null
        return runCatching {
            val digest = MessageDigest.getInstance("SHA-256")
            Files.newInputStream(file).use { input ->
                val buffer = ByteArray(1024 * 1024)
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    digest.update(buffer, 0, read)
                }
            }
            digest.digest().joinToString("") { "%02x".format(it) }
        }.getOrNull()
    }
}
