// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.ipc.proxy.interfaces

import ai.kilocode.jetbrains.editor.ModelChangedEvent
import ai.kilocode.jetbrains.util.URI

interface ExtHostDocumentsProxy {
    fun acceptModelLanguageChanged(strURL: URI, newLanguageId: String)
    fun acceptModelSaved(strURL: URI)
    fun acceptDirtyStateChanged(strURL: URI, isDirty: Boolean)
    fun acceptEncodingChanged(strURL: URI, encoding: String)
    fun acceptModelChanged(strURL: URI, e: ModelChangedEvent, isDirty: Boolean)
}
