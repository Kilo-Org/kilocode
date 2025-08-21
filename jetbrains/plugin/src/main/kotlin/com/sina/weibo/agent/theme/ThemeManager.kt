// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package com.sina.weibo.agent.theme

import com.google.gson.Gson
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.google.gson.JsonIOException
import com.intellij.ide.ui.LafManagerListener
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.util.Disposer
import com.intellij.util.messages.MessageBusConnection
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.nio.charset.StandardCharsets
import java.nio.file.Path
import java.nio.file.Paths
import java.util.concurrent.CopyOnWriteArrayList
import javax.swing.UIManager
import kotlin.io.path.notExists
import kotlin.io.path.exists

/**
 * Theme change listener interface
 */
interface ThemeChangeListener {
    /**
     * Called when theme changes
     * @param themeConfig Theme configuration JSON object
     * @param isDarkTheme Whether it's a dark theme
     */
    fun onThemeChanged(themeConfig: JsonObject, isDarkTheme: Boolean)
}

/**
 * Theme manager, responsible for monitoring IDE theme changes and notifying observers
 */
class ThemeManager : Disposable {
    private val logger = Logger.getInstance(ThemeManager::class.java)
    
    // Theme configuration resource directory
    private var themeResourceDir: Path? = null

    // Whether current theme is dark
    private var isDarkTheme = true

    // Current theme configuration cache
    private var currentThemeConfig: JsonObject? = null

    // VSCode theme CSS content cache
    private var themeStyleContent: String? = null

    // Message bus connection
    private var messageBusConnection: MessageBusConnection? = null

    // Theme change listener list
    private val themeChangeListeners = CopyOnWriteArrayList<ThemeChangeListener>()

    // JSON serialization
    private val gson = Gson()
    
    /**
     * Initialize theme manager
     * @param resourceRoot Theme resource root directory
     */
    fun initialize(resourceRoot: String) {
        logger.info("Initializing theme manager, resource root: $resourceRoot")
        
        // Set theme resource directory
        themeResourceDir = Paths.get(resourceRoot, "integrations", "theme", "default-themes")
        
        // Check if resource directory exists
        if (themeResourceDir?.notExists() == true) {
            themeResourceDir = Paths.get(resourceRoot, "integrations", "theme", "default-themes")
            if(themeResourceDir?.notExists() == true) {
                logger.warn("Theme resource directory does not exist: $themeResourceDir")
                return
            }
        }
        
        logger.info("Theme resource directory set: $themeResourceDir")
        
        // Detect current theme at initialization
        updateCurrentThemeStatus()
        
        // Read initial theme configuration
        loadThemeConfig()
        
        // Register theme change listener
        messageBusConnection = ApplicationManager.getApplication().messageBus.connect()
        messageBusConnection?.subscribe(LafManagerListener.TOPIC, LafManagerListener {
            logger.info("Detected IDE theme change")
            val oldIsDarkTheme = isDarkTheme
            val oldConfig = currentThemeConfig
            
            // Update theme status
            updateCurrentThemeStatus()
            
            // Reload configuration if theme type changes
            if (oldIsDarkTheme != isDarkTheme || oldConfig == null) {
                loadThemeConfig()
            }
        })
        
        logger.info("Theme manager initialization completed, current theme: ${if (isDarkTheme) "dark" else "light"}")
    }

    /**
     * Force get whether current theme is dark, independent of initialization
     */
    fun isDarkThemeForce(): Boolean {
        updateCurrentThemeStatus()
        return isDarkTheme()
    }
    
    /**
     * Update current theme status
     */
    private fun updateCurrentThemeStatus() {
        try {
            // Check if current theme is dark via UIManager
            val background = UIManager.getColor("Panel.background")
            if (background != null) {
                val brightness = (0.299 * background.red + 0.587 * background.green + 0.114 * background.blue) / 255.0
                isDarkTheme = brightness < 0.5
                logger.info("Detected ${if (isDarkTheme) "dark" else "light"} theme: brightness is $brightness")
            } else {
                // Default to dark theme
                isDarkTheme = true
                logger.warn("Cannot detect theme brightness, defaulting to dark theme")
            }
        } catch (e: Exception) {
            logger.error("Error updating theme status", e)
            isDarkTheme = true
        }
    }
    
    /**
     * Parse theme string, remove comments
     */
    private fun parseThemeString(themeString: String): JsonObject {
        try {
            // Remove comment lines
            val cleanedContent = themeString
                .split("\n")
                .filter { !it.trim().startsWith("//") }
                .joinToString("\n")
            
            return JsonParser.parseString(cleanedContent).asJsonObject
        } catch (e: Exception) {
            logger.error("Error parsing theme string", e)
            throw e
        }
    }
    
    /**
     * Merge two JSON objects
     */
    private fun mergeJsonObjects(first: JsonObject, second: JsonObject): JsonObject {
        try {
            val result = gson.fromJson(gson.toJson(first), JsonObject::class.java)
            
            for (key in second.keySet()) {
                if (!first.has(key)) {
                    // New value
                    result.add(key, second.get(key))
                    continue
                }
                
                val firstValue = first.get(key)
                val secondValue = second.get(key)
                
                if (firstValue.isJsonArray && secondValue.isJsonArray) {
                    // Merge arrays
                    val resultArray = firstValue.asJsonArray
                    secondValue.asJsonArray.forEach { resultArray.add(it) }
                } else if (firstValue.isJsonObject && secondValue.isJsonObject) {
                    // Recursively merge objects
                    result.add(key, mergeJsonObjects(firstValue.asJsonObject, secondValue.asJsonObject))
                } else {
                    // Other types (boolean, number, string)
                    result.add(key, secondValue)
                }
            }
            
            return result
        } catch (e: Exception) {
            logger.error("Error merging JSON objects", e)
            // If merge fails, directly return a new object containing all properties from both objects
            val result = gson.fromJson(gson.toJson(first), JsonObject::class.java)
            second.entrySet().forEach { result.add(it.key, it.value) }
            return result
        }
    }
    
    /**
     * Convert theme format
     * Implemented according to monaco-vscode-textmate-theme-converter's convertTheme logic
     */
    private fun convertTheme(theme: JsonObject): JsonObject {
        try {
            val result = JsonObject()
            // Set basic properties
            result.addProperty("inherit", false)
            
            // Set base
            var base = "vs-dark" // Default to dark theme
            if (theme.has("type")) {
                base = when (theme.get("type").asString) {
                    "light", "vs" -> "vs"
                    "hc", "high-contrast", "hc-light", "high-contrast-light" -> "hc-black"
                    else -> "vs-dark"
                }
            } else {
                // Set based on currently detected theme
                base = if (isDarkTheme) "vs-dark" else "vs"
            }
            result.addProperty("base", base)
            
            // Copy colors
            if (theme.has("colors")) {
                result.add("colors", theme.get("colors"))
            } else {
                result.add("colors", JsonObject())
            }
            
            // Create rules array
            val monacoThemeRules = JsonParser.parseString("[]").asJsonArray
            result.add("rules", monacoThemeRules)
            
            // Create empty encodedTokensColors array
            result.add("encodedTokensColors", JsonParser.parseString("[]").asJsonArray)
            
            // Process tokenColors
            if (theme.has("tokenColors") && theme.get("tokenColors").isJsonArray) {
                val tokenColors = theme.getAsJsonArray("tokenColors")
                
                for (i in 0 until tokenColors.size()) {
                    val colorElement = tokenColors.get(i)
                    if (colorElement.isJsonObject) {
                        val colorObj = colorElement.asJsonObject
                        
                        if (!colorObj.has("scope") || !colorObj.has("settings")) {
                            continue
                        }
                        
                        val scope = colorObj.get("scope")
                        val settings = colorObj.get("settings")
                        
                        if (scope.isJsonPrimitive && scope.asJsonPrimitive.isString) {
                            // Handle string type scope
                            val scopeStr = scope.asString
                            val scopes = scopeStr.split(",")
                            
                            if (scopes.size > 1) {
                                // If contains multiple scopes (comma separated), process each
                                for (scopeItem in scopes) {
                                    val rule = JsonObject()
                                    
                                    // Copy all properties from settings
                                    if (settings.isJsonObject) {
                                        val settingsObj = settings.asJsonObject
                                        for (entry in settingsObj.entrySet()) {
                                            rule.add(entry.key, entry.value)
                                        }
                                    }
                                    
                                    // Set token property
                                    rule.addProperty("token", scopeItem.trim())
                                    monacoThemeRules.add(rule)
                                }
                            } else {
                                // Single scope
                                val rule = JsonObject()
                                
                                // Copy all properties from settings
                                if (settings.isJsonObject) {
                                    val settingsObj = settings.asJsonObject
                                    for (entry in settingsObj.entrySet()) {
                                        rule.add(entry.key, entry.value)
                                    }
                                }
                                
                                // Set token property
                                rule.addProperty("token", scopeStr.trim())
                                monacoThemeRules.add(rule)
                            }
                        } else if (scope.isJsonArray) {
                            // Handle array type scope
                            val scopeArray = scope.asJsonArray
                            for (j in 0 until scopeArray.size()) {
                                val scopeItem = scopeArray.get(j)
                                if (scopeItem.isJsonPrimitive && scopeItem.asJsonPrimitive.isString) {
                                    val rule = JsonObject()
                                    
                                    // Copy all properties from settings
                                    if (settings.isJsonObject) {
                                        val settingsObj = settings.asJsonObject
                                        for (entry in settingsObj.entrySet()) {
                                            rule.add(entry.key, entry.value)
                                        }
                                    }
                                    
                                    // Set token property
                                    rule.addProperty("token", scopeItem.asString.trim())
                                    monacoThemeRules.add(rule)
                                }
                            }
                        }
                    }
                }
            } else if (theme.has("settings") && theme.get("settings").isJsonArray) {
                // Handle settings (old format)
                val settings = theme.getAsJsonArray("settings")
                
                for (i in 0 until settings.size()) {
                    val settingElement = settings.get(i)
                    if (settingElement.isJsonObject) {
                        val settingObj = settingElement.asJsonObject
                        
                        if (!settingObj.has("scope") || !settingObj.has("settings")) {
                            continue
                        }
                        
                        val scope = settingObj.get("scope")
                        val settingsObj = settingObj.getAsJsonObject("settings")
                        
                        if (scope.isJsonPrimitive && scope.asJsonPrimitive.isString) {
                            // Handle string type scope
                            val scopeStr = scope.asString
                            val scopes = scopeStr.split(",")
                            
                            if (scopes.size > 1) {
                                // If contains multiple scopes (comma separated), process each
                                for (scopeItem in scopes) {
                                    val rule = JsonObject()
                                    
                                    // Copy all properties from settings
                                    for (entry in settingsObj.entrySet()) {
                                        rule.add(entry.key, entry.value)
                                    }
                                    
                                    // Set token property
                                    rule.addProperty("token", scopeItem.trim())
                                    monacoThemeRules.add(rule)
                                }
                            } else {
                                // Single scope
                                val rule = JsonObject()
                                
                                // Copy all properties from settings
                                for (entry in settingsObj.entrySet()) {
                                    rule.add(entry.key, entry.value)
                                }
                                
                                // Set token property
                                rule.addProperty("token", scopeStr.trim())
                                monacoThemeRules.add(rule)
                            }
                        }
                    }
                }
            }
            
            return result
        } catch (e: Exception) {
            logger.error("Error converting theme format", e)
            throw e
        }
    }
    
    /**
     * Read VSCode theme style file from classpath
     * @return Theme CSS content
     */
    private fun loadVscodeThemeStyle(vscodeThemeFile: File): String? {
        try {
            logger.info("Attempting to load VSCode theme style file: ${vscodeThemeFile.absolutePath}")
            val content = vscodeThemeFile.readText(StandardCharsets.UTF_8)
            logger.info("Successfully loaded VSCode theme style, size: ${content.length} bytes")
            return content
        } catch (e: Exception) {
            logger.error("Failed to read VSCode theme style file: ${vscodeThemeFile.absolutePath}", e)
        }
        
        return null
    }
    
    /**
     * Load theme configuration
     */
    private fun loadThemeConfig() {
        if (themeResourceDir?.notExists() == true) {
            logger.warn("Cannot load theme configuration: resource directory does not exist")
            return
        }
        
        try {
            // Select corresponding theme file
            val themeFileName = if (isDarkTheme) "dark_modern.json" else "light_modern.json"
            val vscodeThemeName = if (isDarkTheme) "vscode-theme-dark.css" else "vscode-theme-light.css"
            val themeFile = themeResourceDir?.resolve(themeFileName)?.toFile()
            val vscodeThemeFile = themeResourceDir?.resolve(vscodeThemeName)?.toFile()
            
            if (themeFile?.exists() == true && vscodeThemeFile?.exists() == true) {
                // Read theme file content
                val themeContent = themeFile.readText()
                
                // Parse theme content
                val parsed = parseThemeString(themeContent)
                
                // Handle include field, similar to getTheme.ts logic
                var finalTheme = parsed
                if (parsed.has("include")) {
                    val includeFileName = parsed.get("include").asString
                    val includePath = themeResourceDir?.resolve(includeFileName)
                    
                    if (includePath != null && includePath.exists()) {
                        try {
                            val includeContent = includePath.toFile().readText()
                            val includeTheme = parseThemeString(includeContent)
                            finalTheme = mergeJsonObjects(finalTheme, includeTheme)
                        } catch (e: Exception) {
                            logger.error("Error processing include theme: $includeFileName", e)
                        }
                    }
                }
                
                // Convert theme
                val converted = convertTheme(finalTheme)
                
                // Read VSCode theme style file
                themeStyleContent = loadVscodeThemeStyle(vscodeThemeFile)
                
                // Add style content to converted theme object
                if (themeStyleContent != null) {
                    converted.addProperty("cssContent", themeStyleContent)
                }
                
                // Update cache
                val oldConfig = currentThemeConfig
                currentThemeConfig = converted
                
                logger.info("Loaded and converted theme configuration: $themeFileName")
                
                // Notify listeners when configuration changes
                if (oldConfig?.toString() != converted.toString()) {
                    notifyThemeChangeListeners()
                }
            } else {
                logger.warn("Theme configuration file does not exist: $themeResourceDir")
                logger.warn("Theme configuration file does not exist: $themeFileName")
            }
        } catch (e: IOException) {
            logger.error("Error reading theme configuration", e)
        } catch (e: JsonIOException) {
            logger.error("Error processing theme JSON", e)
        } catch (e: Exception) {
            logger.error("Unknown error occurred during theme configuration loading", e)
        }
    }
    
    /**
     * Notify all theme change listeners
     */
    private fun notifyThemeChangeListeners() {
        val config = currentThemeConfig ?: return
        
        logger.info("Notifying ${themeChangeListeners.size} theme change listeners")
        themeChangeListeners.forEach { listener ->
            try {
                listener.onThemeChanged(config, isDarkTheme)
            } catch (e: Exception) {
                logger.error("Error notifying theme change listener", e)
            }
        }
    }
    
    /**
     * Add theme change listener
     * @param listener Listener
     */
    fun addThemeChangeListener(listener: ThemeChangeListener) {
        themeChangeListeners.add(listener)
        logger.info("Added theme change listener, current listener count: ${themeChangeListeners.size}")
        
        // If theme configuration already exists, immediately notify new listener
        currentThemeConfig?.let {
            try {
                listener.onThemeChanged(it, isDarkTheme)
                logger.info("Notified newly added listener of current theme configuration")
            } catch (e: Exception) {
                logger.error("Error notifying new listener of current theme configuration", e)
            }
        }
    }
    
    /**
     * Remove theme change listener
     * @param listener Listener
     */
    fun removeThemeChangeListener(listener: ThemeChangeListener) {
        themeChangeListeners.remove(listener)
        logger.info("Removed theme change listener, remaining listener count: ${themeChangeListeners.size}")
    }
    
    /**
     * Manually reload theme configuration
     * Will reload and notify listeners even if theme has not changed
     */
    fun reloadThemeConfig() {
        logger.info("Manually reloading theme configuration")
        loadThemeConfig()
    }
    
    /**
     * Get whether current theme is dark
     * @return Whether dark theme
     */
    fun isDarkTheme(): Boolean {
        return isDarkTheme
    }
    
    /**
     * Get current theme configuration JSON object
     * @return Theme configuration JSON object
     */
    fun getCurrentThemeConfig(): JsonObject? {
        return currentThemeConfig
    }
    
    override fun dispose() {
        logger.info("Releasing theme manager resources")
        
        // Clear listener list
        themeChangeListeners.clear()
        
        // Clean up message bus connection
        try {
            messageBusConnection?.disconnect()
        } catch (e: Exception) {
            logger.error("Error disconnecting message bus connection", e)
        }
        messageBusConnection = null
        
        // Reset resources
        themeResourceDir = null
        currentThemeConfig = null
        themeStyleContent = null
        
        // Reset singleton
        resetInstance()
        
        logger.info("Theme manager resources released")
    }
    
    companion object {
        @Volatile
        private var instance: ThemeManager? = null
        
        /**
         * Get theme manager instance
         */
        fun getInstance(): ThemeManager {
            return instance ?: synchronized(this) {
                instance ?: ThemeManager().also { instance = it }
            }
        }
        
        /**
         * Reset theme manager instance
         */
        private fun resetInstance() {
            synchronized(this) {
                instance = null
            }
        }
    }
}