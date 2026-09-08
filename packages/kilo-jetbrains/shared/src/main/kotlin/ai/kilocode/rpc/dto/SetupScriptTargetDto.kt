package ai.kilocode.rpc.dto

import kotlinx.serialization.Serializable

/** Which interpreter a resolved worktree setup script should be run through. */
@Serializable
enum class SetupScriptKind { POSIX, POWERSHELL, CMD }

@Serializable
data class SetupScriptTargetDto(
    val path: String,
    val displayPath: String,
    val exists: Boolean,
    val kind: SetupScriptKind = SetupScriptKind.POSIX,
)
