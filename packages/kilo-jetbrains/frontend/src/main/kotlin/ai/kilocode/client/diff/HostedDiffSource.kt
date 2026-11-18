package ai.kilocode.client.diff

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloHostedService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.vfs.KiloVfsManager
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.ProfileStatusDto
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.util.concurrency.annotations.RequiresEdt
import java.security.MessageDigest
import java.util.HexFormat

internal enum class HostedDiffComparison(val key: String, val scope: String?) {
    COMMITTED("committed", "against-base-branch"),
    UNCOMMITTED("uncommitted", "uncommitted"),
    PULL_REQUEST("pr", null),
    ;

    fun title(): String = KiloBundle.message("diff.editor.hosted.$key.title")

    fun labels(): Pair<String, String> = when (this) {
        COMMITTED -> diffLabels("branch")
        UNCOMMITTED -> diffLabels("local")
        PULL_REQUEST -> KiloBundle.message("diff.editor.hosted.side.prBase") to
            KiloBundle.message("diff.editor.hosted.side.prHead")
    }
}

/** Hosted identity is intentionally unrelated to a local directory or a root/sibling session. */
internal data class HostedDiffSource(
    val ref: HostedWorkspaceRefDto,
    val comparison: HostedDiffComparison,
    val account: String,
    val organization: String?,
) {
    fun params(): Map<String, String> = linkedMapOf(
        "source" to "hosted",
        "workspace" to ref.key,
        "comparison" to comparison.key,
        "account" to account,
    ).apply { organization?.let { put("organization", it) } }

    fun current(state: KiloAppStateDto = service<KiloAppService>().state.value): Boolean =
        state.status == KiloAppStatusDto.READY && state.progress?.profile != ProfileStatusDto.NOT_LOGGED_IN &&
            state.profile?.email?.let { Companion.account(it) } == account &&
            state.profile?.currentOrgId == organization

    fun current(project: Project): Boolean {
        val state = service<KiloAppService>().state.value
        return current(state) && reason(project, state) == null
    }

    // A missing transient profile is unknown, not evidence that the owner changed.
    fun reason(project: Project, state: KiloAppStateDto = service<KiloAppService>().state.value): String? {
        val hosted = project.service<KiloHostedService>()
        if (hosted.state.value.signedOut || state.progress?.profile == ProfileStatusDto.NOT_LOGGED_IN) return "signedOut"
        if (!hosted.enabled()) return "unavailable"
        val profile = state.profile ?: return "signedOut".takeIf { state.status == KiloAppStatusDto.READY }
        if (profile.email.isBlank()) return "signedOut"
        return "identity.changed".takeUnless {
            Companion.account(profile.email) == account && profile.currentOrgId == organization
        }
    }

    companion object {
        private val HASH = Regex("[0-9a-f]{64}")

        fun account(email: String): String = HexFormat.of().formatHex(
            MessageDigest.getInstance("SHA-256").digest(email.toByteArray()),
        )

        fun parse(params: Map<String, String>): HostedDiffSource? {
            if (params["source"] != "hosted") return null
            val ref = HostedWorkspaceRefDto.parse(params["workspace"] ?: return null) ?: return null
            val comparison = HostedDiffComparison.entries.firstOrNull { it.key == params["comparison"] } ?: return null
            val account = params["account"]?.takeIf { it.matches(HASH) } ?: return null
            return HostedDiffSource(ref, comparison, account, params["organization"])
        }
    }
}

@RequiresEdt
internal fun openHostedDiff(project: Project, ref: HostedWorkspaceRefDto, comparison: HostedDiffComparison) {
    if (project.isDisposed) return
    val state = service<KiloAppService>().state.value
    val account = state.profile?.email?.takeIf { it.isNotBlank() } ?: return
    val source = HostedDiffSource(ref, comparison, HostedDiffSource.account(account), state.profile?.currentOrgId)
    if (!source.current(project)) return
    ensureDiffEditorKind()
    project.service<KiloVfsManager>().open(KiloDiffEditorKind.ID, source.params())
}
