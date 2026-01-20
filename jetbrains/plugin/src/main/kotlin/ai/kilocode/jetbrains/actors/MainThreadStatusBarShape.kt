// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.actors

import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.WindowManager

/**
 * Interface for MainThreadStatusBar
 * Handles status bar operations from the extension host
 */
interface MainThreadStatusBarShape : Disposable {
    /**
     * Set a status bar entry
     * @param id Entry identifier
     * @param extensionId Extension identifier
     * @param entryId Entry identifier
     * @param name Display name
     * @param text Status bar text
     * @param tooltip Tooltip text or MarkdownString object
     * @param showProgress Show progress indicator
     * @param command Command to execute on click
     * @param backgroundColor Background color
     * @param color Text color
     * @param accessibilityInformation Accessibility information object
     * @param priority Display priority
     * @param alignment Alignment (left/right)
     */
    fun setEntry(
        id: Int,
        extensionId: String,
        entryId: String,
        name: String,
        text: String,
        tooltip: Any?,
        showProgress: Boolean,
        command: Any?,
        backgroundColor: Any?,
        color: Any?,
        accessibilityInformation: Any?,
        priority: Double?,
        alignment: Any?,
    )

    /**
     * Remove a status bar entry
     * @param id Entry identifier
     */
    fun removeEntry(id: Int)

    /**
     * Dispose a status bar entry (alias for removeEntry for VSCode compatibility)
     * @param id Entry identifier
     */
    fun disposeEntry(id: Int)
}

/**
 * Implementation of MainThreadStatusBar
 * Manages status bar entries for extensions
 */
class MainThreadStatusBar(
    private val project: Project? = null,
) : MainThreadStatusBarShape {
    private val logger = Logger.getInstance(MainThreadStatusBar::class.java)
    private val statusBarEntries = mutableMapOf<Int, StatusBarEntry>()

    data class StatusBarEntry(
        val id: Int,
        val extensionId: String,
        val entryId: String,
        val name: String,
        val text: String,
        val tooltip: Any?,
        val showProgress: Boolean,
        val command: Any?,
        val backgroundColor: Any?,
        val color: Any?,
        val accessibilityInformation: Any?,
        val priority: Double?,
        val alignment: Any?,
    )

    override fun setEntry(
        id: Int,
        extensionId: String,
        entryId: String,
        name: String,
        text: String,
        tooltip: Any?,
        showProgress: Boolean,
        command: Any?,
        backgroundColor: Any?,
        color: Any?,
        accessibilityInformation: Any?,
        priority: Double?,
        alignment: Any?,
    ) {
        logger.info("Setting status bar entry: id=$id, extensionId=$extensionId, text=$text")

        val entry = StatusBarEntry(
            id = id,
            extensionId = extensionId,
            entryId = entryId,
            name = name,
            text = text,
            tooltip = tooltip,
            showProgress = showProgress,
            command = command,
            backgroundColor = backgroundColor,
            color = color,
            accessibilityInformation = accessibilityInformation,
            priority = priority,
            alignment = alignment,
        )

        statusBarEntries[id] = entry

        // Update the actual status bar if project is available
        project?.let { updateStatusBar(it, entry) }
    }

    override fun removeEntry(id: Int) {
        logger.info("Removing status bar entry: id=$id")
        statusBarEntries.remove(id)

        // In a real implementation, we would remove the widget from the status bar
        // For now, we just log the removal
    }

    override fun disposeEntry(id: Int) {
        logger.info("Disposing status bar entry: id=$id")
        // disposeEntry is functionally equivalent to removeEntry for VSCode compatibility
        removeEntry(id)
    }

    private fun extractTooltipText(tooltip: Any?): String? {
        return when (tooltip) {
            is String -> tooltip
            is Map<*, *> -> {
                // Handle MarkdownString object (serialized as Map)
                tooltip["value"] as? String
            }
            else -> tooltip?.toString()
        }
    }

    private fun updateStatusBar(project: Project, entry: StatusBarEntry) {
        try {
            // Get the status bar for the project
            val statusBar = WindowManager.getInstance().getStatusBar(project)

            if (statusBar != null) {
                // In JetBrains, we can't directly manipulate the status bar like in VSCode
                // We would need to create a custom widget or use notifications
                // For now, we just log the update
                val tooltipText = extractTooltipText(entry.tooltip)
                logger.info("Would update status bar with: ${entry.text}, tooltip: $tooltipText")

                // If showProgress is true, we could show a progress indicator
                if (entry.showProgress) {
                    logger.info("Progress indicator requested for: ${entry.text}")
                }
            } else {
                logger.warn("Status bar not available for project")
            }
        } catch (e: Exception) {
            logger.error("Error updating status bar", e)
        }
    }

    override fun dispose() {
        logger.info("Disposing MainThreadStatusBar")
        statusBarEntries.clear()
    }
}
