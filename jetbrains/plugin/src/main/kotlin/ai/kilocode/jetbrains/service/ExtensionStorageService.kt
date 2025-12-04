// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.service

import com.google.gson.Gson
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.util.xmlb.XmlSerializerUtil

@Service
@State(
    name = "ai.kilocode.jetbrains.service.ExtensionStorageService",
    storages = [Storage("kilocode-extension-storage.xml")],
)
class ExtensionStorageService() : PersistentStateComponent<ExtensionStorageService> {
    private val gson = Gson()
    var storageMap: MutableMap<String, String> = mutableMapOf()

    override fun getState(): ExtensionStorageService = this

    override fun loadState(state: ExtensionStorageService) {
        XmlSerializerUtil.copyBean(state, this)
    }

    fun setValue(key: String, value: Any) {
        storageMap[key] = when (value) {
            is String -> value
            else -> gson.toJson(value)
        }
    }

    fun getValue(key: String): String? {
        return storageMap[key]
    }

    fun removeValue(key: String) {
        storageMap.remove(key)
    }

    fun clear() {
        storageMap.clear()
    }
}
