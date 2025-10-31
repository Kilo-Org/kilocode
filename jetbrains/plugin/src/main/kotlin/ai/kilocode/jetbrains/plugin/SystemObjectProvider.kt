// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.plugin

import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import java.util.concurrent.ConcurrentHashMap

/**
 * System Object Provider
 * Provides unified access to IDEA system objects
 * Now project-scoped to prevent state sharing between projects
 */
@Service(Service.Level.PROJECT)
class SystemObjectProvider(private val project: Project) : Disposable {
    private val logger = Logger.getInstance(SystemObjectProvider::class.java)

    // Mapping for storing system objects per project
    private val systemObjects = ConcurrentHashMap<String, Any>()

    /**
     * System object keys
     */
    object Keys {
        const val APPLICATION = "application"
        const val PLUGIN_SERVICE = "pluginService"
        // More system object keys can be added
    }

    /**
     * Initialize the system object provider
     * @param project current project
     */
    fun initialize(project: Project) {
        logger.info("Initializing SystemObjectProvider for project: ${project.name}")

        // Register application-level objects
        register(Keys.APPLICATION, ApplicationManager.getApplication())
    }

    /**
     * Register a system object
     * @param key object key
     * @param obj object instance
     */
    fun register(key: String, obj: Any) {
        systemObjects[key] = obj
        logger.debug("Registered system object for project ${project.name}: $key")
    }

    /**
     * Get a system object
     * @param key object key
     * @return object instance or null
     */
    @Suppress("UNCHECKED_CAST")
    fun <T> get(key: String): T? {
        return systemObjects[key] as? T
    }

    /**
     * Remove a system object
     * @param key object key
     */
    fun remove(key: String) {
        systemObjects.remove(key)
        logger.debug("Removed system object for project ${project.name}: $key")
    }

    /**
     * Check if a system object exists
     * @param key object key
     * @return true if exists, false otherwise
     */
    fun has(key: String): Boolean {
        return systemObjects.containsKey(key)
    }

    /**
     * Get all registered keys
     * @return set of registered keys
     */
    fun getKeys(): Set<String> {
        return systemObjects.keys.toSet()
    }

    /**
     * Clean up resources for this project
     */
    override fun dispose() {
        logger.info("Disposing SystemObjectProvider for project: ${project.name}")
        systemObjects.clear()
    }

    companion object {
        /**
         * Get SystemObjectProvider instance for a project
         * @param project the project
         * @return SystemObjectProvider instance
         */
        fun getInstance(project: Project): SystemObjectProvider {
            return project.getService(SystemObjectProvider::class.java)
        }
    }
}
