// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.ipc.proxy.interfaces

import ai.kilocode.jetbrains.editor.EditorTabGroupDto
import ai.kilocode.jetbrains.editor.TabOperation

interface ExtHostEditorTabsProxy {
    fun acceptEditorTabModel(tabGroups: List<EditorTabGroupDto>)
    fun acceptTabGroupUpdate(groupDto: EditorTabGroupDto)
    fun acceptTabOperation(operation: TabOperation)
}
