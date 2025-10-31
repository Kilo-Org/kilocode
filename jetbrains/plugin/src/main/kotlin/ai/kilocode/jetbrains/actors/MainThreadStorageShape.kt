// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.actors

import ai.kilocode.jetbrains.service.ExtensionStorageService
import com.intellij.openapi.Disposable
import com.intellij.openapi.components.service
import com.intellij.openapi.diagnostic.Logger

/**
 * Main thread storage service interface.
 */
interface MainThreadStorageShape : Disposable {
    /**
     * Initializes extension storage.
     * @param shared Whether shared
     * @param extensionId Extension ID
     * @return Initialization result
     */
    fun initializeExtensionStorage(shared: Boolean, extensionId: String): Any?

    /**
     * Sets value.
     * @param shared Whether shared
     * @param extensionId Extension ID
     * @param value Value object
     * @return Set result
     */
    fun setValue(shared: Boolean, extensionId: String, value: Any)

    /**
     * Registers extension storage keys for synchronization.
     * @param extension Extension ID and version
     * @param keys List of keys
     */
    fun registerExtensionStorageKeysToSync(extension: Any, keys: List<String>)
}

/**
 * Implementation of the main thread storage service.
 */
class MainThreadStorage : MainThreadStorageShape {
    private val logger = Logger.getInstance(MainThreadStorage::class.java)

    override fun initializeExtensionStorage(shared: Boolean, extensionId: String): Any? {
        logger.info("Initializing extension storage: shared=$shared, extensionId=$extensionId")
        val storage = service<ExtensionStorageService>()
        return storage.getValue(extensionId)
    }

    override fun setValue(shared: Boolean, extensionId: String, value: Any) {
//        logger.info("Setting value: shared=$shared, extensionId=$extensionId, value=$value")
        val storage = service<ExtensionStorageService>()
        storage.setValue(extensionId, value)
    }

    override fun registerExtensionStorageKeysToSync(extension: Any, keys: List<String>) {
        val extensionId = if (extension is Map<*, *>) {
            "${extension["id"]}_${extension["version"]}"
        } else {
            "$extension"
        }
        logger.info("Registering extension storage keys for sync: extension=$extensionId, keys=$keys")
    }

    override fun dispose() {
        logger.info("Dispose MainThreadStorage")
    }
}
