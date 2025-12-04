// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.util

import com.intellij.openapi.diagnostic.Logger
import java.net.URI
import java.net.URISyntaxException

/**
 * Proxy configuration utility class
 * Responsible for getting proxy configuration with priority: IDE settings > environment variables
 */
object ProxyConfigUtil {
    private val logger = Logger.getInstance(ProxyConfigUtil::class.java)

    /**
     * Proxy configuration data class
     */
    data class ProxyConfig(
        val proxyUrl: String?,
        val proxyExceptions: String?,
        val pacUrl: String?,
        val source: String,
    ) {
        val hasProxy: Boolean
            get() = !proxyUrl.isNullOrEmpty() || !pacUrl.isNullOrEmpty()
    }

    /**
     * Get proxy configuration
     * Priority: IDE settings > environment variables
     */
    fun getProxyConfig(): ProxyConfig {
        // First check IDE proxy settings
        val ideProxyConfig = getIDEProxyConfig()
        if (ideProxyConfig.hasProxy) {
            logger.info("Using IDE proxy configuration: ${ideProxyConfig.proxyUrl ?: ideProxyConfig.pacUrl}")
            return ideProxyConfig
        }

        // Then check environment variable proxy settings
        val envProxyConfig = getEnvironmentProxyConfig()
        if (envProxyConfig.hasProxy) {
            logger.info("Using environment variable proxy configuration: ${envProxyConfig.proxyUrl}")
            return envProxyConfig
        }

        // No proxy configuration
        logger.info("No proxy configuration found")
        return ProxyConfig(null, null, null, "none")
    }

    /**
     * Get IDE proxy configuration
     *
     * Note: This method uses deprecated HttpConfigurable class that is scheduled for removal.
     * As of IntelliJ Platform 2024.3, this is still the official API and no replacement
     * has been provided yet. The @Suppress annotation is used to acknowledge this deprecation
     * while waiting for JetBrains to provide an alternative API.
     *
     * See: https://youtrack.jetbrains.com/issue/IDEA-307815
     *
     * TODO: Replace with new proxy configuration API when available in future IntelliJ versions
     */
    @Suppress("DEPRECATION")
    private fun getIDEProxyConfig(): ProxyConfig {
        return try {
            val proxyConfig = com.intellij.util.net.HttpConfigurable.getInstance()

            // Check PAC proxy
            if (proxyConfig.USE_PAC_URL) {
                val pacUrl = proxyConfig.PAC_URL
                if (!pacUrl.isNullOrEmpty()) {
                    return ProxyConfig(null, null, pacUrl, "ide-pac")
                }
            }

            // Check HTTP proxy
            if (proxyConfig.USE_HTTP_PROXY) {
                val proxyHost = proxyConfig.PROXY_HOST
                val proxyPort = proxyConfig.PROXY_PORT

                if (!proxyHost.isNullOrEmpty() && proxyPort > 0) {
                    val proxyUrl = "http://$proxyHost:$proxyPort"
                    val proxyExceptions = proxyConfig.PROXY_EXCEPTIONS
                    return ProxyConfig(proxyUrl, proxyExceptions, null, "ide-http")
                }
            }

            ProxyConfig(null, null, null, "ide-none")
        } catch (e: Exception) {
            logger.warn("Failed to get IDE proxy configuration", e)
            ProxyConfig(null, null, null, "ide-error")
        }
    }

    /**
     * Get environment variable proxy configuration
     */
    private fun getEnvironmentProxyConfig(): ProxyConfig {
        return try {
            val httpProxy = System.getenv("HTTP_PROXY") ?: System.getenv("http_proxy")
            val httpsProxy = System.getenv("HTTPS_PROXY") ?: System.getenv("https_proxy")
            val noProxy = System.getenv("NO_PROXY") ?: System.getenv("no_proxy")

            // Prefer HTTPS_PROXY, then HTTP_PROXY
            val proxyUrl = when {
                !httpsProxy.isNullOrEmpty() -> normalizeProxyUrl(httpsProxy)
                !httpProxy.isNullOrEmpty() -> normalizeProxyUrl(httpProxy)
                else -> null
            }

            ProxyConfig(proxyUrl, noProxy, null, "env")
        } catch (e: Exception) {
            logger.warn("Failed to get environment proxy configuration", e)
            ProxyConfig(null, null, null, "env-error")
        }
    }

    /**
     * Normalize proxy URL
     */
    private fun normalizeProxyUrl(url: String): String {
        return try {
            val uri = URI(url)
            when {
                uri.scheme.isNullOrEmpty() -> "http://$url"
                uri.scheme == "http" || uri.scheme == "https" -> url
                else -> "http://$url"
            }
        } catch (e: URISyntaxException) {
            // If URL parsing fails, assume HTTP protocol
            "http://$url"
        }
    }

    /**
     * Get HTTP proxy configuration for initializeConfiguration
     * If using PAC, set http.proxy to pacUrl
     */
    fun getHttpProxyConfigForInitialization(): Map<String, Any>? {
        val proxyConfig = getProxyConfig()
        if (!proxyConfig.hasProxy) {
            return null
        }

        val configMap = mutableMapOf<String, Any>()

        if (!proxyConfig.pacUrl.isNullOrEmpty()) {
            // For PAC proxy, set http.proxy to pacUrl
            configMap["proxy"] = proxyConfig.pacUrl
            configMap["proxySupport"] = "on"
        } else if (!proxyConfig.proxyUrl.isNullOrEmpty()) {
            // For HTTP proxy
            configMap["proxy"] = proxyConfig.proxyUrl
            configMap["proxySupport"] = "on"
        }

        // Add noProxy configuration if proxyExceptions is not null or empty
        if (!proxyConfig.proxyExceptions.isNullOrEmpty()) {
            // Split proxyExceptions string by comma and trim each entry
            val noProxyList = proxyConfig.proxyExceptions
                .split(",")
                .map { it.trim() }
                .filter { it.isNotEmpty() }

            if (noProxyList.isNotEmpty()) {
                configMap["noProxy"] = noProxyList
            }
        }

        return if (configMap.isNotEmpty()) configMap else null
    }

    /**
     * Get proxy configuration for process startup
     * Only set environment variables, no command line arguments
     */
    fun getProxyEnvVarsForProcessStart(): Map<String, String> {
        val proxyConfig = getProxyConfig()
        val envVars = mutableMapOf<String, String>()

        if (!proxyConfig.hasProxy) {
            return emptyMap()
        }

        if (!proxyConfig.pacUrl.isNullOrEmpty()) {
            // For PAC proxy, set PROXY_PAC_URL environment variable
            envVars["PROXY_PAC_URL"] = proxyConfig.pacUrl
        } else if (!proxyConfig.proxyUrl.isNullOrEmpty()) {
            // For HTTP proxy, set HTTP_PROXY and HTTPS_PROXY environment variables
            envVars["HTTP_PROXY"] = proxyConfig.proxyUrl
            envVars["HTTPS_PROXY"] = proxyConfig.proxyUrl
        }

        // Add NO_PROXY environment variable if proxyExceptions is not null or empty
        if (!proxyConfig.proxyExceptions.isNullOrEmpty()) {
            envVars["NO_PROXY"] = proxyConfig.proxyExceptions
        }

        return envVars
    }
}
