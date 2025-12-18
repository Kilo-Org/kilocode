package ai.kilocode.jetbrains.inline

import com.intellij.codeInsight.inline.completion.InlineCompletionProvider
import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.extensions.ExtensionPointName
import com.intellij.openapi.project.Project

/**
 * Manages the lifecycle of inline completion providers.
 * Handles registration, unregistration, and document selector matching.
 * 
 * This class follows the same pattern as code actions registration,
 * maintaining a mapping of handles to providers.
 */
class InlineCompletionManager(private val project: Project) : Disposable {
    
    private val logger = Logger.getInstance(InlineCompletionManager::class.java)
    
    /**
     * Map of handle to provider instance.
     * Used to track and manage registered providers.
     */
    private val providers = mutableMapOf<Int, ProviderRegistration>()
    
    /**
     * Registers an inline completion provider.
     * 
     * @param handle Unique handle for this provider
     * @param selector Document selector (language patterns, file patterns, etc.)
     * @param supportsHandleDidShowCompletionItem Whether the provider supports showing completion items
     * @param extensionId The ID of the extension providing completions
     * @param yieldsToExtensionIds List of extension IDs this provider yields to
     * @param displayName Optional display name for the provider
     * @param debounceDelayMs Optional debounce delay (handled by extension, not used here)
     */
    fun registerProvider(
        handle: Int,
        selector: List<Map<String, Any?>>,
        supportsHandleDidShowCompletionItem: Boolean,
        extensionId: String,
        yieldsToExtensionIds: List<String>,
        displayName: String?,
        debounceDelayMs: Int?
    ) {
        logger.info("Registering inline completion provider: handle=$handle, extensionId=$extensionId, displayName=$displayName")
        
        try {
            // Create the provider instance
            val provider = KiloCodeInlineCompletionProvider(
                handle = handle,
                project = project,
                extensionId = extensionId,
                displayName = displayName
            )
            
            // Register with IntelliJ's inline completion system using extension point
            // Note: InlineCompletionProvider.EP_NAME is an application-level extension point, not project-level
            val epName = InlineCompletionProvider.EP_NAME
            val extensionPoint = epName.getPoint(null)
            
            // Add the provider to the extension point
            extensionPoint.registerExtension(provider, project)
            
            // Store the registration for later cleanup
            val providerRegistration = ProviderRegistration(
                provider = provider,
                selector = selector,
                extensionId = extensionId,
                yieldsToExtensionIds = yieldsToExtensionIds
            )
            
            providers[handle] = providerRegistration
            
            logger.info("Successfully registered inline completion provider: handle=$handle")
        } catch (e: Exception) {
            logger.error("Failed to register inline completion provider: handle=$handle", e)
            throw e
        }
    }
    
    /**
     * Unregisters an inline completion provider.
     * 
     * @param handle The handle of the provider to unregister
     */
    fun unregisterProvider(handle: Int) {
        logger.info("Unregistering inline completion provider: handle=$handle")
        
        val registration = providers.remove(handle)
        if (registration != null) {
            try {
                // Unregister from extension point
                val epName = InlineCompletionProvider.EP_NAME
                val extensionPoint = epName.getPoint(null)
                extensionPoint.unregisterExtension(registration.provider)
                
                logger.info("Successfully unregistered inline completion provider: handle=$handle")
            } catch (e: Exception) {
                logger.error("Error unregistering inline completion provider: handle=$handle", e)
            }
        } else {
            logger.warn("Attempted to unregister unknown provider: handle=$handle")
        }
    }
    
    /**
     * Gets a provider by its handle.
     * 
     * @param handle The handle of the provider
     * @return The provider instance, or null if not found
     */
    fun getProvider(handle: Int): KiloCodeInlineCompletionProvider? {
        return providers[handle]?.provider
    }
    
    /**
     * Checks if a document matches the selector for a given provider.
     * 
     * @param handle The handle of the provider
     * @param languageId The language ID of the document
     * @param fileName The file name of the document
     * @return true if the document matches the selector
     */
    fun matchesSelector(handle: Int, languageId: String?, fileName: String?): Boolean {
        val registration = providers[handle] ?: return false
        
        // Check each selector pattern
        for (selectorItem in registration.selector) {
            if (matchesSelectorItem(selectorItem, languageId, fileName)) {
                return true
            }
        }
        
        return false
    }
    
    /**
     * Checks if a document matches a single selector item.
     * Selector items can contain:
     * - language: Language ID pattern
     * - scheme: URI scheme pattern
     * - pattern: File path pattern (glob)
     */
    private fun matchesSelectorItem(
        selectorItem: Map<String, Any?>,
        languageId: String?,
        fileName: String?
    ): Boolean {
        // Check language pattern
        val language = selectorItem["language"] as? String
        if (language != null && language != "*") {
            if (languageId == null || !matchesPattern(languageId, language)) {
                return false
            }
        }
        
        // Check file pattern
        val pattern = selectorItem["pattern"] as? String
        if (pattern != null && pattern != "**/*") {
            if (fileName == null || !matchesGlobPattern(fileName, pattern)) {
                return false
            }
        }
        
        // Check scheme (usually "file" for local files)
        val scheme = selectorItem["scheme"] as? String
        if (scheme != null && scheme != "*") {
            // For now, we only support "file" scheme
            if (scheme != "file") {
                return false
            }
        }
        
        return true
    }
    
    /**
     * Simple pattern matching (supports * wildcard).
     */
    private fun matchesPattern(value: String, pattern: String): Boolean {
        if (pattern == "*") return true
        if (pattern == value) return true
        
        // Convert glob pattern to regex
        val regex = pattern
            .replace(".", "\\.")
            .replace("*", ".*")
            .toRegex()
        
        return regex.matches(value)
    }
    
    /**
     * Glob pattern matching for file paths.
     */
    private fun matchesGlobPattern(fileName: String, pattern: String): Boolean {
        if (pattern == "**/*") return true
        
        // Convert glob pattern to regex
        val regex = pattern
            .replace(".", "\\.")
            .replace("**", ".*")
            .replace("*", "[^/]*")
            .replace("?", ".")
            .toRegex()
        
        return regex.matches(fileName)
    }
    
    /**
     * Disposes all registered providers.
     */
    override fun dispose() {
        logger.info("Disposing InlineCompletionManager, unregistering ${providers.size} providers")
        
        // Unregister all providers
        val handles = providers.keys.toList()
        for (handle in handles) {
            unregisterProvider(handle)
        }
    }
    
    /**
     * Internal class to track provider registrations.
     */
    private data class ProviderRegistration(
        val provider: KiloCodeInlineCompletionProvider,
        val selector: List<Map<String, Any?>>,
        val extensionId: String,
        val yieldsToExtensionIds: List<String>
    )
}