package ai.kilocode.client.agentManager.hosted

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.list.ActiveListBadge
import ai.kilocode.rpc.dto.HostedWorkspaceStatusDto

/** The row and editor header use the same compute status labels and themed pills. */
internal enum class HostedWorkspaceStatus(private val value: String, private val style: UiStyle.Badge.Style) {
    LOADING("loading", UiStyle.Badge.Secondary),
    // The Marketplace Agents chip is the canonical Kilo green; Cloud Active reuses it verbatim.
    ACTIVE("active", UiStyle.Badge.typeAgent(true)),
    SETTING_UP("settingUp", UiStyle.Badge.Secondary),
    SLEEPING("sleeping", UiStyle.Badge.Secondary),
    STARTING("starting", UiStyle.Badge.Secondary),
    STOPPING("stopping", UiStyle.Badge.Secondary),
    STOPPED("stopped", UiStyle.Badge.Secondary),
    UNAVAILABLE("unavailable", UiStyle.Badge.ActivityError),
    UNKNOWN("unknown", UiStyle.Badge.Secondary),
    ;

    fun badge(): ActiveListBadge = ActiveListBadge(
        text = KiloBundle.message("hosted.workspace.status.$value"),
        style = style,
        id = "cloud-compute",
    )

    companion object {
        fun of(status: HostedWorkspaceStatusDto?): HostedWorkspaceStatus = when (status?.computeStatus) {
            null -> LOADING
            "active", "running" -> ACTIVE
            "setting_up" -> SETTING_UP
            "sleeping" -> SLEEPING
            "starting" -> STARTING
            "stopping" -> STOPPING
            "stopped" -> STOPPED
            "error", "unreachable", "unavailable" -> UNAVAILABLE
            else -> UNKNOWN
        }
    }
}
