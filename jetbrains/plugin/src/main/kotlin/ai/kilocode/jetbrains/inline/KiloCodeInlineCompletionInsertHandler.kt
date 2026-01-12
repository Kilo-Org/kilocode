// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.inline

import ai.kilocode.jetbrains.core.PluginContext
import ai.kilocode.jetbrains.core.ServiceProxyRegistry
import ai.kilocode.jetbrains.ipc.proxy.interfaces.ExtHostCommandsProxy
import com.intellij.codeInsight.inline.completion.DefaultInlineCompletionInsertHandler
import com.intellij.codeInsight.inline.completion.InlineCompletionInsertEnvironment
import com.intellij.codeInsight.inline.completion.elements.InlineCompletionElement
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project

/**
 * Custom insert handler that triggers telemetry when inline completions are accepted.
 * Extends DefaultInlineCompletionInsertHandler to maintain default insertion behavior
 * while adding telemetry tracking via RPC to the VSCode extension.
 */
class KiloCodeInlineCompletionInsertHandler(
    private val project: Project,
) : DefaultInlineCompletionInsertHandler() {

    private val logger = Logger.getInstance(KiloCodeInlineCompletionInsertHandler::class.java)

    /**
     * Called after the completion text has been inserted into the document.
     * This is our hook to trigger telemetry tracking.
     *
     * @param environment Contains information about the insertion context
     * @param elements The inline completion elements that were inserted
     */
    override fun afterInsertion(
        environment: InlineCompletionInsertEnvironment,
        elements: List<InlineCompletionElement>,
    ) {
        // Note: NOT calling super.afterInsertion() to avoid potential duplicate telemetry
        // The default implementation may be empty or may trigger its own telemetry

        // Trigger telemetry via RPC
        try {
            val proxy = getRPCProxy()
            if (proxy != null) {
                // Execute the acceptance command asynchronously
                // No need to wait for the result as this is fire-and-forget telemetry
                proxy.executeContributedCommand(
                    InlineCompletionConstants.INLINE_COMPLETION_ACCEPTED_COMMAND,
                    emptyList(),
                )
                logger.debug("Triggered inline completion acceptance telemetry")
            } else {
                logger.warn("Failed to trigger acceptance telemetry - RPC proxy not available")
            }
        } catch (e: Exception) {
            // Don't let telemetry errors affect the user experience
            logger.warn("Error triggering acceptance telemetry", e)
        }
    }

    /**
     * Gets the RPC proxy for command execution from the project's PluginContext.
     */
    private fun getRPCProxy(): ExtHostCommandsProxy? {
        return project.getService(PluginContext::class.java)
            ?.getRPCProtocol()
            ?.getProxy(ServiceProxyRegistry.ExtHostContext.ExtHostCommands)
    }
}
