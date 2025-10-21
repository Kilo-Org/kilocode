// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.terminal

import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * Terminal instance manager
 * Responsible for managing the lifecycle and mapping of all terminal instances
 * Avoids circular dependencies between different services
 */
@Service(Service.Level.PROJECT)
class TerminalInstanceManager : Disposable {
    private val logger = Logger.getInstance(TerminalInstanceManager::class.java)

    // Terminal instance management
    private val terminals = ConcurrentHashMap<String, TerminalInstance>()
    private val terminalsByNumericId = ConcurrentHashMap<Int, TerminalInstance>()
    private val nextNumericId = AtomicInteger(1)

    /**
     * Allocate a new numeric ID
     */
    fun allocateNumericId(): Int {
        return nextNumericId.getAndIncrement()
    }

    /**
     * Register terminal instance
     */
    fun registerTerminal(extHostTerminalId: String, terminalInstance: TerminalInstance) {
        terminals[extHostTerminalId] = terminalInstance
        terminalsByNumericId[terminalInstance.numericId] = terminalInstance

        // 🎯 Add terminal close event listener for automatic cleanup
        terminalInstance.addTerminalCloseCallback {
            logger.info("🔔 Received terminal close event callback: $extHostTerminalId")

            // Automatically remove terminal instance from manager
            unregisterTerminal(extHostTerminalId)

            // Additional cleanup logic can be added here
            // e.g., save terminal state, clean up related resources, etc.
        }

        logger.info("📝 Registered terminal instance: $extHostTerminalId (numericId: ${terminalInstance.numericId})")
    }

    /**
     * Unregister terminal instance
     */
    fun unregisterTerminal(extHostTerminalId: String): TerminalInstance? {
        val terminalInstance = terminals.remove(extHostTerminalId)
        if (terminalInstance != null) {
            terminalsByNumericId.remove(terminalInstance.numericId)
            logger.info("🗑️ Unregistered terminal instance: $extHostTerminalId (numericId: ${terminalInstance.numericId})")
        }
        return terminalInstance
    }

    /**
     * Get terminal instance (by string ID)
     */
    fun getTerminalInstance(id: String): TerminalInstance? {
        return terminals[id]
    }

    /**
     * Get terminal instance (by numeric ID)
     */
    fun getTerminalInstance(numericId: Int): TerminalInstance? {
        return terminalsByNumericId[numericId]
    }

    /**
     * Get all terminal instances
     */
    fun getAllTerminals(): Collection<TerminalInstance> {
        return terminals.values
    }

    /**
     * Check if terminal exists
     */
    fun containsTerminal(extHostTerminalId: String): Boolean {
        return terminals.containsKey(extHostTerminalId)
    }

    /**
     * Get terminal count
     */
    fun getTerminalCount(): Int {
        return terminals.size
    }

    /**
     * Get all terminal IDs
     */
    fun getAllTerminalIds(): Set<String> {
        return terminals.keys.toSet()
    }

    /**
     * Get all numeric IDs
     */
    fun getAllNumericIds(): Set<Int> {
        return terminalsByNumericId.keys.toSet()
    }

    override fun dispose() {
        logger.info("🧹 Disposing terminal instance manager")

        try {
            // Dispose all terminal instances
            val terminalList = terminals.values.toList()
            terminals.clear()
            terminalsByNumericId.clear()

            terminalList.forEach { terminal ->
                try {
                    terminal.dispose()
                } catch (e: Exception) {
                    logger.error("Failed to dispose terminal instance: ${terminal.extHostTerminalId}", e)
                }
            }

            logger.info("✅ Terminal instance manager disposed")
        } catch (e: Exception) {
            logger.error("❌ Failed to dispose terminal instance manager", e)
        }
    }
}
