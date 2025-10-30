// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.actions

import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.ActionUpdateThreadAware
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.project.DumbAware

/**
 * Right-click menu code action group, similar to VSCode's code action provider.
 * This class manages the dynamic actions that appear in the context menu when text is selected.
 * Implements DumbAware to ensure the action works during indexing, and ActionUpdateThreadAware
 * to specify which thread should handle action updates.
 */
class RightClickChatActionGroup : DefaultActionGroup(), DumbAware, ActionUpdateThreadAware {

    /**
     * Provider that supplies the actual code actions to be displayed in the menu.
     */
    private val codeActionProvider = CodeActionProvider()

    /**
     * Updates the action group based on the current context.
     * This method is called each time the menu needs to be displayed.
     *
     * @param e The action event containing context information
     */
    override fun update(e: AnActionEvent) {
        removeAll()

        // Check if there is an editor and selected text
        val editor = e.getData(CommonDataKeys.EDITOR)
        val hasSelection = editor?.selectionModel?.hasSelection() == true

        if (hasSelection) {
            loadDynamicActions(e)
        }

        // Set the visibility of the action group
        e.presentation.isVisible = hasSelection
    }

    /**
     * Loads dynamic actions into this action group based on the current context.
     *
     * @param e The action event containing context information
     */
    private fun loadDynamicActions(e: AnActionEvent) {
        // Use actions provided by CodeActionProvider
        val actions = codeActionProvider.provideCodeActions(e)
        actions.forEach { action ->
            add(action)
        }
    }

    /**
     * Specifies which thread should be used for updating this action.
     * EDT (Event Dispatch Thread) is used for UI-related operations.
     *
     * @return The thread to use for action updates
     */
    override fun getActionUpdateThread(): ActionUpdateThread {
        return ActionUpdateThread.EDT
    }
}
