package ai.kilocode.jetbrains.core

import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import java.util.concurrent.ConcurrentHashMap

/**
 * Context Manager Service
 * 
 * Manages VSCode-style context keys for the JetBrains plugin.
 * Provides thread-safe storage for context key-value pairs that can be used
 * to control UI state and feature availability.
 * 
 * This service is project-scoped, meaning each project has its own context storage.
 * 
 * Example usage:
 * ```kotlin
 * val contextManager = project.getService(ContextManager::class.java)
 * contextManager.setContext("kilocode.autocomplete.enableQuickInlineTaskKeybinding", true)
 * val value = contextManager.getContext("kilocode.autocomplete.enableQuickInlineTaskKeybinding")
 * ```
 */
@Service(Service.Level.PROJECT)
class ContextManager {
    private val logger = Logger.getInstance(ContextManager::class.java)
    
    /**
     * Thread-safe storage for context key-value pairs
     */
    private val contexts = ConcurrentHashMap<String, Any?>()
    
    /**
     * Sets a context value for the given key.
     * If the value is null, the context key will be removed.
     * 
     * @param key The context key (e.g., "kilocode.autocomplete.enableQuickInlineTaskKeybinding")
     * @param value The value to set (can be Boolean, String, Number, or any serializable type)
     */
    fun setContext(key: String, value: Any?) {
        if (value == null) {
            removeContext(key)
            return
        }
        
        val previousValue = contexts.put(key, value)
        
        if (logger.isDebugEnabled) {
            if (previousValue != null) {
                logger.debug("Context updated: $key = $value (previous: $previousValue)")
            } else {
                logger.debug("Context set: $key = $value")
            }
        }
    }
    
    /**
     * Gets the context value for the given key.
     * 
     * @param key The context key to retrieve
     * @return The context value, or null if the key doesn't exist
     */
    fun getContext(key: String): Any? {
        return contexts[key]
    }
    
    /**
     * Checks if a context key exists.
     * 
     * @param key The context key to check
     * @return true if the key exists, false otherwise
     */
    fun hasContext(key: String): Boolean {
        return contexts.containsKey(key)
    }
    
    /**
     * Removes a context key and its value.
     * 
     * @param key The context key to remove
     */
    fun removeContext(key: String) {
        val previousValue = contexts.remove(key)
        if (previousValue != null && logger.isDebugEnabled) {
            logger.debug("Context removed: $key (previous value: $previousValue)")
        }
    }
    
    /**
     * Gets all context keys and their values.
     * Returns a copy of the context map to prevent external modification.
     * 
     * @return A map of all context keys and values
     */
    fun getAllContexts(): Map<String, Any?> {
        return contexts.toMap()
    }
    
    /**
     * Clears all context keys.
     * This is typically used during cleanup or reset operations.
     */
    fun clearAll() {
        val count = contexts.size
        contexts.clear()
        if (logger.isDebugEnabled) {
            logger.debug("Cleared all contexts ($count keys)")
        }
    }
    
    companion object {
        /**
         * Gets the ContextManager instance for the given project.
         * 
         * @param project The project to get the ContextManager for
         * @return The ContextManager instance
         */
        fun getInstance(project: Project): ContextManager {
            return project.getService(ContextManager::class.java)
        }
    }
}