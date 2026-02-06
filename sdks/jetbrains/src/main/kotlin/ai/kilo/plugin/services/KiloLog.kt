package ai.kilo.plugin.services

import com.intellij.openapi.application.PathManager
import com.intellij.openapi.diagnostic.Logger
import java.io.File
import java.io.FileWriter
import java.io.PrintWriter
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

/**
 * Plugin-specific logger that writes to a dedicated kilo.log file
 * in addition to IntelliJ's standard idea.log.
 */
class KiloLog private constructor(private val delegate: Logger) {

    fun info(message: String) {
        delegate.info(message)
        writeToFile("INFO", delegate.toString(), message)
    }

    fun warn(message: String) {
        delegate.warn(message)
        writeToFile("WARN", delegate.toString(), message)
    }

    fun warn(message: String, throwable: Throwable) {
        delegate.warn(message, throwable)
        writeToFile("WARN", delegate.toString(), message, throwable)
    }

    fun error(message: String) {
        delegate.error(message)
        writeToFile("ERROR", delegate.toString(), message)
    }

    fun error(message: String, throwable: Throwable) {
        delegate.error(message, throwable)
        writeToFile("ERROR", delegate.toString(), message, throwable)
    }

    fun debug(message: String) {
        delegate.debug(message)
        writeToFile("DEBUG", delegate.toString(), message)
    }

    companion object {
        private val formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss.SSS")
        private val logFile = File(PathManager.getLogPath(), "kilo.log")

        fun getInstance(clazz: Class<*>): KiloLog {
            return KiloLog(Logger.getInstance(clazz))
        }

        @Synchronized
        private fun writeToFile(level: String, category: String, message: String, throwable: Throwable? = null) {
            try {
                PrintWriter(FileWriter(logFile, true)).use { writer ->
                    val timestamp = LocalDateTime.now().format(formatter)
                    writer.println("$timestamp [$level] $category - $message")
                    throwable?.printStackTrace(writer)
                }
            } catch (_: Exception) {
                // Don't let logging failures break the plugin
            }
        }
    }
}
