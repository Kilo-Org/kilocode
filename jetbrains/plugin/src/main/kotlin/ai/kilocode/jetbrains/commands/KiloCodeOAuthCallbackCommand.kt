// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.commands

import ai.kilocode.jetbrains.core.PluginContext
import com.intellij.openapi.application.JBProtocolCommand
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * JetBrains Protocol Command for handling Kilo Code OAuth callback URLs
 *
 * Handles OAuth callback URLs from providers like OpenRouter, Glama, Requesty
 * Format: jetbrains://idea/ai.kilocode.jetbrains.oauth?provider=openrouter&token=HERE
 */
class KiloCodeOAuthCallbackCommand : JBProtocolCommand("ai.kilocode.jetbrains.oauth") {
    private val logger = Logger.getInstance(KiloCodeOAuthCallbackCommand::class.java)
    private val coroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    companion object {
        const val COMMAND_ID = "ai.kilocode.jetbrains.oauth"
        const val PROVIDER_PARAM = "provider"
        const val TOKEN_PARAM = "token"
        const val STATE_PARAM = "state"
    }

    /**
     * Handle the protocol command
     * @param target The target parameter from the URL
     * @param parameters Map of URL parameters
     * @param fragment The URL fragment
     * @return null on success, error message on error
     */
    override suspend fun execute(target: String?, parameters: Map<String, String>, fragment: String?): String? {
        val provider = parameters[PROVIDER_PARAM]
        val token = parameters[TOKEN_PARAM]
        val state = parameters[STATE_PARAM]

        logger.info("Handling Kilo Code OAuth callback: provider=$provider, state=$state")

        return try {
            if (provider.isNullOrBlank()) {
                val errorMsg = "No provider specified in OAuth callback: $parameters"
                logger.warn(errorMsg)
                return errorMsg
            }

            if (token.isNullOrBlank()) {
                val errorMsg = "No token found in OAuth callback for provider=$provider"
                logger.warn(errorMsg)
                return errorMsg
            }

            logger.info("Extracted OAuth token for provider=$provider, forwarding to extension")

            // Forward to the existing auth protocol command
            forwardToken(token, provider, state)

            null // Success
        } catch (e: Exception) {
            val errorMsg = "Error handling OAuth callback: ${e.message}"
            logger.error(errorMsg, e)
            errorMsg
        }
    }

    /**
     * Forward the OAuth token to the extension via the existing auth protocol command
     */
    private fun forwardToken(token: String, provider: String, state: String?) {
        coroutineScope.launch {
            try {
                val projectManager = ProjectManager.getInstance()
                val projects = projectManager.openProjects

                if (projects.isEmpty()) {
                    logger.warn("No open projects to forward OAuth token to")
                    return@launch
                }

                // Forward to each open project
                projects.forEach { project ->
                    try {
                        val pluginContext = project.getService(PluginContext::class.java)
                        val extensionHostManager = pluginContext.getExtensionHostManager()

                        logger.info("Forwarding OAuth token to extension host for project: ${project.name}")

                        // Send token via RPC
                        val authCommand = KiloCodeAuthProtocolCommand()
                        authCommand.executeForTesting(null, mapOf(TOKEN_PARAM to token), null)

                        logger.info("Successfully forwarded OAuth token for provider=$provider")
                    } catch (e: Exception) {
                        logger.error("Failed to forward OAuth token for project ${project.name}", e)
                    }
                }
            } catch (e: Exception) {
                logger.error("Failed to forward OAuth token", e)
            }
        }
    }
}
