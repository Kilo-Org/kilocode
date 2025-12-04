// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.actors

import ai.kilocode.jetbrains.i18n.I18n
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.ui.Messages
import java.util.concurrent.atomic.AtomicReference

interface MainThreadMessageServiceShape : Disposable {
    //    $showMessage(severity: Severity, message: string, options: MainThreadMessageOptions, commands: { title: string; isCloseAffordance: boolean; handle: number }[]): Promise<number | undefined>;
    fun showMessage(severity: Int, message: String, options: Map<String, Any>, commands: List<Map<String, Any>>): Int?
}

class MainThreadMessageService : MainThreadMessageServiceShape {
    private val logger = Logger.getInstance(MainThreadMessageService::class.java)

    override fun showMessage(
        severity: Int,
        message: String,
        options: Map<String, Any>,
        commands: List<Map<String, Any>>,
    ): Int? {
        logger.info("showMessage - severity: $severity, message: $message, options: $options, commands: $commands")

        val project = ProjectManager.getInstance().defaultProject
        val isModal = options["modal"] as? Boolean ?: false
        val detail = options["detail"] as? String
        return if (isModal) {
            showModalMessage(project, severity, message, detail, options, commands)
        } else {
            showNotificationMessage(project, severity, message)
            null
        }
    }

    private fun showModalMessage(
        project: com.intellij.openapi.project.Project,
        severity: Int,
        message: String,
        detail: String?,
        options: Map<String, Any>,
        commands: List<Map<String, Any>>,
    ): Int? {
        // Find if there's a button with isCloseAffordance=true as cancel button
        var cancelIdx = commands.indexOfFirst { it["isCloseAffordance"] == true }
        // If no cancel button, automatically add a "Cancel" button at the end
        val commandsWithCancel = if (cancelIdx < 0) {
            val cancelHandle = commands.size
            commands + mapOf("title" to I18n.t("jetbrains:dialog.cancel"), "handle" to cancelHandle, "isCloseAffordance" to true)
        } else {
            commands
        }
        // Button title array for dialog buttons
        val buttonTitles = commandsWithCancel.map { it["title"].toString() }
        // Establish mapping from button index to handle for returning handle later
        val handleMap = commandsWithCancel.mapIndexed { idx, cmd -> idx to (cmd["handle"] as? Number)?.toInt() }.toMap()
        // Re-find the index of cancel button
        val cancelIdxFinal = commandsWithCancel.indexOfFirst { it["isCloseAffordance"] == true }
        // Assemble dialog main message and subtitle
        val dialogMessage = if (detail.isNullOrBlank()) message else "$message\n\n$detail"
        // For thread-safe retrieval of user-selected button index
        val selectedIdxRef = AtomicReference<Int>()
        // Ensure UI operations execute on EDT thread, show modal dialog
        ApplicationManager.getApplication().invokeAndWait {
            val selectedIdx = Messages.showDialog(
                project,
                dialogMessage,
                options["source"]?.let { (it as? Map<*, *>)?.get("label")?.toString() } ?: "kilocode",
                buttonTitles.toTypedArray(),
                if (cancelIdxFinal >= 0) cancelIdxFinal else 0,
                // Choose different icons based on severity
                when (severity) {
                    1 -> Messages.getInformationIcon()
                    2 -> Messages.getWarningIcon()
                    3 -> Messages.getErrorIcon()
                    else -> Messages.getInformationIcon()
                },
            )
            selectedIdxRef.set(selectedIdx)
        }
        // Get user-clicked button index and return corresponding handle
        val selectedIdx = selectedIdxRef.get()
        return if (selectedIdx != null && selectedIdx >= 0) handleMap[selectedIdx] else null
    }

    private fun showNotificationMessage(
        project: com.intellij.openapi.project.Project,
        severity: Int,
        message: String,
    ) {
        val notificationType = when (severity) {
            1 -> NotificationType.INFORMATION
            2 -> NotificationType.WARNING
            3 -> NotificationType.ERROR
            else -> NotificationType.INFORMATION
        }
        val notification = NotificationGroupManager.getInstance().getNotificationGroup("kilocode").createNotification(
            message,
            notificationType,
        )
        notification.notify(project)
    }

    override fun dispose() {
        logger.info("dispose")
    }
}
