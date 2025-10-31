// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.ipc

/**
 * Load estimator interface
 * Corresponds to ILoadEstimator in VSCode
 */
interface ILoadEstimator {
    /**
     * Check if currently in high load state
     * @return true indicates high load
     */
    fun hasHighLoad(): Boolean
}
