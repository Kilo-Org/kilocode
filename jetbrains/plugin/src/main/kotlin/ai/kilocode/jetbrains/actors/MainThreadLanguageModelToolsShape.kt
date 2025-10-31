// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.actors

import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.logger
import java.util.concurrent.ConcurrentHashMap

/**
 * Language model tools service interface.
 * Corresponds to the MainThreadLanguageModelTools interface in VSCode.
 */
interface MainThreadLanguageModelToolsShape : Disposable {
    /**
     * Gets all available tool list.
     */
    fun getTools(): List<Map<String, Any?>>

    /**
     * Invokes the specified tool.
     * @param dto Tool invocation parameters
     * @param token Cancellation token
     */
    fun invokeTool(dto: Map<String, Any?>, token: Any? = null): Map<String, Any?>

    /**
     * Calculates the number of tokens for the given input.
     * @param callId Call ID
     * @param input Input content
     * @param token Cancellation token
     */
    fun countTokensForInvocation(callId: String, input: String, token: Any?): Int

    /**
     * Registers a tool.
     * @param id Tool ID
     */
    fun registerTool(id: String)

    /**
     * Unregisters a tool.
     * @param name Tool name
     */
    fun unregisterTool(name: String)
}

/**
 * Implementation of the language model tools service.
 */
class MainThreadLanguageModelTools : MainThreadLanguageModelToolsShape {

    private val logger = logger<MainThreadLanguageModelTools>()
    private val tools = ConcurrentHashMap<String, ToolInfo>()

    /**
     * Tool information
     */
    private data class ToolInfo(
        val id: String,
        val registered: Boolean = true,
    )

    override fun getTools(): List<Map<String, Any?>> {
        logger.info("Get available language model tool list")
        // Return the list of registered tools
        return tools.values.filter { it.registered }.map {
            mapOf("id" to it.id)
        }
    }

    override fun invokeTool(dto: Map<String, Any?>, token: Any?): Map<String, Any?> {
        val toolId = dto["id"] as? String ?: throw IllegalArgumentException("Tool ID cannot be empty")
        val params = dto["params"] ?: emptyMap<String, Any?>()

        logger.info("Invoke language model tool: $toolId")
        val toolInfo = tools[toolId] ?: throw IllegalArgumentException("Tool with ID $toolId not found")

        if (!toolInfo.registered) {
            throw IllegalStateException("Tool $toolId is not registered")
        }

        // The actual tool should be invoked here. Currently returns a mock result.
        // In the actual implementation, it may need to call the real tool in the extension process via RPC.
        return mapOf(
            "result" to "Tool $toolId invoked successfully",
            "id" to toolId,
        )
    }

    override fun countTokensForInvocation(callId: String, input: String, token: Any?): Int {
        logger.info("Calculate token count for tool invocation $callId")

        // The actual token count should be calculated here. Currently returns a mock result.
        // In the actual implementation, it may need to use a specific algorithm or service to calculate the token count.
        return input.length / 4 + 1 // Simple mock token calculation
    }

    override fun registerTool(id: String) {
        logger.info("Register language model tool: $id")

        tools[id] = ToolInfo(id, true)
    }

    override fun unregisterTool(name: String) {
        logger.info("Unregister language model tool: $name")

        if (tools.containsKey(name)) {
            tools[name] = tools[name]!!.copy(registered = false)
        } else {
            logger.warn("Attempting to unregister non-existent tool: $name")
        }
    }

    override fun dispose() {
        logger.info("Dispose MainThreadLanguageModelTools resources")
        tools.clear()
    }
}
