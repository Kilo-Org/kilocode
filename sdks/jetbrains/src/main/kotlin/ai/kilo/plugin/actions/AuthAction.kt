package ai.kilo.plugin.actions

import ai.kilo.plugin.services.KiloApiClient
import ai.kilo.plugin.services.KiloProjectService
import com.intellij.ide.BrowserUtil
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBLabel
import com.intellij.ui.dsl.builder.panel
import com.intellij.util.ui.JBUI
import kotlinx.coroutines.*
import java.awt.Font
import javax.swing.JComponent
import javax.swing.SwingConstants

/**
 * Action to trigger Kilo authentication flow.
 */
class AuthAction : AnAction(), DumbAware {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val projectService = KiloProjectService.getInstance(project)
        val apiClient = projectService.api

        if (apiClient == null) {
            return
        }

        val dialog = AuthDialog(apiClient)
        dialog.show()
    }

    override fun update(e: AnActionEvent) {
        val project = e.project
        val projectService = project?.let { KiloProjectService.getInstance(it) }
        e.presentation.isEnabledAndVisible = project != null && projectService?.initialized == true
    }
}

/**
 * Dialog that handles the device authorization flow for Kilo.
 * Shows the verification code and waits for the user to authorize in the browser.
 */
class AuthDialog(
    private val apiClient: KiloApiClient
) : DialogWrapper(true) {

    private val log = Logger.getInstance(AuthDialog::class.java)
    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())

    private var state: AuthState = AuthState.Initializing
    private var authJob: Job? = null

    // UI components that need updating
    private var statusLabel: JBLabel? = null
    private var codeLabel: JBLabel? = null
    private var instructionsLabel: JBLabel? = null

    sealed class AuthState {
        object Initializing : AuthState()
        data class WaitingForAuth(val code: String, val url: String, val instructions: String) : AuthState()
        object Success : AuthState()
        data class Error(val message: String) : AuthState()
    }

    init {
        title = "Sign in to Kilo"
        setOKButtonText("Cancel")
        setCancelButtonText("")
        init()
        startAuthFlow()
    }

    private fun startAuthFlow() {
        authJob = scope.launch {
            try {
                // Start the OAuth flow - this opens the browser automatically
                log.info("Starting Kilo OAuth authorization flow")
                val authorization = apiClient.authorizeProvider("kilo", 0)

                // Extract code from instructions (format: "Open URL and enter code: ABC123")
                val code = extractCode(authorization.instructions)

                updateState(AuthState.WaitingForAuth(
                    code = code,
                    url = authorization.url,
                    instructions = authorization.instructions
                ))

                // Wait for the callback to complete (this polls until user authorizes)
                log.info("Waiting for user authorization...")
                val success = apiClient.authCallback("kilo", 0)

                if (success) {
                    log.info("Authorization successful")
                    updateState(AuthState.Success)
                    delay(1500) // Show success briefly
                    withContext(Dispatchers.Main) {
                        close(OK_EXIT_CODE)
                    }
                } else {
                    updateState(AuthState.Error("Authorization failed"))
                }
            } catch (e: CancellationException) {
                log.info("Auth flow cancelled")
                throw e
            } catch (e: Exception) {
                log.error("Auth flow error", e)
                updateState(AuthState.Error(e.message ?: "Unknown error"))
            }
        }
    }

    private fun extractCode(instructions: String): String {
        // Instructions format: "Open URL and enter code: ABC123"
        val codeMatch = Regex("code:\\s*(\\S+)").find(instructions)
        return codeMatch?.groupValues?.get(1) ?: instructions
    }

    private suspend fun updateState(newState: AuthState) {
        state = newState
        withContext(Dispatchers.Main) {
            updateUI()
        }
    }

    private fun updateUI() {
        when (val s = state) {
            is AuthState.Initializing -> {
                statusLabel?.text = "Initializing..."
                codeLabel?.text = ""
                instructionsLabel?.text = ""
            }
            is AuthState.WaitingForAuth -> {
                statusLabel?.text = "Waiting for authorization..."
                codeLabel?.text = s.code
                instructionsLabel?.text = "Enter this code in your browser"
            }
            is AuthState.Success -> {
                statusLabel?.text = "Success!"
                statusLabel?.foreground = JBColor.GREEN
                codeLabel?.text = ""
                instructionsLabel?.text = "You are now signed in"
            }
            is AuthState.Error -> {
                statusLabel?.text = "Error"
                statusLabel?.foreground = JBColor.RED
                codeLabel?.text = ""
                instructionsLabel?.text = s.message
            }
        }
    }

    override fun createCenterPanel(): JComponent {
        statusLabel = JBLabel("Initializing...").apply {
            horizontalAlignment = SwingConstants.CENTER
        }

        codeLabel = JBLabel("").apply {
            horizontalAlignment = SwingConstants.CENTER
            font = font.deriveFont(Font.BOLD, 32f)
            foreground = JBUI.CurrentTheme.Link.Foreground.ENABLED
        }

        instructionsLabel = JBLabel("").apply {
            horizontalAlignment = SwingConstants.CENTER
            foreground = JBUI.CurrentTheme.Label.disabledForeground()
        }

        return panel {
            row {
                cell(statusLabel!!)
                    .align(com.intellij.ui.dsl.builder.Align.CENTER)
            }
            row {
                cell(codeLabel!!)
                    .align(com.intellij.ui.dsl.builder.Align.CENTER)
            }
            row {
                cell(instructionsLabel!!)
                    .align(com.intellij.ui.dsl.builder.Align.CENTER)
            }
            separator()
            row {
                text("Browser should have opened automatically.")
            }
            row {
                link("Open manually") {
                    (state as? AuthState.WaitingForAuth)?.url?.let { url ->
                        BrowserUtil.browse(url)
                    }
                }
            }
        }.apply {
            border = JBUI.Borders.empty(20, 40)
            preferredSize = java.awt.Dimension(400, 200)
        }
    }

    override fun doCancelAction() {
        authJob?.cancel()
        scope.cancel()
        super.doCancelAction()
    }

    override fun doOKAction() {
        // OK button acts as cancel in this dialog
        authJob?.cancel()
        scope.cancel()
        super.doOKAction()
    }

    override fun createActions() = arrayOf(okAction)
}
