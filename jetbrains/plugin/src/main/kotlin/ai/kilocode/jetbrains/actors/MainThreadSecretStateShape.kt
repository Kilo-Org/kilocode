// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.actors

import com.google.gson.GsonBuilder
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.File

/**
 * Secret state management service interface.
 */
interface MainThreadSecretStateShape : Disposable {
    /**
     * Gets the secret.
     * @param extensionId Extension ID
     * @param key Secret key identifier
     * @return Secret value, returns null if not exists
     */
    suspend fun getPassword(extensionId: String, key: String): String?

    /**
     * Sets the secret.
     * @param extensionId Extension ID
     * @param key Secret key identifier
     * @param value Secret value
     */
    suspend fun setPassword(extensionId: String, key: String, value: String)

    /**
     * Deletes the secret.
     * @param extensionId Extension ID
     * @param key Secret key identifier
     */
    suspend fun deletePassword(extensionId: String, key: String)
}

/**
 * Implementation of the secret state management service.
 * Stores secrets in ~/.kilocode/secrets.json file.
 */
class MainThreadSecretState : MainThreadSecretStateShape {
    private val logger = Logger.getInstance(MainThreadSecretState::class.java)
    private val gson = GsonBuilder().setPrettyPrinting().create()
    private val mutex = Mutex()

    // Configuration file path
    private val secretsDir = File(System.getProperty("user.home"), ".kilocode")
    private val secretsFile = File(secretsDir, "secrets.json")

    init {
        // Ensure the directory exists
        if (!secretsDir.exists()) {
            secretsDir.mkdirs()
            logger.info("Create secret storage directory: ${secretsDir.absolutePath}")
        }
    }

    override suspend fun getPassword(extensionId: String, key: String): String? = mutex.withLock {
        try {
            if (!secretsFile.exists()) {
                return null
            }

            val jsonContent = secretsFile.readText()
            if (jsonContent.isBlank()) {
                return null
            }

            val jsonObject = JsonParser.parseString(jsonContent).asJsonObject
            val extensionObject = jsonObject.getAsJsonObject(extensionId) ?: return null
            val passwordElement = extensionObject.get(key) ?: return null

            return passwordElement.asString
        } catch (e: Exception) {
            logger.warn("Failed to get secret: extensionId=$extensionId, key=$key", e)
            return null
        }
    }

    override suspend fun setPassword(extensionId: String, key: String, value: String) = mutex.withLock {
        try {
            val jsonObject = if (secretsFile.exists() && secretsFile.readText().isNotBlank()) {
                JsonParser.parseString(secretsFile.readText()).asJsonObject
            } else {
                JsonObject()
            }

            val extensionObject = jsonObject.getAsJsonObject(extensionId) ?: JsonObject().also {
                jsonObject.add(extensionId, it)
            }

            extensionObject.addProperty(key, value)

            val jsonString = gson.toJson(jsonObject)
            secretsFile.writeText(jsonString)

            logger.info("Successfully set secret: extensionId=$extensionId, key=$key")
        } catch (e: Exception) {
            logger.error("Failed to set secret: extensionId=$extensionId, key=$key", e)
            throw e
        }
    }

    override suspend fun deletePassword(extensionId: String, key: String) = mutex.withLock {
        try {
            if (!secretsFile.exists()) {
                return
            }

            val jsonContent = secretsFile.readText()
            if (jsonContent.isBlank()) {
                return
            }

            val jsonObject = JsonParser.parseString(jsonContent).asJsonObject
            val extensionObject = jsonObject.getAsJsonObject(extensionId) ?: return

            extensionObject.remove(key)

            // If extension object is empty, delete the entire extension
            if (extensionObject.size() == 0) {
                jsonObject.remove(extensionId)
            }

            val jsonString = gson.toJson(jsonObject)
            secretsFile.writeText(jsonString)

            logger.info("Successfully deleted secret: extensionId=$extensionId, key=$key")
        } catch (e: Exception) {
            logger.error("Failed to delete secret: extensionId=$extensionId, key=$key", e)
            throw e
        }
    }

    override fun dispose() {
        logger.info("Disposing MainThreadSecretState resources")
        // JSON file storage doesn't require special resource disposal
    }
}
