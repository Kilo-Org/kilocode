package ai.kilocode.rpc.dto

import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class HostedDiffDtoTest {
    private val ref = HostedWorkspaceRefDto("cloud", "wrk_1")
    private val revision = 9_007_199_254_740_991L
    private val head = "a".repeat(64)
    private val repository = HostedWorkspaceChangeRepositoryDto("", "Kilo-Org/kilocode")
    private val comparison = HostedWorkspaceComparisonDto(
        "main", "b".repeat(40), head, HostedWorkspaceBaseRefFallbackDto("main", "HEAD~1"),
    )

    @Test
    fun `snapshot RPC roundtrip preserves long counts nullable repository raw scope and comparison metadata`() {
        val value = HostedWorkspaceChangesDto(ref, "captured", revision, "2026-11-17T16:04:00.365Z", true, listOf(
            HostedWorkspaceChangeComparisonDto(null, comparison, false, listOf(
                HostedWorkspaceChangeFileDto("src/file.kt", "modified", revision, 0, true, false, false, revision,
                    repository, HostedWorkspaceDiffAvailabilityDto("available"),
                    HostedWorkspaceContentAvailabilityDto("available", "current")),
            )),
        ))
        assertEquals(value, Json.decodeFromString<HostedWorkspaceChangesDto>(Json.encodeToString(value)))
        val refresh = HostedWorkspaceChangesRefreshDto("offline", value)
        assertEquals(refresh, Json.decodeFromString<HostedWorkspaceChangesRefreshDto>(Json.encodeToString(refresh)))
        assertNull(value.comparisons?.single()?.files?.single()?.scope)
    }

    @Test
    fun `file RPC roundtrip preserves one deleted original content side and explicit stale envelope`() {
        val value = HostedWorkspaceChangeFileResultDto("available", HostedWorkspaceFileRecordDto(
            1, revision, "src/file.kt", HostedWorkspaceFileDiffDto("available", "@@ -1 +1 @@\n-old\n+new\n"),
            HostedWorkspaceFileContentDto("available", "deleted-original", "old\n"), "against-base-branch",
        ), "2026-11-17T16:04:00.365Z", comparison, null)
        assertEquals(value, Json.decodeFromString<HostedWorkspaceChangeFileResultDto>(Json.encodeToString(value)))
        val stale = HostedWorkspaceChangeFileResultDto("stale", null, null, null, 5)
        assertEquals(stale, Json.decodeFromString<HostedWorkspaceChangeFileResultDto>(Json.encodeToString(stale)))
    }

    @Test
    fun `PR RPC roundtrips preserve K8 identity and provider omitted patch without K7 badge coercion`() {
        val value = HostedWorkspacePullRequestDiffDto(ref, "linked", null,
            HostedWorkspacePullRequestDiffIdentityDto(revision, "https://github.com/Kilo-Org/kilocode/pull/147",
                "closed", true, head, "main", repository, true), true,
            listOf(HostedWorkspacePullRequestDiffFileDto("new.kt", "old.kt", "renamed", revision, 0, false)))
        assertEquals(value, Json.decodeFromString<HostedWorkspacePullRequestDiffDto>(Json.encodeToString(value)))
        val omitted = HostedWorkspacePullRequestDiffFileResultDto("omitted", "new.kt", null, "provider_omitted", head, null)
        assertEquals(omitted, Json.decodeFromString<HostedWorkspacePullRequestDiffFileResultDto>(Json.encodeToString(omitted)))
    }

    @Test
    fun `mandatory nullable RPC properties cannot be silently supplied by decoder defaults`() {
        required(HostedWorkspaceChangesDto(ref, "not_captured", null, null, false, null), "revision", "capturedAt", "comparisons")
        required(HostedWorkspaceChangeComparisonDto(null, comparison, false, emptyList()), "repository")
        required(HostedWorkspaceChangeFileResultDto("not_captured", null, null, null, null), "file", "capturedAt", "comparison", "currentRevision")
        required(HostedWorkspacePullRequestDiffDto(ref, "not_linked", null, null, false, emptyList()), "reason", "pullRequest")
        required(HostedWorkspacePullRequestDiffFileDto("file.kt", null, "modified", 0, 0, false), "previousPath")
        required(HostedWorkspacePullRequestDiffFileResultDto("not_linked", "file.kt", null, null, null, null), "reason", "omissionReason", "headSha", "patch")
    }

    private inline fun <reified T> required(value: T, vararg fields: String) {
        val root = Json.parseToJsonElement(Json.encodeToString(value)).jsonObject
        fields.forEach { field ->
            assertFailsWith<SerializationException> { Json.decodeFromString<T>(JsonObject(root - field).toString()) }
        }
    }
}
