// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.terminal

import com.intellij.execution.wsl.WSLDistribution
import com.intellij.execution.wsl.WslDistributionManager
import com.intellij.execution.wsl.WslPath
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import org.jetbrains.plugins.terminal.LocalTerminalCustomizer
import java.io.File
import java.nio.file.Path
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
        // Print debug logs
        logger.info("🔧 WeCodeTerminalCustomizer - customize terminal command and environment")
        logger.info("📂 Working directory: $workingDirectory")
        logger.info("🔨 Command: ${command.joinToString(" ")}")
        logger.info("🌍 Environment variables: ${envs.entries.joinToString("\n")}")

        // Detect if terminal is targeting WSL and get the distribution
        val wslDistribution = getWslDistribution(workingDirectory, command, envs)
        logger.info("🐧 WSL distribution: ${wslDistribution?.msId ?: "none"}")

        // Inject VSCode shell integration script
        return injectVSCodeScript(command, envs, wslDistribution)
    }

    /**
     * Get the WSL distribution if the terminal is targeting WSL.
     * Returns null if not running in WSL context.
     */
    private fun getWslDistribution(workingDirectory: String?, command: Array<String>, envs: Map<String, String>): WSLDistribution? {
        // Check if we're on Windows first
        val osName = System.getProperty("os.name")?.lowercase() ?: ""
        if (!osName.contains("windows")) {
            return null
        }

        // Try to get distribution from working directory UNC path (e.g., \\wsl$\Ubuntu\...)
        if (workingDirectory != null) {
            val wslPath = WslPath.parseWindowsUncPath(workingDirectory)
            if (wslPath != null) {
                return try {
                    WslDistributionManager.getInstance().getOrCreateDistributionByMsId(wslPath.distributionId)
                } catch (e: Exception) {
                    logger.warn("Failed to get WSL distribution from path: ${e.message}")
                    null
                }
            }
        }

        // Try to get distribution from WSL_DISTRO_NAME environment variable
        val distroName = envs["WSL_DISTRO_NAME"]
        if (distroName != null) {
            return try {
                WslDistributionManager.getInstance().getOrCreateDistributionByMsId(distroName)
            } catch (e: Exception) {
                logger.warn("Failed to get WSL distribution from env: ${e.message}")
                null
            }
        }

        // Check if the shell command is a Linux-style path (e.g., /bin/bash)
        // This indicates JetBrains is running the shell inside WSL, but we don't know which distro
        // Try to get the first installed distribution as a fallback
        if (command.isNotEmpty() && command[0].startsWith("/")) {
            return try {
                val distributions = WslDistributionManager.getInstance().installedDistributions
                if (distributions.isNotEmpty()) {
                    distributions.first()
                } else {
                    null
                }
            } catch (e: Exception) {
                logger.warn("Failed to get installed WSL distributions: ${e.message}")
                null
            }
        }

        return null
    }

    /**
     * Convert a Windows path to a WSL-compatible path using the WSL distribution.
     * Falls back to manual conversion if distribution is not available.
     */
    private fun convertToWslPath(windowsPath: String, distribution: WSLDistribution?): String {
        // Try using the JetBrains WSL API first
        if (distribution != null) {
            try {
                val wslPath = distribution.getWslPath(Path.of(windowsPath))
                if (wslPath != null) {
                    return wslPath
                }
            } catch (e: Exception) {
                logger.warn("Failed to convert path using WSL API: ${e.message}")
            }
        }

        // Fallback to manual conversion for standard /mnt/ mount root
        val driveLetterRegex = Regex("^([A-Za-z]):\\\\")
        val match = driveLetterRegex.find(windowsPath)

        return if (match != null) {
            val driveLetter = match.groupValues[1].lowercase()
            val restOfPath = windowsPath.substring(match.range.last + 1)
                .replace("\\", "/")
            "/mnt/$driveLetter/$restOfPath"
        } else {
            // Not a Windows path, return as-is
            windowsPath
        }
    }

    private fun injectVSCodeScript(command: Array<String>, envs: MutableMap<String, String>, wslDistribution: WSLDistribution?): Array<String> {
        val shellName = File(command[0]).name
        val scriptPath = getVSCodeScript(shellName) ?: run {
            logger.warn("🚫 No integration script found for Shell($shellName)")
            return command
        }

        // Convert path for WSL if needed
        val effectiveScriptPath = if (wslDistribution != null) convertToWslPath(scriptPath, wslDistribution) else scriptPath
        logger.info("🔧 Injecting Shell Integration script: $effectiveScriptPath (original: $scriptPath, wsl: ${wslDistribution != null})")
        logger.info("🐚 Shell type: $shellName")

        // Set general injection flag
        envs["VSCODE_INJECTION"] = "1"

        return when (shellName) {
            "bash", "sh" -> injectBashScript(command, envs, effectiveScriptPath, wslDistribution)
            "zsh" -> injectZshScript(command, envs, effectiveScriptPath, wslDistribution)
            "powershell", "pwsh", "powershell.exe" -> injectPowerShellScript(command, envs, effectiveScriptPath)
            else -> {
                logger.warn("⚠️ Unsupported shell type: $shellName")
                command
            }
        }
    }

    /**
     * Inject VSCode integration script for Bash/Sh
     */
    private fun injectBashScript(command: Array<String>, envs: MutableMap<String, String>, scriptPath: String, wslDistribution: WSLDistribution?): Array<String> {
        val rcfileIndex = command.indexOf("--rcfile")

        return if (rcfileIndex != -1 && rcfileIndex + 1 < command.size) {
            // If --rcfile parameter already exists, save the original rcfile path
            val originalRcfile = command[rcfileIndex + 1]
            logger.info("🔧 Detected existing --rcfile parameter: $originalRcfile")

            // Save the original rcfile path to environment variable for script use
            // Convert to WSL path if needed so the shell integration script can source it
            val effectiveOriginalRcfile = if (wslDistribution != null) convertToWslPath(originalRcfile, wslDistribution) else originalRcfile
            envs["ORIGINAL_BASH_RCFILE"] = effectiveOriginalRcfile
            logger.info("🔧 Set ORIGINAL_BASH_RCFILE: $effectiveOriginalRcfile")

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
        wslDistribution: WSLDistribution?,
    ): Array<String> {
        // 1) If JetBrains' built-in zsh shell integration is already in place, avoid modifying ZDOTDIR to prevent conflicts.
        val jetbrainsZshDir = envs["JETBRAINS_INTELLIJ_ZSH_DIR"] ?: System.getenv("JETBRAINS_INTELLIJ_ZSH_DIR")
        val shellExeName = File(command[0]).name
        val looksLikeJbZsh = command[0].contains("/plugins/terminal/shell-integrations/zsh")

        if (jetbrainsZshDir != null || looksLikeJbZsh) {
            logger.info("🔒 Detected JetBrains Zsh integration (JETBRAINS_INTELLIJ_ZSH_DIR=$jetbrainsZshDir, looksLikeJbZsh=$looksLikeJbZsh). Skip overriding ZDOTDIR.")
            // Still retain the user's original ZDOTDIR in the environment for on-demand use within scripts.
            val userZdotdir = envs["ZDOTDIR"] ?: System.getenv("ZDOTDIR") ?: System.getProperty("user.home")
            // Convert to WSL path if needed
            val effectiveUserZdotdir = if (wslDistribution != null) convertToWslPath(userZdotdir, wslDistribution) else userZdotdir
            envs["USER_ZDOTDIR"] = effectiveUserZdotdir
            return command
        }

        // 2) Inject only when the ZDOTDIR contains `.zshrc`.
        // Use the Windows path (shellIntegrationBaseDir) for file existence check since File() operates on host filesystem
        val zshDirToCheck = Paths.get(shellIntegrationBaseDir, "vscode-zsh").toString()
        val dir = File(zshDirToCheck)
        val hasZshrc = File(dir, ".zshrc").exists()
        if (!dir.isDirectory || !hasZshrc) {
            logger.warn("🚫 Zsh script dir '$zshDirToCheck' is invalid (dir=$dir, hasZshrc=$hasZshrc). Skip overriding ZDOTDIR.")
            return command
        }

        // 3) Record and securely overwrite.
        val userZdotdir = envs["ZDOTDIR"] ?: System.getenv("ZDOTDIR") ?: System.getProperty("user.home")
        // Convert to WSL path if needed
        val effectiveUserZdotdir = if (wslDistribution != null) convertToWslPath(userZdotdir, wslDistribution) else userZdotdir
        envs["USER_ZDOTDIR"] = effectiveUserZdotdir
        envs["ZDOTDIR"] = scriptPath

        logger.info("🔧 Set ZDOTDIR to '$scriptPath' (saved original as USER_ZDOTDIR='$effectiveUserZdotdir'), shell=$shellExeName")
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
