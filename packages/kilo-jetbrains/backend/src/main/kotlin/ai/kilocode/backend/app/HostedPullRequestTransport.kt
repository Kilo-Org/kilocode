package ai.kilocode.backend.app

import ai.kilocode.rpc.dto.HostedPullRequestChecksDto
import ai.kilocode.rpc.dto.HostedPullRequestConversationsDto
import ai.kilocode.rpc.dto.HostedPullRequestMergeabilityDto
import ai.kilocode.rpc.dto.HostedPullRequestRefreshDto
import ai.kilocode.rpc.dto.HostedPullRequestReviewDto
import ai.kilocode.rpc.dto.HostedPullRequestSummaryDto
import ai.kilocode.rpc.dto.HostedWorkspacePullRequestDto
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonObject
import okhttp3.Call
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okio.BufferedSink
import java.io.IOException
import java.util.concurrent.TimeUnit

private const val BUDGET = 180L
private const val LIMIT = 65_536L
private const val INTEGER = 9_007_199_254_740_991L
private const val URL_LIMIT = 2048
private const val TITLE_LIMIT = 1024
private const val DETAIL_LIMIT = 100
private val SHA = Regex("[0-9a-fA-F]{40}")
private val JSON = Json { ignoreUnknownKeys = true }
private val STATES = setOf(
    "available", "no_pr", "signed_out", "rejected", "unreachable", "rate_limited", "unavailable", "unsupported",
)

internal suspend fun pullRequest(
    http: OkHttpClient?,
    base: String?,
    ref: HostedWorkspaceRefDto,
    organizationID: String?,
    refresh: Boolean,
): HostedWorkspacePullRequestDto = withContext(Dispatchers.IO) {
    if (http == null || base == null) return@withContext HostedWorkspacePullRequestDto(ref, "unavailable", null)
    val url = base.toHttpUrl().newBuilder()
        .addPathSegments("kilocode/session-host/workspace")
        .addPathSegment(ref.providerID)
        .addPathSegment(ref.workspaceID)
        .addPathSegment("pull-request")
        .apply {
            if (refresh) addPathSegment("refresh")
            organizationID?.let { addQueryParameter("organizationID", it) }
        }
        .build()
    val client = http.newBuilder()
        .callTimeout(BUDGET, TimeUnit.SECONDS)
        .connectTimeout(BUDGET, TimeUnit.SECONDS)
        .readTimeout(BUDGET, TimeUnit.SECONDS)
        .writeTimeout(BUDGET, TimeUnit.SECONDS)
        .retryOnConnectionFailure(false)
        .followRedirects(false)
        .followSslRedirects(false)
        .build()
    val request = Request.Builder().url(url).apply {
        if (refresh) post(object : RequestBody() {
            override fun contentType() = null
            override fun contentLength() = 0L
            override fun writeTo(sink: BufferedSink) = Unit
            override fun isOneShot() = true
        }) else get()
    }.build()
    request(client.newCall(request), ref)
}

private suspend fun request(call: Call, ref: HostedWorkspaceRefDto): HostedWorkspacePullRequestDto =
    coroutineScope {
        fun failure(state: String) = HostedWorkspacePullRequestDto(ref, state, null)
        // await() covers response headers; keep cancellation wired during bounded body consumption too.
        val guard = launch(start = CoroutineStart.UNDISPATCHED) {
            try {
                awaitCancellation()
            } finally {
                call.cancel()
            }
        }
        try {
            call.await().use { response ->
                if (!response.isSuccessful) return@coroutineScope failure(state(response.code))
                val source = response.body.source()
                if (source.request(LIMIT + 1)) return@coroutineScope failure("unavailable")
                val raw = source.readUtf8()
                val root = JSON.parseToJsonElement(raw).jsonObject
                require(root["refresh"] != JsonNull)
                JSON.decodeFromString<WireResult>(raw).dto(ref)
            }
        } catch (_: IOException) {
            currentCoroutineContext().ensureActive()
            failure("unreachable")
        } catch (_: SerializationException) {
            failure("unavailable")
        } catch (_: IllegalArgumentException) {
            failure("unavailable")
        } finally {
            guard.cancel()
        }
    }

@Suppress("MagicNumber")
private fun state(code: Int): String = when (code) {
    401, 403, 409 -> "rejected"
    404, 405, 501 -> "unsupported"
    429 -> "rate_limited"
    else -> "unavailable"
}

// Backend-local serializers avoid shared-module serialization classloader linkage at runtime.
@Serializable
private data class WireResult(
    val id: WireIdentity,
    val state: String,
    val pullRequest: WireSummary?,
    val refresh: WireRefresh? = null,
) {
    fun dto(ref: HostedWorkspaceRefDto): HostedWorkspacePullRequestDto {
        require(id.providerID == ref.providerID && id.workspaceID == ref.workspaceID)
        require(state in STATES)
        require(state != "available" || pullRequest != null)
        require(state != "no_pr" || pullRequest == null)
        refresh?.let {
            val expected = when (it.status) {
                "refreshed" -> "available"
                "no_pr" -> "no_pr"
                "rate_limited", "throttled" -> "rate_limited"
                "no_integration", "unavailable", "failed" -> "unavailable"
                else -> null
            }
            require(expected != null && state == expected)
        }
        return HostedWorkspacePullRequestDto(
            ref, state, pullRequest?.dto(), refresh?.let { HostedPullRequestRefreshDto(it.status, it.retryAt) },
        )
    }
}

@Serializable
private data class WireIdentity(val providerID: String, val workspaceID: String)

@Serializable
private data class WireRefresh(val status: String, val retryAt: String?)

@Serializable
private data class WireSummary(
    val url: String,
    val number: Long,
    val state: String,
    val title: String?,
    val headSha: String?,
    val lastSyncedAt: String,
    val review: WireReview,
    val checks: WireChecks,
    val conversations: WireConversations,
    val mergeability: WireMergeability,
    val partial: Boolean,
    val unavailable: List<String>,
) {
    fun dto(): HostedPullRequestSummaryDto {
        val link = url.toHttpUrl()
        // Session Host is provider-neutral; adapters enforce provider-specific PR hosts.
        require(link.scheme == "https" && link.username.isEmpty() && link.password.isEmpty())
        require(url.length <= URL_LIMIT && number in 1..INTEGER)
        require(state in setOf("open", "draft", "merged", "closed", "unknown"))
        require(title == null || title.length <= TITLE_LIMIT)
        require(headSha == null || SHA.matches(headSha))
        require(lastSyncedAt.isNotEmpty())
        require(review.decision in setOf(null, "none", "review_required", "approved", "changes_requested"))
        require(listOf(checks.total, checks.passed, checks.failed, checks.pending, checks.skipped, checks.unknown)
            .all { it in 0..INTEGER })
        require(conversations.unresolved == null || conversations.unresolved in 0..INTEGER)
        require(mergeability.state == null || mergeability.state.length <= DETAIL_LIMIT)
        require(unavailable.all { it in setOf("checks", "statuses", "reviews") })
        return HostedPullRequestSummaryDto(
            url, number, state, title, headSha, lastSyncedAt,
            HostedPullRequestReviewDto(review.decision, review.available, review.pending),
            HostedPullRequestChecksDto(
                checks.total, checks.passed, checks.failed, checks.pending, checks.skipped, checks.unknown,
                checks.complete, checks.available,
            ),
            HostedPullRequestConversationsDto(conversations.unresolved, conversations.complete),
            HostedPullRequestMergeabilityDto(mergeability.mergeable, mergeability.state, mergeability.complete),
            partial, unavailable,
        )
    }
}

@Serializable
private data class WireReview(val decision: String?, val available: Boolean, val pending: Boolean)

@Serializable
private data class WireChecks(
    val total: Long,
    val passed: Long,
    val failed: Long,
    val pending: Long,
    val skipped: Long,
    val unknown: Long,
    val complete: Boolean,
    val available: Boolean,
)

@Serializable
private data class WireConversations(val unresolved: Long?, val complete: Boolean)

@Serializable
private data class WireMergeability(val mergeable: Boolean?, val state: String?, val complete: Boolean)
