package ai.kilocode.log

import ai.kilocode.KiloPlugin
import com.intellij.openapi.application.ApplicationInfo
import com.intellij.openapi.application.PathManager
import com.intellij.openapi.diagnostic.Logger
import java.io.BufferedOutputStream
import java.io.OutputStream
import java.io.PrintWriter
import java.io.StringWriter
import java.lang.management.ManagementFactory
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.logging.ErrorManager
import java.util.logging.Formatter
import java.util.logging.Handler
import java.util.logging.Level
import java.util.logging.LogRecord

/**
 * Logging interface for the Kilo JetBrains plugin.
 *
 * In normal (non-sandbox) mode, output goes through IntelliJ's own [com.intellij.openapi.diagnostic.Logger],
 * which writes to the standard IDE log file, and to rotated `kilo.log*` files inside the IDE log directory.
 *
 * In sandbox mode (i.e. when running via `./gradlew runIde`, detected via the `idea.plugin.in.sandbox.mode`
 * system property), output is written only to `kilo.log*`.
 *
 * Usage:
 * ```kotlin
 * private val log = KiloLog.create(this::class.java)
 *
 * log.info("session started")
 * log.debug { "expensive: ${computeSomething()}" }  // lambda is only evaluated when debug is enabled
 * log.warn("unexpected state", exception)
 * ```
 *
 * The log level for the sandbox file can be controlled via the `kilo.dev.log.level` system property
 * (DEBUG, INFO, WARN, ERROR, OFF). Defaults to INFO.
 */
interface KiloLog {
    val isDebugEnabled: Boolean
    fun debug(block: () -> String)
    fun info(msg: String)
    fun warn(msg: String, t: Throwable? = null)
    fun error(msg: String, t: Throwable? = null)

    companion object {
        fun create(cls: Class<*>): KiloLog {
            return create(cls, sandbox())
        }

        internal fun create(cls: Class<*>, sandbox: Boolean): KiloLog = logger(
            sandbox = sandbox,
            intellij = { IntellijLog(cls) },
            file = { FileLog(cls) },
        )

        internal fun logger(sandbox: Boolean, intellij: () -> KiloLog, file: () -> KiloLog): KiloLog {
            if (sandbox) return file()
            return CompositeLog(intellij(), file())
        }

        fun sandbox(): Boolean = System.getProperty("idea.plugin.in.sandbox.mode", "false").toBoolean()

        /** Current diagnostic log file for this process (frontend or backend in split mode). */
        fun logFile(): Path = FileLog.logFile()

        fun payload(log: KiloLog? = null): Map<String, String> = buildMap {
            put("platform", "jetbrains")
            put("client", "jetbrains")
            put("feature", "jetbrains-plugin")
            runCatching {
                val info = ApplicationInfo.getInstance()
                put("editorName", info.fullApplicationName)
                put("jetbrainsBuild", info.build.asString())
            }.onFailure { log?.info("Could not read ApplicationInfo for environment payload: ${it.message}") }
            runCatching {
                val version = KiloPlugin.version()
                if (version != null) {
                    put("pluginVersion", version)
                    put("appVersion", version)
                }
            }.onFailure { log?.info("Could not read plugin version for environment payload: ${it.message}") }
        }
    }
}

internal class IntellijLog(cls: Class<*>) : KiloLog {
    private val delegate = Logger.getInstance(cls)
    override val isDebugEnabled: Boolean
        get() = delegate.isDebugEnabled
    override fun debug(block: () -> String) {
        if (delegate.isDebugEnabled) delegate.debug(block())
    }
    override fun info(msg: String) = delegate.info(msg)
    override fun warn(msg: String, t: Throwable?) {
        if (t != null) delegate.warn(msg, t) else delegate.warn(msg)
    }
    override fun error(msg: String, t: Throwable?) {
        if (t != null) delegate.error(msg, t) else delegate.error(msg)
    }
}

internal class FileLog(cls: Class<*>) : KiloLog {
    private val name = cls.name

    companion object {
        private const val LIMIT = 5_000_000
        private const val ROTATIONS = 2
        @Volatile
        private var initialized = false

        private val root: java.util.logging.Logger by lazy {
            val logger = java.util.logging.Logger.getLogger("ai.kilocode")
            val payload = KiloLog.payload().entries.joinToString(" ") { "${it.key}=${it.value}" }
            logger.addHandler(handler)
            logger.useParentHandlers = false
            logger.level = LogConfig.julLevel()
            initialized = true
            logger.log(Level.INFO, "environment payload: $payload")
            logger
        }

        private val handler: Handler by lazy {
            val dir = resolveLogDir()
            val path = dir.resolve("kilo.log")
            IntellijLog(FileLog::class.java).info("Kilo diagnostic log directory: $dir")
            deleteLegacyLogs(dir)
            val h = RotatingLogHandler(path, LIMIT, ROTATIONS)
            h.formatter = KiloFormatter()
            h
        }

        internal fun deleteLegacyLogs(dir: Path) {
            runCatching {
                Files.newDirectoryStream(dir, "kilo-dev.log*").use { files ->
                    files.forEach { Files.deleteIfExists(it) }
                }
            }.onFailure {
                IntellijLog(FileLog::class.java).warn("Could not delete legacy Kilo diagnostic logs in $dir", it)
            }
        }

        private fun resolveLogDir(): Path {
            val dir = PathManager.getLogDir()
            var current = dir
            var side: String? = null
            while (current.parent != null) {
                val name = current.fileName.toString()
                if (name.startsWith("log_run")) {
                    side = if (name.lowercase().contains("frontend")) "kilo-frontend" else "kilo-backend"
                }
                if (name == "kilo.jetbrains" && side != null) {
                    val target = current.resolve(side)
                    Files.createDirectories(target)
                    return target
                }
                current = current.parent
            }
            return dir
        }

        internal fun refreshLevel() {
            if (!initialized) return
            root.level = LogConfig.julLevel()
        }

        internal fun logFile(): Path = resolveLogDir().resolve("kilo.log")
    }

    override val isDebugEnabled: Boolean
        get() = root.isLoggable(Level.FINE)

    override fun debug(block: () -> String) {
        if (root.isLoggable(Level.FINE)) root.logp(Level.FINE, name, null, block())
    }
    override fun info(msg: String) = root.logp(Level.INFO, name, null, msg)
    override fun warn(msg: String, t: Throwable?) {
        if (t != null) root.logp(Level.WARNING, name, null, msg, t) else root.logp(Level.WARNING, name, null, msg)
    }
    override fun error(msg: String, t: Throwable?) {
        if (t != null) root.logp(Level.SEVERE, name, null, msg, t) else root.logp(Level.SEVERE, name, null, msg)
    }
}

internal class RotatingLogHandler(
    private val path: Path,
    private val limit: Int,
    private val count: Int,
) : Handler() {
    // The stream stays open across records; it is reopened only after a rotation. `size` tracks the
    // current file length in memory so the hot logging path avoids per-record open/close and stat calls.
    private var out: OutputStream? = null
    private var size: Long = 0

    init {
        Files.createDirectories(path.parent)
    }

    @Synchronized
    override fun publish(record: LogRecord) {
        if (!isLoggable(record)) return
        runCatching {
            val bytes = formatter.format(record).toByteArray(StandardCharsets.UTF_8)
            ensureOpen()
            if (limit > 0 && count > 0 && size + bytes.size > limit) {
                rotate()
                ensureOpen()
            }
            val stream = out ?: return@runCatching
            stream.write(bytes)
            stream.flush()
            size += bytes.size
        }.onFailure {
            val err = if (it is Exception) it else RuntimeException(it)
            reportError(null, err, ErrorManager.WRITE_FAILURE)
        }
    }

    @Synchronized
    override fun flush() {
        runCatching { out?.flush() }
    }

    @Synchronized
    override fun close() {
        runCatching { out?.close() }
        out = null
    }

    private fun ensureOpen() {
        if (out != null) return
        out = BufferedOutputStream(Files.newOutputStream(path, StandardOpenOption.CREATE, StandardOpenOption.APPEND))
        size = runCatching { Files.size(path) }.getOrDefault(0L)
    }

    private fun rotate() {
        runCatching { out?.close() }
        out = null
        for (i in count - 1 downTo 0) {
            val src = rotated(i)
            val dst = rotated(i + 1)
            if (i == count - 1) {
                Files.deleteIfExists(src)
                continue
            }
            if (Files.exists(src)) Files.move(src, dst, StandardCopyOption.REPLACE_EXISTING)
        }
        if (Files.exists(path)) Files.move(path, rotated(0), StandardCopyOption.REPLACE_EXISTING)
        size = 0
    }

    private fun rotated(i: Int): Path = path.resolveSibling("${path.fileName}.$i")
}

internal class KiloFormatter : Formatter() {
    private val start = ManagementFactory.getRuntimeMXBean().startTime
    private val fmt = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss,SSS")

    override fun format(record: LogRecord): String {
        val time = Instant.ofEpochMilli(record.millis).atZone(ZoneId.systemDefault())
        val elapsed = record.millis - start
        val level = when (record.level) {
            Level.FINE -> "DEBUG"
            Level.INFO -> "INFO"
            Level.WARNING -> "WARN"
            Level.SEVERE -> "ERROR"
            else -> record.level.name
        }
        val category = record.sourceClassName ?: record.loggerName ?: "kilo.dev"
        val sb = StringBuilder()
        sb.append(fmt.format(time))
        sb.append(" [")
        sb.append(elapsed.toString().padStart(8))
        sb.append("]   ")
        sb.append(level.padEnd(5))
        sb.append(" - #")
        sb.append(category)
        sb.append(" - ")
        sb.append(formatMessage(record))
        sb.append('\n')
        if (record.thrown != null) {
            val sw = StringWriter()
            record.thrown.printStackTrace(PrintWriter(sw))
            sb.append(sw)
        }
        return sb.toString()
    }
}

internal class CompositeLog(vararg val delegates: KiloLog) : KiloLog {
    override val isDebugEnabled: Boolean
        get() = delegates.any { it.isDebugEnabled }
    override fun debug(block: () -> String) {
        val active = delegates.filter { it.isDebugEnabled }
        if (active.isEmpty()) return
        val msg = block()
        active.forEach { it.debug { msg } }
    }
    override fun info(msg: String) = delegates.forEach { it.info(msg) }
    override fun warn(msg: String, t: Throwable?) = delegates.forEach { it.warn(msg, t) }
    override fun error(msg: String, t: Throwable?) = delegates.forEach { it.error(msg, t) }
}
