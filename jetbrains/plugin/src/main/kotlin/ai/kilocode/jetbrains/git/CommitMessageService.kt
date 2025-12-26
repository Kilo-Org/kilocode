// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.git

import ai.kilocode.jetbrains.core.PluginContext
import ai.kilocode.jetbrains.core.ServiceProxyRegistry
import ai.kilocode.jetbrains.i18n.I18n
import ai.kilocode.jetbrains.ipc.proxy.LazyPromise
import ai.kilocode.jetbrains.ipc.proxy.interfaces.ExtHostCommandsProxy
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import kotlinx.coroutines.withTimeout

/**
 * Service responsible for generating commit messages via RPC communication
 * with the VSCode extension. Encapsulates all RPC logic, error handling,
 * and result processing for commit message generation.
 */
class CommitMessageService {
    private val logger: Logger = Logger.getInstance(CommitMessageService::class.java)

    /**
     * Result wrapper for commit message generation operations.
     */
    sealed class Result {
        data class Success(val message: String) : Result()
        data class Error(val errorMessage: String) : Result()
    }

    /**
     * Generates a commit message using the VSCode extension via RPC.
     * Can optionally focus on specific files if provided.
     *
     * @param project The current project context
     * @param workspacePath The absolute path to the Git repository
     * @param selectedFiles Optional list of file paths to focus on for commit message generation
     * @return Result containing either the generated message or error information
     */
    suspend fun generateCommitMessage(
        project: Project,
        workspacePath: String,
        selectedFiles: List<String>? = null,
    ): Result {
        return try {
            val proxy = getRPCProxy(project)
            if (proxy == null) {
                logger.error("Failed to get RPC proxy - extension not connected")
                return Result.Error(I18n.t("kilocode:commitMessage.errors.connectionFailed"))
            }

            val rpcResult = executeRPCCommand(proxy, workspacePath, selectedFiles)
            processCommandResult(rpcResult)
        } catch (e: kotlinx.coroutines.TimeoutCancellationException) {
            logger.warn("Commit message generation timed out after ${CommitMessageConstants.RPC_TIMEOUT_MS}ms", e)
            Result.Error(I18n.t("kilocode:commitMessage.errors.timeout"))
        } catch (e: Exception) {
            logger.error("Commit message generation failed", e)
            Result.Error(I18n.t("kilocode:commitMessage.generationFailed", mapOf("errorMessage" to (e.message ?: I18n.t("kilocode:commitMessage.error.unknown")))))
        }
    }

    /**
     * Gets the RPC proxy for command execution from the project's PluginContext.
     */
    private fun getRPCProxy(project: Project): ExtHostCommandsProxy? {
        return project.getService(PluginContext::class.java)
            ?.getRPCProtocol()
            ?.getProxy(ServiceProxyRegistry.ExtHostContext.ExtHostCommands)
    }

    /**
     * Executes the commit message generation command via RPC with timeout handling.
     */
    private suspend fun executeRPCCommand(
        proxy: ExtHostCommandsProxy,
        workspacePath: String,
        selectedFiles: List<String>? = null,
    ): Any? {
        // Always pass both parameters: workspacePath and selectedFiles (empty if none)
        val fileList = selectedFiles ?: emptyList()
        val args = listOf(workspacePath, fileList)

        val promise: LazyPromise = proxy.executeContributedCommand(
            CommitMessageConstants.EXTERNAL_COMMAND_ID,
            args,
        )

        // Wait for the result with timeout
        return withTimeout(CommitMessageConstants.RPC_TIMEOUT_MS) {
            val result = promise.await()
            result
        }
    }

    /**
     * Processes the result from the RPC command and returns appropriate Result.
     */
    private fun processCommandResult(result: Any?): Result {
        // Handle invalid result format
        if (result !is Map<*, *>) {
            logger.warn("Received unexpected response format: ${result?.javaClass?.simpleName}, result: $result")
            return Result.Error(I18n.t("kilocode:commitMessage.errors.invalidResponse"))
        }

        // Extract response data
        val message = result["message"] as? String
        val error = result["error"] as? String

        // Handle error response
        if (error != null) {
            logger.warn("Commit message generation failed with error: $error")
            return Result.Error(I18n.t("kilocode:commitMessage.generationFailed", mapOf("errorMessage" to error)))
        }

        // Handle missing message
        if (message == null) {
            logger.warn("Received response without message or error field")
            return Result.Error(I18n.t("kilocode:commitMessage.errors.missingMessage"))
        }

        // Success case
        logger.info("Successfully generated commit message: $message")
        return Result.Success(message)
    }

    companion object {
        /**
         * Gets or creates the CommitMessageService instance for the project.
         * @param project The project context for which to get the service
         */
        fun getInstance(project: Project): CommitMessageService {
            return project.getService(CommitMessageService::class.java)
        }
    }
}
