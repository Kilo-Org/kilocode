// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.actions

import ai.kilocode.jetbrains.webview.WebViewManager
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages

/**
 * Code action provider, similar to VSCode's CodeActionProvider.
 * Provides functionality for creating and managing code-related actions.
 */
class CodeActionProvider {

    /**
     * Creates a single code action with the specified title and command.
     *
     * @param title The display title for the action
     * @param command The command identifier to execute when action is triggered
     * @return An AnAction instance that can be registered with the IDE
     */
    private fun createAction(
        title: String,
        command: String,
    ): AnAction {
        return object : AnAction(title) {
            override fun actionPerformed(e: AnActionEvent) {
                val project = e.project ?: return
                val editor = e.getData(CommonDataKeys.EDITOR) ?: return
                val file = e.dataContext.getData(CommonDataKeys.VIRTUAL_FILE) ?: return

                // Get current parameters when the action is clicked
                val effectiveRange = getEffectiveRange(editor)
                if (effectiveRange == null) return

                val args = mutableMapOf<String, Any?>()
                args["filePath"] = file.path
                args["selectedText"] = effectiveRange.text
                args["startLine"] = effectiveRange.startLine + 1
                args["endLine"] = effectiveRange.endLine + 1

                handleCodeAction(command, title, args, project)
            }
        }
    }

    /**
     * Creates a pair of actions (new task version and current task version).
     *
     * @param baseTitle The base title for the actions
     * @param baseCommand The base command identifier
     * @return List of AnAction instances
     */
    private fun createActionPair(
        baseTitle: String,
        baseCommand: String,
    ): List<AnAction> {
        return listOf(
            createAction("$baseTitle in Current Task", "${baseCommand}InCurrentTask"),
        )
    }

    /**
     * Gets the effective range and text from the current editor selection.
     *
     * @param editor The current editor instance
     * @return EffectiveRange object containing selected text and line numbers, or null if no selection
     */
    private fun getEffectiveRange(editor: Editor): EffectiveRange? {
        val document = editor.document
        val selectionModel = editor.selectionModel

        return if (selectionModel.hasSelection()) {
            val selectedText = selectionModel.selectedText ?: ""
            val startLine = document.getLineNumber(selectionModel.selectionStart)
            val endLine = document.getLineNumber(selectionModel.selectionEnd)
            EffectiveRange(selectedText, startLine, endLine)
        } else {
            null
        }
    }

    /**
     * Provides a list of code actions for the given action event.
     *
     * @param e The action event containing context information
     * @return List of available code actions
     */
    fun provideCodeActions(e: AnActionEvent): List<AnAction> {
        val actions = mutableListOf<AnAction>()

        // Add to context action
        actions.add(
            createAction(
                ActionNames.ADD_TO_CONTEXT,
                CommandIds.ADD_TO_CONTEXT,
            ),
        )

        // Explain code action pair
        actions.addAll(
            createActionPair(
                ActionNames.EXPLAIN,
                CommandIds.EXPLAIN,
            ),
        )

        // Fix code action pair (logic fix)
        actions.addAll(
            createActionPair(
                ActionNames.FIX_LOGIC,
                CommandIds.FIX,
            ),
        )

        // Improve code action pair
        actions.addAll(
            createActionPair(
                ActionNames.IMPROVE,
                CommandIds.IMPROVE,
            ),
        )

        return actions
    }
}

/**
 * Data class representing an effective range of selected text.
 * Contains the selected text and its start/end line numbers.
 *
 * @property text The selected text content
 * @property startLine The starting line number (0-based)
 * @property endLine The ending line number (0-based)
 */
data class EffectiveRange(
    val text: String,
    val startLine: Int,
    val endLine: Int,
)

/**
 * Registers a code action with the specified parameters.
 *
 * @param command The command identifier
 * @param promptType The type of prompt to use
 * @param inputPrompt Optional prompt text for user input dialog
 * @param inputPlaceholder Optional placeholder text for input field
 * @return An AnAction instance that can be registered with the IDE
 */
fun registerCodeAction(
    command: String,
    promptType: String,
    inputPrompt: String? = null,
    inputPlaceholder: String? = null,
): AnAction {
    return object : AnAction(command) {
        override fun actionPerformed(e: AnActionEvent) {
            val project = e.project ?: return
            val editor = e.getData(CommonDataKeys.EDITOR) ?: return

            var userInput: String? = null
            if (inputPrompt != null) {
                userInput = Messages.showInputDialog(
                    project,
                    inputPrompt,
                    "Kilo Code",
                    null,
                    inputPlaceholder,
                    null,
                )
                if (userInput == null) return // Cancelled
            }

            // Get selected content, line numbers, etc.
            val document = editor.document
            val selectionModel = editor.selectionModel
            val selectedText = selectionModel.selectedText ?: ""
            val startLine = if (selectionModel.hasSelection()) document.getLineNumber(selectionModel.selectionStart) else null
            val endLine = if (selectionModel.hasSelection()) document.getLineNumber(selectionModel.selectionEnd) else null
            val file = e.getData(CommonDataKeys.VIRTUAL_FILE)
            val filePath = file?.path ?: ""

            val params = mutableMapOf<String, Any?>(
                "filePath" to filePath,
                "selectedText" to selectedText,
            )
            if (startLine != null) params["startLine"] = (startLine + 1).toString()
            if (endLine != null) params["endLine"] = (endLine + 1).toString()
            if (!userInput.isNullOrEmpty()) params["userInput"] = userInput

            handleCodeAction(command, promptType, params, e.project)
        }
    }
}

/**
 * Registers a pair of code actions with the specified parameters.
 *
 * @param baseCommand The base command identifier
 * @param inputPrompt Optional prompt text for user input dialog
 * @param inputPlaceholder Optional placeholder text for input field
 * @return An AnAction instance for the new task version
 */
fun registerCodeActionPair(
    baseCommand: String,
    inputPrompt: String? = null,
    inputPlaceholder: String? = null,
): AnAction {
    // New task version
    return registerCodeAction(baseCommand, baseCommand, inputPrompt, inputPlaceholder)
}

/**
 * Core logic for handling code actions.
 * Processes different types of commands and sends appropriate messages to the webview.
 *
 * @param command The command identifier
 * @param promptType The type of prompt to use
 * @param params Parameters for the action (can be Map or List)
 * @param project The current project
 */
fun handleCodeAction(command: String, promptType: String, params: Any, project: Project?) {
    val latestWebView = project?.getService(WebViewManager::class.java)?.getLatestWebView()
    if (latestWebView == null) {
        return
    }

    // Create message content based on command type
    val messageContent = when {
        // Add to context command
        command.contains("addToContext") -> {
            @Suppress("UNCHECKED_CAST")
            val promptParams = if (params is Map<*, *>) params as Map<String, Any?> else emptyMap()
            mapOf(
                "type" to "invoke",
                "invoke" to "setChatBoxMessage",
                "text" to SupportPrompt.create("ADD_TO_CONTEXT", promptParams),
            )
        }
        // Command executed in current task
        command.endsWith("InCurrentTask") -> {
            @Suppress("UNCHECKED_CAST")
            val promptParams = if (params is Map<*, *>) params as Map<String, Any?> else emptyMap()
            val basePromptType = when {
                command.contains("explain") -> "EXPLAIN"
                command.contains("fix") -> "FIX"
                command.contains("improve") -> "IMPROVE"
                else -> promptType
            }
            mapOf(
                "type" to "invoke",
                "invoke" to "sendMessage",
                "text" to SupportPrompt.create(basePromptType, promptParams),
            )
        }
        // Command executed in new task
        else -> {
            val promptParams = if (params is List<*>) {
                // Process parameter list from createAction
                @Suppress("UNCHECKED_CAST")
                val argsList = params as List<Any>
                if (argsList.size >= 4) {
                    mapOf(
                        "filePath" to argsList[0],
                        "selectedText" to argsList[1],
                        "startLine" to argsList[2],
                        "endLine" to argsList[3],
                    )
                } else {
                    emptyMap()
                }
            } else if (params is Map<*, *>) {
                @Suppress("UNCHECKED_CAST")
                params as Map<String, Any?>
            } else {
                emptyMap()
            }

            val basePromptType = when {
                command.contains("explain") -> "EXPLAIN"
                command.contains("fix") -> "FIX"
                command.contains("improve") -> "IMPROVE"
                else -> promptType
            }

            mapOf(
                "type" to "invoke",
                "invoke" to "initClineWithTask",
                "text" to SupportPrompt.create(basePromptType, promptParams),
            )
        }
    }

    // Convert to JSON and send
    val messageJson = com.google.gson.Gson().toJson(messageContent)
    latestWebView.postMessageToWebView(messageJson)
}
