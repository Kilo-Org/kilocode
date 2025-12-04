// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.actors

import ai.kilocode.jetbrains.editor.EditorAndDocManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project

interface MainThreadEditorTabsShape {
    fun moveTab(tabId: String, index: Int, viewColumn: Int, preserveFocus: Boolean?)
    suspend fun closeTab(tabIds: List<String>, preserveFocus: Boolean?): Boolean
    suspend fun closeGroup(groupIds: List<Int>, preservceFocus: Boolean?): Boolean
}

class MainThreadEditorTabs(val project: Project) : MainThreadEditorTabsShape {
    private val logger = Logger.getInstance(MainThreadEditorTabs::class.java)
    override fun moveTab(tabId: String, index: Int, viewColumn: Int, preserveFocus: Boolean?) {
        logger.info("moveTab $tabId")
    }

    override suspend fun closeTab(tabIds: List<String>, preserveFocus: Boolean?): Boolean {
        logger.info("closeTab $tabIds")

        // Iterate all tab IDs and trigger close event
        var closedAny = true
        for (tabId in tabIds) {
            val tab = project.getService(EditorAndDocManager::class.java).closeTab(tabId)
//            closedAny = tab?.triggerClose()?:false
//            if (closedAny){
//                project.getService(TabStateManager::class.java).removeTab(tabId)
//            }
        }

        return closedAny
    }

    override suspend fun closeGroup(groupIds: List<Int>, preservceFocus: Boolean?): Boolean {
        logger.info("closeGroup $groupIds")

        // Iterate all tab group IDs and trigger close event
        var closedAny = false
        for (groupId in groupIds) {
            val group = project.getService(EditorAndDocManager::class.java).closeGroup(groupId)
//            closedAny = group?.triggerClose()?:false
        }
        return closedAny
    }
}
