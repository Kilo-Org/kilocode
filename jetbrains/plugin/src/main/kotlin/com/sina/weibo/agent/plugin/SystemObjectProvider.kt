// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package com.sina.weibo.agent.plugin

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import java.util.concurrent.ConcurrentHashMap

/**
 * System Object Provider
 * Provides unified access to IDEA system objects
 */
object SystemObjectProvider {
    private val logger = Logger.getInstance(SystemObjectProvider::class.java)
    
        // Mapping for storing system objects
        private val systemObjects = ConcurrentHashMap<String, Any>()

    
        /**
         * System object keys
         */
    object Keys {
        const val APPLICATION = "application"
            // More system object keys can be added
    }
    
        /**
         * Initialize the system object provider
         * @param project current project
         */
    fun initialize(project: Project) {
        logger.info("Initializing SystemObjectProvider with project: ${project.name}")

        register(Keys.APPLICATION, ApplicationManager.getApplication())
    }
    
        /**
         * Register a system object
         * @param key object key
         * @param obj object instance
         */
    fun register(key: String, obj: Any) {
        systemObjects[key] = obj
        logger.debug("Registered system object: $key")
    }
    
        /**
         * Get a system object
         * @param key object key
         * @return object instance or null
         */
    @Suppress("UNCHECKED_CAST")
    fun <T> get(key: String): T? {
        return systemObjects[key] as? T
    }
    

        /**
         * Clean up resources
         */
    fun dispose() {
        logger.info("Disposing SystemObjectProvider")
        systemObjects.clear()
    }
} 