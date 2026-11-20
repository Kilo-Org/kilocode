package ai.kilocode.rpc.dto

import kotlinx.serialization.Serializable

@Serializable
data class HostedWorkspaceChangeRepositoryDto(val path: String, val repoFullName: String)

@Serializable
data class HostedWorkspaceBaseRefFallbackDto(val requested: String, val used: String)

@Serializable
data class HostedWorkspaceComparisonDto(
    val baseRef: String,
    val mergeBase: String,
    val head: String,
    val baseRefFallback: HostedWorkspaceBaseRefFallbackDto? = null,
)

@Serializable
data class HostedWorkspaceDiffAvailabilityDto(val status: String, val reason: String? = null)

@Serializable
data class HostedWorkspaceContentAvailabilityDto(
    val status: String,
    val source: String? = null,
    val reason: String? = null,
)

@Serializable
data class HostedWorkspaceChangeFileDto(
    val path: String,
    val status: String,
    val additions: Long,
    val deletions: Long,
    val tracked: Boolean,
    val binary: Boolean,
    val countsComplete: Boolean,
    val revision: Long,
    val repository: HostedWorkspaceChangeRepositoryDto?,
    val diff: HostedWorkspaceDiffAvailabilityDto,
    val content: HostedWorkspaceContentAvailabilityDto,
    val scope: String? = null,
)

@Serializable
data class HostedWorkspaceChangeComparisonDto(
    val repository: HostedWorkspaceChangeRepositoryDto?,
    val comparison: HostedWorkspaceComparisonDto,
    val truncated: Boolean,
    val files: List<HostedWorkspaceChangeFileDto>,
)

@Serializable
data class HostedWorkspaceChangesDto(
    val ref: HostedWorkspaceRefDto,
    val status: String,
    val revision: Long?,
    val capturedAt: String?,
    val truncated: Boolean,
    val comparisons: List<HostedWorkspaceChangeComparisonDto>?,
)

@Serializable
data class HostedWorkspaceChangesRefreshDto(val status: String, val changes: HostedWorkspaceChangesDto)

@Serializable
data class HostedWorkspaceFileDiffDto(
    val status: String,
    val patch: String? = null,
    val reason: String? = null,
)

/** Captured content is one side, never an invented before/after pair. */
@Serializable
data class HostedWorkspaceFileContentDto(
    val status: String,
    val source: String? = null,
    val text: String? = null,
    val reason: String? = null,
)

@Serializable
data class HostedWorkspaceFileRecordDto(
    val schemaVersion: Int,
    val revision: Long,
    val path: String,
    val diff: HostedWorkspaceFileDiffDto,
    val content: HostedWorkspaceFileContentDto,
    val scope: String? = null,
)

@Serializable
data class HostedWorkspaceChangeFileResultDto(
    val status: String,
    val file: HostedWorkspaceFileRecordDto?,
    val capturedAt: String?,
    val comparison: HostedWorkspaceComparisonDto?,
    val currentRevision: Long?,
)

@Serializable
data class HostedWorkspacePullRequestDiffIdentityDto(
    val number: Long,
    val url: String,
    val state: String,
    val draft: Boolean,
    val headSha: String,
    val baseRef: String,
    val repository: HostedWorkspaceChangeRepositoryDto,
    val cacheStale: Boolean,
)

@Serializable
data class HostedWorkspacePullRequestDiffFileDto(
    val path: String,
    val previousPath: String?,
    val status: String,
    val additions: Long,
    val deletions: Long,
    val patchAvailable: Boolean,
)

@Serializable
data class HostedWorkspacePullRequestDiffDto(
    val ref: HostedWorkspaceRefDto,
    val status: String,
    val reason: String?,
    val pullRequest: HostedWorkspacePullRequestDiffIdentityDto?,
    val truncated: Boolean,
    val files: List<HostedWorkspacePullRequestDiffFileDto>,
)

@Serializable
data class HostedWorkspacePullRequestDiffFileResultDto(
    val status: String,
    val path: String,
    val reason: String?,
    val omissionReason: String?,
    val headSha: String?,
    val patch: String?,
)
