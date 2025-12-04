// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.ipc.proxy.interfaces

/**
 * Extension host configuration service interface
 * Corresponds to ExtHostConfiguration in VSCode
 */
interface ExtHostConfigurationProxy {
    /**
     * Initialize configuration
     * @param configModel Configuration model
     */
    fun initializeConfiguration(configModel: Map<String, Any?>)

    /**
     * Update configuration
     * @param configModel Configuration model
     */
    fun updateConfiguration(configModel: Map<String, Any?>)

    /**
     * Get configuration
     * @param key Configuration key
     * @param section Configuration section
     * @param scopeToLanguage Whether to scope to language
     * @return Configuration value
     */
    fun getConfiguration(key: String, section: String?, scopeToLanguage: Boolean): Any?
}
