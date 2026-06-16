package ai.kilocode.log

import ai.kilocode.KiloPlugin
import com.intellij.openapi.application.ApplicationInfo
import com.intellij.openapi.application.PathManager
import com.intellij.openapi.diagnostic.Logger
import java.io.PrintWriter
import java.io.StringWriter
import java.lang.management.ManagementFactory
import java.nio.file.Files
import java.nio.file.Path
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.logging.FileHandler
import java.util.logging.Formatter
import java.util.logging.Level
import java.util.logging.LogRecord

/**
 * Logging interface for the Kilo JetBrains plugin.
 *
 * In normal (non-sandbox) mode, all output goes through IntelliJ's own [com.intellij.openapi.diagnostic.Logger],
 * which writes to the standard IDE log file.
 *
 * In sandbox mode (i.e. when running via `./gradlew runIde`, detected via the `idea.plugin.in.sandbox.mode`
 * system property), output is written only to a `kilo-dev.log` file inside the IDE log directory. RC plugin builds
 * write to both IntelliJ's log and `kilo-dev.log`.
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
            if (sandbox()) return FileLog(cls)
            val intellij = IntellijLog(cls)
            if (!runCatching { KiloPlugin.isRc() }.getOrDefault(false)) return intellij
            return CompositeLog(intellij, FileLog(cls))
        }

        fun sandbox(): Boolean = System.getProperty("idea.plugin.in.sandbox.mode", "false").toBoolean()

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
        private val level: Level by lazy { resolveLevel() }

        private val root: java.util.logging.Logger by lazy {
            val logger = java.util.logging.Logger.getLogger("ai.kilocode")
            val payload = KiloLog.payload().entries.joinToString(" ") { "${it.key}=${it.value}" }
            logger.addHandler(handler)
            logger.useParentHandlers = false
            logger.level = level
            logger.log(Level.INFO, "environment payload: $payload")
            logger
        }

        private val handler: FileHandler by lazy {
            val dir = resolveLogDir()
            val path = dir.resolve("kilo-dev.log")
            val h = FileHandler(path.toString(), true)
            h.formatter = KiloFormatter()
            h
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

        private fun resolveLevel(): Level {
            val prop = System.getProperty("kilo.dev.log.level") ?: return Level.INFO
            return when (prop.uppercase()) {
                "DEBUG" -> Level.FINE
                "INFO" -> Level.INFO
                "WARN", "WARNING" -> Level.WARNING
                "ERROR" -> Level.SEVERE
                "OFF" -> Level.OFF
                else -> Level.ALL
            }
        }
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
