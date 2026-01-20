package ai.kilocode.jetbrains.terminal

import ai.kilocode.jetbrains.monitoring.ScopeRegistry
import ai.kilocode.jetbrains.monitoring.DisposableTracker
import ai.kilocode.jetbrains.core.ServiceProxyRegistry
import ai.kilocode.jetbrains.ipc.proxy.IRPCProtocol
import ai.kilocode.jetbrains.ipc.proxy.interfaces.ExtHostTerminalShellIntegrationProxy
import ai.kilocode.jetbrains.ipc.proxy.interfaces.ShellLaunchConfigDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.terminal.JBTerminalWidget
import com.intellij.terminal.ui.TerminalWidget
import com.pty4j.PtyProcess
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.jetbrains.plugins.terminal.LocalTerminalDirectRunner
import org.jetbrains.plugins.terminal.ShellStartupOptions
import org.jetbrains.plugins.terminal.ShellTerminalWidget

/**
 * Terminal instance class
 *
 * Manages the lifecycle and operations of a single terminal, including:
 * - Terminal creation and initialization
 * - RPC communication with ExtHost process
 * - Shell integration management
 * - Terminal show and hide
 * - Text sending and command execution
 * - Resource cleanup and disposal
 *
 * @property extHostTerminalId Terminal identifier in ExtHost process
 * @property numericId Numeric ID for RPC communication
 * @property project IDEA project instance
 * @property config Terminal configuration parameters
 * @property rpcProtocol RPC protocol instance
 */
class TerminalInstance(
    val extHostTerminalId: String,
    val numericId: Int,
    val project: Project,
    private val config: TerminalConfig,
    private val rpcProtocol: IRPCProtocol,
) : Disposable {

    companion object {
        private const val DEFAULT_TERMINAL_NAME = "kilo"
        private const val TERMINAL_TOOL_WINDOW_ID = "Terminal"
    }

    private val logger = Logger.getInstance(TerminalInstance::class.java)

    // Terminal components
    private var terminalWidget: TerminalWidget? = null
    private var shellWidget: ShellTerminalWidget? = null

    // State management
    private val state = TerminalState()

    // Coroutine scope - use IO dispatcher to avoid Main Dispatcher issues
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // Shell integration manager
    private val terminalShellIntegration = TerminalShellIntegration(extHostTerminalId, numericId, rpcProtocol)

    // Event callback manager
    private val callbackManager = TerminalCallbackManager()

    /**
     * Add terminal close listener
     */
    fun addTerminalCloseCallback(callback: () -> Unit) {
        callbackManager.addCloseCallback(callback)
    }

    /**
     * Initialize terminal instance
     *
     * @throws IllegalStateException if terminal is already initialized or disposed
     * @throws Exception if error occurs during initialization
     */
    fun initialize() {
        state.checkCanInitialize(extHostTerminalId)

        try {
            logger.info("🚀 Initializing terminal instance: $extHostTerminalId (numericId: $numericId)")
            ScopeRegistry.register("TerminalInstance.scope-$extHostTerminalId", scope)
            DisposableTracker.register("TerminalInstance-$extHostTerminalId", this)

            // 🎯 First register to project's Disposer to avoid memory leaks
            registerToProjectDisposer()

            // Switch to EDT thread for UI operations
            ApplicationManager.getApplication().invokeAndWait {
                performInitialization()
            }
        } catch (e: Exception) {
            logger.error("❌ Failed to initialize terminal instance: $extHostTerminalId", e)
            throw e
        }
    }

    /**
     * Register to project Disposer
     */
    private fun registerToProjectDisposer() {
        try {
            // Register TerminalInstance as a child Disposable of the project
            Disposer.register(project, this)
            logger.info("✅ Terminal instance registered to project Disposer: $extHostTerminalId")
        } catch (e: Exception) {
            logger.error("❌ Failed to register terminal instance to project Disposer: $extHostTerminalId", e)
            throw e
        }
    }

    /**
     * Perform initialization steps
     */
    private fun performInitialization() {
        try {
            createTerminalWidget()
            setupShellIntegration()
            finalizeInitialization()
        } catch (e: Exception) {
            logger.error("❌ Failed to initialize terminal in EDT thread: $extHostTerminalId", e)
            throw e
        }
    }

    /**
     * Setup shell integration
     */
    private fun setupShellIntegration() {
        terminalShellIntegration.setupShellIntegration()
    }

    /**
     * Finalize initialization
     */
    private fun finalizeInitialization() {
        state.markInitialized()
        logger.info("✅ Terminal instance initialization complete: $extHostTerminalId")

        // 🎯 Add terminalWidget to Terminal tool window
        addToTerminalToolWindow()

        notifyTerminalOpened()
        notifyShellIntegrationChange()
        handleInitialText()
    }

    /**
     * Handle initial text
     */
    private fun handleInitialText() {
        config.initialText?.let { initialText ->
            sendText(initialText, shouldExecute = false)
        }
    }

    /**
     * Create terminal widget
     */
    private fun createTerminalWidget() {
        try {
            val customRunner = createCustomRunner()
            val startupOptions = createStartupOptions()

            logger.info("🚀 Calling startShellTerminalWidget...")

            terminalWidget = customRunner.startShellTerminalWidget(
                this, // parent disposable
                startupOptions,
                false, // deferSessionStartUntilUiShown - start session immediately, must be false
            )

            logger.info("✅ startShellTerminalWidget call complete, returned widget: ${terminalWidget?.javaClass?.name}")

            initializeWidgets()
            setupTerminalCloseListener()

            logger.info("✅ Terminal widget created successfully")
        } catch (e: Exception) {
            logger.error("❌ Failed to create terminal widget", e)
            throw e
        }
    }

    /**
     * Create custom runner
     */
    private fun createCustomRunner(): LocalTerminalDirectRunner {
        return object : LocalTerminalDirectRunner(project) {
            override fun createProcess(options: ShellStartupOptions): PtyProcess {
                logger.info("🔧 Custom createProcess method called...")
                logger.info("Startup options: $options")

                val originalProcess = super.createProcess(options)
                logger.info("✅ Original Process created: ${originalProcess.javaClass.name}")

                return createProxyPtyProcess(originalProcess)
            }

            override fun createShellTerminalWidget(
                parent: Disposable,
                startupOptions: ShellStartupOptions,
            ): TerminalWidget {
                logger.info("🔧 Custom createShellTerminalWidget method called...")
                return super.createShellTerminalWidget(parent, startupOptions)
            }

            override fun configureStartupOptions(baseOptions: ShellStartupOptions): ShellStartupOptions {
                logger.info("🔧 Custom configureStartupOptions method called...")
                return super.configureStartupOptions(baseOptions)
            }
        }
    }

    /**
     * Create startup options
     */
    private fun createStartupOptions(): ShellStartupOptions {
        val fullShellCommand = buildShellCommand()

        logger.info("🔧 Shell config: shellPath=${config.shellPath}, shellArgs=${config.shellArgs}")
        logger.info("🔧 Full shell command: $fullShellCommand")

        return ShellStartupOptions.Builder()
            .workingDirectory(config.cwd ?: project.basePath)
            .shellCommand(fullShellCommand)
            .build()
    }

    /**
     * Build shell command
     */
    private fun buildShellCommand(): List<String>? {
        return buildList {
            config.shellPath?.let { add(it) }
            config.shellArgs?.let { addAll(it) }
        }.takeIf { it.isNotEmpty() }
    }

    /**
     * Initialize widget components
     */
    private fun initializeWidgets() {
        shellWidget = JBTerminalWidget.asJediTermWidget(terminalWidget!!) as? ShellTerminalWidget
            ?: throw IllegalStateException("Cannot get ShellTerminalWidget")

        // Set terminal title
        terminalWidget!!.terminalTitle.change {
            userDefinedTitle = config.name ?: DEFAULT_TERMINAL_NAME
        }
    }

    /**
     * Set terminal close event listener
     */
    private fun setupTerminalCloseListener() {
        try {
            Disposer.register(terminalWidget!!) {
                logger.info("🔔 TerminalWidget dispose event: $extHostTerminalId")
                if (!state.isDisposed) {
                    onTerminalClosed()
                }
            }
        } catch (e: Exception) {
            logger.error("❌ Failed to set terminal close event listener: $extHostTerminalId", e)
        }
    }

    /**
     * Create proxy PtyProcess to intercept input/output streams
     */
    private fun createProxyPtyProcess(originalProcess: PtyProcess): PtyProcess {
        logger.info("🔧 Creating proxy PtyProcess to intercept input/output streams...")

        val rawDataCallback = createRawDataCallback()
        return ProxyPtyProcess(originalProcess, rawDataCallback)
    }

    /**
     * Create raw data callback handler
     */
    private fun createRawDataCallback(): ProxyPtyProcessCallback {
        return object : ProxyPtyProcessCallback {
            override fun onRawData(data: String, streamType: String) {
                logger.debug("📥 Raw data [$streamType]: ${data.length} chars")

                try {
                    sendRawDataToExtHost(data)
                    terminalShellIntegration.appendRawOutput(data)
                } catch (e: Exception) {
                    logger.error("❌ Failed to process raw data (terminal: $extHostTerminalId)", e)
                }
            }
        }
    }

    /**
     * Send raw data to ExtHost
     */
    private fun sendRawDataToExtHost(data: String) {
        val extHostTerminalServiceProxy =
            rpcProtocol.getProxy(ServiceProxyRegistry.ExtHostContext.ExtHostTerminalService)
        extHostTerminalServiceProxy.acceptTerminalProcessData(
            id = numericId,
            data = data,
        )
        logger.debug("✅ Sent raw data to exthost: ${data.length} chars (terminal: $extHostTerminalId)")
    }

    /**
     * Show terminal
     */
    fun show(preserveFocus: Boolean = false) {
        if (!state.canOperate()) {
            logger.warn("Terminal not initialized or disposed, cannot show: $extHostTerminalId")
            return
        }

        ApplicationManager.getApplication().invokeLater {
            try {
                showTerminalToolWindow()
                // Note: show() method is deprecated but there's no direct replacement in the current API
                // The terminal visibility is now managed through the tool window
                @Suppress("DEPRECATION")
                shellWidget?.show(preserveFocus)
                logger.info("✅ Terminal shown: $extHostTerminalId")
            } catch (e: Exception) {
                logger.error("❌ Failed to show terminal: $extHostTerminalId", e)
            }
        }
    }

    /**
     * Hide terminal
     */
    fun hide() {
        if (!state.canOperate()) {
            logger.warn("Terminal not initialized or disposed, cannot hide: $extHostTerminalId")
            return
        }

        ApplicationManager.getApplication().invokeLater {
            try {
                hideTerminalToolWindow()
                // Note: hide() method is deprecated but there's no direct replacement in the current API
                // The terminal visibility is now managed through the tool window
                @Suppress("DEPRECATION")
                shellWidget?.hide()
                logger.info("✅ Terminal hidden: $extHostTerminalId")
            } catch (e: Exception) {
                logger.error("❌ Failed to hide terminal: $extHostTerminalId", e)
            }
        }
    }

    /**
     * Show terminal tool window and activate current terminal tab
     */
    private fun showTerminalToolWindow() {
        try {
            val toolWindow = ToolWindowManager.getInstance(project).getToolWindow(TERMINAL_TOOL_WINDOW_ID)
            toolWindow?.show(null)
        } catch (e: Exception) {
            logger.error("❌ Failed to show terminal tool window", e)
        }
    }

    /**
     * Add terminalWidget to Terminal tool window
     */
    private fun addToTerminalToolWindow() {
        if (terminalWidget == null) {
            logger.warn("TerminalWidget is null, cannot add to tool window")
            return
        }

        try {
            val terminalToolWindowManager = org.jetbrains.plugins.terminal.TerminalToolWindowManager.getInstance(project)
            val toolWindow = ToolWindowManager.getInstance(project).getToolWindow(TERMINAL_TOOL_WINDOW_ID)

            if (toolWindow == null) {
                logger.warn("Terminal tool window does not exist")
                return
            }

            // Use TerminalToolWindowManager's newTab method to create new Content
            val content = terminalToolWindowManager.newTab(toolWindow, terminalWidget!!)
            content.displayName = config.name ?: DEFAULT_TERMINAL_NAME

            logger.info("✅ Added terminalWidget to Terminal tool window: ${content.displayName}")
        } catch (e: Exception) {
            logger.error("❌ Failed to add terminalWidget to tool window", e)
        }
    }

    /**
     * Hide terminal tool window
     */
    private fun hideTerminalToolWindow() {
        val toolWindow = ToolWindowManager.getInstance(project).getToolWindow(TERMINAL_TOOL_WINDOW_ID)
        toolWindow?.hide(null)
    }

    /**
     * Send text to terminal
     */
    fun sendText(text: String, shouldExecute: Boolean = false) {
        if (!state.canOperate()) {
            logger.warn("Terminal not initialized or disposed, cannot send text: $extHostTerminalId")
            return
        }

        ApplicationManager.getApplication().invokeLater {
            try {
                val shell = shellWidget ?: return@invokeLater

                if (shouldExecute) {
                    shell.executeCommand(text)
                    logger.info("✅ Command executed: $text (terminal: $extHostTerminalId)")
                } else {
                    shell.writePlainMessage(text)
                    logger.info("✅ Text sent: $text (terminal: $extHostTerminalId)")
                }
            } catch (e: Exception) {
                logger.error("❌ Failed to send text: $extHostTerminalId", e)
            }
        }
    }

    /**
     * Notify exthost process that terminal is opened
     */
    private fun notifyTerminalOpened() {
        try {
            logger.info("📤 Notify exthost process terminal opened: $extHostTerminalId (numericId: $numericId)")

            val shellLaunchConfigDto = config.toShellLaunchConfigDto(project.basePath)
            val extHostTerminalServiceProxy =
                rpcProtocol.getProxy(ServiceProxyRegistry.ExtHostContext.ExtHostTerminalService)

            extHostTerminalServiceProxy.acceptTerminalOpened(
                id = numericId,
                extHostTerminalId = extHostTerminalId,
                name = config.name ?: DEFAULT_TERMINAL_NAME,
                shellLaunchConfig = shellLaunchConfigDto,
            )

            logger.info("✅ Successfully notified exthost process terminal opened: $extHostTerminalId")
        } catch (e: Exception) {
            logger.error("❌ Failed to notify exthost process terminal opened: $extHostTerminalId", e)
        }
    }

    /**
     * Notify Shell integration change
     */
    private fun notifyShellIntegrationChange() {
        try {
            val extHostTerminalShellIntegrationProxy =
                rpcProtocol.getProxy(ServiceProxyRegistry.ExtHostContext.ExtHostTerminalShellIntegration)

            extHostTerminalShellIntegrationProxy.shellIntegrationChange(instanceId = numericId)
            logger.info("✅ Notified exthost Shell integration initialized: (terminal: $extHostTerminalId)")

            notifyEnvironmentVariableChange(extHostTerminalShellIntegrationProxy)
        } catch (e: Exception) {
            logger.error("❌ Failed to notify exthost Shell integration initialized: (terminal: $extHostTerminalId)", e)
        }
    }

    /**
     * Notify environment variable change
     */
    private fun notifyEnvironmentVariableChange(extHostTerminalShellIntegrationProxy: ExtHostTerminalShellIntegrationProxy) {
        config.env?.takeIf { it.isNotEmpty() }?.let { env ->
            try {
                val envKeys = env.keys.toTypedArray()
                val envValues = env.values.toTypedArray()

                extHostTerminalShellIntegrationProxy.shellEnvChange(
                    instanceId = numericId,
                    shellEnvKeys = envKeys,
                    shellEnvValues = envValues,
                    isTrusted = true,
                )

                logger.info("✅ Notified exthost environment variable change: ${env.size} variables (terminal: $extHostTerminalId)")
            } catch (e: Exception) {
                logger.error("❌ Failed to notify environment variable change: (terminal: $extHostTerminalId)", e)
            }
        }
    }

    /**
     * Trigger terminal close event
     */
    private fun onTerminalClosed() {
        logger.info("🔔 Terminal closed event triggered: $extHostTerminalId (numericId: $numericId)")

        try {
            notifyTerminalClosed()
            callbackManager.executeCloseCallbacks()

            if (!state.isDisposed) {
                dispose()
            }
        } catch (e: Exception) {
            logger.error("Failed to handle terminal closed event: $extHostTerminalId", e)
        }
    }

    /**
     * Notify exthost process that terminal is closed
     */
    private fun notifyTerminalClosed() {
        try {
            logger.info("📤 Notify exthost process terminal closed: $extHostTerminalId (numericId: $numericId)")

            val extHostTerminalServiceProxy =
                rpcProtocol.getProxy(ServiceProxyRegistry.ExtHostContext.ExtHostTerminalService)
            extHostTerminalServiceProxy.acceptTerminalClosed(
                id = numericId,
                exitCode = null,
                exitReason = numericId,
            )

            logger.info("✅ Successfully notified exthost process terminal closed: $extHostTerminalId")
        } catch (e: Exception) {
            logger.error("❌ Failed to notify exthost process terminal closed: $extHostTerminalId", e)
        }
    }

    override fun dispose() {
        if (state.isDisposed) return

        logger.info("🧹 Disposing terminal instance: $extHostTerminalId")

        try {
            // 🎯 Mark as disposed first to avoid repeated calls in callbacks
            state.markDisposed()

            callbackManager.clear()
            
            ScopeRegistry.unregister("TerminalInstance.scope-$extHostTerminalId")
            DisposableTracker.unregister("TerminalInstance-$extHostTerminalId")
            scope.cancel()

            // 🎯 Dispose terminalWidget, onTerminalClosed callback will be skipped since state.isDisposed=true
            terminalWidget?.let { widget ->
                try {
                    Disposer.dispose(widget)
                } catch (e: Exception) {
                    logger.error("❌ Failed to dispose terminalWidget: $extHostTerminalId", e)
                }
            }

            terminalShellIntegration.dispose()
            cleanupResources()

            logger.info("✅ Terminal instance disposed: $extHostTerminalId")
        } catch (e: Exception) {
            logger.error("❌ Failed to dispose terminal instance: $extHostTerminalId", e)
        }
    }

    /**
     * Cleanup resources
     */
    private fun cleanupResources() {
        terminalWidget = null
        shellWidget = null
    }
}

/**
 * Terminal configuration data class
 */
data class TerminalConfig(
    val name: String? = null,
    val shellPath: String? = null,
    val shellArgs: List<String>? = null,
    val cwd: String? = null,
    val env: Map<String, String>? = null,
    val useShellEnvironment: Boolean? = null,
    val hideFromUser: Boolean? = null,
    val isFeatureTerminal: Boolean? = null,
    val forceShellIntegration: Boolean? = null,
    val initialText: String? = null,
) {
    companion object {
        /**
         * Create TerminalConfig from Map
         */
        @Suppress("UNCHECKED_CAST")
        fun fromMap(config: Map<String, Any?>): TerminalConfig {
            return TerminalConfig(
                name = config["name"] as? String,
                shellPath = config["shellPath"] as? String,
                shellArgs = config["shellArgs"] as? List<String>,
                cwd = config["cwd"] as? String,
                env = config["env"] as? Map<String, String>,
                useShellEnvironment = config["useShellEnvironment"] as? Boolean,
                hideFromUser = config["hideFromUser"] as? Boolean,
                isFeatureTerminal = config["isFeatureTerminal"] as? Boolean,
                forceShellIntegration = config["forceShellIntegration"] as? Boolean,
                initialText = config["initialText"] as? String,
            )
        }
    }

    /**
     * Convert to ShellLaunchConfigDto
     */
    fun toShellLaunchConfigDto(defaultCwd: String?): ShellLaunchConfigDto {
        return ShellLaunchConfigDto(
            name = name,
            executable = shellPath,
            args = shellArgs,
            cwd = cwd ?: defaultCwd,
            env = env,
            useShellEnvironment = useShellEnvironment,
            hideFromUser = hideFromUser,
            reconnectionProperties = null,
            type = null,
            isFeatureTerminal = isFeatureTerminal,
            tabActions = null,
            shellIntegrationEnvironmentReporting = forceShellIntegration,
        )
    }
}

/**
 * Terminal state manager
 */
private class TerminalState {
    @Volatile
    private var isInitialized = false

    @Volatile
    private var _isDisposed = false

    val isDisposed: Boolean get() = _isDisposed

    fun checkCanInitialize(terminalId: String) {
        if (isInitialized || _isDisposed) {
            throw IllegalStateException("Terminal instance already initialized or disposed: $terminalId")
        }
    }

    fun markInitialized() {
        isInitialized = true
    }

    fun markDisposed() {
        _isDisposed = true
    }

    fun canOperate(): Boolean {
        return isInitialized && !_isDisposed
    }
}

/**
 * Terminal callback manager
 */
private class TerminalCallbackManager {
    private val logger = Logger.getInstance(TerminalCallbackManager::class.java)
    private val terminalCloseCallbacks = mutableListOf<() -> Unit>()

    fun addCloseCallback(callback: () -> Unit) {
        terminalCloseCallbacks.add(callback)
    }

    fun executeCloseCallbacks() {
        terminalCloseCallbacks.forEach { callback ->
            try {
                callback()
            } catch (e: Exception) {
                logger.error("Failed to execute terminal close callback", e)
            }
        }
    }

    fun clear() {
        terminalCloseCallbacks.clear()
    }
}
