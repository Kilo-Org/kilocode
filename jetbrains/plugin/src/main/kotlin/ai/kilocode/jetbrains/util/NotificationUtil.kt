// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.util

import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager

/**
 * Notification utility class
 * Used to encapsulate notification functionality for the plugin
 */
object NotificationUtil {

    private const val NOTIFICATION_GROUP_ID = "kilocode"

    /**
     * Show error notification
     * @param title Notification title
     * @param content Notification content
     * @param project Project instance, if null the default project is used
     */
    fun showError(title: String, content: String, project: Project? = null) {
        showNotification(title, content, NotificationType.ERROR, project)
    }

    /**
     * Show warning notification
     * @param title Notification title
     * @param content Notification content
     * @param project Project instance, if null the default project is used
     */
    fun showWarning(title: String, content: String, project: Project? = null) {
        showNotification(title, content, NotificationType.WARNING, project)
    }

    /**
     * Show info notification
     * @param title Notification title
     * @param content Notification content
     * @param project Project instance, if null the default project is used
     */
    fun showInfo(title: String, content: String, project: Project? = null) {
        showNotification(title, content, NotificationType.INFORMATION, project)
    }

    /**
     * Show notification
     * @param title Notification title
     * @param content Notification content
     * @param type Notification type
     * @param project Project instance, if null the default project is used
     */
    private fun showNotification(title: String, content: String, type: NotificationType, project: Project?) {
        val targetProject = project ?: ProjectManager.getInstance().defaultProject
        val notificationGroup = NotificationGroupManager.getInstance().getNotificationGroup(NOTIFICATION_GROUP_ID)

        notificationGroup?.createNotification(title, content, type)?.notify(targetProject)
    }
}
