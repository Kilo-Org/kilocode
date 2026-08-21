package ai.kilocode.rpc.dto

import kotlinx.serialization.Serializable

@Serializable
data class RunConfigDto(
    val id: String,   // RunnerAndConfigurationSettings.uniqueID — stable per project
    val name: String, // configuration display name
    val type: String, // configuration type display name
)

@Serializable
data class RunConfigListDto(
    val configs: List<RunConfigDto> = emptyList(),
    val error: String? = null,
)

@Serializable
enum class RunProcessState { RUNNING, STOPPING }

@Serializable
data class RunStateDto(
    val id: String,       // config id ([RunConfigDto.id])
    val name: String,     // display name of the running per-worktree clone
    val worktree: String, // absolute worktree path the process was started for
    val state: RunProcessState = RunProcessState.RUNNING,
)

@Serializable
data class RunResultDto(
    val ok: Boolean = false,
    val error: String? = null,
)
