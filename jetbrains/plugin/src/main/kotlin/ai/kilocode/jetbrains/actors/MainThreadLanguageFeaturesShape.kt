package ai.kilocode.jetbrains.actors

import ai.kilocode.jetbrains.core.ExtensionIdentifier
import ai.kilocode.jetbrains.inline.InlineCompletionManager
import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project

/**
 * Language features related interface.
 * Corresponds to the MainThreadLanguageFeaturesShape interface in VSCode.
 * This interface defines the contract for language feature providers that run on the main thread.
 * It provides methods to register various language intelligence features like code completion,
 * hover information, symbol navigation, and more.
 */
interface MainThreadLanguageFeaturesShape : Disposable {
    /**
     * Unregisters service.
     * @param handle Provider handle
     */
    fun unregister(handle: Int)

    /**
     * Registers document symbol provider.
     * @param handle Provider handle
     * @param selector Document selector
     * @param label Label
     */
    fun registerDocumentSymbolProvider(handle: Int, selector: List<Map<String, Any?>>, label: String)

    /**
     * Registers code lens support.
     * @param handle Provider handle
     * @param selector Document selector
     * @param eventHandle Event handle
     */
    fun registerCodeLensSupport(handle: Int, selector: List<Map<String, Any?>>, eventHandle: Int?)

    /**
     * Emits code lens event.
     * @param eventHandle Event handle
     * @param event Event content
     */
    fun emitCodeLensEvent(eventHandle: Int, event: Any?)

    /**
     * Registers definition support.
     * @param handle Provider handle
     * @param selector Document selector
     */
    fun registerDefinitionSupport(handle: Int, selector: List<Map<String, Any?>>)

    /**
     * Registers declaration support.
     * @param handle Provider handle
     * @param selector Document selector
     */
    fun registerDeclarationSupport(handle: Int, selector: List<Map<String, Any?>>)

    /**
     * Registers implementation support.
     * @param handle Provider handle
     * @param selector Document selector
     */
    fun registerImplementationSupport(handle: Int, selector: List<Map<String, Any?>>)

    /**
     * Registers type definition support.
     * @param handle Provider handle
     * @param selector Document selector
     */
    fun registerTypeDefinitionSupport(handle: Int, selector: List<Map<String, Any?>>)

    /**
     * Registers hover provider.
     * @param handle Provider handle
     * @param selector Document selector
     */
    fun registerHoverProvider(handle: Int, selector: List<Map<String, Any?>>)

    /**
     * Registers evaluatable expression provider.
     * @param handle Provider handle
     * @param selector Document selector
     */
    fun registerEvaluatableExpressionProvider(handle: Int, selector: List<Map<String, Any?>>)

    /**
     * Registers inline values provider.
     * @param handle Provider handle
     * @param selector Document selector
     * @param eventHandle Event handle
     */
    fun registerInlineValuesProvider(handle: Int, selector: List<Map<String, Any?>>, eventHandle: Int?)

    /**
     * Emits inline values event.
     * @param eventHandle Event handle
     * @param event Event content
     */
    fun emitInlineValuesEvent(eventHandle: Int, event: Any?)

    /**
     * Registers document highlight provider.
     * @param handle Provider handle
     * @param selector Document selector
     */
    fun registerDocumentHighlightProvider(handle: Int, selector: List<Map<String, Any?>>)

    /**
     * Registers multi-document highlight provider.
     * @param handle Provider handle
     * @param selector Document selector
     */
    fun registerMultiDocumentHighlightProvider(handle: Int, selector: List<Map<String, Any?>>)

    /**
     * Registers linked editing range provider.
     * @param handle Provider handle
     * @param selector Document selector
     */
    fun registerLinkedEditingRangeProvider(handle: Int, selector: List<Map<String, Any?>>)

    /**
     * Registers reference support.
     * @param handle Provider handle
     * @param selector Document selector
     */
    fun registerReferenceSupport(handle: Int, selector: List<Map<String, Any?>>)

    /**
     * Registers code action support.
     * @param handle Provider handle
     * @param selector Document selector
     * @param metadata Metadata
     * @param displayName Display name
     * @param extensionID Extension ID
     * @param supportsResolve Whether to support resolve
     */
    fun registerCodeActionSupport(
        handle: Int,
        selector: List<Map<String, Any?>>,
        metadata: Map<String, Any?>,
        displayName: String,
        extensionID: String,
        supportsResolve: Boolean,
    )

    /**
     * Registers paste edit provider.
     * @param handle Provider handle
     * @param selector Document selector
     * @param metadata Metadata
     */
    fun registerPasteEditProvider(
        handle: Int,
        selector: List<Map<String, Any?>>,
        metadata: Map<String, Any?>,
    )

    /**
     * Registers document formatting support.
     * @param handle Provider handle
     * @param selector Document selector
     * @param extensionId Extension ID
     * @param displayName Display name
     */
    fun registerDocumentFormattingSupport(
        handle: Int,
        selector: List<Map<String, Any?>>,
        extensionId: ExtensionIdentifier,
        displayName: String,
    )

    /**
     * Registers range formatting support.
     * @param handle Provider handle
     * @param selector Document selector
     * @param extensionId Extension ID
     * @param displayName Display name
     * @param supportRanges Whether to support ranges
     */
    fun registerRangeFormattingSupport(
        handle: Int,
        selector: List<Map<String, Any?>>,
        extensionId: ExtensionIdentifier,
        displayName: String,
        supportRanges: Boolean,
    )

    /**
     * Registers on-type formatting support.
     * @param handle Provider handle
     * @param selector Document selector
     * @param autoFormatTriggerCharacters Auto-format trigger characters
     * @param extensionId Extension ID
     */
    fun registerOnTypeFormattingSupport(
        handle: Int,
        selector: List<Map<String, Any?>>,
        autoFormatTriggerCharacters: List<String>,
        extensionId: ExtensionIdentifier,
    )

    /**
     * Registers navigate type support.
     * @param handle Provider handle
     * @param supportsResolve Whether to support resolve
     */
    fun registerNavigateTypeSupport(handle: Int, supportsResolve: Boolean)

    /**
     * Registers rename support.
     * @param handle Provider handle
     * @param selector Document selector
     * @param supportsResolveInitialValues Whether to support resolve initial values
     */
    fun registerRenameSupport(handle: Int, selector: List<Map<String, Any?>>, supportsResolveInitialValues: Boolean)

    /**
     * Registers new symbol names provider.
     * @param handle Provider handle
     * @param selector Document selector
     */
    fun registerNewSymbolNamesProvider(handle: Int, selector: List<Map<String, Any?>>)

    /**
     * Registers document semantic tokens provider.
     * @param handle Provider handle
     * @param selector Document selector
     * @param legend Legend
     * @param eventHandle Event handle
     */
    fun registerDocumentSemanticTokensProvider(
        handle: Int,
        selector: List<Map<String, Any?>>,
        legend: Map<String, Any?>,
        eventHandle: Int?,
    )

    /**
     * Emits document semantic tokens event.
     * @param eventHandle Event handle
     */
    fun emitDocumentSemanticTokensEvent(eventHandle: Int)

    /**
     * Registers document range semantic tokens provider.
     * @param handle Provider handle
     * @param selector Document selector
     * @param legend Legend
     */
    fun registerDocumentRangeSemanticTokensProvider(
        handle: Int,
        selector: List<Map<String, Any?>>,
        legend: Map<String, Any?>,
    )

    /**
     * Registers completions provider.
     * @param handle Provider handle
     * @param selector Document selector
     * @param triggerCharacters Trigger characters
     * @param supportsResolveDetails Whether to support resolve details
     * @param extensionId Extension ID
     */
    fun registerCompletionsProvider(
        handle: Int,
        selector: List<Map<String, Any?>>,
        triggerCharacters: List<String>,
        supportsResolveDetails: Boolean,
        extensionId: ExtensionIdentifier,
    )

    /**
     * Registers inline completions support.
     * @param handle Provider handle
     * @param selector Document selector
     * @param supportsHandleDidShowCompletionItem Whether to support handle did show completion item
     * @param extensionId Extension ID
     * @param yieldsToExtensionIds Yields to extension IDs
     * @param displayName Display name
     * @param debounceDelayMs Debounce delay in milliseconds
     */
    fun registerInlineCompletionsSupport(
        handle: Int,
        selector: List<Map<String, Any?>>,
        supportsHandleDidShowCompletionItem: Boolean,
        extensionId: String,
        yieldsToExtensionIds: List<String>,
        displayName: String?,
        debounceDelayMs: Int?,
    )

    /**
     * Registers inline edit provider.
     * @param handle Provider handle
     * @param selector Document selector
     * @param extensionId Extension ID
     * @param displayName Display name
     */
    fun registerInlineEditProvider(
        handle: Int,
        selector: List<Map<String, Any?>>,
        extensionId: ExtensionIdentifier,
        displayName: String,
    )

    /**
     * Registers signature help provider.
     * @param handle Provider handle
     * @param selector Document selector
     * @param metadata Metadata
     */
    fun registerSignatureHelpProvider(
        handle: Int,
        selector: List<Map<String, Any?>>,
        metadata: Map<String, Any?>,
    )

    /**
     * Registers inlay hints provider.
     * @param handle Provider handle
     * @param selector Document selector
     * @param supportsResolve Whether to support resolve
     * @param eventHandle Event handle
     * @param displayName Display name
     */
    fun registerInlayHintsProvider(
        handle: Int,
        selector: List<Map<String, Any?>>,
        supportsResolve: Boolean,
        eventHandle: Int?,
        displayName: String?,
    )

    /**
     * Emits inlay hints event.
     * @param eventHandle Event handle
     */
    fun emitInlayHintsEvent(eventHandle: Int)

    /**
     * Registers document link provider.
     * @param handle Provider handle
     * @param selector Document selector
     * @param supportsResolve Whether to support resolve
     */
    fun registerDocumentLinkProvider(
        handle: Int,
        selector: List<Map<String, Any?>>,
        supportsResolve: Boolean,
    )

    /**
     * Registers document color provider.
     * @param handle Provider handle
     * @param selector Document selector
     */
    fun registerDocumentColorProvider(handle: Int, selector: List<Map<String, Any?>>)

    /**
     * Registers folding range provider.
     * @param handle Provider handle
     * @param selector Document selector
     * @param extensionId Extension ID
     * @param eventHandle Event handle
     */
    fun registerFoldingRangeProvider(
        handle: Int,
        selector: List<Map<String, Any?>>,
        extensionId: ExtensionIdentifier,
        eventHandle: Int?,
    )

    /**
     * Emits folding range event.
     * @param eventHandle Event handle
     * @param event Event content
     */
    fun emitFoldingRangeEvent(eventHandle: Int, event: Any?)

    /**
     * Registers selection range provider.
     * @param handle Provider handle
     * @param selector Document selector
     */
    fun registerSelectionRangeProvider(handle: Int, selector: List<Map<String, Any?>>)

    /**
     * Registers call hierarchy provider.
     * @param handle Provider handle
     * @param selector Document selector
     */
    fun registerCallHierarchyProvider(handle: Int, selector: List<Map<String, Any?>>)

    /**
     * Registers type hierarchy provider.
     * @param handle Provider handle
     * @param selector Document selector
     */
    fun registerTypeHierarchyProvider(handle: Int, selector: List<Map<String, Any?>>)

    /**
     * Registers document on drop edit provider.
     * @param handle Provider handle
     * @param selector Document selector
     * @param metadata Metadata
     */
    fun registerDocumentOnDropEditProvider(
        handle: Int,
        selector: List<Map<String, Any?>>,
        metadata: Map<String, Any?>?,
    )

    /**
     * Resolves paste file data.
     * @param handle Provider handle
     * @param requestId Request ID
     * @param dataId Data ID
     * @return File data
     */
    fun resolvePasteFileData(handle: Int, requestId: Int, dataId: String): ByteArray

    /**
     * Resolves document on drop file data.
     * @param handle Provider handle
     * @param requestId Request ID
     * @param dataId Data ID
     * @return File data
     */
    fun resolveDocumentOnDropFileData(handle: Int, requestId: Int, dataId: String): ByteArray

    /**
     * Sets language configuration.
     * @param handle Provider handle
     * @param languageId Language ID
     * @param configuration Configuration
     */
    fun setLanguageConfiguration(handle: Int, languageId: String, configuration: Map<String, Any?>)
}

/**
 * Language features related implementation class.
 * This class implements the MainThreadLanguageFeaturesShape interface and provides
 * concrete implementations for all language feature registration methods.
 * It acts as a bridge between the extension host and the IDE's language services.
 */
class MainThreadLanguageFeatures(private val project: Project) : MainThreadLanguageFeaturesShape {
    private val logger = Logger.getInstance(MainThreadLanguageFeatures::class.java)
    
    /**
     * Manager for inline completion providers.
     * Handles registration, unregistration, and lifecycle management.
     */
    private val inlineCompletionManager: InlineCompletionManager by lazy {
        InlineCompletionManager(project)
    }

    override fun unregister(handle: Int) {
        logger.info("Unregistering service: handle=$handle")
        
        // Try to unregister from inline completion manager
        try {
            inlineCompletionManager.unregisterProvider(handle)
        } catch (e: Exception) {
            logger.warn("Failed to unregister inline completion provider: handle=$handle", e)
        }
    }

    override fun registerDocumentSymbolProvider(handle: Int, selector: List<Map<String, Any?>>, label: String) {
        logger.info("Registering document symbol provider: handle=$handle, selector=$selector, label=$label")
    }

    override fun registerCodeLensSupport(handle: Int, selector: List<Map<String, Any?>>, eventHandle: Int?) {
        logger.info("Registering code lens support: handle=$handle, selector=$selector, eventHandle=$eventHandle")
    }

    override fun emitCodeLensEvent(eventHandle: Int, event: Any?) {
        logger.info("Emitting code lens event: eventHandle=$eventHandle, event=$event")
    }

    override fun registerDefinitionSupport(handle: Int, selector: List<Map<String, Any?>>) {
        logger.info("Registering definition support: handle=$handle, selector=$selector")
    }

    override fun registerDeclarationSupport(handle: Int, selector: List<Map<String, Any?>>) {
        logger.info("Registering declaration support: handle=$handle, selector=$selector")
    }

    override fun registerImplementationSupport(handle: Int, selector: List<Map<String, Any?>>) {
        logger.info("Registering implementation support: handle=$handle, selector=$selector")
    }

    override fun registerTypeDefinitionSupport(handle: Int, selector: List<Map<String, Any?>>) {
        logger.info("Registering type definition support: handle=$handle, selector=$selector")
    }

    override fun registerHoverProvider(handle: Int, selector: List<Map<String, Any?>>) {
        logger.info("Registering hover provider: handle=$handle, selector=$selector")
    }

    override fun registerEvaluatableExpressionProvider(handle: Int, selector: List<Map<String, Any?>>) {
        logger.info("Registering evaluatable expression provider: handle=$handle, selector=$selector")
    }

    override fun registerInlineValuesProvider(handle: Int, selector: List<Map<String, Any?>>, eventHandle: Int?) {
        logger.info("Registering inline values provider: handle=$handle, selector=$selector, eventHandle=$eventHandle")
    }

    override fun emitInlineValuesEvent(eventHandle: Int, event: Any?) {
        logger.info("Emitting inline values event: eventHandle=$eventHandle, event=$event")
    }

    override fun registerDocumentHighlightProvider(handle: Int, selector: List<Map<String, Any?>>) {
        logger.info("Registering document highlight provider: handle=$handle, selector=$selector")
    }

    override fun registerMultiDocumentHighlightProvider(handle: Int, selector: List<Map<String, Any?>>) {
        logger.info("Registering multi-document highlight provider: handle=$handle, selector=$selector")
    }

    override fun registerLinkedEditingRangeProvider(handle: Int, selector: List<Map<String, Any?>>) {
        logger.info("Registering linked editing range provider: handle=$handle, selector=$selector")
    }

    override fun registerReferenceSupport(handle: Int, selector: List<Map<String, Any?>>) {
        logger.info("Registering reference support: handle=$handle, selector=$selector")
    }

    override fun registerCodeActionSupport(
        handle: Int,
        selector: List<Map<String, Any?>>,
        metadata: Map<String, Any?>,
        displayName: String,
        extensionID: String,
        supportsResolve: Boolean,
    ) {
        logger.info("Registering code action support: handle=$handle, selector=$selector, metadata=$metadata, displayName=$displayName, extensionID=$extensionID, supportsResolve=$supportsResolve")
    }

    override fun registerPasteEditProvider(
        handle: Int,
        selector: List<Map<String, Any?>>,
        metadata: Map<String, Any?>,
    ) {
        logger.info("Registering paste edit provider: handle=$handle, selector=$selector, metadata=$metadata")
    }

    override fun registerDocumentFormattingSupport(
        handle: Int,
        selector: List<Map<String, Any?>>,
        extensionId: ExtensionIdentifier,
        displayName: String,
    ) {
        logger.info("Registering document formatting support: handle=$handle, selector=$selector, extensionId=${extensionId.value}, displayName=$displayName")
    }

    override fun registerRangeFormattingSupport(
        handle: Int,
        selector: List<Map<String, Any?>>,
        extensionId: ExtensionIdentifier,
        displayName: String,
        supportRanges: Boolean,
    ) {
        logger.info("Registering range formatting support: handle=$handle, selector=$selector, extensionId=${extensionId.value}, displayName=$displayName, supportRanges=$supportRanges")
    }

    override fun registerOnTypeFormattingSupport(
        handle: Int,
        selector: List<Map<String, Any?>>,
        autoFormatTriggerCharacters: List<String>,
        extensionId: ExtensionIdentifier,
    ) {
        logger.info("Registering on-type formatting support: handle=$handle, selector=$selector, autoFormatTriggerCharacters=$autoFormatTriggerCharacters, extensionId=${extensionId.value}")
    }

    override fun registerNavigateTypeSupport(handle: Int, supportsResolve: Boolean) {
        logger.info("Registering navigate type support: handle=$handle, supportsResolve=$supportsResolve")
    }

    override fun registerRenameSupport(handle: Int, selector: List<Map<String, Any?>>, supportsResolveInitialValues: Boolean) {
        logger.info("Registering rename support: handle=$handle, selector=$selector, supportsResolveInitialValues=$supportsResolveInitialValues")
    }

    override fun registerNewSymbolNamesProvider(handle: Int, selector: List<Map<String, Any?>>) {
        logger.info("Registering new symbol names provider: handle=$handle, selector=$selector")
    }

    override fun registerDocumentSemanticTokensProvider(
        handle: Int,
        selector: List<Map<String, Any?>>,
        legend: Map<String, Any?>,
        eventHandle: Int?,
    ) {
        logger.info("Registering document semantic tokens provider: handle=$handle, selector=$selector, legend=$legend, eventHandle=$eventHandle")
    }

    override fun emitDocumentSemanticTokensEvent(eventHandle: Int) {
        logger.info("Emitting document semantic tokens event: eventHandle=$eventHandle")
    }

    override fun registerDocumentRangeSemanticTokensProvider(
        handle: Int,
        selector: List<Map<String, Any?>>,
        legend: Map<String, Any?>,
    ) {
        logger.info("Registering document range semantic tokens provider: handle=$handle, selector=$selector, legend=$legend")
    }

    override fun registerCompletionsProvider(
        handle: Int,
        selector: List<Map<String, Any?>>,
        triggerCharacters: List<String>,
        supportsResolveDetails: Boolean,
        extensionId: ExtensionIdentifier,
    ) {
        logger.info("Registering completions provider: handle=$handle, selector=$selector, triggerCharacters=$triggerCharacters, supportsResolveDetails=$supportsResolveDetails, extensionId=${extensionId.value}")
    }

    override fun registerInlineCompletionsSupport(
        handle: Int,
        selector: List<Map<String, Any?>>,
        supportsHandleDidShowCompletionItem: Boolean,
        extensionId: String,
        yieldsToExtensionIds: List<String>,
        displayName: String?,
        debounceDelayMs: Int?,
    ) {
        logger.info("Registering inline completions support: handle=$handle, extensionId=$extensionId, displayName=$displayName")
        
        try {
            inlineCompletionManager.registerProvider(
                handle = handle,
                selector = selector,
                supportsHandleDidShowCompletionItem = supportsHandleDidShowCompletionItem,
                extensionId = extensionId,
                yieldsToExtensionIds = yieldsToExtensionIds,
                displayName = displayName,
                debounceDelayMs = debounceDelayMs
            )
            logger.info("Successfully registered inline completion provider: handle=$handle")
        } catch (e: Exception) {
            logger.error("Failed to register inline completion provider: handle=$handle", e)
        }
    }

    override fun registerInlineEditProvider(
        handle: Int,
        selector: List<Map<String, Any?>>,
        extensionId: ExtensionIdentifier,
        displayName: String,
    ) {
        logger.info("Registering inline edit provider: handle=$handle, selector=$selector, extensionId=${extensionId.value}, displayName=$displayName")
    }

    override fun registerSignatureHelpProvider(
        handle: Int,
        selector: List<Map<String, Any?>>,
        metadata: Map<String, Any?>,
    ) {
        logger.info("Registering signature help provider: handle=$handle, selector=$selector, metadata=$metadata")
    }

    override fun registerInlayHintsProvider(
        handle: Int,
        selector: List<Map<String, Any?>>,
        supportsResolve: Boolean,
        eventHandle: Int?,
        displayName: String?,
    ) {
        logger.info("Registering inlay hints provider: handle=$handle, selector=$selector, supportsResolve=$supportsResolve, eventHandle=$eventHandle, displayName=$displayName")
    }

    override fun emitInlayHintsEvent(eventHandle: Int) {
        logger.info("Emitting inlay hints event: eventHandle=$eventHandle")
    }

    override fun registerDocumentLinkProvider(
        handle: Int,
        selector: List<Map<String, Any?>>,
        supportsResolve: Boolean,
    ) {
        logger.info("Registering document link provider: handle=$handle, selector=$selector, supportsResolve=$supportsResolve")
    }

    override fun registerDocumentColorProvider(handle: Int, selector: List<Map<String, Any?>>) {
        logger.info("Registering document color provider: handle=$handle, selector=$selector")
    }

    override fun registerFoldingRangeProvider(
        handle: Int,
        selector: List<Map<String, Any?>>,
        extensionId: ExtensionIdentifier,
        eventHandle: Int?,
    ) {
        logger.info("Registering folding range provider: handle=$handle, selector=$selector, extensionId=${extensionId.value}, eventHandle=$eventHandle")
    }

    override fun emitFoldingRangeEvent(eventHandle: Int, event: Any?) {
        logger.info("Emitting folding range event: eventHandle=$eventHandle, event=$event")
    }

    override fun registerSelectionRangeProvider(handle: Int, selector: List<Map<String, Any?>>) {
        logger.info("Registering selection range provider: handle=$handle, selector=$selector")
    }

    override fun registerCallHierarchyProvider(handle: Int, selector: List<Map<String, Any?>>) {
        logger.info("Registering call hierarchy provider: handle=$handle, selector=$selector")
    }

    override fun registerTypeHierarchyProvider(handle: Int, selector: List<Map<String, Any?>>) {
        logger.info("Registering type hierarchy provider: handle=$handle, selector=$selector")
    }

    override fun registerDocumentOnDropEditProvider(
        handle: Int,
        selector: List<Map<String, Any?>>,
        metadata: Map<String, Any?>?,
    ) {
        logger.info("Registering document on drop edit provider: handle=$handle, selector=$selector, metadata=$metadata")
    }

    override fun resolvePasteFileData(handle: Int, requestId: Int, dataId: String): ByteArray {
        logger.info("Resolving paste file data: handle=$handle, requestId=$requestId, dataId=$dataId")
        return ByteArray(0) // Return empty array, actual implementation needs to handle real file data
    }

    override fun resolveDocumentOnDropFileData(handle: Int, requestId: Int, dataId: String): ByteArray {
        logger.info("Resolving document on drop file data: handle=$handle, requestId=$requestId, dataId=$dataId")
        return ByteArray(0) // Return empty array, actual implementation needs to handle real file data
    }

    override fun setLanguageConfiguration(handle: Int, languageId: String, configuration: Map<String, Any?>) {
        logger.info("Setting language configuration: handle=$handle, languageId=$languageId, configuration=$configuration")
    }

    override fun dispose() {
        logger.info("Disposing MainThreadLanguageFeatures resources")
        
        // Dispose inline completion manager
        try {
            inlineCompletionManager.dispose()
        } catch (e: Exception) {
            logger.error("Error disposing inline completion manager", e)
        }
    }
}
