// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.terminal

import ai.kilocode.jetbrains.core.ServiceProxyRegistry
import ai.kilocode.jetbrains.ipc.proxy.IRPCProtocol
import ai.kilocode.jetbrains.util.URI
import com.intellij.openapi.diagnostic.Logger

/**
 * Terminal shell integration manager
 * Responsible for handling the lifecycle management of terminal shell command execution and RPC communication with ExtHost
 *
 * @param extHostTerminalId ExtHost terminal ID
 * @param numericId Numeric terminal ID
 * @param rpcProtocol RPC protocol instance
 */
class TerminalShellIntegration(
    private val extHostTerminalId: String,
    private val numericId: Int,
    private val rpcProtocol: IRPCProtocol,
) {

    companion object {
        private const val HIGH_CONFIDENCE = 2
        private const val DEFAULT_EXIT_CODE = 0
        private const val LOG_PREFIX_SETUP = "🔧"
        private const val LOG_PREFIX_START = "🚀"
        private const val LOG_PREFIX_END = "🏁"
        private const val LOG_PREFIX_DATA = "✨"
        private const val LOG_PREFIX_CWD = "📁"
        private const val LOG_PREFIX_SUCCESS = "✅"
        private const val LOG_PREFIX_ERROR = "❌"
        private const val LOG_PREFIX_DISPOSE = "🧹"
    }

    private val logger = Logger.getInstance(TerminalShellIntegration::class.java)
    private var shellIntegrationState: ShellIntegrationOutputState? = null
    private var shellEventListener: ShellEventListener? = null

    /**
     * Lazy delegate for getting ExtHost terminal shell integration proxy
     */
    private val extHostProxy by lazy {
        rpcProtocol.getProxy(ServiceProxyRegistry.ExtHostContext.ExtHostTerminalShellIntegration)
    }

    /**
     * Setup shell integration
     * Initialize shell event listener and state manager
     */
    fun setupShellIntegration() {
        runCatching {
            logger.info("$LOG_PREFIX_SETUP Setting up shell integration (terminal: $extHostTerminalId)...")

            initializeShellEventListener()
            initializeShellIntegrationState()

            logger.info("$LOG_PREFIX_SUCCESS Shell integration setup complete (terminal: $extHostTerminalId)")
        }.onFailure { exception ->
            logger.error("$LOG_PREFIX_ERROR Failed to setup shell integration (terminal: $extHostTerminalId)", exception)
        }
    }

    /**
     * Dispose shell integration and release related resources
     */
    fun dispose() {
        logger.info("$LOG_PREFIX_DISPOSE Disposing shell integration: $extHostTerminalId")

        runCatching {
            shellIntegrationState?.apply {
                terminate()
                dispose()
            }
            shellEventListener = null
            shellIntegrationState = null

            logger.info("$LOG_PREFIX_SUCCESS Shell integration disposed: $extHostTerminalId")
        }.onFailure { exception ->
            logger.error("$LOG_PREFIX_ERROR Failed to dispose shell integration: $extHostTerminalId", exception)
        }
    }

    /**
     * Append raw output data
     * @param data Output data
     */
    fun appendRawOutput(data: String) {
        shellIntegrationState?.appendRawOutput(data)
    }

    /**
     * Initialize shell event listener
     */
    private fun initializeShellEventListener() {
        shellEventListener = TerminalShellEventListener()
    }

    /**
     * Initialize shell integration state manager
     */
    private fun initializeShellIntegrationState() {
        shellIntegrationState = ShellIntegrationOutputState().apply {
            shellEventListener?.let { addListener(it) }
        }
    }

    /**
     * Helper function to safely execute RPC calls
     * @param operation Operation name for logging
     * @param action RPC operation
     */
    private inline fun safeRpcCall(operation: String, action: () -> Unit) {
        runCatching {
            action()
            logger.debug("$LOG_PREFIX_SUCCESS $operation succeeded (terminal: $extHostTerminalId)")
        }.onFailure { exception ->
            logger.error("$LOG_PREFIX_ERROR $operation failed (terminal: $extHostTerminalId)", exception)
        }
    }

    /**
     * Inner class for terminal shell event listener
     * Handles various shell command execution events
     */
    private inner class TerminalShellEventListener : ShellEventListener {

        override fun onShellExecutionStart(commandLine: String, cwd: String) {
            logger.info("$LOG_PREFIX_START Command execution started: '$commandLine' in directory '$cwd' (terminal: $extHostTerminalId)")

            safeRpcCall("Notify ExtHost command start") {
                extHostProxy.shellExecutionStart(
                    instanceId = numericId,
                    commandLineValue = commandLine,
                    commandLineConfidence = HIGH_CONFIDENCE,
                    isTrusted = true,
                    cwd = URI.file(cwd),
                )
            }
        }

        override fun onShellExecutionEnd(commandLine: String, exitCode: Int?) {
            val actualExitCode = exitCode ?: DEFAULT_EXIT_CODE
            logger.info("$LOG_PREFIX_END Command execution finished: '$commandLine' (exit code: $actualExitCode) (terminal: $extHostTerminalId)")

            safeRpcCall("Notify ExtHost command end") {
                extHostProxy.shellExecutionEnd(
                    instanceId = numericId,
                    commandLineValue = commandLine,
                    commandLineConfidence = HIGH_CONFIDENCE,
                    isTrusted = true,
                    exitCode = actualExitCode,
                )
            }
        }

        override fun onShellExecutionData(data: String) {
            logger.debug("$LOG_PREFIX_DATA Clean output data: ${data.length} chars (terminal: $extHostTerminalId)")

            safeRpcCall("Send shellExecutionData") {
                extHostProxy.shellExecutionData(
                    instanceId = numericId,
                    data = data,
                )
            }
        }

        override fun onCwdChange(cwd: String) {
            logger.info("$LOG_PREFIX_CWD Working directory changed to: '$cwd' (terminal: $extHostTerminalId)")

            safeRpcCall("Notify ExtHost directory change") {
                extHostProxy.cwdChange(
                    instanceId = numericId,
                    cwd = URI.file(cwd),
                )
            }
        }
    }
}
