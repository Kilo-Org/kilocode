package ai.kilocode.jetbrains.core

import ai.kilocode.jetbrains.actors.MainThreadBulkEditsShape
import ai.kilocode.jetbrains.actors.MainThreadClipboardShape
import ai.kilocode.jetbrains.actors.MainThreadCommandsShape
import ai.kilocode.jetbrains.actors.MainThreadConfigurationShape
import ai.kilocode.jetbrains.actors.MainThreadConsoleShape
import ai.kilocode.jetbrains.actors.MainThreadDebugServiceShape
import ai.kilocode.jetbrains.actors.MainThreadDiaglogsShape
import ai.kilocode.jetbrains.actors.MainThreadDocumentContentProvidersShape
import ai.kilocode.jetbrains.actors.MainThreadDocumentsShape
import ai.kilocode.jetbrains.actors.MainThreadEditorTabsShape
import ai.kilocode.jetbrains.actors.MainThreadErrorsShape
import ai.kilocode.jetbrains.actors.MainThreadExtensionServiceShape
import ai.kilocode.jetbrains.actors.MainThreadFileSystemEventServiceShape
import ai.kilocode.jetbrains.actors.MainThreadFileSystemShape
import ai.kilocode.jetbrains.actors.MainThreadLanguageFeaturesShape
import ai.kilocode.jetbrains.actors.MainThreadLanguageModelToolsShape
import ai.kilocode.jetbrains.actors.MainThreadLoggerShape
import ai.kilocode.jetbrains.actors.MainThreadMessageServiceShape
import ai.kilocode.jetbrains.actors.MainThreadOutputServiceShape
import ai.kilocode.jetbrains.actors.MainThreadSearchShape
import ai.kilocode.jetbrains.actors.MainThreadSecretStateShape
import ai.kilocode.jetbrains.actors.MainThreadStatusBarShape
import ai.kilocode.jetbrains.actors.MainThreadStorageShape
import ai.kilocode.jetbrains.actors.MainThreadTaskShape
import ai.kilocode.jetbrains.actors.MainThreadTelemetryShape
import ai.kilocode.jetbrains.actors.MainThreadTerminalServiceShape
import ai.kilocode.jetbrains.actors.MainThreadTerminalShellIntegrationShape
import ai.kilocode.jetbrains.actors.MainThreadTextEditorsShape
import ai.kilocode.jetbrains.actors.MainThreadUrlsShape
import ai.kilocode.jetbrains.actors.MainThreadWebviewViewsShape
import ai.kilocode.jetbrains.actors.MainThreadWebviewsShape
import ai.kilocode.jetbrains.actors.MainThreadWindowShape
import ai.kilocode.jetbrains.ipc.proxy.createProxyIdentifier
import ai.kilocode.jetbrains.ipc.proxy.interfaces.ExtHostCommandsProxy
import ai.kilocode.jetbrains.ipc.proxy.interfaces.ExtHostConfigurationProxy
import ai.kilocode.jetbrains.ipc.proxy.interfaces.ExtHostDocumentsAndEditorsProxy
import ai.kilocode.jetbrains.ipc.proxy.interfaces.ExtHostDocumentsProxy
import ai.kilocode.jetbrains.ipc.proxy.interfaces.ExtHostEditorTabsProxy
import ai.kilocode.jetbrains.ipc.proxy.interfaces.ExtHostEditorsProxy
import ai.kilocode.jetbrains.ipc.proxy.interfaces.ExtHostExtensionServiceProxy
import ai.kilocode.jetbrains.ipc.proxy.interfaces.ExtHostFileSystemEventServiceProxy
import ai.kilocode.jetbrains.ipc.proxy.interfaces.ExtHostTerminalServiceProxy
import ai.kilocode.jetbrains.ipc.proxy.interfaces.ExtHostTerminalShellIntegrationProxy
import ai.kilocode.jetbrains.ipc.proxy.interfaces.ExtHostWebviewViewsProxy
import ai.kilocode.jetbrains.ipc.proxy.interfaces.ExtHostWebviewsProxy
import ai.kilocode.jetbrains.ipc.proxy.interfaces.ExtHostWorkspaceProxy
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger

/**
 * Service proxy registry class, centrally manages registration of all service proxies
 */
@Service(Service.Level.PROJECT)
class ServiceProxyRegistry private constructor() {
    private val logger = Logger.getInstance(this::class.java)

//    companion object {
//        private val instance = ServiceProxyRegistry()
//
//        fun getInstance(): ServiceProxyRegistry {
//            return instance
//        }
//    }
//
    /**
     * Initialize and register all service proxies
     */
    fun initialize() {
        // Initialize all proxy identifiers
        initializeAllProxies()
    }

    /**
     * Initialize all proxy identifiers
     * Ensure all services are initialized when created
     */
    private fun initializeAllProxies() {
        logger.info("Initialize all proxy identifiers")

        // Main thread service proxies
        val mainThreadProxies = listOf(
            MainContext.MainThreadAuthentication,
            MainContext.MainThreadBulkEdits,
            MainContext.MainThreadLanguageModels,
            MainContext.MainThreadEmbeddings,
            MainContext.MainThreadChatAgents2,
            MainContext.MainThreadCodeMapper,
            MainContext.MainThreadLanguageModelTools,
            MainContext.MainThreadClipboard,
            MainContext.MainThreadCommands,
            MainContext.MainThreadComments,
            MainContext.MainThreadConfiguration,
            MainContext.MainThreadConsole,
            MainContext.MainThreadDebugService,
            MainContext.MainThreadDecorations,
            MainContext.MainThreadDiagnostics,
            MainContext.MainThreadDialogs,
            MainContext.MainThreadDocuments,
            MainContext.MainThreadDocumentContentProviders,
            MainContext.MainThreadTextEditors,
            MainContext.MainThreadEditorInsets,
            MainContext.MainThreadEditorTabs,
            MainContext.MainThreadErrors,
            MainContext.MainThreadTreeViews,
            MainContext.MainThreadDownloadService,
            MainContext.MainThreadLanguageFeatures,
            MainContext.MainThreadLanguages,
            MainContext.MainThreadLogger,
            MainContext.MainThreadMessageService,
            MainContext.MainThreadOutputService,
            MainContext.MainThreadProgress,
            MainContext.MainThreadQuickDiff,
            MainContext.MainThreadQuickOpen,
            MainContext.MainThreadStatusBar,
            MainContext.MainThreadSecretState,
            MainContext.MainThreadStorage,
            MainContext.MainThreadSpeech,
            MainContext.MainThreadTelemetry,
            MainContext.MainThreadTerminalService,
            MainContext.MainThreadTerminalShellIntegration,
            MainContext.MainThreadWebviews,
            MainContext.MainThreadWebviewPanels,
            MainContext.MainThreadWebviewViews,
            MainContext.MainThreadCustomEditors,
            MainContext.MainThreadUrls,
            MainContext.MainThreadUriOpeners,
            MainContext.MainThreadProfileContentHandlers,
            MainContext.MainThreadWorkspace,
            MainContext.MainThreadFileSystem,
            MainContext.MainThreadFileSystemEventService,
            MainContext.MainThreadExtensionService,
            MainContext.MainThreadSCM,
            MainContext.MainThreadSearch,
            MainContext.MainThreadShare,
            MainContext.MainThreadTask,
            MainContext.MainThreadWindow,
            MainContext.MainThreadLabelService,
            MainContext.MainThreadNotebook,
            MainContext.MainThreadNotebookDocuments,
            MainContext.MainThreadNotebookEditors,
            MainContext.MainThreadNotebookKernels,
            MainContext.MainThreadNotebookRenderers,
            MainContext.MainThreadInteractive,
            MainContext.MainThreadTheming,
            MainContext.MainThreadTunnelService,
            MainContext.MainThreadManagedSockets,
            MainContext.MainThreadTimeline,
            MainContext.MainThreadTesting,
            MainContext.MainThreadLocalization,
            MainContext.MainThreadMcp,
            MainContext.MainThreadAiRelatedInformation,
            MainContext.MainThreadAiEmbeddingVector,
            MainContext.MainThreadChatStatus,
        )

        // Extension host service proxies
        val extHostProxies = listOf(
            ExtHostContext.ExtHostCodeMapper,
            ExtHostContext.ExtHostCommands,
            ExtHostContext.ExtHostConfiguration,
            ExtHostContext.ExtHostDiagnostics,
            ExtHostContext.ExtHostDebugService,
            ExtHostContext.ExtHostDecorations,
            ExtHostContext.ExtHostDocumentsAndEditors,
            ExtHostContext.ExtHostDocuments,
            ExtHostContext.ExtHostDocumentContentProviders,
            ExtHostContext.ExtHostDocumentSaveParticipant,
            ExtHostContext.ExtHostEditors,
            ExtHostContext.ExtHostTreeViews,
            ExtHostContext.ExtHostFileSystem,
            ExtHostContext.ExtHostFileSystemInfo,
            ExtHostContext.ExtHostFileSystemEventService,
            ExtHostContext.ExtHostLanguages,
            ExtHostContext.ExtHostLanguageFeatures,
            ExtHostContext.ExtHostQuickOpen,
            ExtHostContext.ExtHostQuickDiff,
            ExtHostContext.ExtHostStatusBar,
            ExtHostContext.ExtHostShare,
            ExtHostContext.ExtHostExtensionService,
            ExtHostContext.ExtHostLogLevelServiceShape,
            ExtHostContext.ExtHostTerminalService,
            ExtHostContext.ExtHostTerminalShellIntegration,
            ExtHostContext.ExtHostSCM,
            ExtHostContext.ExtHostSearch,
            ExtHostContext.ExtHostTask,
            ExtHostContext.ExtHostWorkspace,
            ExtHostContext.ExtHostWindow,
            ExtHostContext.ExtHostWebviews,
            ExtHostContext.ExtHostWebviewPanels,
            ExtHostContext.ExtHostCustomEditors,
            ExtHostContext.ExtHostWebviewViews,
            ExtHostContext.ExtHostEditorInsets,
            ExtHostContext.ExtHostEditorTabs,
            ExtHostContext.ExtHostProgress,
            ExtHostContext.ExtHostComments,
            ExtHostContext.ExtHostSecretState,
            ExtHostContext.ExtHostStorage,
            ExtHostContext.ExtHostUrls,
            ExtHostContext.ExtHostUriOpeners,
            ExtHostContext.ExtHostProfileContentHandlers,
            ExtHostContext.ExtHostOutputService,
            ExtHostContext.ExtHostLabelService,
            ExtHostContext.ExtHostNotebook,
            ExtHostContext.ExtHostNotebookDocuments,
            ExtHostContext.ExtHostNotebookEditors,
            ExtHostContext.ExtHostNotebookKernels,
            ExtHostContext.ExtHostNotebookRenderers,
            ExtHostContext.ExtHostNotebookDocumentSaveParticipant,
            ExtHostContext.ExtHostInteractive,
            ExtHostContext.ExtHostChatAgents2,
            ExtHostContext.ExtHostLanguageModelTools,
            ExtHostContext.ExtHostChatProvider,
            ExtHostContext.ExtHostSpeech,
            ExtHostContext.ExtHostEmbeddings,
            ExtHostContext.ExtHostAiRelatedInformation,
            ExtHostContext.ExtHostAiEmbeddingVector,
            ExtHostContext.ExtHostTheming,
            ExtHostContext.ExtHostTunnelService,
            ExtHostContext.ExtHostManagedSockets,
            ExtHostContext.ExtHostAuthentication,
            ExtHostContext.ExtHostTimeline,
            ExtHostContext.ExtHostTesting,
            ExtHostContext.ExtHostTelemetry,
            ExtHostContext.ExtHostLocalization,
            ExtHostContext.ExtHostMcp,
        )

        logger.info("Initialized ${mainThreadProxies.size} main thread services and ${extHostProxies.size} extension host services")
    }

    /**
     * Main thread context - Context ID enum values defined in VSCode
     */
    object MainContext {
        val MainThreadAuthentication = createProxyIdentifier<Any>("MainThreadAuthentication")
        val MainThreadBulkEdits = createProxyIdentifier<MainThreadBulkEditsShape>("MainThreadBulkEdits")
        val MainThreadLanguageModels = createProxyIdentifier<Any>("MainThreadLanguageModels")
        val MainThreadEmbeddings = createProxyIdentifier<Any>("MainThreadEmbeddings")
        val MainThreadChatAgents2 = createProxyIdentifier<Any>("MainThreadChatAgents2")
        val MainThreadCodeMapper = createProxyIdentifier<Any>("MainThreadCodeMapper")
        val MainThreadLanguageModelTools = createProxyIdentifier<MainThreadLanguageModelToolsShape>("MainThreadLanguageModelTools")
        val MainThreadClipboard = createProxyIdentifier<MainThreadClipboardShape>("MainThreadClipboard")
        val MainThreadCommands = createProxyIdentifier<MainThreadCommandsShape>("MainThreadCommands")
        val MainThreadComments = createProxyIdentifier<Any>("MainThreadComments")
        val MainThreadConfiguration = createProxyIdentifier<MainThreadConfigurationShape>("MainThreadConfiguration")
        val MainThreadConsole = createProxyIdentifier<MainThreadConsoleShape>("MainThreadConsole")
        val MainThreadDebugService = createProxyIdentifier<MainThreadDebugServiceShape>("MainThreadDebugService")
        val MainThreadDecorations = createProxyIdentifier<Any>("MainThreadDecorations")
        val MainThreadDiagnostics = createProxyIdentifier<Any>("MainThreadDiagnostics")
        val MainThreadDialogs = createProxyIdentifier<MainThreadDiaglogsShape>("MainThreadDiaglogs")
        val MainThreadDocuments = createProxyIdentifier<MainThreadDocumentsShape>("MainThreadDocuments")
        val MainThreadDocumentContentProviders = createProxyIdentifier<MainThreadDocumentContentProvidersShape>("MainThreadDocumentContentProviders")
        val MainThreadTextEditors = createProxyIdentifier<MainThreadTextEditorsShape>("MainThreadTextEditors")
        val MainThreadEditorInsets = createProxyIdentifier<Any>("MainThreadEditorInsets")
        val MainThreadEditorTabs = createProxyIdentifier<MainThreadEditorTabsShape>("MainThreadEditorTabs")
        val MainThreadErrors = createProxyIdentifier<MainThreadErrorsShape>("MainThreadErrors")
        val MainThreadTreeViews = createProxyIdentifier<Any>("MainThreadTreeViews")
        val MainThreadDownloadService = createProxyIdentifier<Any>("MainThreadDownloadService")
        val MainThreadLanguageFeatures = createProxyIdentifier<MainThreadLanguageFeaturesShape>("MainThreadLanguageFeatures")
        val MainThreadLanguages = createProxyIdentifier<Any>("MainThreadLanguages")
        val MainThreadLogger = createProxyIdentifier<MainThreadLoggerShape>("MainThreadLogger")
        val MainThreadMessageService = createProxyIdentifier<MainThreadMessageServiceShape>("MainThreadMessageService")
        val MainThreadOutputService = createProxyIdentifier<MainThreadOutputServiceShape>("MainThreadOutputService")
        val MainThreadProgress = createProxyIdentifier<Any>("MainThreadProgress")
        val MainThreadQuickDiff = createProxyIdentifier<Any>("MainThreadQuickDiff")
        val MainThreadQuickOpen = createProxyIdentifier<Any>("MainThreadQuickOpen")
        val MainThreadStatusBar = createProxyIdentifier<MainThreadStatusBarShape>("MainThreadStatusBar")
        val MainThreadSecretState = createProxyIdentifier<MainThreadSecretStateShape>("MainThreadSecretState")
        val MainThreadStorage = createProxyIdentifier<MainThreadStorageShape>("MainThreadStorage")
        val MainThreadSpeech = createProxyIdentifier<Any>("MainThreadSpeechProvider")
        val MainThreadTelemetry = createProxyIdentifier<MainThreadTelemetryShape>("MainThreadTelemetry")
        val MainThreadTerminalService = createProxyIdentifier<MainThreadTerminalServiceShape>("MainThreadTerminalService")
        val MainThreadTerminalShellIntegration = createProxyIdentifier<MainThreadTerminalShellIntegrationShape>("MainThreadTerminalShellIntegration")
        val MainThreadWebviews = createProxyIdentifier<MainThreadWebviewsShape>("MainThreadWebviews")
        val MainThreadWebviewPanels = createProxyIdentifier<Any>("MainThreadWebviewPanels")
        val MainThreadWebviewViews = createProxyIdentifier<MainThreadWebviewViewsShape>("MainThreadWebviewViews")
        val MainThreadCustomEditors = createProxyIdentifier<Any>("MainThreadCustomEditors")
        val MainThreadUrls = createProxyIdentifier<MainThreadUrlsShape>("MainThreadUrls")
        val MainThreadUriOpeners = createProxyIdentifier<Any>("MainThreadUriOpeners")
        val MainThreadProfileContentHandlers = createProxyIdentifier<Any>("MainThreadProfileContentHandlers")
        val MainThreadWorkspace = createProxyIdentifier<Any>("MainThreadWorkspace")
        val MainThreadFileSystem = createProxyIdentifier<MainThreadFileSystemShape>("MainThreadFileSystem")
        val MainThreadFileSystemEventService = createProxyIdentifier<MainThreadFileSystemEventServiceShape>("MainThreadFileSystemEventService")
        val MainThreadExtensionService = createProxyIdentifier<MainThreadExtensionServiceShape>("MainThreadExtensionService")
        val MainThreadSCM = createProxyIdentifier<Any>("MainThreadSCM")
        val MainThreadSearch = createProxyIdentifier<MainThreadSearchShape>("MainThreadSearch")
        val MainThreadShare = createProxyIdentifier<Any>("MainThreadShare")
        val MainThreadTask = createProxyIdentifier<MainThreadTaskShape>("MainThreadTask")
        val MainThreadWindow = createProxyIdentifier<MainThreadWindowShape>("MainThreadWindow")
        val MainThreadLabelService = createProxyIdentifier<Any>("MainThreadLabelService")
        val MainThreadNotebook = createProxyIdentifier<Any>("MainThreadNotebook")
        val MainThreadNotebookDocuments = createProxyIdentifier<Any>("MainThreadNotebookDocumentsShape")
        val MainThreadNotebookEditors = createProxyIdentifier<Any>("MainThreadNotebookEditorsShape")
        val MainThreadNotebookKernels = createProxyIdentifier<Any>("MainThreadNotebookKernels")
        val MainThreadNotebookRenderers = createProxyIdentifier<Any>("MainThreadNotebookRenderers")
        val MainThreadInteractive = createProxyIdentifier<Any>("MainThreadInteractive")
        val MainThreadTheming = createProxyIdentifier<Any>("MainThreadTheming")
        val MainThreadTunnelService = createProxyIdentifier<Any>("MainThreadTunnelService")
        val MainThreadManagedSockets = createProxyIdentifier<Any>("MainThreadManagedSockets")
        val MainThreadTimeline = createProxyIdentifier<Any>("MainThreadTimeline")
        val MainThreadTesting = createProxyIdentifier<Any>("MainThreadTesting")
        val MainThreadLocalization = createProxyIdentifier<Any>("MainThreadLocalizationShape")
        val MainThreadMcp = createProxyIdentifier<Any>("MainThreadMcpShape")
        val MainThreadAiRelatedInformation = createProxyIdentifier<Any>("MainThreadAiRelatedInformation")
        val MainThreadAiEmbeddingVector = createProxyIdentifier<Any>("MainThreadAiEmbeddingVector")
        val MainThreadChatStatus = createProxyIdentifier<Any>("MainThreadChatStatus")
    }

    /**
     * Extension host context - Extension host context ID enum values defined in VSCode
     */
    object ExtHostContext {
        val ExtHostCodeMapper = createProxyIdentifier<Any>("ExtHostCodeMapper")
        val ExtHostCommands = createProxyIdentifier<ExtHostCommandsProxy>("ai.kilocode.jetbrains.ipc.proxy.interfaces.ExtHostCommandsProxy")
        val ExtHostConfiguration = createProxyIdentifier<ExtHostConfigurationProxy>("ai.kilocode.jetbrains.ipc.proxy.interfaces.ExtHostConfigurationProxy")
        val ExtHostDiagnostics = createProxyIdentifier<Any>("ExtHostDiagnostics")
        val ExtHostDebugService = createProxyIdentifier<Any>("ExtHostDebugService")
        val ExtHostDecorations = createProxyIdentifier<Any>("ExtHostDecorations")
        val ExtHostDocumentsAndEditors = createProxyIdentifier<ExtHostDocumentsAndEditorsProxy>("ai.kilocode.jetbrains.ipc.proxy.interfaces.ExtHostDocumentsAndEditorsProxy")
        val ExtHostDocuments = createProxyIdentifier<ExtHostDocumentsProxy>("ai.kilocode.jetbrains.ipc.proxy.interfaces.ExtHostDocumentsProxy")
        val ExtHostDocumentContentProviders = createProxyIdentifier<Any>("ExtHostDocumentContentProviders")
        val ExtHostDocumentSaveParticipant = createProxyIdentifier<Any>("ExtHostDocumentSaveParticipant")
        val ExtHostEditors = createProxyIdentifier<ExtHostEditorsProxy>("ai.kilocode.jetbrains.ipc.proxy.interfaces.ExtHostEditorsProxy")
        val ExtHostTreeViews = createProxyIdentifier<Any>("ExtHostTreeViews")
        val ExtHostFileSystem = createProxyIdentifier<Any>("ExtHostFileSystem")
        val ExtHostFileSystemInfo = createProxyIdentifier<Any>("ExtHostFileSystemInfo")
        val ExtHostFileSystemEventService = createProxyIdentifier<ExtHostFileSystemEventServiceProxy>("ai.kilocode.jetbrains.ipc.proxy.interfaces.ExtHostFileSystemEventServiceProxy")
        val ExtHostLanguages = createProxyIdentifier<Any>("ExtHostLanguages")
        val ExtHostLanguageFeatures = createProxyIdentifier<Any>("ExtHostLanguageFeatures")
        val ExtHostQuickOpen = createProxyIdentifier<Any>("ExtHostQuickOpen")
        val ExtHostQuickDiff = createProxyIdentifier<Any>("ExtHostQuickDiff")
        val ExtHostStatusBar = createProxyIdentifier<Any>("ExtHostStatusBar")
        val ExtHostShare = createProxyIdentifier<Any>("ExtHostShare")
        val ExtHostExtensionService = createProxyIdentifier<ExtHostExtensionServiceProxy>("ai.kilocode.jetbrains.ipc.proxy.interfaces.ExtHostExtensionServiceProxy")
        val ExtHostLogLevelServiceShape = createProxyIdentifier<Any>("ExtHostLogLevelServiceShape")
        val ExtHostTerminalService = createProxyIdentifier<ExtHostTerminalServiceProxy>("ai.kilocode.jetbrains.ipc.proxy.interfaces.ExtHostTerminalServiceProxy")
        val ExtHostTerminalShellIntegration = createProxyIdentifier<ExtHostTerminalShellIntegrationProxy>("ai.kilocode.jetbrains.ipc.proxy.interfaces.ExtHostTerminalShellIntegrationProxy")
        val ExtHostSCM = createProxyIdentifier<Any>("ExtHostSCM")
        val ExtHostSearch = createProxyIdentifier<Any>("ExtHostSearch")
        val ExtHostTask = createProxyIdentifier<Any>("ExtHostTask")
        val ExtHostWorkspace = createProxyIdentifier<ExtHostWorkspaceProxy>("ai.kilocode.jetbrains.ipc.proxy.interfaces.ExtHostWorkspaceProxy")
        val ExtHostWindow = createProxyIdentifier<Any>("ExtHostWindow")
        val ExtHostWebviews = createProxyIdentifier<ExtHostWebviewsProxy>("ai.kilocode.jetbrains.ipc.proxy.interfaces.ExtHostWebviewsProxy")
        val ExtHostWebviewPanels = createProxyIdentifier<Any>("ExtHostWebviewPanels")
        val ExtHostCustomEditors = createProxyIdentifier<Any>("ExtHostCustomEditors")
        val ExtHostWebviewViews = createProxyIdentifier<ExtHostWebviewViewsProxy>("ai.kilocode.jetbrains.ipc.proxy.interfaces.ExtHostWebviewViewsProxy")
        val ExtHostEditorInsets = createProxyIdentifier<Any>("ExtHostEditorInsets")
        val ExtHostEditorTabs = createProxyIdentifier<ExtHostEditorTabsProxy>("ai.kilocode.jetbrains.ipc.proxy.interfaces.ExtHostEditorTabsProxy")
        val ExtHostProgress = createProxyIdentifier<Any>("ExtHostProgress")
        val ExtHostComments = createProxyIdentifier<Any>("ExtHostComments")
        val ExtHostSecretState = createProxyIdentifier<Any>("ExtHostSecretState")
        val ExtHostStorage = createProxyIdentifier<Any>("ExtHostStorage")
        val ExtHostUrls = createProxyIdentifier<Any>("ExtHostUrls")
        val ExtHostUriOpeners = createProxyIdentifier<Any>("ExtHostUriOpeners")
        val ExtHostProfileContentHandlers = createProxyIdentifier<Any>("ExtHostProfileContentHandlers")
        val ExtHostOutputService = createProxyIdentifier<Any>("ExtHostOutputService")
        val ExtHostLabelService = createProxyIdentifier<Any>("ExtHostLabelService")
        val ExtHostNotebook = createProxyIdentifier<Any>("ExtHostNotebook")
        val ExtHostNotebookDocuments = createProxyIdentifier<Any>("ExtHostNotebookDocuments")
        val ExtHostNotebookEditors = createProxyIdentifier<Any>("ExtHostNotebookEditors")
        val ExtHostNotebookKernels = createProxyIdentifier<Any>("ExtHostNotebookKernels")
        val ExtHostNotebookRenderers = createProxyIdentifier<Any>("ExtHostNotebookRenderers")
        val ExtHostNotebookDocumentSaveParticipant = createProxyIdentifier<Any>("ExtHostNotebookDocumentSaveParticipant")
        val ExtHostInteractive = createProxyIdentifier<Any>("ExtHostInteractive")
        val ExtHostChatAgents2 = createProxyIdentifier<Any>("ExtHostChatAgents")
        val ExtHostLanguageModelTools = createProxyIdentifier<Any>("ExtHostChatSkills")
        val ExtHostChatProvider = createProxyIdentifier<Any>("ExtHostChatProvider")
        val ExtHostSpeech = createProxyIdentifier<Any>("ExtHostSpeech")
        val ExtHostEmbeddings = createProxyIdentifier<Any>("ExtHostEmbeddings")
        val ExtHostAiRelatedInformation = createProxyIdentifier<Any>("ExtHostAiRelatedInformation")
        val ExtHostAiEmbeddingVector = createProxyIdentifier<Any>("ExtHostAiEmbeddingVector")
        val ExtHostTheming = createProxyIdentifier<Any>("ExtHostTheming")
        val ExtHostTunnelService = createProxyIdentifier<Any>("ExtHostTunnelService")
        val ExtHostManagedSockets = createProxyIdentifier<Any>("ExtHostManagedSockets")
        val ExtHostAuthentication = createProxyIdentifier<Any>("ExtHostAuthentication")
        val ExtHostTimeline = createProxyIdentifier<Any>("ExtHostTimeline")
        val ExtHostTesting = createProxyIdentifier<Any>("ExtHostTesting")
        val ExtHostTelemetry = createProxyIdentifier<Any>("ExtHostTelemetry")
        val ExtHostLocalization = createProxyIdentifier<Any>("ExtHostLocalization")
        val ExtHostMcp = createProxyIdentifier<Any>("ExtHostMcp")
    }
}
