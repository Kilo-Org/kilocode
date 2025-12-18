package ai.kilocode.jetbrains.commands

import ai.kilocode.jetbrains.core.ContextManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project

/**
 * Registers the setContext command for managing VSCode-style context keys.
 * 
 * The setContext command allows the extension to set context values that can be used
 * to control UI state and feature availability. This is commonly used by features like
 * the GhostProvider (autocomplete) to enable/disable keybindings dynamically.
 * 
 * @param project The current IntelliJ project
 * @param registry The command registry to register commands with
 */
fun registerSetContextCommands(project: Project, registry: CommandRegistry) {
    // Register the primary command
    registry.registerCommand(
        object : ICommand {
            override fun getId(): String {
                return "setContext"
            }
            
            override fun getMethod(): String {
                return "setContext"
            }
            
            override fun handler(): Any {
                return SetContextCommands(project)
            }
            
            override fun returns(): String? {
                return "void"
            }
        },
    )
    
    // Register alias with underscore prefix for compatibility with VSCode
    registry.registerCommandAlias("setContext", "_setContext")
}

/**
 * Handles setContext command operations for managing context keys.
 * 
 * This class provides the implementation for the setContext command, which allows
 * setting context key-value pairs that can be used throughout the plugin to control
 * feature availability and UI state.
 * 
 * Example context keys used by GhostProvider:
 * - kilocode.ghost.enableQuickInlineTaskKeybinding
 * - kilocode.ghost.enableSmartInlineTaskKeybinding
 */
class SetContextCommands(val project: Project) {
    private val logger = Logger.getInstance(SetContextCommands::class.java)
    private val contextManager = ContextManager.getInstance(project)
    
    /**
     * Sets a context value for the given key.
     * 
     * This method is called when the setContext command is executed from the extension.
     * It stores the key-value pair in the ContextManager for later retrieval.
     * 
     * @param key The context key to set (e.g., "kilocode.ghost.enableQuickInlineTaskKeybinding")
     * @param value The value to set (typically Boolean, but can be String, Number, etc.)
     * @return null (void return type)
     */
    suspend fun setContext(key: String, value: Any?): Any? {
        try {
            logger.info("Setting context: $key = $value")
            contextManager.setContext(key, value)
            logger.debug("Context successfully set: $key")
        } catch (e: Exception) {
            logger.error("Failed to set context: $key = $value", e)
            throw e
        }
        
        return null
    }
}