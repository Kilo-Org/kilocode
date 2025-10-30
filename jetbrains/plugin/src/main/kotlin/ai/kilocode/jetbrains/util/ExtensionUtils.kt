// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.util

/**
 * Common utility methods for Extension
 */
object ExtensionUtils {
    /**
     * Check whether the Socket server port (Int) or UDS path (String) is valid
     * @param portOrPath Port (Int) or UDS path (String)
     * @return Returns true if valid, otherwise false
     */
    @JvmStatic
    fun isValidPortOrPath(portOrPath: Any?): Boolean {
        return when (portOrPath) {
            is Int -> portOrPath > 0
            is String -> portOrPath.isNotEmpty()
            else -> false
        }
    }
}
