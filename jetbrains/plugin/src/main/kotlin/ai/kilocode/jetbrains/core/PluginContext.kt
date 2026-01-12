// Copyright 2009-2025 Weibo, Inc.
// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.core

import ai.kilocode.jetbrains.ipc.proxy.IRPCProtocol
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project

/**
 * Plugin global context
 * Used for managing globally accessible resources and objects
 */
@Service(Service.Level.PROJECT)
class PluginContext {
    private val logger = Logger.getInstance(PluginContext::class.java)

    // RPC protocol instance
    @Volatile
    private var rpcProtocol: IRPCProtocol? = null
    
    // Extension host manager instance
    @Volatile
    private var extensionHostManager: ExtensionHostManager? = null

    /**
     * Set RPC protocol instance
     * @param protocol RPC protocol instance
     */
    fun setRPCProtocol(protocol: IRPCProtocol) {
        logger.info("Setting RPC protocol instance")
        rpcProtocol = protocol
    }

    /**
     * Get RPC protocol instance
     * @return RPC protocol instance, or null if not set
     */
    fun getRPCProtocol(): IRPCProtocol? {
        return rpcProtocol
    }
    
    /**
     * Set extension host manager instance
     * @param manager Extension host manager instance
     */
    fun setExtensionHostManager(manager: ExtensionHostManager) {
        logger.info("Setting extension host manager instance")
        extensionHostManager = manager
    }
    
    /**
     * Get extension host manager instance
     * @return Extension host manager instance, or null if not set
     */
    fun getExtensionHostManager(): ExtensionHostManager? {
        return extensionHostManager
    }

    /**
     * Clear all resources
     */
    fun clear() {
        logger.info("Clearing resources in PluginContext")
        rpcProtocol = null
        extensionHostManager = null
    }

    companion object {
        // Singleton instance
//        @Volatile
//        private var instance: PluginContext? = null

        /**
         * Get PluginContext singleton instance
         * @return PluginContext instance
         */
        fun getInstance(project: Project): PluginContext {
            return project.getService(PluginContext::class.java)
        }
    }
}
