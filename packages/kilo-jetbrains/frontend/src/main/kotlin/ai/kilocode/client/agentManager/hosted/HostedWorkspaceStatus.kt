package ai.kilocode.client.agentManager.hosted

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.active.ActiveBadge
import ai.kilocode.rpc.dto.HostedWorkspaceStatusDto

/** The row and editor header use the same compute status labels and themed pills. */
internal enum class HostedWorkspaceStatus(private val value: String, private val style: UiStyle.Badge.Style) {
    LOADING("loading", UiStyle.Badge.Secondary),
    // The Marketplace Agents chip is the canonical Kilo green; Cloud Active reuses it verbatim.
    ACTIVE("active", UiStyle.Badge.typeAgent(true)),
    SETTING_UP("settingUp", UiStyle.Badge.Secondary),
    SLEEPING("sleeping", UiStyle.Badge.Secondary),
    STARTING("starting", UiStyle.Badge.Secondary),
    FAILED("failed", UiStyle.Badge.ActivityError),
    STOPPING("stopping", UiStyle.Badge.Secondary),
    STOPPED("stopped", UiStyle.Badge.Secondary),
    DELETING("deleting", UiStyle.Badge.Secondary),
    UNAVAILABLE("unavailable", UiStyle.Badge.ActivityError),
    UNKNOWN("unknown", UiStyle.Badge.Secondary),
    ;

    fun badge(): ActiveBadge = ActiveBadge(
        text = KiloBundle.message("hosted.workspace.status.$value"),
        style = style,
        id = "cloud-compute",
    )

    /**
     * Sandbox boot or teardown. Rows show the same running spinner local sessions use so Cloud work
     * in progress reads the same at a glance; the compute badge still names the phase.
     */
    fun busy(): Boolean = this == STARTING || this == SETTING_UP || this == LOADING || this == STOPPING

    companion object {
        fun of(status: HostedWorkspaceStatusDto?): HostedWorkspaceStatus {
            if (status?.deletionState == "deleting" ||
                (status?.deletion?.started == true && status?.deletion?.completed != true)
            ) {
                return DELETING
            }
            if (status?.deletionState == "deleted") return UNAVAILABLE
            return when (status?.computeStatus) {
                null -> LOADING
                "active", "running" -> ACTIVE
                "setting_up" -> SETTING_UP
                "sleeping" -> SLEEPING
                "starting" -> STARTING
                "failed" -> FAILED
                "stopping" -> STOPPING
                "stopped" -> STOPPED
                "error", "unreachable", "unavailable" -> UNAVAILABLE
                else -> UNKNOWN
            }
        }
    }
}
