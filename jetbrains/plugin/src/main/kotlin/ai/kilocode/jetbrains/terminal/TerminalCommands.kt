// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.terminal

import ai.kilocode.jetbrains.actors.MainThreadClipboard
import ai.kilocode.jetbrains.commands.CommandRegistry
import ai.kilocode.jetbrains.commands.ICommand
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindowManager
import org.jetbrains.plugins.terminal.TerminalToolWindowManager

/**
 * Registers commands related to terminal API operations
 * Currently registers the workbench.action.terminal.copySelection command for copying terminal output to clipboard
 *
 * @param project The current IntelliJ project
 * @param registry The command registry to register commands with
 */
fun registerTerminalAPICommands(project: Project, registry: CommandRegistry) {
    registry.registerCommand(
        object : ICommand {
            override fun getId(): String {
                return "workbench.action.terminal.copySelection"
            }
            override fun getMethod(): String {
                return "workbench_action_terminal_copySelection"
            }

            override fun handler(): Any {
                return TerminalAPICommands(project)
            }

            override fun returns(): String? {
                return "void"
            }
        },
    )
}

/**
 * Handles terminal API commands for operations like copying terminal output to clipboard
 */
class TerminalAPICommands(val project: Project) {
    private val logger = Logger.getInstance(TerminalAPICommands::class.java)
    private val clipboard = MainThreadClipboard()

    /**
     * Copies the last command output from the current terminal to clipboard
     *
     * @return null after operation completes
     */
    suspend fun workbench_action_terminal_copySelection(): Any? {
        logger.info("Copying terminal output to clipboard")

        val textToCopy = try {
            getTerminalText() ?: ""
        } catch (e: Exception) {
            logger.error("Failed to copy terminal output to clipboard", e)
            ""
        }

        clipboard.writeText(textToCopy)
        if (textToCopy.isNotEmpty()) {
            logger.info("Successfully copied terminal output to clipboard")
        } else {
            logger.info("Copied empty terminal output to clipboard")
        }

        return null
    }

    /**
     * Get terminal text content
     *
     * @return Terminal text content, returns null if failed to get
     */
    private fun getTerminalText(): String? {
        val window = ToolWindowManager.getInstance(project)
            .getToolWindow("Terminal") // or TerminalToolWindowFactory.TOOL_WINDOW_ID
            ?: return null

        val selected = window.getContentManager().getSelectedContent()
            ?: return null

        val widget = TerminalToolWindowManager.getWidgetByContent(selected)
            ?: return null

        return widget.text.takeIf { it.isNotEmpty() }
    }
}
