// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.terminal

import com.intellij.openapi.diagnostic.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/**
 * Shell integration event types
 */
sealed class ShellEvent {
    data class ShellExecutionStart(val commandLine: String, val cwd: String) : ShellEvent()
    data class ShellExecutionEnd(val commandLine: String, val exitCode: Int?) : ShellEvent()
    data class ShellExecutionData(val data: String) : ShellEvent()
    data class CwdChange(val cwd: String) : ShellEvent()
}

/**
 * Shell integration event listener
 */
interface ShellEventListener {
    fun onShellExecutionStart(commandLine: String, cwd: String)
    fun onShellExecutionEnd(commandLine: String, exitCode: Int?)
    fun onShellExecutionData(data: String)
    fun onCwdChange(cwd: String)
}

/**
 * Shell integration output state manager
 * Refer to VSCode Shell Integration implementation
 * Reference: https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminal/common/terminalShellIntegration.ts
 */
class ShellIntegrationOutputState {
    private val logger = Logger.getInstance(ShellIntegrationOutputState::class.java)

    // Event listeners
    private val listeners = mutableListOf<ShellEventListener>()

    // State properties
    @Volatile
    var isCommandRunning: Boolean = false
        private set

    @Volatile
    var currentCommand: String = ""
        private set

    @Volatile
    var currentNonce: String = ""
        private set

    @Volatile
    var commandStatus: Int? = null
        private set

    @Volatile
    var currentDirectory: String = ""
        private set

    @Volatile
    var output: String = ""
        private set

    // Pending output buffer
    private val pendingOutput = StringBuilder()
    private val pendingOutputLock = Any()
    private val lastAppendTime = AtomicLong(0)
    private val isFlushScheduled = AtomicBoolean(false)

    // Coroutine scope
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    /**
     * Add event listener
     */
    fun addListener(listener: ShellEventListener) {
        synchronized(listeners) {
            listeners.add(listener)
        }
    }

    /**
     * Remove event listener
     */
    fun removeListener(listener: ShellEventListener) {
        synchronized(listeners) {
            listeners.remove(listener)
        }
    }

    /**
     * Notify all listeners of an event
     */
    private fun notifyListeners(event: ShellEvent) {
        synchronized(listeners) {
            listeners.forEach { listener ->
                try {
                    when (event) {
                        is ShellEvent.ShellExecutionStart ->
                            listener.onShellExecutionStart(event.commandLine, event.cwd)
                        is ShellEvent.ShellExecutionEnd ->
                            listener.onShellExecutionEnd(event.commandLine, event.exitCode)
                        is ShellEvent.ShellExecutionData ->
                            listener.onShellExecutionData(event.data)
                        is ShellEvent.CwdChange ->
                            listener.onCwdChange(event.cwd)
                    }
                } catch (e: Exception) {
                    logger.warn("Failed to notify Shell event listener", e)
                }
            }
        }
    }

    /**
     * Append output data (with buffering and delayed sending)
     */
    private fun appendOutput(text: String) {
        logger.debug("📝 appendOutput called: '$text', length=${text.length}")
        synchronized(pendingOutputLock) {
            pendingOutput.append(text)
            logger.debug("📝 pendingOutput updated length: ${pendingOutput.length}")
        }

        val currentTime = System.currentTimeMillis()
        lastAppendTime.set(currentTime)

        // If no flush task is scheduled, schedule one
        if (isFlushScheduled.compareAndSet(false, true)) {
            logger.debug("📝 Scheduling flush task, will execute after 50ms")
            scope.launch {
                delay(50) // 50ms delay
                flushPendingOutput()
            }
        } else {
            logger.debug("📝 Flush task already scheduled, skipping")
        }
    }

    /**
     * Flush pending output
     */
    private fun flushPendingOutput() {
        logger.debug("🚀 flushPendingOutput called")
        val textToFlush = synchronized(pendingOutputLock) {
            if (pendingOutput.isNotEmpty()) {
                val text = pendingOutput.toString()
                pendingOutput.clear()
                logger.debug("🚀 Ready to flush text: '$text', length=${text.length}")
                text
            } else {
                logger.debug("🚀 pendingOutput is empty, no need to flush")
                null
            }
        }

        isFlushScheduled.set(false)

        textToFlush?.let { text ->
            output += text
            logger.info("🚀 Sending ShellExecutionData event: '$text', length=${text.length}")
            notifyListeners(ShellEvent.ShellExecutionData(text))
        }
    }

    /**
     * Clear output
     */
    fun clearOutput() {
        synchronized(pendingOutputLock) {
            output = ""
            pendingOutput.clear()
            currentNonce = ""
        }
        isFlushScheduled.set(false)
    }

    /**
     * Terminate current state
     */
    fun terminate() {
        isCommandRunning = false
        flushPendingOutput()
    }

    /**
     * Process raw output data
     * Parse Shell Integration markers and extract clean content
     */
    fun appendRawOutput(output: String) {
        logger.debug("📥 Processing raw output: ${output.length} chars, isCommandRunning=$isCommandRunning")
        logger.debug("📥 Raw output content: '${output.replace("\u001b", "\\u001b").replace("\u0007", "\\u0007")}'")

        var currentIndex = 0
        var hasShellIntegrationMarkers = false

        while (currentIndex < output.length) {
            // Find Shell Integration marker: \u001b]633;
            val markerIndex = output.indexOf("\u001b]633;", currentIndex)

            if (markerIndex == -1) {
                // No marker found
                val remainingContent = output.substring(currentIndex)
                logger.debug("📤 No Shell Integration marker found, remaining content: '$remainingContent', isCommandRunning=$isCommandRunning")

                if (!hasShellIntegrationMarkers && remainingContent.isNotEmpty()) {
                    // If there is no Shell Integration marker in the entire output, treat all content as command output
                    logger.debug("📤 No Shell Integration marker, treat all content as command output")
                    appendOutput(remainingContent)
                } else if (isCommandRunning && currentIndex < output.length) {
                    logger.debug("📤 Append remaining content to output: '$remainingContent'")
                    appendOutput(remainingContent)
                } else if (!isCommandRunning) {
                    logger.debug("⚠️ Command not running, ignore output: '$remainingContent'")
                }
                break
            }

            hasShellIntegrationMarkers = true

            // If command is running, append content before marker
            if (isCommandRunning && currentIndex < markerIndex) {
                val beforeMarker = output.substring(currentIndex, markerIndex)
                logger.debug("📤 Append content before marker: '$beforeMarker'")
                appendOutput(beforeMarker)
            } else if (!isCommandRunning && currentIndex < markerIndex) {
                val beforeMarker = output.substring(currentIndex, markerIndex)
                logger.debug("⚠️ Command not running, ignore content before marker: '$beforeMarker'")
            }

            // Parse marker
            val typeStart = markerIndex + 6 // "\u001b]633;".length
            if (typeStart >= output.length) {
                if (isCommandRunning && currentIndex < output.length) {
                    appendOutput(output.substring(currentIndex))
                }
                break
            }

            val type = MarkerType.fromChar(output[typeStart])
            val paramStart = typeStart + 1

            // Find marker end: \u0007
            val paramEnd = output.indexOf('\u0007', paramStart)
            if (paramEnd == -1) {
                logger.debug("⚠️ Marker end not found, skip")
                currentIndex = typeStart
                continue
            }

            // Extract parameters
            val params = if (paramStart < paramEnd) {
                output.substring(paramStart, paramEnd)
            } else {
                ""
            }

            val components = if (params.startsWith(";")) {
                params.substring(1).split(";")
            } else {
                listOf(params)
            }

            logger.debug("🔍 Parse Shell Integration marker: type=$type, params='$params', components=$components")

            // Handle different marker types
            when (type) {
                MarkerType.COMMAND_LINE -> {
                    logger.info("🎯 Shell Integration - Detected command line marker")
                    if (components.isNotEmpty() && components[0].isNotEmpty()) {
                        currentCommand = components[0]
                        currentNonce = if (components.size >= 2) components[1] else ""
                        logger.info("🎯 Shell Integration - Command line: '$currentCommand'")
                    }
                }

                MarkerType.COMMAND_EXECUTED -> {
                    logger.info("🚀 Shell Integration - Detected command executed marker")
                    isCommandRunning = true
                    if (currentCommand.isNotEmpty()) {
                        logger.info("🚀 Shell Integration - Command started: '$currentCommand', isCommandRunning=$isCommandRunning")
                        notifyListeners(ShellEvent.ShellExecutionStart(currentCommand, currentDirectory))
                        // Include marker itself in output
                        appendOutput(output.substring(markerIndex, paramEnd + 1))
                    }
                }

                MarkerType.COMMAND_FINISHED -> {
                    logger.info("🏁 Shell Integration - Detected command finished marker")
                    if (currentCommand.isNotEmpty()) {
                        // Include marker itself in output
                        appendOutput(output.substring(markerIndex, paramEnd + 1))
                        flushPendingOutput() // Ensure all pending data is sent before command ends

                        commandStatus = components.firstOrNull()?.toIntOrNull()
                        logger.info("🏁 Shell Integration - Command finished: '$currentCommand' (exit code: $commandStatus)")
                        notifyListeners(ShellEvent.ShellExecutionEnd(currentCommand, commandStatus))
                        currentCommand = ""
                    }
                    isCommandRunning = false
                }

                MarkerType.PROPERTY -> {
                    logger.debug("📋 Shell Integration - Detected property marker")
                    if (components.isNotEmpty()) {
                        val property = components[0]
                        if (property.startsWith("Cwd=")) {
                            val cwdValue = property.substring(4) // "Cwd=".length
                            if (cwdValue != currentDirectory) {
                                currentDirectory = cwdValue
                                logger.info("📁 Shell Integration - Directory changed: '$cwdValue'")
                                notifyListeners(ShellEvent.CwdChange(cwdValue))
                            }
                        }
                    }
                }

                MarkerType.PROMPT_START -> {
                    logger.debug("🎯 Shell Integration - Prompt start")
                }

                MarkerType.COMMAND_START -> {
                    logger.debug("🎯 Shell Integration - Command input start")
                }

                else -> {
                    logger.debug("🔍 Shell Integration - Unhandled marker type: $type")
                }
            }

            currentIndex = paramEnd + 1
        }
    }

    /**
     * Get clean output with Shell Integration markers removed
     */
    fun getCleanOutput(rawOutput: String): String {
        var result = rawOutput

        // Remove all Shell Integration markers
        val markerPattern = Regex("\u001b\\]633;[^\\u0007]*\\u0007")
        result = markerPattern.replace(result, "")

        return result
    }

    /**
     * Dispose resources
     */
    fun dispose() {
        scope.cancel()
        synchronized(listeners) {
            listeners.clear()
        }
    }

    /**
     * VSCode Shell Integration marker types
     * Reference: https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminal/common/terminalShellIntegration.ts
     */
    private enum class MarkerType(val char: Char) {
        // Implemented types
        COMMAND_LINE('E'), // Command line content, format: OSC 633 ; E ; <CommandLine> [; <Nonce>] ST
        COMMAND_FINISHED('D'), // Command finished, format: OSC 633 ; D [; <ExitCode>] ST
        COMMAND_EXECUTED('C'), // Command output started, format: OSC 633 ; C ST
        PROPERTY('P'), // Property set, format: OSC 633 ; P ; <Property>=<Value> ST

        // Prompt related
        PROMPT_START('A'), // Prompt start, format: OSC 633 ; A ST
        COMMAND_START('B'), // Command input start, format: OSC 633 ; B ST

        // Line continuation related (not completed)
        CONTINUATION_START('F'), // Line continuation start, format: OSC 633 ; F ST
        CONTINUATION_END('G'), // Line continuation end, format: OSC 633 ; G ST

        // Right prompt related (not completed)
        RIGHT_PROMPT_START('H'), // Right prompt start, format: OSC 633 ; H ST
        RIGHT_PROMPT_END('I'), // Right prompt end, format: OSC 633 ; I ST

        UNKNOWN('?'),
        ;

        companion object {
            fun fromChar(char: Char): MarkerType {
                return values().find { it.char == char } ?: UNKNOWN
            }
        }
    }
}
