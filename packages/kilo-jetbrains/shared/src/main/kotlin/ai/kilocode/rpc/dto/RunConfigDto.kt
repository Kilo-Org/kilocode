package ai.kilocode.rpc.dto

import kotlinx.serialization.Serializable

@Serializable
data class RunConfigDto(
    val id: String,   // RunnerAndConfigurationSettings.uniqueID — stable per project
    val name: String, // configuration display name
    val type: String, // configuration type display name
    // How the worktree run is executed when it is not a direct transplant, e.g. "Gradle". Null for
    // configs the adapter transplants directly (external-system configs, CLI-style params configs).
    val via: String? = null,
)

@Serializable
data class RunConfigListDto(
    val configs: List<RunConfigDto> = emptyList(),
    val error: String? = null,
    // True when the project has at least one linked external-system root whose build tasks are known,
    // so the worktree can be built. False hides the build actions instead of offering a failing one.
    val buildable: Boolean = false,
)

@Serializable
enum class RunProcessState { RUNNING, STOPPING }

@Serializable
data class RunStateDto(
    val id: String,       // config id ([RunConfigDto.id])
    val name: String,     // display name of the running per-worktree clone
    val worktree: String, // absolute worktree path the process was started for
    val state: RunProcessState = RunProcessState.RUNNING,
    // Whether the platform can force-kill this process once it is [RunProcessState.STOPPING].
    // False for Gradle and other external-system runs: their handler only cancels the build
    // through the tooling API and never signals the forked process, so there is nothing to kill.
    val killable: Boolean = false,
    // True when this row is backed by a scanned orphan process rather than a live ProcessHandler —
    // the external-system handler already terminated, but its forked app JVM is still alive. There
    // is no Run tab behind it, so the popup must not offer "Show Output".
    val orphan: Boolean = false,
)

@Serializable
data class RunResultDto(
    val ok: Boolean = false,
    val error: String? = null,
    // Set when the run started but not exactly as configured — currently only when a framework's own
    // build-system integration declined the configuration and it had to run as a plain JVM
    // application, dropping the framework-specific settings named here (e.g. Spring Boot profiles).
    val warning: String? = null,
)
