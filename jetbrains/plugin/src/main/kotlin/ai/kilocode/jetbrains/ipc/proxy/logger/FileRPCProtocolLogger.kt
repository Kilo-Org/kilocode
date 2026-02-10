package ai.kilocode.jetbrains.ipc.proxy.logger

import ai.kilocode.jetbrains.monitoring.ScopeRegistry
import ai.kilocode.jetbrains.monitoring.DisposableTracker
import ai.kilocode.jetbrains.ipc.proxy.IRPCProtocolLogger
import ai.kilocode.jetbrains.ipc.proxy.RequestInitiator
import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.io.BufferedWriter
import java.io.File
import java.io.FileWriter
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * File-based RPC protocol logger
 * Logs RPC communication to a file
 */
class FileRPCProtocolLogger : IRPCProtocolLogger, Disposable {
    private val logger = Logger.getInstance(FileRPCProtocolLogger::class.java)

    // Total incoming bytes
    private var totalIncoming = 0

    // Total outgoing bytes
    private var totalOutgoing = 0

    // Log directory
    private var logDir: Path? = null

    // Log file
    private var logFile: File? = null

    // Log file writer
    private var writer: BufferedWriter? = null

    // Log queue
    private val logQueue = LinkedBlockingQueue<String>()

    // Whether initialized
    private val isInitialized = AtomicBoolean(false)

    // Whether disposed
    private val isDisposed = AtomicBoolean(false)

    // Logger thread
    private var loggerThread: Thread? = null

    // Coroutine scope
    private val coroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    // Whether logging is enabled
    private val isEnabled = false

    init {
        if (!isEnabled) {
            logger.warn("FileRPCProtocolLogger not enabled")
        } else {
            // Create log directory
            val userHome = System.getProperty("user.home")
            logDir = Paths.get(userHome, ".ext_host", "log")

            // Ensure directory exists
            if (!Files.exists(logDir)) {
                Files.createDirectories(logDir)
            }

            // Create log filename, use timestamp for uniqueness
            val timestamp = SimpleDateFormat("yyyyMMdd_HHmmss").format(Date())
            logFile = logDir?.resolve("rpc_$timestamp-idea.log")?.toFile()

            // Create file writer
            writer = BufferedWriter(FileWriter(logFile))

            // Start logger thread
            startLoggerThread()

            // Write log header
            val startTime = formatTimestampWithMilliseconds(Date())
            val header = """
               |-------------------------------------------------------------
               | IDEA RPC Protocol Logger
               | Started at: $startTime
               | Log file: ${logFile?.absolutePath}
               |-------------------------------------------------------------
           
            """.trimMargin()

            logQueue.add(header)

            isInitialized.set(true)
            logger.info("FileRPCProtocolLogger initialized successfully, log file: ${logFile?.absolutePath}")
        }
    }

    /**
     * Start logger thread
     */
    private fun startLoggerThread() {
        loggerThread = thread(start = true, isDaemon = true, name = "RPC-Logger") {
            try {
                while (!isDisposed.get()) {
                    val logEntry = logQueue.take()
                    try {
                        writer?.write(logEntry)
                        writer?.newLine()
                        writer?.flush()
                    } catch (e: Exception) {
                        logger.error("Failed to write log file", e)
                    }
                }
            } catch (e: InterruptedException) {
                // Thread interrupted, exit normally
            } catch (e: Exception) {
                logger.error("Logger thread exception", e)
            }
        }
    }

    /**
     * Log incoming message
     */
    override fun logIncoming(msgLength: Int, req: Int, initiator: RequestInitiator, str: String, data: Any?) {
        if (!isInitialized.get()) {
            return
        }

        totalIncoming += msgLength
        logMessage("Ext → IDEA", totalIncoming, msgLength, req, initiator, str, data)
    }

    /**
     * Log outgoing message
     */
    override fun logOutgoing(msgLength: Int, req: Int, initiator: RequestInitiator, str: String, data: Any?) {
        if (!isInitialized.get()) {
            return
        }

        totalOutgoing += msgLength
        logMessage("IDEA → Ext", totalOutgoing, msgLength, req, initiator, str, data)
    }

    /**
     * Log message
     */
    private fun logMessage(
        direction: String,
        totalLength: Int,
        msgLength: Int,
        req: Int,
        initiator: RequestInitiator,
        str: String,
        data: Any?,
    ) {
        try {
            val timestamp = formatTimestampWithMilliseconds(Date())
            val initiatorStr = when (initiator) {
                RequestInitiator.LocalSide -> "Local"
                RequestInitiator.OtherSide -> "Other"
            }

            val logEntry = StringBuilder()
            logEntry.append("[$timestamp] ")
            logEntry.append("[$direction] ")
            logEntry.append("[Total: ${totalLength.toString().padStart(7)}] ")
            logEntry.append("[Len: ${msgLength.toString().padStart(5)}] ")
            logEntry.append("[${req.toString().padStart(5)}] ")
            logEntry.append("[$initiatorStr] ")
            logEntry.append(str)

            if (data != null) {
                val dataStr = if (str.endsWith("(")) {
                    "$data)"
                } else {
                    data.toString()
                }
                logEntry.append(" ").append(dataStr)
            }

            // Use coroutine to asynchronously add to queue
            coroutineScope.launch(Dispatchers.IO) {
                logQueue.add(logEntry.toString())
            }
        } catch (e: Exception) {
            logger.error("Failed to format log message", e)
        }
    }

    /**
     * Safely convert data to string
     */
    private fun stringify(data: Any?): String {
        return try {
            when (data) {
                is Map<*, *> -> data.toString()
                is Collection<*> -> data.toString()
                is Array<*> -> data.contentToString()
                else -> data.toString()
            }
        } catch (e: Exception) {
            "Unserializable data: ${e.message}"
        }
    }

    /**
     * Format timestamp with milliseconds
     */
    private fun formatTimestampWithMilliseconds(date: Date): String {
        val calendar = Calendar.getInstance()
        calendar.time = date

        val year = calendar.get(Calendar.YEAR)
        val month = (calendar.get(Calendar.MONTH) + 1).toString().padStart(2, '0')
        val day = calendar.get(Calendar.DAY_OF_MONTH).toString().padStart(2, '0')
        val hours = calendar.get(Calendar.HOUR_OF_DAY).toString().padStart(2, '0')
        val minutes = calendar.get(Calendar.MINUTE).toString().padStart(2, '0')
        val seconds = calendar.get(Calendar.SECOND).toString().padStart(2, '0')
        val milliseconds = calendar.get(Calendar.MILLISECOND).toString().padStart(3, '0')

        return "$year-$month-$day $hours:$minutes:$seconds.$milliseconds"
    }

    /**
     * Release resources
     */
    override fun dispose() {
        if (isDisposed.getAndSet(true)) {
            return
        }

        try {
            // Write log footer
            val endTime = formatTimestampWithMilliseconds(Date())
            val footer = """
               |-------------------------------------------------------------
               | IDEA RPC Protocol Logger
               | Ended at: $endTime
               | Total incoming: $totalIncoming bytes
               | Total outgoing: $totalOutgoing bytes
               |-------------------------------------------------------------
            """.trimMargin()

            logQueue.add(footer)

            // Wait for log queue to empty
            var retries = 0
            while (logQueue.isNotEmpty() && retries < 10) {
                Thread.sleep(100)
                retries++
            }

            // Close writer
            writer?.close()
            writer = null

            // Interrupt logger thread
            loggerThread?.interrupt()
            loggerThread = null

            logger.info("FileRPCProtocolLogger released")
        } catch (e: Exception) {
            logger.error("Failed to release FileRPCProtocolLogger", e)
        }
    }
}
