package ai.kilocode.backend.app

import ai.kilocode.rpc.dto.HostedWorkspaceBaseRefFallbackDto
import ai.kilocode.rpc.dto.HostedWorkspaceChangeComparisonDto
import ai.kilocode.rpc.dto.HostedWorkspaceChangeFileDto
import ai.kilocode.rpc.dto.HostedWorkspaceChangeFileResultDto
import ai.kilocode.rpc.dto.HostedWorkspaceChangeRepositoryDto
import ai.kilocode.rpc.dto.HostedWorkspaceChangesDto
import ai.kilocode.rpc.dto.HostedWorkspaceChangesRefreshDto
import ai.kilocode.rpc.dto.HostedWorkspaceComparisonDto
import ai.kilocode.rpc.dto.HostedWorkspaceContentAvailabilityDto
import ai.kilocode.rpc.dto.HostedWorkspaceDiffAvailabilityDto
import ai.kilocode.rpc.dto.HostedWorkspaceFileContentDto
import ai.kilocode.rpc.dto.HostedWorkspaceFileDiffDto
import ai.kilocode.rpc.dto.HostedWorkspaceFileRecordDto
import ai.kilocode.rpc.dto.HostedWorkspacePullRequestDiffDto
import ai.kilocode.rpc.dto.HostedWorkspacePullRequestDiffFileDto
import ai.kilocode.rpc.dto.HostedWorkspacePullRequestDiffFileResultDto
import ai.kilocode.rpc.dto.HostedWorkspacePullRequestDiffIdentityDto
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
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.nullable
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonTransformingSerializer
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okio.BufferedSink
import java.io.IOException
import java.util.concurrent.TimeUnit

private const val BUDGET = 180L
// Budget includes the full patch plus one-sided content; larger responses fail closed instead of truncating.
private const val LIMIT = 16_777_216L
private const val INTEGER = 9_007_199_254_740_991L
private val JSON = Json { ignoreUnknownKeys = true }
private val SHA = Regex("(?:[0-9a-f]{40}|[0-9a-f]{64})")
private val TIME = Regex("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})")
private val SCOPES = setOf("uncommitted", "against-base-branch")
private val OMISSIONS = setOf(
    "binary", "unsupported", "invalid_utf8", "too_large", "line_limit", "budget_exhausted", "inconsistent", "capture_failed",
)
private val REASONS = setOf(
    "no_pull_request", "pull_request_not_found", "head_ref_mismatch", "repository_mismatch", "installation_unavailable",
    "connected_user_required", "github_access_denied", "github_rate_limited", "github_unavailable", "pull_request_changed",
    "unsupported_repository",
)
private val PR_STATES = setOf("linked", "stale", "not_linked", "unverified", "credential_required", "unavailable", "not_github")

/** The message and exception cause never include response bodies, credentials, or provider URLs. */
internal class HostedDiffException : IllegalStateException("Hosted comparison request failed")

internal class HostedDiffTransport(private val http: OkHttpClient?, private val base: String?) {
    suspend fun workspaceChanges(ref: HostedWorkspaceRefDto, organizationID: String?): HostedWorkspaceChangesDto =
        request<WireChanges, HostedWorkspaceChangesDto>(ref, "changes", organizationID) { it.dto(ref) }

    suspend fun refreshWorkspaceChanges(
        ref: HostedWorkspaceRefDto,
        organizationID: String?,
    ): HostedWorkspaceChangesRefreshDto =
        request<DiffRefresh, HostedWorkspaceChangesRefreshDto>(ref, "changes/refresh", organizationID, refresh = true) {
            require(it.status in setOf("refreshed", "offline", "failed"))
            HostedWorkspaceChangesRefreshDto(it.status, it.changes.dto(ref))
        }

    suspend fun workspaceChangeFile(
        ref: HostedWorkspaceRefDto,
        path: String,
        scope: String?,
        expectedRevision: Long,
        organizationID: String?,
    ): HostedWorkspaceChangeFileResultDto = request<WireFileResult, HostedWorkspaceChangeFileResultDto>(
        ref, "changes/file", organizationID,
        query = buildMap {
            path(path)
            require(scope == null || scope in SCOPES)
            revision(expectedRevision)
            put("path", path)
            scope?.let { put("scope", it) }
            put("expectedRevision", expectedRevision.toString())
        },
    ) { it.dto(path, scope, expectedRevision) }

    suspend fun workspacePullRequestDiff(
        ref: HostedWorkspaceRefDto,
        organizationID: String?,
    ): HostedWorkspacePullRequestDiffDto =
        request<WirePull, HostedWorkspacePullRequestDiffDto>(ref, "pull-request-diff", organizationID) { it.dto(ref) }

    suspend fun workspacePullRequestDiffFile(
        ref: HostedWorkspaceRefDto,
        path: String,
        expectedHeadSha: String,
        organizationID: String?,
    ): HostedWorkspacePullRequestDiffFileResultDto = request<WirePullFile, HostedWorkspacePullRequestDiffFileResultDto>(
        ref, "pull-request-diff/file", organizationID,
        query = buildMap {
            path(path)
            require(SHA.matches(expectedHeadSha))
            put("path", path)
            put("expectedHeadSha", expectedHeadSha)
        },
    ) { it.dto(path, expectedHeadSha) }

    private suspend inline fun <reified W, T> request(
        ref: HostedWorkspaceRefDto,
        route: String,
        organizationID: String?,
        refresh: Boolean = false,
        query: Map<String, String> = emptyMap(),
        crossinline decode: (W) -> T,
    ): T = withContext(Dispatchers.IO) {
        try {
            require(http != null && base != null)
            require(Regex("[a-z][a-z0-9-]{0,63}").matches(ref.providerID))
            require(Regex("[A-Za-z0-9_][A-Za-z0-9_.-]{0,254}").matches(ref.workspaceID))
            val origin = base.toHttpUrl()
            require(origin.scheme == "http" && origin.host in setOf("127.0.0.1", "localhost", "::1"))
            require(origin.username.isEmpty() && origin.password.isEmpty() && origin.encodedPath == "/")
            val url = origin.newBuilder()
                .addPathSegments("kilocode/session-host/workspace")
                .addPathSegment(ref.providerID)
                .addPathSegment(ref.workspaceID)
                .addPathSegments(route)
                .apply {
                    organizationID?.let { addQueryParameter("organizationID", it) }
                    query.forEach { (key, value) -> addQueryParameter(key, value) }
                }.build()
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
            val call = client.newCall(request)
            coroutineScope {
                // Keep cancellation connected while consuming the bounded response body as well as headers.
                val guard = launch(start = CoroutineStart.UNDISPATCHED) {
                    try {
                        awaitCancellation()
                    } finally {
                        call.cancel()
                    }
                }
                try {
                    call.await().use { response ->
                        require(response.isSuccessful)
                        val source = response.body.source()
                        require(!source.request(LIMIT + 1))
                        decode(JSON.decodeFromString<W>(source.readUtf8()))
                    }
                } finally {
                    guard.cancel()
                }
            }
        } catch (_: IOException) {
            currentCoroutineContext().ensureActive()
            throw HostedDiffException()
        } catch (_: SerializationException) {
            throw HostedDiffException()
        } catch (_: IllegalArgumentException) {
            throw HostedDiffException()
        }
    }
}

private fun revision(value: Long) = require(value in 1..INTEGER)

private fun path(value: String) {
    require(value.length in 1..4096 && '\u0000' !in value)
    require(value.split('/').none { it.isEmpty() || it == "." || it == ".." })
}

private fun ref(value: String) {
    require(value.length in 1..1024 && !value.startsWith('-') && '\u0000' !in value)
}

// Only module-local serializers are used here; shared DTO serializers have a different runtime classloader.
private object WireInteger : KSerializer<Long> {
    override val descriptor = PrimitiveSerialDescriptor("HostedDiffInteger", PrimitiveKind.LONG)

    override fun deserialize(decoder: Decoder): Long {
        val value = (decoder as JsonDecoder).decodeJsonElement().jsonPrimitive
        require(!value.isString)
        return requireNotNull(value.longOrNull).also { require(it in 0..INTEGER) }
    }

    override fun serialize(encoder: Encoder, value: Long) = encoder.encodeLong(value)
}

// Optional fields use their null default only when absent, never for an explicit JSON null.
private open class WireOptional<T : Any>(serializer: KSerializer<T>) : JsonTransformingSerializer<T?>(serializer.nullable) {
    override fun transformDeserialize(element: JsonElement): JsonElement {
        require(element != JsonNull)
        return element
    }
}

private object WireScope : WireOptional<String>(String.serializer())

private object OptionalFallback : WireOptional<WireFallback>(WireFallback.serializer())

@Serializable
private data class DiffIdentity(val providerID: String, val workspaceID: String) {
    fun check(ref: HostedWorkspaceRefDto) = require(providerID == ref.providerID && workspaceID == ref.workspaceID)
}

@Serializable
private data class WireRepository(val path: String, val repoFullName: String) {
    fun dto(): HostedWorkspaceChangeRepositoryDto {
        require(path.length <= 4096 && repoFullName.length in 1..500)
        return HostedWorkspaceChangeRepositoryDto(path, repoFullName)
    }
}

@Serializable
private data class WireFallback(val requested: String, val used: String) {
    fun dto(): HostedWorkspaceBaseRefFallbackDto {
        ref(requested)
        ref(used)
        return HostedWorkspaceBaseRefFallbackDto(requested, used)
    }
}

@Serializable
private data class WireComparison(
    val baseRef: String,
    val mergeBase: String,
    val head: String,
    @Serializable(with = OptionalFallback::class)
    val baseRefFallback: WireFallback? = null,
) {
    fun dto(): HostedWorkspaceComparisonDto {
        ref(baseRef)
        require(SHA.matches(mergeBase) && SHA.matches(head))
        return HostedWorkspaceComparisonDto(baseRef, mergeBase, head, baseRefFallback?.dto())
    }
}

@Serializable
private data class WireDiff(val status: String, val reason: String? = null, val patch: String? = null) {
    fun check(record: Boolean) {
        require(status in setOf("available", "omitted"))
        if (status == "omitted") {
            require(reason in OMISSIONS && patch == null)
            return
        }
        require(reason == null && if (record) !patch.isNullOrEmpty() else patch == null)
    }
}

@Serializable
private data class WireContent(
    val status: String,
    val source: String? = null,
    val reason: String? = null,
    val text: String? = null,
) {
    fun check(record: Boolean) {
        require(status in setOf("available", "unavailable"))
        if (status == "unavailable") {
            require(reason in OMISSIONS && source == null && text == null)
            return
        }
        require(source in setOf("current", "deleted-original") && reason == null)
        require(if (record) text != null else text == null)
    }
}

@Serializable
private data class WireFile(
    val path: String,
    val status: String,
    @Serializable(with = WireInteger::class)
    val additions: Long,
    @Serializable(with = WireInteger::class)
    val deletions: Long,
    val tracked: Boolean,
    val binary: Boolean,
    val countsComplete: Boolean,
    @Serializable(with = WireInteger::class)
    val revision: Long,
    val repository: WireRepository?,
    val diff: WireDiff,
    val content: WireContent,
    @Serializable(with = WireScope::class)
    val scope: String? = null,
) {
    fun dto(): HostedWorkspaceChangeFileDto {
        path(path)
        require(status in setOf("added", "modified", "deleted"))
        require(additions in 0..INTEGER && deletions in 0..INTEGER)
        revision(revision)
        require(scope == null || scope in SCOPES)
        diff.check(record = false)
        content.check(record = false)
        return HostedWorkspaceChangeFileDto(
            path, status, additions, deletions, tracked, binary, countsComplete, revision, repository?.dto(),
            HostedWorkspaceDiffAvailabilityDto(diff.status, diff.reason),
            HostedWorkspaceContentAvailabilityDto(content.status, content.source, content.reason), scope,
        )
    }
}

@Serializable
private data class WireGroup(
    val repository: WireRepository?,
    val comparison: WireComparison,
    val truncated: Boolean,
    val files: List<WireFile>,
) {
    fun dto() = HostedWorkspaceChangeComparisonDto(
        repository?.dto(), comparison.dto(), truncated, files.map { it.dto() },
    )
}

@Serializable
private data class WireChanges(
    val id: DiffIdentity,
    val status: String,
    @Serializable(with = WireInteger::class)
    val revision: Long?,
    val capturedAt: String?,
    val truncated: Boolean,
    val comparisons: List<WireGroup>?,
) {
    fun dto(ref: HostedWorkspaceRefDto): HostedWorkspaceChangesDto {
        id.check(ref)
        require(status in setOf("captured", "not_captured", "inconsistent"))
        if (status != "captured") {
            require(revision == null && capturedAt == null && comparisons == null && !truncated)
            return HostedWorkspaceChangesDto(ref, status, null, null, false, null)
        }
        require(revision != null && capturedAt != null && !comparisons.isNullOrEmpty())
        revision(revision)
        require(TIME.matches(capturedAt))
        return HostedWorkspaceChangesDto(ref, status, revision, capturedAt, truncated, comparisons.map { it.dto() })
    }
}

@Serializable
private data class DiffRefresh(val status: String, val changes: WireChanges)

@Serializable
private data class WireRecord(
    @Serializable(with = WireInteger::class)
    val schemaVersion: Long,
    @Serializable(with = WireInteger::class)
    val revision: Long,
    val path: String,
    val diff: WireDiff,
    val content: WireContent,
    @Serializable(with = WireScope::class)
    val scope: String? = null,
) {
    fun dto(expected: String, requested: String?, version: Long): HostedWorkspaceFileRecordDto {
        path(path)
        require(schemaVersion == 1L && path == expected && revision == version)
        require(scope == null || scope in SCOPES)
        // An absent request scope has no default: preserve the provider's raw scope.
        require(requested == null || scope == requested)
        diff.check(record = true)
        content.check(record = true)
        return HostedWorkspaceFileRecordDto(
            schemaVersion.toInt(), revision, path, HostedWorkspaceFileDiffDto(diff.status, diff.patch, diff.reason),
            HostedWorkspaceFileContentDto(content.status, content.source, content.text, content.reason), scope,
        )
    }
}

@Serializable
private data class WireFileResult(
    val status: String,
    val file: WireRecord?,
    val capturedAt: String?,
    val comparison: WireComparison?,
    @Serializable(with = WireInteger::class)
    val currentRevision: Long?,
) {
    fun dto(path: String, scope: String?, revision: Long): HostedWorkspaceChangeFileResultDto {
        require(status in setOf("available", "omitted", "not_captured", "no_longer_listed", "stale"))
        require(if (status in setOf("no_longer_listed", "stale")) currentRevision != null else currentRevision == null)
        currentRevision?.let { revision(it) }
        if (status !in setOf("available", "omitted")) {
            require(file == null && capturedAt == null && comparison == null)
            return HostedWorkspaceChangeFileResultDto(status, null, null, null, currentRevision)
        }
        require(file != null && file.diff.status == status && capturedAt != null && comparison != null)
        require(TIME.matches(capturedAt))
        return HostedWorkspaceChangeFileResultDto(status, file.dto(path, scope, revision), capturedAt, comparison.dto(), null)
    }
}

@Serializable
private data class WirePullIdentity(
    @Serializable(with = WireInteger::class)
    val number: Long,
    val url: String,
    val state: String,
    val draft: Boolean,
    val headSha: String,
    val baseRef: String,
    val repository: WireRepository,
    val cacheStale: Boolean,
) {
    fun dto(): HostedWorkspacePullRequestDiffIdentityDto {
        require(number in 1..INTEGER && url.length in 1..2048)
        val link = url.toHttpUrl()
        require(link.scheme == "https" && link.username.isEmpty() && link.password.isEmpty())
        require(state in setOf("open", "closed") && SHA.matches(headSha))
        ref(baseRef)
        return HostedWorkspacePullRequestDiffIdentityDto(
            number, url, state, draft, headSha, baseRef, repository.dto(), cacheStale,
        )
    }
}

@Serializable
private data class WirePullFileMetadata(
    val path: String,
    val previousPath: String?,
    val status: String,
    @Serializable(with = WireInteger::class)
    val additions: Long,
    @Serializable(with = WireInteger::class)
    val deletions: Long,
    val patchAvailable: Boolean,
) {
    fun dto(): HostedWorkspacePullRequestDiffFileDto {
        path(path)
        require(previousPath == null || previousPath.length in 1..4096)
        require(status in setOf("added", "removed", "modified", "renamed", "copied", "changed", "unchanged"))
        require(additions in 0..INTEGER && deletions in 0..INTEGER)
        return HostedWorkspacePullRequestDiffFileDto(path, previousPath, status, additions, deletions, patchAvailable)
    }
}

@Serializable
private data class WirePull(
    val id: DiffIdentity,
    val status: String,
    val reason: String?,
    val pullRequest: WirePullIdentity?,
    val truncated: Boolean,
    val files: List<WirePullFileMetadata>,
) {
    fun dto(ref: HostedWorkspaceRefDto): HostedWorkspacePullRequestDiffDto {
        id.check(ref)
        require(status in PR_STATES && (reason == null || reason in REASONS))
        require((status == "linked") == (pullRequest != null))
        require(status == "linked" || files.isEmpty())
        return HostedWorkspacePullRequestDiffDto(ref, status, reason, pullRequest?.dto(), truncated, files.map { it.dto() })
    }
}

@Serializable
private data class WirePullFile(
    val status: String,
    val path: String,
    val reason: String?,
    val omissionReason: String?,
    val headSha: String?,
    val patch: String?,
) {
    fun dto(expected: String, head: String): HostedWorkspacePullRequestDiffFileResultDto {
        path(path)
        require(path == expected && (reason == null || reason in REASONS))
        require(headSha == null || SHA.matches(headSha))
        when (status) {
            "available" -> require(!patch.isNullOrEmpty() && headSha == head && omissionReason == null)
            "omitted" -> require(patch == null && headSha == head && omissionReason == "provider_omitted")
            else -> require(status in (PR_STATES - "linked" + "not_listed") && patch == null && omissionReason == null)
        }
        return HostedWorkspacePullRequestDiffFileResultDto(status, path, reason, omissionReason, headSha, patch)
    }
}
