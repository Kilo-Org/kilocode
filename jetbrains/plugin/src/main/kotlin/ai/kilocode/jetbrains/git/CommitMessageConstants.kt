// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.git

/**
 * Shared constants for Git commit message generation functionality.
 */
object CommitMessageConstants {
    /**
     * VSCode extension command ID for external commit message generation.
     */
    const val EXTERNAL_COMMAND_ID = "kilo-code.jetbrains.generateCommitMessage"
    
    /**
     * Default timeout in milliseconds for commit message generation requests.
     */
    const val RPC_TIMEOUT_MS = 30000L
}
