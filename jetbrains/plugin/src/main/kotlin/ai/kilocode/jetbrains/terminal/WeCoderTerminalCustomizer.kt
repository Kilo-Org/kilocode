// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.terminal

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import org.jetbrains.plugins.terminal.LocalTerminalCustomizer
import java.io.File
import java.nio.file.Paths
import java.util.concurrent.atomic.AtomicBoolean

class WeCoderTerminalCustomizer : LocalTerminalCustomizer() {

    private val logger = Logger.getInstance(WeCoderTerminalCustomizer::class.java)

    // Mark file copy status
    private val filesCopied = AtomicBoolean(false)

    // Get the base directory for shell integration files - use user home directory for cross-platform compatibility
    private val shellIntegrationBaseDir: String by lazy {
        val userHome = System.getProperty("user.home")
        Paths.get(userHome, ".kilocode-shell-integrations").toString()
    }

    init {
        // Asynchronously copy shell integration files during class initialization
        copyShellIntegrationFiles()
    }

    /**
     * Asynchronously copy shell integration files to user home directory
     */
    private fun copyShellIntegrationFiles() {
        if (filesCopied.get()) {
            return // Already copied
        }

        // Use IDEA's background thread pool to execute asynchronously
        ApplicationManager.getApplication().executeOnPooledThread {
            if (!filesCopied.compareAndSet(false, true)) {
                return@executeOnPooledThread // Prevent duplicate copy
            }

            try {
                logger.info("🚀 Start async copy of shell integration files to user home...")

                // Define shell integration configs to copy
                val shellConfigs = mapOf(
                    "vscode-zsh" to listOf(".zshrc", ".zshenv"),
                    "vscode-bash" to listOf("bashrc"),
                    "vscode-powershell" to listOf("profile.ps1", "diagnose.ps1"),
                )

                // Copy integration files for each shell
                shellConfigs.forEach { (shellType, files) ->
                    val sourceDir = "kilocode-shell-integrations/$shellType"
                    val targetDir = Paths.get(shellIntegrationBaseDir, shellType).toString()

                    // Create target directory
                    val targetDirFile = File(targetDir)
                    if (!targetDirFile.exists()) {
                        targetDirFile.mkdirs()
                        logger.info("📁 Created $shellType target directory: $targetDir")
                    }

                    // Copy files
                    files.forEach { fileName ->
                        val inputStream = javaClass.classLoader.getResourceAsStream("$sourceDir/$fileName")
                        if (inputStream != null) {
                            val targetFile = File("$targetDir/$fileName")
                            targetFile.outputStream().use { outputStream ->
                                inputStream.copyTo(outputStream)
                            }
                            // Set executable permission
                            targetFile.setExecutable(true, true)
                            logger.info("✅ Successfully copied $shellType file: $fileName")
                        } else {
                            logger.warn("⚠️ Cannot find $shellType source file: $fileName")
                        }
                    }
                }

                logger.info("✅ Shell integration files async copy complete")
            } catch (e: Exception) {
                logger.error("❌ Failed to async copy shell integration files", e)
                filesCopied.set(false) // Copy failed, reset state to allow retry
            }
        }
    }

    override fun customizeCommandAndEnvironment(
        project: Project,
        workingDirectory: String?,
        command: Array<String>,
        envs: MutableMap<String, String>,
    ): Array<String> {
        return injectVSCodeScript(command, envs)
    }

    private fun injectVSCodeScript(command: Array<String>, envs: MutableMap<String, String>): Array<String> {
        val shellName = File(command[0]).name
        
        val scriptPath = getVSCodeScript(shellName) ?: run {
            logger.warn("No integration script found for Shell($shellName)")
            return command
        }

        // Set general injection flag
        envs["VSCODE_INJECTION"] = "1"

        return when (shellName) {
            "bash", "sh" -> injectBashScript(command, envs, scriptPath)
            "zsh" -> injectZshScript(command, envs, scriptPath)
            "powershell", "pwsh", "powershell.exe" -> injectPowerShellScript(command, envs, scriptPath)
            else -> {
                logger.warn("Unsupported shell type: $shellName")
                command
            }
        }
    }

    /**
     * Inject VSCode integration script for Bash/Sh
     */
    private fun injectBashScript(command: Array<String>, envs: MutableMap<String, String>, scriptPath: String): Array<String> {
        val rcfileIndex = command.indexOf("--rcfile")

        return if (rcfileIndex != -1 && rcfileIndex + 1 < command.size) {
            // If --rcfile parameter already exists, save the original rcfile path
            val originalRcfile = command[rcfileIndex + 1]
            logger.info("🔧 Detected existing --rcfile parameter: $originalRcfile")

            // Save the original rcfile path to environment variable for script use
            envs["ORIGINAL_BASH_RCFILE"] = originalRcfile

            // Replace the existing --rcfile parameter value
            val newCommand = command.clone()
            newCommand[rcfileIndex + 1] = scriptPath
            logger.info("🔧 Replaced --rcfile parameter with: $scriptPath")
            newCommand
        } else {
            // If --rcfile parameter does not exist, add new parameter
            logger.info("🔧 Added new --rcfile parameter: $scriptPath")
            arrayOf(command[0], "--rcfile", scriptPath) + command.drop(1)
        }
    }

    /**
     * Inject VSCode integration script for Zsh (safe with JetBrains shell integration)
     */
    private fun injectZshScript(
        command: Array<String>,
        envs: MutableMap<String, String>,
        scriptPath: String,
    ): Array<String> {
        // Check if this is an extension-owned terminal using our marker
        val isExtensionTerminal = envs["KILOCODE_EXTENSION_TERMINAL"] == "true"
        
        // 1) If JetBrains' built-in zsh shell integration is already in place, avoid modifying ZDOTDIR to prevent conflicts.
        val jetbrainsZshDir = envs["JETBRAINS_INTELLIJ_ZSH_DIR"] ?: System.getenv("JETBRAINS_INTELLIJ_ZSH_DIR")
        val looksLikeJbZsh = command[0].contains("/plugins/terminal/shell-integrations/zsh")

        // For extension-owned terminals, FORCE VSCode shell integration even if JetBrains integration is detected
        if (jetbrainsZshDir != null || looksLikeJbZsh) {
            if (isExtensionTerminal) {
                // Don't return early - continue with VSCode injection
            } else {
                // Still retain the user's original ZDOTDIR in the environment for on-demand use within scripts.
                val userZdotdir = envs["ZDOTDIR"] ?: System.getenv("ZDOTDIR") ?: System.getProperty("user.home")
                envs["USER_ZDOTDIR"] = userZdotdir
                return command
            }
        }

        // 2) Inject only when `scriptPath` appears to be a valid `ZDOTDIR` (at least containing `.zshrc`).
        val dir = File(scriptPath)
        val hasZshrc = File(dir, ".zshrc").exists()
        
        if (!dir.isDirectory || !hasZshrc) {
            logger.warn("Zsh script dir '$scriptPath' is invalid. Skip overriding ZDOTDIR.")
            return command
        }

        // 3) Record and securely overwrite.
        // For extension terminals, set USER_ZDOTDIR to user's home directory to avoid loading JetBrains integration
        val userZdotdir = if (isExtensionTerminal) {
            System.getProperty("user.home")
        } else {
            envs["ZDOTDIR"] ?: System.getenv("ZDOTDIR") ?: System.getProperty("user.home")
        }
        envs["USER_ZDOTDIR"] = userZdotdir
        envs["ZDOTDIR"] = scriptPath

        return command
    }

    /**
     * Inject VSCode integration script for PowerShell
     */
    private fun injectPowerShellScript(command: Array<String>, envs: MutableMap<String, String>, scriptPath: String): Array<String> {
        logger.info("🔧 Inject PowerShell script: $scriptPath")

        // Add debug info environment variables
        // envs["WECODER_SHELL_INTEGRATION"] = "1"
        // envs["WECODER_SCRIPT_PATH"] = scriptPath

        // Set environment variables required for PowerShell shell integration
        envs["VSCODE_NONCE"] = generateNonce()
        envs["VSCODE_SHELL_ENV_REPORTING"] = "1"
        envs["VSCODE_STABLE"] = "1" // Mark as stable version

        logger.info("🔧 Set PowerShell environment variables: VSCODE_NONCE=${envs["VSCODE_NONCE"]}")

        // Find existing -File parameter position
        val fileIndex = command.indexOf("-File")

        return if (fileIndex != -1 && fileIndex + 1 < command.size) {
            // If -File parameter already exists, save the original script path
            val originalScript = command[fileIndex + 1]
            logger.info("🔧 Detected existing -File parameter: $originalScript")

            // Save the original script path to environment variable for script use
            envs["ORIGINAL_POWERSHELL_SCRIPT"] = originalScript

            // Replace the existing -File parameter value
            val newCommand = command.clone()
            newCommand[fileIndex + 1] = scriptPath
            logger.info("🔧 Replace -File parameter with: $scriptPath")
            newCommand
        } else {
            // If -File parameter does not exist, add parameter in IDEA default format
            // Default format: powershell.exe -NoExit -ExecutionPolicy Bypass -File <script>
            logger.info("🔧 Add new -File parameter: $scriptPath")

            // Build new command, keep IDEA's default parameter order
            val newCommand = mutableListOf<String>()
            newCommand.add(command[0]) // powershell.exe

            // Check if -NoExit parameter already exists
            if (!command.contains("-NoExit")) {
                newCommand.add("-NoExit")
            }

            // Check if -ExecutionPolicy parameter already exists
            val execPolicyIndex = command.indexOf("-ExecutionPolicy")
            if (execPolicyIndex == -1) {
                newCommand.add("-ExecutionPolicy")
                newCommand.add("Bypass")
            }

            // Add -File parameter and script path
            newCommand.add("-File")
            newCommand.add(scriptPath)

            // Add other original parameters (skip the first executable file name)
            command.drop(1).forEach { arg ->
                if (arg != "-NoExit" && arg != "-ExecutionPolicy" && arg != "Bypass") {
                    newCommand.add(arg)
                }
            }

            newCommand.toTypedArray()
        }
    }

    /**
     * Generate random nonce for shell integration
     */
    private fun generateNonce(): String {
        val chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
        return (1..16).map { chars.random() }.joinToString("")
    }

    private fun getVSCodeScript(shellName: String): String? {
        return when (shellName) {
            "bash", "sh" -> {
                // bash uses --rcfile parameter, needs to point to a specific file
                Paths.get(shellIntegrationBaseDir, "vscode-bash", "bashrc").toString()
            }
            "zsh" -> {
                // zsh uses ZDOTDIR, needs to point to a directory, zsh will automatically look for .zshrc and .zshenv in that directory
                Paths.get(shellIntegrationBaseDir, "vscode-zsh").toString()
            }
            "powershell", "pwsh", "powershell.exe" -> {
                // PowerShell uses -File parameter, needs to point to a specific file
                Paths.get(shellIntegrationBaseDir, "vscode-powershell", "profile.ps1").toString()
            }
            else -> null
        }
    }
}
