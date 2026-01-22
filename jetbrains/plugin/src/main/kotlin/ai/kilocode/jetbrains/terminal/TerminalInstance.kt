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
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
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
            logger.info("🔧 [DEBUG] Creating custom runner...")
            val customRunner = createCustomRunner()
            logger.info("✅ [DEBUG] Custom runner created: ${customRunner.javaClass.name}")
            
            logger.info("🔧 [DEBUG] Creating startup options...")
            val startupOptions = createStartupOptions()
            logger.info("✅ [DEBUG] Startup options created: workingDirectory=${startupOptions.workingDirectory}, shellCommand=${startupOptions.shellCommand}")

            logger.info("🚀 [DEBUG] Calling startShellTerminalWidget with deferSessionStartUntilUiShown=false...")
            logger.info("🔧 [DEBUG] Parent disposable: ${this.javaClass.name}")

            terminalWidget = customRunner.startShellTerminalWidget(
                this, // parent disposable
                startupOptions,
                false, // deferSessionStartUntilUiShown - start session immediately, must be false
            )

            logger.info("✅ [DEBUG] startShellTerminalWidget call complete, returned widget: ${terminalWidget?.javaClass?.name}")
            logger.info("🔧 [DEBUG] Terminal widget is null: ${terminalWidget == null}")

            logger.info("🔧 [DEBUG] Initializing widgets...")
            initializeWidgets()
            logger.info("✅ [DEBUG] Widgets initialized")
            
            logger.info("🔧 [DEBUG] Setting up terminal close listener...")
            setupTerminalCloseListener()
            logger.info("✅ [DEBUG] Terminal close listener set up")

            logger.info("✅ Terminal widget created successfully")
        } catch (e: Exception) {
            logger.error("❌ [DEBUG] Failed to create terminal widget", e)
            logger.error("❌ [DEBUG] Exception type: ${e.javaClass.name}, message: ${e.message}")
            throw e
        }
    }

    /**
     * Create custom runner
     */
    private fun createCustomRunner(): LocalTerminalDirectRunner {
        return object : LocalTerminalDirectRunner(project) {
            @Suppress("DEPRECATION")
            override fun createProcess(options: ShellStartupOptions): PtyProcess {
                logger.info("🔧 [DEBUG] createProcess called for terminal: $extHostTerminalId")
                logger.info("🔧 [DEBUG] ShellStartupOptions: workingDirectory=${options.workingDirectory}, shellCommand=${options.shellCommand}")
                
                try {
                    val originalProcess = super.createProcess(options)
                    logger.info("✅ [DEBUG] Original process created successfully, pid=${originalProcess.pid()}")
                    
                    val proxyProcess = createProxyPtyProcess(originalProcess)
                    logger.info("✅ [DEBUG] Proxy process created successfully")
                    
                    return proxyProcess
                } catch (e: Exception) {
                    logger.error("❌ [DEBUG] Failed to create process for terminal: $extHostTerminalId", e)
                    throw e
                }
            }

            override fun createShellTerminalWidget(
                parent: Disposable,
                startupOptions: ShellStartupOptions,
            ): TerminalWidget {
                logger.info("🔧 [DEBUG] createShellTerminalWidget called for terminal: $extHostTerminalId")
                try {
                    val widget = super.createShellTerminalWidget(parent, startupOptions)
                    logger.info("✅ [DEBUG] Shell terminal widget created: ${widget.javaClass.name}")
                    return widget
                } catch (e: Exception) {
                    logger.error("❌ [DEBUG] Failed to create shell terminal widget: $extHostTerminalId", e)
                    throw e
                }
            }

            override fun configureStartupOptions(baseOptions: ShellStartupOptions): ShellStartupOptions {
                logger.info("🔧 [DEBUG] configureStartupOptions called for terminal: $extHostTerminalId")
                try {
                    val configured = super.configureStartupOptions(baseOptions)
                    logger.info("✅ [DEBUG] Startup options configured")
                    return configured
                } catch (e: Exception) {
                    logger.error("❌ [DEBUG] Failed to configure startup options: $extHostTerminalId", e)
                    throw e
                }
            }
        }
    }

    /**
     * Create startup options
     */
    private fun createStartupOptions(): ShellStartupOptions {
        val fullShellCommand = buildShellCommand()

        // Add extension marker to environment so WeCoderTerminalCustomizer can detect it
        val envWithMarker = (config.env?.toMutableMap() ?: mutableMapOf()).apply {
            put("KILOCODE_EXTENSION_TERMINAL", "true")
        }

        return ShellStartupOptions.Builder()
            .workingDirectory(config.cwd ?: project.basePath)
            .shellCommand(fullShellCommand)
            .envVariables(envWithMarker)
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
        
        // SDK 2025.3: createProcess() is no longer called during widget creation
        // The terminal session starts asynchronously, so TtyConnector is not immediately available
        // We need to wait for it and then set up output capture
        logger.info("🔧 [DEBUG] Setting up delayed TtyConnector access for output capture...")
        setupDelayedTtyConnectorAccess()
    }
    
    /**
     * Setup delayed access to TtyConnector
     * In SDK 2025.3, the terminal session starts asynchronously, so we need to poll for the TtyConnector
     */
    private fun setupDelayedTtyConnectorAccess() {
        logger.info("🔧 [DEBUG] Starting delayed TtyConnector access...")
        
        // Use a coroutine to poll for the TtyConnector
        scope.launch {
            var attempts = 0
            val maxAttempts = 50 // 5 seconds total (50 * 100ms)
            
            while (attempts < maxAttempts) {
                try {
                    val ttyConnector = terminalWidget?.ttyConnector
                    if (ttyConnector != null) {
                        logger.info("✅ [DEBUG] TtyConnector obtained after $attempts attempts: ${ttyConnector.javaClass.name}")
                        setupTtyConnectorOutputCapture(ttyConnector)
                        return@launch
                    }
                } catch (e: Exception) {
                    logger.error("❌ [DEBUG] Error checking TtyConnector", e)
                }
                
                attempts++
                delay(100) // Wait 100ms before next attempt
            }
            
            logger.error("❌ [DEBUG] TtyConnector not available after $maxAttempts attempts - output capture will not work")
            logger.error("❌ [DEBUG] This indicates a significant API change in SDK 2025.3")
        }
    }
    
    /**
     * Setup output capture from TtyConnector
     * This is the new approach for SDK 2025.3 since createProcess() is no longer called
     */
    private fun setupTtyConnectorOutputCapture(ttyConnector: com.jediterm.terminal.TtyConnector) {
        logger.info("🔧 [DEBUG] Setting up TtyConnector output capture...")
        
        try {
            // Access the underlying input stream from the TtyConnector
            // The TtyConnector reads from the process output stream
            val inputStream = ttyConnector.javaClass.getDeclaredField("myInputStream").apply {
                isAccessible = true
            }.get(ttyConnector) as? java.io.InputStream
            
            if (inputStream != null) {
                logger.info("✅ [DEBUG] Got input stream from TtyConnector: ${inputStream.javaClass.name}")
                
                // Wrap the input stream with our proxy to capture output
                val proxyStream = ProxyInputStream(inputStream, "STDOUT", createRawDataCallback())
                
                // Replace the input stream in the TtyConnector
                ttyConnector.javaClass.getDeclaredField("myInputStream").apply {
                    isAccessible = true
                }.set(ttyConnector, proxyStream)
                
                logger.info("✅ [DEBUG] TtyConnector input stream wrapped with proxy for output capture")
            } else {
                logger.warn("⚠️ [DEBUG] Could not get input stream from TtyConnector")
            }
        } catch (e: Exception) {
            logger.error("❌ [DEBUG] Failed to setup TtyConnector output capture", e)
            logger.error("❌ [DEBUG] This is expected if TtyConnector implementation changed in SDK 2025.3")
            logger.error("❌ [DEBUG] Will attempt alternative approach...")
            
            // Alternative: Try to add a listener to the terminal text buffer
            setupTerminalTextBufferListener()
        }
    }
    
    /**
     * Alternative approach: Use TtyConnectorAccessor to monitor terminal output
     * This is the proper API for SDK 2025.3
     */
    private fun setupTerminalTextBufferListener() {
        logger.info("🔧 [DEBUG] Setting up TtyConnectorAccessor for output capture...")
        
        try {
            val widget = terminalWidget
            if (widget == null) {
                logger.error("❌ [DEBUG] terminalWidget is null, cannot setup output capture")
                return
            }
            
            // Use the TtyConnectorAccessor API which is the proper way to access terminal I/O
            val ttyConnectorAccessor = widget.ttyConnectorAccessor
            logger.info("✅ [DEBUG] Got TtyConnectorAccessor: ${ttyConnectorAccessor.javaClass.name}")
            
            // Add a callback to be notified when the terminal is connected
            scope.launch {
                // Wait a bit for the terminal to fully initialize
                delay(500)
                
                val ttyConnector = ttyConnectorAccessor.ttyConnector
                if (ttyConnector != null) {
                    logger.info("✅ [DEBUG] TtyConnector available via accessor: ${ttyConnector.javaClass.name}")
                    
                    // Try to wrap the connector's input stream
                    try {
                        // List all fields to understand the TtyConnector structure
                        logger.info("🔧 [DEBUG] TtyConnector fields:")
                        ttyConnector.javaClass.declaredFields.forEach { field ->
                            logger.info("  - ${field.name}: ${field.type.name}")
                        }
                        
                        // Access the process from the TtyConnector
                        val processField = ttyConnector.javaClass.getDeclaredField("myProcess")
                        processField.isAccessible = true
                        val process = processField.get(ttyConnector) as? PtyProcess
                        
                        if (process != null) {
                            logger.info("✅ [DEBUG] Got PtyProcess from TtyConnector: pid=${process.pid()}, class=${process.javaClass.name}")
                            
                            val originalInputStream = process.inputStream
                            val originalErrorStream = process.errorStream
                            logger.info("🔧 [DEBUG] PtyProcess input stream: ${originalInputStream.javaClass.name}")
                            logger.info("🔧 [DEBUG] PtyProcess error stream: ${originalErrorStream.javaClass.name}")
                            
                            // Instead of wrapping the process, wrap the streams directly in the process
                            // This ensures the TtyConnector uses our wrapped streams
                            try {
                                // Create proxy streams
                                val proxyInputStream = ProxyInputStream(originalInputStream, "STDOUT", createRawDataCallback())
                                val proxyErrorStream = ProxyInputStream(originalErrorStream, "STDERR", createRawDataCallback())
                                
                                logger.info("✅ [DEBUG] Created proxy streams")
                                
                                // Replace the streams in the PtyProcess
                                // For UnixPtyProcess, the streams are in fields 'in' and 'err'
                                val inputStreamField = process.javaClass.getDeclaredField("in")
                                inputStreamField.isAccessible = true
                                inputStreamField.set(process, proxyInputStream)
                                logger.info("✅ [DEBUG] Replaced input stream in PtyProcess")
                                
                                val errorStreamField = process.javaClass.getDeclaredField("err")
                                errorStreamField.isAccessible = true
                                errorStreamField.set(process, proxyErrorStream)
                                logger.info("✅ [DEBUG] Replaced error stream in PtyProcess")
                                
                                logger.info("✅ [DEBUG] PtyProcess streams wrapped with proxy for output capture")
                            } catch (e: Exception) {
                                logger.error("❌ [DEBUG] Failed to wrap streams directly", e)
                                logger.info("🔧 [DEBUG] Falling back to process wrapping approach...")
                                
                                // Fallback: Wrap the entire process
                                val proxyProcess = createProxyPtyProcess(process)
                                logger.info("✅ [DEBUG] Created ProxyPtyProcess: ${proxyProcess.javaClass.name}")
                                
                                // Replace the process in the TtyConnector
                                processField.set(ttyConnector, proxyProcess)
                                
                                // Verify the replacement
                                val replacedProcess = processField.get(ttyConnector)
                                logger.info("✅ [DEBUG] PtyProcess replaced in TtyConnector: ${replacedProcess.javaClass.name}")
                            }
                        } else {
                            logger.warn("⚠️ [DEBUG] Could not get PtyProcess from TtyConnector")
                        }
                    } catch (e: Exception) {
                        logger.error("❌ [DEBUG] Failed to wrap PtyProcess", e)
                        logger.error("❌ [DEBUG] Exception details: ${e.message}")
                        e.printStackTrace()
                        logger.info("🔧 [DEBUG] Terminal output capture not available in SDK 2025.3 with current approach")
                    }
                } else {
                    logger.warn("⚠️ [DEBUG] TtyConnector still null via accessor")
                }
            }
            
            logger.info("✅ [DEBUG] TtyConnectorAccessor setup complete")
        } catch (e: Exception) {
            logger.error("❌ [DEBUG] Failed to setup TtyConnectorAccessor", e)
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
        val rawDataCallback = createRawDataCallback()
        return ProxyPtyProcess(originalProcess, rawDataCallback)
    }

    /**
     * Create raw data callback handler
     */
    private fun createRawDataCallback(): ProxyPtyProcessCallback {
        return object : ProxyPtyProcessCallback {
            override fun onRawData(data: String, streamType: String) {
                try {
                    logger.debug("🔧 [DEBUG] onRawData callback triggered: terminal=$extHostTerminalId, streamType=$streamType, dataLength=${data.length}, data='${data.take(100)}'")
                    sendRawDataToExtHost(data)
                    terminalShellIntegration.appendRawOutput(data)
                    logger.debug("✅ [DEBUG] Raw data processed successfully")
                } catch (e: Exception) {
                    logger.error("❌ [DEBUG] Failed to process raw data (terminal: $extHostTerminalId)", e)
                }
            }
        }
    }

    /**
     * Send raw data to ExtHost
     */
    private fun sendRawDataToExtHost(data: String) {
        logger.debug("📤 [DEBUG] Sending raw data to ExtHost: terminal=$extHostTerminalId, numericId=$numericId, dataLength=${data.length}")
        
        try {
            val extHostTerminalServiceProxy =
                rpcProtocol.getProxy(ServiceProxyRegistry.ExtHostContext.ExtHostTerminalService)
            
            logger.debug("🔧 [DEBUG] Got ExtHostTerminalService proxy: ${extHostTerminalServiceProxy.javaClass.name}")
            
            extHostTerminalServiceProxy.acceptTerminalProcessData(
                id = numericId,
                data = data,
            )
            
            logger.debug("✅ [DEBUG] acceptTerminalProcessData called successfully")
        } catch (e: Exception) {
            logger.error("❌ [DEBUG] Failed to send raw data to ExtHost", e)
            throw e
        }
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
