// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.ipc.proxy.interfaces

import ai.kilocode.jetbrains.model.WorkspaceData
import ai.kilocode.jetbrains.util.URIComponents

/**
 * Extension host workspace service interface
 * Corresponds to ExtHostWorkspace in VSCode
 */
interface ExtHostWorkspaceProxy {
    /**
     * Initialize workspace
     * @param workspace Workspace configuration
     * @param trusted Whether trusted
     */
    fun initializeWorkspace(workspace: WorkspaceData?, trusted: Boolean)

    /**
     * Accept workspace data
     * @param workspace Workspace data
     */
    fun acceptWorkspaceData(workspace: WorkspaceData?)

    /**
     * Handle text search result
     */
    fun handleTextSearchResult(result: Any, requestId: Long)

    /**
     * Grant workspace trust
     */
    fun onDidGrantWorkspaceTrust()

    /**
     * Get edit session identifier
     */
    fun getEditSessionIdentifier(folder: URIComponents, token: Any): String?
}
