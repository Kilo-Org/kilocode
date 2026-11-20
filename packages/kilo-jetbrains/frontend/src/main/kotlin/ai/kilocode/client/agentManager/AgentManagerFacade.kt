package ai.kilocode.client.agentManager

import ai.kilocode.client.ui.active.ActiveItem
import ai.kilocode.rpc.dto.HostedWorkspaceDto
import ai.kilocode.rpc.dto.WorktreeDirtyDto
import ai.kilocode.rpc.dto.WorktreeDto
import ai.kilocode.rpc.dto.WorktreePrDto
import ai.kilocode.rpc.dto.WorktreeStatsDto
import com.intellij.openapi.actionSystem.DataKey
import com.intellij.util.concurrency.annotations.RequiresEdt

sealed interface AgentManagerElement {
    val key: String

    data class Local(val dto: WorktreeDto) : AgentManagerElement {
        override val key: String get() = dto.id
    }

    data class Cloud(val dto: HostedWorkspaceDto) : AgentManagerElement {
        override val key: String get() = dto.ref.key
    }
}

enum class AgentManagerCommand {
    BROWSER, RELOAD, BASE_DIFF, UNCOMMITTED_DIFF, UPDATE_BASE,
    COPY_BRANCH, COPY_PATH, COPY_PR, SHOW_SETUP, RUN_SETUP, MOVE, DELETE,
    PR, REVIEW, CHECKS, COMMENTS,
}

enum class AgentManagerAvailability {
    HIDDEN, DISABLED, ENABLED;

    val visible: Boolean get() = this != HIDDEN
    val enabled: Boolean get() = this == ENABLED

    companion object {
        fun of(enabled: Boolean): AgentManagerAvailability = if (enabled) ENABLED else DISABLED
    }
}

data class AgentManagerDestination(
    val key: String,
    val title: String,
    val color: String? = null,
    val enabled: Boolean = true,
)

data class AgentManagerBadgeState(
    val pr: WorktreePrDto? = null,
    val stats: WorktreeStatsDto? = null,
    val dirty: WorktreeDirtyDto? = null,
    val busy: Boolean = false,
    val enabled: Set<AgentManagerCommand> = emptySet(),
)

/** Owns live policy and dispatch; menu and badge callbacks only retain the clicked element. */
interface AgentManagerFacade {
    @RequiresEdt
    fun availability(element: AgentManagerElement, command: AgentManagerCommand): AgentManagerAvailability

    @RequiresEdt
    fun perform(element: AgentManagerElement, command: AgentManagerCommand, target: String? = null)

    @RequiresEdt
    fun destinations(element: AgentManagerElement): List<AgentManagerDestination>

    @RequiresEdt
    fun badges(element: AgentManagerElement): AgentManagerBadgeState
}

internal interface AgentManagerRow : ActiveItem {
    val element: AgentManagerElement
}

internal object AgentManagerKeys {
    val FACADE: DataKey<AgentManagerFacade> = DataKey.create("kilo.agentManager.facade")
    val ELEMENT: DataKey<AgentManagerElement> = DataKey.create("kilo.agentManager.element")
}
