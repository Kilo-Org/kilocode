// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.git

import com.intellij.openapi.vcs.CheckinProjectPanel
import com.intellij.openapi.vcs.changes.CommitContext
import com.intellij.openapi.vcs.checkin.CheckinHandler
import com.intellij.openapi.vcs.checkin.CheckinHandlerFactory

/**
 * Factory for creating commit message handlers that integrate with JetBrains VCS commit workflow.
 * This factory is registered in plugin.xml to automatically add commit message generation
 * capabilities to all commit dialogs.
 */
class CommitMessageHandlerFactory : CheckinHandlerFactory() {

    /**
     * Creates a new CheckinHandler for the given commit panel.
     * This handler will add UI components to the commit dialog for generating commit messages.
     *
     * @param panel The commit panel where the handler will be integrated
     * @param commitContext The context of the current commit operation
     * @return A new CommitMessageHandler instance
     */
    override fun createHandler(panel: CheckinProjectPanel, commitContext: CommitContext): CheckinHandler {
        return CommitMessageHandler(panel, commitContext)
    }
}
