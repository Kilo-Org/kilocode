// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.commands

import ai.kilocode.jetbrains.core.PluginContext
import ai.kilocode.jetbrains.core.ServiceProxyRegistry
import com.intellij.openapi.application.JBProtocolCommand
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * JetBrains Protocol Command for handling Kilo Code authentication URLs
 *
 * Handles URLs in the format: jetbrains://idea/ai.kilocode.jetbrains.auth?token=HERE
 * and forwards them to the VSCode extension via RPC protocol
 */
class KiloCodeAuthProtocolCommand : JBProtocolCommand("ai.kilocode.jetbrains.auth") {
    private val logger = Logger.getInstance(KiloCodeAuthProtocolCommand::class.java)
    private val coroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    companion object {
        const val COMMAND_ID = "ai.kilocode.jetbrains.auth"
        const val TOKEN_PARAM = "token"
    }

    /**
     * Public method for testing the protocol command execution
     * @param target The target parameter from the URL
     * @param parameters Map of URL parameters
     * @param fragment The URL fragment
     * @return null on success, error message on failure
     */
    suspend fun executeForTesting(target: String?, parameters: Map<String, String>, fragment: String?): String? {
        return execute(target, parameters, fragment)
    }

    /**
     * Handle the protocol command
     * @param target The target parameter from the URL
     * @param parameters Map of URL parameters
     * @param fragment The URL fragment
     * @return null on success, error message on failure
     */
    override suspend fun execute(target: String?, parameters: Map<String, String>, fragment: String?): String? {
        logger.info("Handling Kilo Code auth protocol command: target=$target, parameters=$parameters")

        return try {
            // Extract token from parameters
            val token = parameters[TOKEN_PARAM]
            if (token.isNullOrBlank()) {
                val errorMsg = "No token found in parameters: $parameters"
                logger.warn(errorMsg)
                return errorMsg
            }

            logger.info("Extracted token from parameters, forwarding to VSCode extension")

            // Forward to VSCode extension via RPC
            forwardTokenToVSCodeExtension(token)

            null // Success
        } catch (e: Exception) {
            val errorMsg = "Error handling Kilo Code auth protocol command: ${e.message}"
            logger.error(errorMsg, e)
            errorMsg
        }
    }

    /**
     * Forward the token to the VSCode extension by simulating a VSCode URL handler call
     */
    private fun forwardTokenToVSCodeExtension(token: String) {
        coroutineScope.launch {
            try {
                // Get the current project (or default project if none is open)
                val project = getCurrentProject()

                if (project == null) {
                    logger.warn("No project available to forward token")
                    return@launch
                }

                // Get RPC protocol instance
                val protocol = project.getService(PluginContext::class.java)?.getRPCProtocol()

                if (protocol == null) {
                    logger.error("Cannot get RPC protocol instance, cannot forward token")
                    return@launch
                }

                logger.info("Forwarding token to VSCode extension via RPC")

                // Use ExtHostCommands to execute a command that handles the URL
                val extHostCommands = protocol.getProxy(ServiceProxyRegistry.ExtHostContext.ExtHostCommands)

                // Create the VSCode URI string that would normally be handled by handleUri
                val vscodeUriString = "vscode://kilocode.kilo-code/kilocode?token=$token"

                // Execute a command to handle the URI - this simulates what happens when VSCode receives a URL
                // We'll use a special command that the VSCode extension can handle
                extHostCommands.executeContributedCommand(
                    "kilo-code.handleExternalUri",
                    listOf(vscodeUriString),
                )

                logger.info("Successfully forwarded token to VSCode extension via command execution")
            } catch (e: Exception) {
                logger.error("Error forwarding token to VSCode extension", e)
            }
        }
    }

    /**
     * Get the current project, preferring the focused project
     */
    private fun getCurrentProject(): Project? {
        return try {
            val projectManager = ProjectManager.getInstance()

            // Try to get the default project first
            val openProjects = projectManager.openProjects

            if (openProjects.isNotEmpty()) {
                // Return the first open project
                openProjects[0]
            } else {
                // Fallback to default project
                projectManager.defaultProject
            }
        } catch (e: Exception) {
            logger.warn("Error getting current project", e)
            null
        }
    }
}
