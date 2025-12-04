// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.actors

import ai.kilocode.jetbrains.util.URI
import ai.kilocode.jetbrains.util.URIComponents
import com.intellij.ide.util.PropertiesComponent
import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager

/**
 * Enum for configuration targets.
 * Corresponds to the ConfigurationTarget enum in VSCode.
 * Defines the different scopes where configuration can be applied.
 */
enum class ConfigurationTarget(val value: Int) {
    /** Application-level configuration, applies globally to the entire IDE */
    APPLICATION(1),

    /** User-level configuration, applies to the current user across all projects */
    USER(2),

    /** Local user configuration, specific to the local machine */
    USER_LOCAL(3),

    /** Remote user configuration, for remote development scenarios */
    USER_REMOTE(4),

    /** Workspace-level configuration, applies to the current project workspace */
    WORKSPACE(5),

    /** Workspace folder-level configuration, applies to specific folders within a workspace */
    WORKSPACE_FOLDER(6),

    /** Default configuration target when no specific target is provided */
    DEFAULT(7),

    /** Memory-only configuration, temporary and not persisted */
    MEMORY(8),
    ;

    companion object {
        /**
         * Creates a ConfigurationTarget from its integer value.
         * @param value The integer value representing the configuration target
         * @return The corresponding ConfigurationTarget enum value, or null if not found
         */
        fun fromValue(value: Int?): ConfigurationTarget? {
            return values().find { it.value == value }
        }

        /**
         * Converts a ConfigurationTarget enum to its string representation.
         * @param target The configuration target to convert
         * @return The string name of the configuration target
         */
        fun toString(target: ConfigurationTarget): String {
            return when (target) {
                APPLICATION -> "APPLICATION"
                USER -> "USER"
                USER_LOCAL -> "USER_LOCAL"
                USER_REMOTE -> "USER_REMOTE"
                WORKSPACE -> "WORKSPACE"
                WORKSPACE_FOLDER -> "WORKSPACE_FOLDER"
                DEFAULT -> "DEFAULT"
                MEMORY -> "MEMORY"
            }
        }
    }
}

/**
 * Interface for configuration overrides.
 * Corresponds to the IConfigurationOverrides interface in VSCode.
 * Used to provide context-specific configuration overrides.
 */
data class ConfigurationOverrides(
    /** Optional identifier for overriding configuration values, typically used for language-specific settings */
    val overrideIdentifier: String? = null,
    /** Optional URI specifying the resource context for the configuration override */
    val resource: URI? = null,
)

/**
 * Main thread configuration interface.
 * Corresponds to the MainThreadConfigurationShape interface in VSCode.
 * Defines the contract for configuration management operations that can be performed
 * from the main thread of the IDE.
 */
interface MainThreadConfigurationShape : Disposable {
    /**
     * Updates a configuration option with the specified parameters.
     * @param target Configuration target scope (application, user, workspace, etc.)
     * @param key Configuration key path (e.g., "editor.fontSize")
     * @param value Configuration value to set, can be null to unset
     * @param overrides Optional configuration overrides for specific contexts
     * @param scopeToLanguage Whether to scope this configuration to a specific language
     */
    fun updateConfigurationOption(
        target: Int,
        key: String,
        value: Any?,
        overrides: Map<String, Any>?,
        scopeToLanguage: Boolean?,
    )

    /**
     * Removes a configuration option from the specified target scope.
     * @param target Configuration target scope from which to remove the setting
     * @param key Configuration key path to remove
     * @param overrides Optional configuration overrides to consider during removal
     * @param scopeToLanguage Whether the configuration was scoped to a specific language
     */
    fun removeConfigurationOption(
        target: Int,
        key: String,
        overrides: Map<String, Any>?,
        scopeToLanguage: Boolean?,
    )
}

/**
 * Implementation of the main thread configuration interface.
 * Provides concrete implementation for managing IDE configuration settings
 * across different scopes and contexts.
 */
class MainThreadConfiguration : MainThreadConfigurationShape {
    private val logger = Logger.getInstance(MainThreadConfiguration::class.java)

    /**
     * Updates a configuration option in the specified target scope.
     * Handles the conversion of parameters and delegates to the appropriate
     * storage mechanism based on the configuration target.
     */
    override fun updateConfigurationOption(
        target: Int,
        key: String,
        value: Any?,
        overrides: Map<String, Any>?,
        scopeToLanguage: Boolean?,
    ) {
        // Convert parameter types from raw values to type-safe objects
        val configTarget = ConfigurationTarget.fromValue(target)
        val configOverrides = convertToConfigurationOverrides(overrides)

        // Log the configuration update for debugging purposes
        logger.info(
            "Update configuration option: target=${configTarget?.let { ConfigurationTarget.toString(it) }}, key=$key, value=$value, " +
                "overrideIdentifier=${configOverrides?.overrideIdentifier}, resource=${configOverrides?.resource}, " +
                "scopeToLanguage=$scopeToLanguage",
        )

        // Build the complete configuration key including overrides and language scoping
        val fullKey = buildConfigurationKey(key, configOverrides, scopeToLanguage)

        // Store the configuration value based on the target scope
        when (configTarget) {
            ConfigurationTarget.APPLICATION -> {
                // Application-level configuration applies to all projects and users
                val properties = PropertiesComponent.getInstance()
                storeValue(properties, fullKey, value)
            }
            ConfigurationTarget.WORKSPACE, ConfigurationTarget.WORKSPACE_FOLDER -> {
                // Project-level configuration applies to the current project
                val activeProject = getActiveProject()
                if (activeProject != null) {
                    val properties = PropertiesComponent.getInstance(activeProject)
                    storeValue(properties, fullKey, value)
                } else {
                    logger.warn("Failed to save project-level configuration, no active project found")
                }
            }
            ConfigurationTarget.USER, ConfigurationTarget.USER_LOCAL -> {
                // User-level configuration applies to the current user across projects
                val properties = PropertiesComponent.getInstance()
                val userPrefixedKey = "user.$fullKey"
                storeValue(properties, userPrefixedKey, value)
            }
            else -> {
                // Memory-level configuration is temporary and not persisted
                val properties = PropertiesComponent.getInstance()
                val memoryPrefixedKey = "memory.$fullKey"
                storeValue(properties, memoryPrefixedKey, value)
            }
        }
    }

    /**
     * Removes a configuration option from the specified target scope.
     * Handles the conversion of parameters and delegates to the appropriate
     * removal mechanism based on the configuration target.
     */
    override fun removeConfigurationOption(
        target: Int,
        key: String,
        overrides: Map<String, Any>?,
        scopeToLanguage: Boolean?,
    ) {
        // Convert parameter types from raw values to type-safe objects
        val configTarget = ConfigurationTarget.fromValue(target)
        val configOverrides = convertToConfigurationOverrides(overrides)

        // Log the configuration removal for debugging purposes
        logger.info(
            "Remove configuration option: target=${configTarget?.let { ConfigurationTarget.toString(it) }}, key=$key, " +
                "overrideIdentifier=${configOverrides?.overrideIdentifier}, resource=${configOverrides?.resource}, " +
                "scopeToLanguage=$scopeToLanguage",
        )

        // Build the complete configuration key including overrides and language scoping
        val fullKey = buildConfigurationKey(key, configOverrides, scopeToLanguage)

        // Remove the configuration value based on the target scope
        when (configTarget) {
            ConfigurationTarget.APPLICATION -> {
                // Remove application-level configuration
                val properties = PropertiesComponent.getInstance()
                properties.unsetValue(fullKey)
            }
            ConfigurationTarget.WORKSPACE, ConfigurationTarget.WORKSPACE_FOLDER -> {
                // Remove project-level configuration
                val activeProject = getActiveProject()
                if (activeProject != null) {
                    val properties = PropertiesComponent.getInstance(activeProject)
                    properties.unsetValue(fullKey)
                } else {
                    logger.warn("Failed to remove project-level configuration, no active project found")
                }
            }
            ConfigurationTarget.USER, ConfigurationTarget.USER_LOCAL -> {
                // Remove user-level configuration
                val properties = PropertiesComponent.getInstance()
                val userPrefixedKey = "user.$fullKey"
                properties.unsetValue(userPrefixedKey)
            }
            else -> {
                // Remove memory-level configuration
                val properties = PropertiesComponent.getInstance()
                val memoryPrefixedKey = "memory.$fullKey"
                properties.unsetValue(memoryPrefixedKey)
            }
        }
    }

    /**
     * Converts a Map<String, Any> to a ConfigurationOverrides object.
     * Handles the parsing of URI strings and map structures into proper URI objects.
     * @param overridesMap The overrides map containing configuration override data
     * @return The configuration overrides object, or null if conversion fails
     */
    @Suppress("UNCHECKED_CAST")
    private fun convertToConfigurationOverrides(overridesMap: Map<String, Any>?): ConfigurationOverrides? {
        if (overridesMap.isNullOrEmpty()) {
            return null
        }

        try {
            val overrideIdentifier = overridesMap["overrideIdentifier"] as? String
            val resourceUri = when (val uriObj = overridesMap["resource"]) {
                is Map<*, *> -> {
                    // Extract URI components from the map structure
                    val scheme = uriObj["scheme"] as? String ?: ""
                    val path = uriObj["path"] as? String ?: ""
                    val authority = uriObj["authority"] as? String ?: ""
                    val query = uriObj["query"] as? String ?: ""
                    val fragment = uriObj["fragment"] as? String ?: ""

                    if (path.isNotEmpty()) {
                        // Create URI instance using URI.from static method
                        val uriComponents = object : URIComponents {
                            override val scheme: String = scheme
                            override val authority: String = authority
                            override val path: String = path
                            override val query: String = query
                            override val fragment: String = fragment
                        }
                        URI.from(uriComponents)
                    } else {
                        null
                    }
                }
                is String -> {
                    try {
                        // Parse URI string using URI.parse static method
                        URI.parse(uriObj)
                    } catch (e: Exception) {
                        logger.warn("Failed to parse URI string: $uriObj", e)
                        null
                    }
                }
                else -> null
            }

            return ConfigurationOverrides(overrideIdentifier, resourceUri)
        } catch (e: Exception) {
            logger.error("Failed to convert configuration overrides: $overridesMap", e)
            return null
        }
    }

    /**
     * Builds a complete configuration key based on base key, overrides, and language scoping.
     * Constructs a unique key that incorporates override identifiers and resource contexts.
     * @param baseKey The base configuration key
     * @param overrides Optional configuration overrides to include in the key
     * @param scopeToLanguage Whether to scope the configuration to a specific language
     * @return The complete configuration key string
     */
    private fun buildConfigurationKey(baseKey: String, overrides: ConfigurationOverrides?, scopeToLanguage: Boolean?): String {
        val keyBuilder = StringBuilder(baseKey)

        // Add override identifier if language scoping is enabled
        overrides?.let {
            it.overrideIdentifier?.let { identifier ->
                if (scopeToLanguage == true) {
                    keyBuilder.append(".").append(identifier)
                }
            }

            // Add resource identifier if URI is provided
            it.resource?.let { uri ->
                keyBuilder.append("@").append(uri.toString().hashCode())
            }
        }

        return keyBuilder.toString()
    }

    /**
     * Retrieves the currently active project in the IDE.
     * @return The active project instance, or null if no project is currently open
     */
    private fun getActiveProject(): Project? {
        val openProjects = ProjectManager.getInstance().openProjects
        return openProjects.firstOrNull { it.isInitialized && !it.isDisposed }
    }

    /**
     * Stores a configuration value in the properties component based on its type.
     * Handles type-specific storage for common data types and falls back to string
     * representation for complex objects.
     * @param properties The properties component to store the value in
     * @param key The configuration key
     * @param value The configuration value to store
     */
    private fun storeValue(properties: PropertiesComponent, key: String, value: Any?) {
        when (value) {
            null -> properties.unsetValue(key)
            is String -> properties.setValue(key, value)
            is Boolean -> properties.setValue(key, value)
            is Int -> properties.setValue(key, value, 0)
            is Float -> properties.setValue(key, value.toString())
            is Double -> properties.setValue(key, value.toString())
            is Long -> properties.setValue(key, value.toString())
            else -> {
                // Convert complex objects to JSON string for storage
                try {
                    properties.setValue(key, value.toString())
                } catch (e: Exception) {
                    logger.error("Failed to serialize configuration value, type: ${value.javaClass.name}", e)
                }
            }
        }
    }

    /**
     * Disposes of resources when the configuration manager is no longer needed.
     * Called when the plugin or component is being unloaded.
     */
    override fun dispose() {
        logger.info("Releasing resources: MainThreadConfiguration")
    }
}
