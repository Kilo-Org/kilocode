// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.core

/**
 * Extension identifier class
 * Corresponds to ExtensionIdentifier in VSCode
 */
class ExtensionIdentifier(val value: String) {
    /**
     * Stores lowercase value for comparison and indexing
     */
    val _lower: String = value.lowercase()

    companion object {
        /**
         * Compare whether two extension identifiers are equal
         * @param a First extension identifier or string
         * @param b Second extension identifier or string
         * @return true if equal, false otherwise
         */
        fun equals(
            a: ExtensionIdentifier?,
            b: ExtensionIdentifier?,
        ): Boolean {
            if (a == null) {
                return b == null
            }
            if (b == null) {
                return false
            }
            return a._lower == b._lower
        }

        /**
         * Compare extension identifier and string for equality
         * @param a Extension identifier
         * @param b String
         * @return true if values are equal (case-insensitive), false otherwise
         */
        fun equals(
            a: ExtensionIdentifier?,
            b: String?,
        ): Boolean {
            if (a == null) {
                return b == null
            }
            if (b == null) {
                return false
            }
            return a._lower == b.lowercase()
        }

        /**
         * Compare string and extension identifier for equality
         * @param a String
         * @param b Extension identifier
         * @return true if values are equal (case-insensitive), false otherwise
         */
        fun equals(
            a: String?,
            b: ExtensionIdentifier?,
        ): Boolean {
            if (a == null) {
                return b == null
            }
            if (b == null) {
                return false
            }
            return a.lowercase() == b._lower
        }

        /**
         * Get key for indexing
         * @param id Extension identifier or string
         * @return Key for indexing
         */
        fun toKey(id: ExtensionIdentifier): String {
            return id._lower
        }

        /**
         * Get key for indexing
         * @param id String
         * @return Key for indexing
         */
        fun toKey(id: String): String {
            return id.lowercase()
        }
    }

    override fun equals(other: Any?): Boolean {
        if (other === this) return true
        if (other !is ExtensionIdentifier) return false
        return _lower == other._lower
    }

    override fun hashCode(): Int {
        return _lower.hashCode()
    }

    override fun toString(): String {
        return value
    }
}
