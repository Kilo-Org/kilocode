// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.util

import ai.kilocode.jetbrains.plugin.DebugMode
import ai.kilocode.jetbrains.plugin.WecoderPluginService
import com.intellij.ide.plugins.IdeaPluginDescriptor
import com.intellij.ide.plugins.PluginManagerCore
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.extensions.PluginId
import java.io.File
import java.nio.file.Files
import java.nio.file.Paths
import kotlin.io.path.pathString

/**
 * Plugin resource utility class
 * Used to obtain resource file paths in the plugin
 */
object PluginResourceUtil {
    private val LOG = Logger.getInstance(PluginResourceUtil::class.java)

    /**
     * Get resource path
     *
     * @param pluginId Plugin ID
     * @param resourceName Resource name
     * @return Resource path, or null if failed to get
     */
    fun getResourcePath(pluginId: String, resourceName: String): String? {
        return try {
            if (WecoderPluginService.getDebugMode() != DebugMode.NONE) {
                // Debug mode: directly use plugin service to get resource path
                return WecoderPluginService.getDebugResource() + "/$resourceName"
            }
            val plugin = PluginManagerCore.getPlugin(PluginId.getId(pluginId))
                ?: throw IllegalStateException("Cannot find plugin: $pluginId")

            LOG.info("Get plugin version: ${plugin.version}")
            // Determine whether it is development mode or production mode
            val isDevMode = checkDevMode(plugin)

            if (isDevMode) {
                // Development mode: load from classpath or project resource directory
                loadDevResource(resourceName, plugin)
            } else {
                // Production mode: load from plugin JAR or installation directory
                loadProdResource(resourceName, plugin)
            }
        } catch (e: Exception) {
            LOG.error("Failed to get plugin resource path: $resourceName", e)
            null
        }
    }

    /**
     * Load resources in development mode
     */
    private fun loadDevResource(resourceName: String, plugin: IdeaPluginDescriptor): String {
        val resourcePath = Paths.get(plugin.pluginPath.parent.parent.parent.parent.parent.pathString, "resources/$resourceName")
        return resourcePath.toString()
    }

    /**
     * Load resources in production mode
     */
    private fun loadProdResource(resourceName: String, plugin: IdeaPluginDescriptor): String {
        // Load from plugin installation directory (compatible with old version)
        val pluginDir = plugin.pluginPath.toFile()
        val resourceDir = pluginDir.resolve(resourceName)
        if (resourceDir.exists()) {
            return resourceDir.absolutePath
        }

        throw IllegalStateException("Production environment resource not found: $resourceName")
    }

    /**
     * Check whether it is in development mode
     */
    private fun checkDevMode(plugin: IdeaPluginDescriptor): Boolean {
        try {
            val isSandbox = System.getProperty("idea.plugins.path")?.contains("idea-sandbox") ?: false
            val devResourcePath = Paths.get(plugin.pluginPath.parent.parent.parent.parent.parent.pathString, "resources")
            return isSandbox && Files.exists(devResourcePath)
        } catch (e: Exception) {
            return false
        }
    }

    /**
     * Extract resource from URL to temporary file
     *
     * @param resourceUrl Resource URL
     * @param filename File name
     * @return Temporary file path, or null if extraction fails
     */
    fun extractResourceToTempFile(resourceUrl: java.net.URL, filename: String): String? {
        return try {
            val tempFile = File.createTempFile("kilocode-", "-$filename")
            tempFile.deleteOnExit()

            resourceUrl.openStream().use { input ->
                tempFile.outputStream().use { output ->
                    input.copyTo(output)
                }
            }

            LOG.info("Resource extracted to temporary file: ${tempFile.absolutePath}")
            tempFile.absolutePath
        } catch (e: Exception) {
            LOG.error("Failed to extract resource to temporary file: $filename", e)
            null
        }
    }
}
