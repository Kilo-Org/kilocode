// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.util

import com.intellij.openapi.diagnostic.Logger

/**
 * Node.js version information
 */
data class NodeVersion(
    val major: Int,
    val minor: Int,
    val patch: Int,
    val original: String,
) {
    /**
     * Compare version numbers
     * @param other Another version
     * @return Negative if less than, 0 if equal, positive if greater than
     */
    fun compareTo(other: NodeVersion): Int {
        return when {
            major != other.major -> major - other.major
            minor != other.minor -> minor - other.minor
            else -> patch - other.patch
        }
    }

    /**
     * Whether it is less than the specified version
     */
    fun isLowerThan(other: NodeVersion): Boolean {
        return compareTo(other) < 0
    }

    /**
     * Whether it is greater than or equal to the specified version
     */
    fun isGreaterOrEqualTo(other: NodeVersion): Boolean {
        return compareTo(other) >= 0
    }

    override fun toString(): String = original
}

/**
 * Node.js version utility class
 */
object NodeVersionUtil {
    private val LOG = Logger.getInstance(NodeVersionUtil::class.java)

    /**
     * Get Node.js version information
     * @param nodePath Path to Node.js executable
     * @return Node.js version information, or null if failed to get
     */
    fun getNodeVersion(nodePath: String): NodeVersion? {
        return try {
            val process = ProcessBuilder(nodePath, "--version").start()
            val output = process.inputStream.bufferedReader().readText().trim()
            process.waitFor()

            parseNodeVersion(output)
        } catch (e: Exception) {
            LOG.warn("Failed to get Node.js version", e)
            null
        }
    }

    /**
     * Parse Node.js version string
     * @param versionOutput Output of Node.js --version command
     * @return Parsed version information, or null if parsing fails
     */
    private fun parseNodeVersion(versionOutput: String): NodeVersion? {
        return try {
            // Node.js version format is usually v20.19.2, parse the full version number
            val versionRegex = Regex("v(\\d+)\\.(\\d+)\\.(\\d+)")
            val matchResult = versionRegex.find(versionOutput.trim())

            if (matchResult != null) {
                val major = matchResult.groupValues[1].toInt()
                val minor = matchResult.groupValues[2].toInt()
                val patch = matchResult.groupValues[3].toInt()
                val nodeVersion = NodeVersion(major, minor, patch, versionOutput.trim())

                LOG.info("Node.js version: $versionOutput, parsed: $major.$minor.$patch")
                nodeVersion
            } else {
                LOG.warn("Failed to parse Node.js version from output: $versionOutput")
                null
            }
        } catch (e: Exception) {
            LOG.warn("Failed to parse Node.js version", e)
            null
        }
    }

    /**
     * Check whether the Node.js version meets the minimum requirement
     * @param nodeVersion Current Node.js version
     * @param minRequiredVersion Minimum required version
     * @return Whether the requirement is met
     */
    fun isVersionSupported(nodeVersion: NodeVersion?, minRequiredVersion: NodeVersion): Boolean {
        return nodeVersion?.isGreaterOrEqualTo(minRequiredVersion) == true
    }
}
