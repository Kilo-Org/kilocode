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

    // For OSC 133 (FinalTerm) protocol: capture command line between B and C markers
    @Volatile
    private var commandLineBuffer: String = ""
    
    @Volatile
    private var isCapturingCommandLine: Boolean = false

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
        synchronized(pendingOutputLock) {
            pendingOutput.append(text)
        }

        val currentTime = System.currentTimeMillis()
        lastAppendTime.set(currentTime)

        // If no flush task is scheduled, schedule one
        if (isFlushScheduled.compareAndSet(false, true)) {
            scope.launch {
                delay(50) // 50ms delay
                flushPendingOutput()
            }
        }
    }

    /**
     * Flush pending output
     */
    private fun flushPendingOutput() {
        val textToFlush = synchronized(pendingOutputLock) {
            if (pendingOutput.isNotEmpty()) {
                val text = pendingOutput.toString()
                pendingOutput.clear()
                text
            } else {
                null
            }
        }

        isFlushScheduled.set(false)

        textToFlush?.let { text ->
            output += text
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
        var currentIndex = 0
        var hasShellIntegrationMarkers = false

        while (currentIndex < output.length) {
            // Find Shell Integration marker: \u001b]633; (VSCode) or \u001b]133; (FinalTerm/JetBrains)
            val vscodeMarkerIndex = output.indexOf("\u001b]633;", currentIndex)
            val finaltermMarkerIndex = output.indexOf("\u001b]133;", currentIndex)
            
            // Use whichever marker comes first
            val markerIndex = when {
                vscodeMarkerIndex == -1 && finaltermMarkerIndex == -1 -> -1
                vscodeMarkerIndex == -1 -> finaltermMarkerIndex
                finaltermMarkerIndex == -1 -> vscodeMarkerIndex
                else -> minOf(vscodeMarkerIndex, finaltermMarkerIndex)
            }
            
            val isVSCodeMarker = markerIndex == vscodeMarkerIndex && vscodeMarkerIndex != -1

            if (markerIndex == -1) {
                // No marker found
                val remainingContent = output.substring(currentIndex)

                // If capturing command line (between B and C markers), add to buffer
                if (isCapturingCommandLine && remainingContent.isNotEmpty()) {
                    commandLineBuffer += remainingContent
                }

                if (!hasShellIntegrationMarkers && remainingContent.isNotEmpty()) {
                    // If there is no Shell Integration marker in the entire output, treat all content as command output
                    appendOutput(remainingContent)
                } else if (isCommandRunning && currentIndex < output.length) {
                    appendOutput(remainingContent)
                }
                break
            }

            hasShellIntegrationMarkers = true

            // Handle content before marker
            if (currentIndex < markerIndex) {
                val beforeMarker = output.substring(currentIndex, markerIndex)
                
                // If capturing command line (between B and C markers), add to buffer
                if (isCapturingCommandLine) {
                    commandLineBuffer += beforeMarker
                }
                
                // If command is running, append content to output
                if (isCommandRunning) {
                    appendOutput(beforeMarker)
                }
            }

            // Parse marker
            val markerLength = 6 // Both "\u001b]633;" and "\u001b]133;" are 6 chars
            val typeStart = markerIndex + markerLength
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

            // Handle different marker types
            when (type) {
                MarkerType.COMMAND_LINE -> {
                    // OSC 633;E - VSCode protocol: explicit command line
                    if (components.isNotEmpty() && components[0].isNotEmpty()) {
                        currentCommand = components[0]
                        currentNonce = if (components.size >= 2) components[1] else ""
                    }
                }

                MarkerType.PROMPT_START -> {
                    // OSC 133;A or OSC 633;A - Prompt starts
                    // Reset command line buffer for OSC 133 protocol
                    commandLineBuffer = ""
                    isCapturingCommandLine = false
                }

                MarkerType.COMMAND_START -> {
                    // OSC 133;B or OSC 633;B - User starts typing command
                    // For OSC 133, we'll capture the command line between B and C markers
                    commandLineBuffer = ""
                    isCapturingCommandLine = true
                }

                MarkerType.COMMAND_EXECUTED -> {
                    // OSC 133;C or OSC 633;C - Command execution starts
                    
                    // Stop capturing command line
                    isCapturingCommandLine = false
                    
                    // For OSC 133 protocol, use the captured command line buffer
                    if (currentCommand.isEmpty() && commandLineBuffer.isNotEmpty()) {
                        // Clean up ANSI escape sequences from command line
                        val cleanCommand = commandLineBuffer
                            .replace(Regex("\u001b\\[[0-9;]*[a-zA-Z]"), "") // Remove ANSI CSI sequences
                            .replace(Regex("\u001b\\][^\\u0007]*\\u0007"), "") // Remove OSC sequences
                            .trim()
                        currentCommand = cleanCommand
                    }
                    
                    isCommandRunning = true
                    if (currentCommand.isNotEmpty()) {
                        notifyListeners(ShellEvent.ShellExecutionStart(currentCommand, currentDirectory))
                        // Include marker itself in output
                        appendOutput(output.substring(markerIndex, paramEnd + 1))
                    }
                }

                MarkerType.COMMAND_FINISHED -> {
                    // OSC 133;D or OSC 633;D - Command finishes
                    if (currentCommand.isNotEmpty()) {
                        // Include marker itself in output
                        appendOutput(output.substring(markerIndex, paramEnd + 1))
                        flushPendingOutput() // Ensure all pending data is sent before command ends

                        commandStatus = components.firstOrNull()?.toIntOrNull()
                        notifyListeners(ShellEvent.ShellExecutionEnd(currentCommand, commandStatus))
                        currentCommand = ""
                        commandLineBuffer = ""
                    }
                    isCommandRunning = false
                }

                MarkerType.PROPERTY -> {
                    // OSC 633;P - VSCode protocol: property set
                    if (components.isNotEmpty()) {
                        val property = components[0]
                        if (property.startsWith("Cwd=")) {
                            val cwdValue = property.substring(4) // "Cwd=".length
                            if (cwdValue != currentDirectory) {
                                currentDirectory = cwdValue
                                notifyListeners(ShellEvent.CwdChange(cwdValue))
                            }
                        }
                    }
                }

                else -> {
                    // Unhandled marker type
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

        // Remove all Shell Integration markers (both VSCode 633 and FinalTerm 133)
        val vscodeMarkerPattern = Regex("\u001b\\]633;[^\\u0007]*\\u0007")
        val finaltermMarkerPattern = Regex("\u001b\\]133;[^\\u0007]*\\u0007")
        result = vscodeMarkerPattern.replace(result, "")
        result = finaltermMarkerPattern.replace(result, "")

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
