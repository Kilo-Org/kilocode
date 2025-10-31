// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.model

import ai.kilocode.jetbrains.util.URI

/**
 * Workspace base data
 * Corresponds to IStaticWorkspaceData in VSCode
 */
data class StaticWorkspaceData(
    val id: String,
    val name: String,
    val transient: Boolean? = null,
    val configuration: URI? = null,
    val isUntitled: Boolean? = null,
)

/**
 * Workspace folder
 * Corresponds to elements in IWorkspaceData.folders in VSCode
 */
data class WorkspaceFolder(
    val uri: URI,
    val name: String,
    val index: Int,
)

/**
 * Workspace data
 * Corresponds to IWorkspaceData in VSCode
 */
data class WorkspaceData(
    val id: String,
    val name: String,
    val transient: Boolean? = null,
    val configuration: URI? = null,
    val isUntitled: Boolean? = null,
    val folders: List<WorkspaceFolder> = emptyList(),
) {
    // Create WorkspaceData from StaticWorkspaceData
    constructor(staticData: StaticWorkspaceData, folders: List<WorkspaceFolder> = emptyList()) : this(
        id = staticData.id,
        name = staticData.name,
        transient = staticData.transient,
        configuration = staticData.configuration,
        isUntitled = staticData.isUntitled,
        folders = folders,
    )
}
