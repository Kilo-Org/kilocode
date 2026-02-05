package ai.kilo.plugin.actions

import ai.kilo.plugin.model.AuthMethod
import ai.kilo.plugin.services.KiloApiClient
import ai.kilo.plugin.services.KiloProjectService
import com.intellij.icons.AllIcons
import com.intellij.ide.BrowserUtil
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.ui.Messages
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.JBUI
import kotlinx.coroutines.*
import java.awt.BorderLayout
import java.awt.Component
import java.awt.Dimension
import java.awt.FlowLayout
import java.awt.Font
import javax.swing.*

/**
 * Action to open the Providers management dialog.
 */
class ProvidersAction : AnAction(), DumbAware {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val projectService = KiloProjectService.getInstance(project)
        val apiClient = projectService.api ?: return

        ProvidersDialog(project, apiClient).show()
    }

    override fun update(e: AnActionEvent) {
        val project = e.project
        val projectService = project?.let { KiloProjectService.getInstance(it) }
        e.presentation.isEnabledAndVisible = project != null && projectService?.initialized == true
    }
}

/**
 * Data class representing a provider in the list.
 */
data class ProviderItem(
    val id: String,
    val name: String,
    val isConnected: Boolean
)

/**
 * Dialog showing connected providers with ability to add new ones.
 */
class ProvidersDialog(
    private val project: Project,
    private val apiClient: KiloApiClient
) : DialogWrapper(project, true) {

    private val log = Logger.getInstance(ProvidersDialog::class.java)
    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())

    private val listModel = DefaultListModel<ProviderItem>()
    private val providerList = JBList(listModel)
    private var authMethods: Map<String, List<AuthMethod>> = emptyMap()

    init {
        title = "Providers"
        setOKButtonText("Close")
        init()
        loadProviders()
    }

    private fun loadProviders() {
        scope.launch {
            try {
                val response = apiClient.listProviders()
                val methods = apiClient.getAuthMethods()

                withContext(Dispatchers.Main) {
                    authMethods = methods
                    listModel.clear()

                    // Add connected providers first
                    for (provider in response.all) {
                        val isConnected = provider.id in response.connected
                        // Only show providers that have auth methods (can be connected)
                        if (provider.id in methods || isConnected) {
                            listModel.addElement(ProviderItem(
                                id = provider.id,
                                name = provider.name,
                                isConnected = isConnected
                            ))
                        }
                    }
                }
            } catch (e: Exception) {
                log.error("Failed to load providers", e)
                withContext(Dispatchers.Main) {
                    listModel.clear()
                    listModel.addElement(ProviderItem("error", "Failed to load providers", false))
                }
            }
        }
    }

    override fun createCenterPanel(): JComponent {
        val panel = JPanel(BorderLayout())
        panel.preferredSize = Dimension(400, 300)

        // Provider list with custom renderer
        providerList.cellRenderer = ProviderListCellRenderer()
        providerList.selectionMode = ListSelectionModel.SINGLE_SELECTION

        val scrollPane = JBScrollPane(providerList)
        scrollPane.border = JBUI.Borders.empty()
        panel.add(scrollPane, BorderLayout.CENTER)

        // Button panel
        val buttonPanel = JPanel(FlowLayout(FlowLayout.LEFT))

        val connectButton = JButton("Connect Provider", AllIcons.General.Add)
        connectButton.addActionListener {
            val selected = providerList.selectedValue
            if (selected != null && !selected.isConnected) {
                startAuthFlow(selected)
            } else if (selected == null) {
                // Show provider selection dialog
                showProviderSelectionDialog()
            } else {
                Messages.showInfoMessage(project, "${selected.name} is already connected.", "Already Connected")
            }
        }
        buttonPanel.add(connectButton)

        val refreshButton = JButton("Refresh", AllIcons.Actions.Refresh)
        refreshButton.addActionListener {
            loadProviders()
        }
        buttonPanel.add(refreshButton)

        panel.add(buttonPanel, BorderLayout.SOUTH)

        return panel
    }

    private fun showProviderSelectionDialog() {
        // Get providers that are not connected and have auth methods
        val availableProviders = listModel.elements().toList()
            .filter { !it.isConnected && it.id in authMethods }

        if (availableProviders.isEmpty()) {
            Messages.showInfoMessage(project, "All available providers are already connected.", "No Providers Available")
            return
        }

        val providerNames = availableProviders.map { it.name }.toTypedArray()
        val selectedIndex = Messages.showChooseDialog(
            project,
            "Select a provider to connect:",
            "Connect Provider",
            AllIcons.General.Add,
            providerNames,
            providerNames.firstOrNull() ?: ""
        )

        if (selectedIndex >= 0) {
            startAuthFlow(availableProviders[selectedIndex])
        }
    }

    private fun startAuthFlow(provider: ProviderItem) {
        val methods = authMethods[provider.id] ?: return

        if (methods.isEmpty()) {
            Messages.showErrorDialog(project, "No auth methods available for ${provider.name}", "Error")
            return
        }

        // If there's only one method, use it directly
        val methodIndex = if (methods.size == 1) {
            0
        } else {
            // Let user choose method
            val methodNames = methods.map { it.label }.toTypedArray()
            Messages.showChooseDialog(
                project,
                "Select login method for ${provider.name}:",
                "Login Method",
                AllIcons.General.User,
                methodNames,
                methodNames.first()
            )
        }

        if (methodIndex < 0) return

        val method = methods[methodIndex]

        if (method.type == "oauth") {
            // Start OAuth flow
            val authDialog = ProviderAuthDialog(apiClient, provider.id, provider.name, methodIndex)
            if (authDialog.showAndGet()) {
                // Refresh the list after successful auth
                loadProviders()
            }
        } else if (method.type == "api") {
            // Show API key input dialog
            val apiKey = Messages.showInputDialog(
                project,
                "Enter your API key for ${provider.name}:",
                "API Key",
                null
            )
            if (!apiKey.isNullOrBlank()) {
                scope.launch {
                    try {
                        // TODO: Add API endpoint to set API key
                        // For now, show info message
                        withContext(Dispatchers.Main) {
                            Messages.showInfoMessage(
                                project,
                                "API key auth is not yet implemented in the plugin.\n\nUse CLI: kilo auth login",
                                "Not Implemented"
                            )
                        }
                    } catch (e: Exception) {
                        log.error("Failed to set API key", e)
                    }
                }
            }
        }
    }

    override fun dispose() {
        scope.cancel()
        super.dispose()
    }

    override fun createActions() = arrayOf(okAction)
}

/**
 * Custom cell renderer for the provider list.
 */
class ProviderListCellRenderer : ListCellRenderer<ProviderItem> {
    private val panel = JPanel(BorderLayout())
    private val nameLabel = JBLabel()
    private val statusLabel = JBLabel()

    init {
        panel.border = JBUI.Borders.empty(8, 12)

        nameLabel.font = nameLabel.font.deriveFont(Font.BOLD)

        val leftPanel = JPanel(BorderLayout())
        leftPanel.isOpaque = false
        leftPanel.add(nameLabel, BorderLayout.CENTER)

        panel.add(leftPanel, BorderLayout.CENTER)
        panel.add(statusLabel, BorderLayout.EAST)
    }

    override fun getListCellRendererComponent(
        list: JList<out ProviderItem>,
        value: ProviderItem,
        index: Int,
        isSelected: Boolean,
        cellHasFocus: Boolean
    ): Component {
        nameLabel.text = value.name

        if (value.isConnected) {
            statusLabel.text = "Connected"
            statusLabel.foreground = JBColor.GREEN.darker()
            statusLabel.icon = AllIcons.General.InspectionsOK
        } else {
            statusLabel.text = ""
            statusLabel.icon = null
        }

        if (isSelected) {
            panel.background = list.selectionBackground
            nameLabel.foreground = list.selectionForeground
        } else {
            panel.background = list.background
            nameLabel.foreground = list.foreground
        }
        panel.isOpaque = true

        return panel
    }
}

/**
 * Dialog for OAuth provider authentication flow.
 */
class ProviderAuthDialog(
    private val apiClient: KiloApiClient,
    private val providerId: String,
    private val providerName: String,
    private val methodIndex: Int
) : DialogWrapper(true) {

    private val log = Logger.getInstance(ProviderAuthDialog::class.java)
    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())

    private var authJob: Job? = null
    private var authUrl: String? = null

    private val statusLabel = JBLabel("Initializing...")
    private val codeLabel = JBLabel("")
    private val instructionsLabel = JBLabel("")

    init {
        title = "Sign in to $providerName"
        setOKButtonText("Cancel")
        init()
        startAuthFlow()
    }

    private fun startAuthFlow() {
        authJob = scope.launch {
            try {
                log.info("Starting OAuth authorization flow for $providerId")
                val authorization = apiClient.authorizeProvider(providerId, methodIndex)

                authUrl = authorization.url
                val code = extractCode(authorization.instructions)

                withContext(Dispatchers.Main) {
                    statusLabel.text = "Waiting for authorization..."
                    codeLabel.text = code
                    codeLabel.font = codeLabel.font.deriveFont(Font.BOLD, 32f)
                    codeLabel.foreground = JBUI.CurrentTheme.Link.Foreground.ENABLED
                    instructionsLabel.text = "Enter this code in your browser"
                }

                log.info("Waiting for user authorization...")
                val success = apiClient.authCallback(providerId, methodIndex)

                if (success) {
                    log.info("Authorization successful")
                    withContext(Dispatchers.Main) {
                        statusLabel.text = "Success!"
                        statusLabel.foreground = JBColor.GREEN
                        codeLabel.text = ""
                        instructionsLabel.text = "You are now signed in to $providerName"
                    }
                    delay(1500)
                    withContext(Dispatchers.Main) {
                        close(OK_EXIT_CODE)
                    }
                } else {
                    withContext(Dispatchers.Main) {
                        statusLabel.text = "Error"
                        statusLabel.foreground = JBColor.RED
                        instructionsLabel.text = "Authorization failed"
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                log.error("Auth flow error", e)
                withContext(Dispatchers.Main) {
                    statusLabel.text = "Error"
                    statusLabel.foreground = JBColor.RED
                    codeLabel.text = ""
                    instructionsLabel.text = e.message ?: "Unknown error"
                }
            }
        }
    }

    private fun extractCode(instructions: String): String {
        val codeMatch = Regex("code:\\s*(\\S+)").find(instructions)
        return codeMatch?.groupValues?.get(1) ?: instructions
    }

    override fun createCenterPanel(): JComponent {
        val panel = JPanel()
        panel.layout = BoxLayout(panel, BoxLayout.Y_AXIS)
        panel.border = JBUI.Borders.empty(20, 40)

        statusLabel.alignmentX = Component.CENTER_ALIGNMENT
        codeLabel.alignmentX = Component.CENTER_ALIGNMENT
        instructionsLabel.alignmentX = Component.CENTER_ALIGNMENT
        instructionsLabel.foreground = JBUI.CurrentTheme.Label.disabledForeground()

        panel.add(statusLabel)
        panel.add(Box.createVerticalStrut(16))
        panel.add(codeLabel)
        panel.add(Box.createVerticalStrut(8))
        panel.add(instructionsLabel)
        panel.add(Box.createVerticalStrut(16))

        val separator = JSeparator()
        separator.maximumSize = Dimension(Int.MAX_VALUE, 1)
        panel.add(separator)
        panel.add(Box.createVerticalStrut(8))

        val infoLabel = JBLabel("Browser should have opened automatically.")
        infoLabel.alignmentX = Component.CENTER_ALIGNMENT
        panel.add(infoLabel)

        val linkPanel = JPanel(FlowLayout(FlowLayout.CENTER))
        val linkButton = JButton("Open manually")
        linkButton.addActionListener {
            authUrl?.let { BrowserUtil.browse(it) }
        }
        linkPanel.add(linkButton)
        linkPanel.alignmentX = Component.CENTER_ALIGNMENT
        panel.add(linkPanel)

        panel.preferredSize = Dimension(400, 250)
        return panel
    }

    override fun doCancelAction() {
        authJob?.cancel()
        scope.cancel()
        super.doCancelAction()
    }

    override fun doOKAction() {
        authJob?.cancel()
        scope.cancel()
        super.doOKAction()
    }

    override fun createActions() = arrayOf(okAction)
}
