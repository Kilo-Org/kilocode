package ai.kilocode.rpc.dto

import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class HostedDtoTest {
    @Test
    fun `workspace and session identities have distinct discriminators`() {
        val workspace = HostedIDs.workspace("cloud", "wrk_1")
        val session = HostedIDs.session("cloud", "wrk_1", "ses_1")

        assertEquals("cloud" to "wrk_1", HostedIDs.parseWorkspace(workspace))
        assertTrue(HostedIDs.isWorkspace(workspace))
        assertFalse(HostedIDs.isSession(workspace))
        assertEquals(Triple("cloud", "wrk_1", "ses_1"), HostedIDs.parseSession(session))
        assertTrue(HostedIDs.isSession(session))
        assertFalse(HostedIDs.isWorkspace(session))
    }

    @Test
    fun `workspace parser rejects malformed identities`() {
        listOf(
            "",
            "hosted",
            "hosted:cloud",
            "other:cloud:wrk_1",
            "hosted::wrk_1",
            "hosted:   :wrk_1",
            "hosted:cloud:",
            "hosted:cloud:   ",
            "hosted:cloud:wrk_1:ses_1",
        ).forEach { id ->
            assertNull(HostedIDs.parseWorkspace(id), id)
            assertFalse(HostedIDs.isWorkspace(id), id)
        }
    }

    @Test
    fun `PR RPC serialization preserves nullable evidence large counts and original timestamps`() {
        val value = HostedWorkspacePullRequestDto(
            HostedWorkspaceRefDto("cloud", "wrk_1"), "rate_limited",
            HostedPullRequestSummaryDto(
                "https://github.com/Kilo-Org/cloud/pull/142", 9_007_199_254_740_991L, "unknown", null, null,
                "original source timestamp", HostedPullRequestReviewDto(null, false, true),
                HostedPullRequestChecksDto(9_007_199_254_740_991L, 0, 0, 0, 0, 9_007_199_254_740_991L, false, false),
                HostedPullRequestConversationsDto(null, false), HostedPullRequestMergeabilityDto(null, null, false),
                true, listOf("checks", "statuses", "reviews"),
            ),
            HostedPullRequestRefreshDto("throttled", "original retry timestamp"),
        )

        assertEquals(value, Json.decodeFromString<HostedWorkspacePullRequestDto>(Json.encodeToString(value)))
        assertEquals(value.copy(pullRequest = null), Json.decodeFromString<HostedWorkspacePullRequestDto>(Json.encodeToString(value.copy(pullRequest = null))))
        val summary = Json.parseToJsonElement(Json.encodeToString(value.pullRequest)).jsonObject
        listOf("title", "headSha").forEach { key ->
            assertFailsWith<SerializationException> {
                Json.decodeFromString<HostedPullRequestSummaryDto>(JsonObject(summary - key).toString())
            }
        }
        assertFailsWith<SerializationException> { Json.decodeFromString<HostedPullRequestRefreshDto>("""{"status":"failed"}""") }
        assertEquals(HostedPullRequestRefreshDto("failed", null), Json.decodeFromString<HostedPullRequestRefreshDto>("""{"status":"failed","retryAt":null}"""))
    }
}
