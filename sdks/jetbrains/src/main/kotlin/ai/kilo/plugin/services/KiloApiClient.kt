package ai.kilo.plugin.services

import ai.kilo.plugin.model.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

/**
 * HTTP client for communicating with the Kilo server API.
 * Uses Java's built-in HttpClient to avoid Ktor version conflicts with IntelliJ.
 */
class KiloApiClient(
    private val baseUrl: String,
    private val directory: String
) {
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        encodeDefaults = false
        explicitNulls = false
    }

    private val client: HttpClient = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(10))
        .build()

    private fun buildUrl(path: String, params: Map<String, Any?> = emptyMap()): URI {
        val allParams = params + ("directory" to directory)
        val queryString = allParams
            .filterValues { it != null }
            .map { (k, v) -> "${URLEncoder.encode(k, Charsets.UTF_8)}=${URLEncoder.encode(v.toString(), Charsets.UTF_8)}" }
            .joinToString("&")
        
        val url = if (queryString.isNotEmpty()) "$baseUrl$path?$queryString" else "$baseUrl$path"
        return URI.create(url)
    }

    private fun requestBuilder(uri: URI): HttpRequest.Builder {
        return HttpRequest.newBuilder(uri)
            .header("Content-Type", "application/json")
            .header("x-opencode-directory", directory)
            .timeout(Duration.ofSeconds(60))
    }

    private suspend fun <T> get(path: String, params: Map<String, Any?> = emptyMap(), deserializer: (String) -> T): T {
        return withContext(Dispatchers.IO) {
            val request = requestBuilder(buildUrl(path, params))
                .GET()
                .build()
            val response = client.send(request, HttpResponse.BodyHandlers.ofString())
            if (response.statusCode() !in 200..299) {
                throw RuntimeException("HTTP ${response.statusCode()}: ${response.body()}")
            }
            deserializer(response.body())
        }
    }

    private suspend fun <T> post(path: String, jsonBody: String = "{}", params: Map<String, Any?> = emptyMap(), deserializer: (String) -> T): T {
        return withContext(Dispatchers.IO) {
            val request = requestBuilder(buildUrl(path, params))
                .POST(HttpRequest.BodyPublishers.ofString(jsonBody))
                .build()
            val response = client.send(request, HttpResponse.BodyHandlers.ofString())
            if (response.statusCode() !in 200..299) {
                throw RuntimeException("HTTP ${response.statusCode()}: ${response.body()}")
            }
            deserializer(response.body())
        }
    }

    private suspend fun <T> patch(path: String, jsonBody: String = "{}", params: Map<String, Any?> = emptyMap(), deserializer: (String) -> T): T {
        return withContext(Dispatchers.IO) {
            val request = requestBuilder(buildUrl(path, params))
                .method("PATCH", HttpRequest.BodyPublishers.ofString(jsonBody))
                .build()
            val response = client.send(request, HttpResponse.BodyHandlers.ofString())
            if (response.statusCode() !in 200..299) {
                throw RuntimeException("HTTP ${response.statusCode()}: ${response.body()}")
            }
            deserializer(response.body())
        }
    }

    private suspend fun <T> delete(path: String, params: Map<String, Any?> = emptyMap(), deserializer: (String) -> T): T {
        return withContext(Dispatchers.IO) {
            val request = requestBuilder(buildUrl(path, params))
                .DELETE()
                .build()
            val response = client.send(request, HttpResponse.BodyHandlers.ofString())
            if (response.statusCode() !in 200..299) {
                throw RuntimeException("HTTP ${response.statusCode()}: ${response.body()}")
            }
            deserializer(response.body())
        }
    }

    private suspend fun postNoResponse(path: String, jsonBody: String = "{}", params: Map<String, Any?> = emptyMap()) {
        withContext(Dispatchers.IO) {
            val request = requestBuilder(buildUrl(path, params))
                .POST(HttpRequest.BodyPublishers.ofString(jsonBody))
                .build()
            val response = client.send(request, HttpResponse.BodyHandlers.ofString())
            if (response.statusCode() !in 200..299) {
                throw RuntimeException("HTTP ${response.statusCode()}: ${response.body()}")
            }
        }
    }

    // ==================== Health ====================

    suspend fun health(): HealthResponse {
        return get("/global/health", emptyMap()) { json.decodeFromString(it) }
    }

    // ==================== Sessions ====================

    suspend fun listSessions(
        roots: Boolean = true,
        limit: Int? = null,
        search: String? = null
    ): List<Session> {
        val params = mutableMapOf<String, Any?>("roots" to roots)
        limit?.let { params["limit"] = it }
        search?.let { params["search"] = it }
        return get("/session", params) { json.decodeFromString(it) }
    }

    suspend fun getSession(sessionId: String): Session {
        return get("/session/$sessionId") { json.decodeFromString(it) }
    }

    suspend fun createSession(
        parentId: String? = null,
        title: String? = null
    ): Session {
        val body = json.encodeToString(CreateSessionRequest(parentID = parentId, title = title))
        return post("/session", body) { json.decodeFromString(it) }
    }

    suspend fun updateSession(
        sessionId: String,
        title: String? = null,
        archived: Long? = null
    ): Session {
        val body = json.encodeToString(UpdateSessionRequest(
            title = title,
            time = archived?.let { UpdateSessionTime(archived = it) }
        ))
        return patch("/session/$sessionId", body) { json.decodeFromString(it) }
    }

    suspend fun deleteSession(sessionId: String): Boolean {
        return delete("/session/$sessionId") { json.decodeFromString(it) }
    }

    suspend fun abortSession(sessionId: String): Boolean {
        return post("/session/$sessionId/abort") { json.decodeFromString(it) }
    }

    suspend fun getSessionStatus(): Map<String, SessionStatus> {
        return get("/session/status") { json.decodeFromString(it) }
    }

    // ==================== Messages ====================

    suspend fun getMessages(sessionId: String, limit: Int? = null): List<MessageWithParts> {
        val params = mutableMapOf<String, Any?>()
        limit?.let { params["limit"] = it }
        return get("/session/$sessionId/message", params) { json.decodeFromString(it) }
    }

    suspend fun sendMessage(
        sessionId: String,
        text: String,
        model: ModelRef? = null,
        agent: String? = null
    ): String {
        val parts = listOf(TextOnlyPromptPart(text = text))
        val body = if (model != null || agent != null) {
            json.encodeToString(SendMessageRequestFull(parts = parts, model = model, agent = agent))
        } else {
            json.encodeToString(SendMessageRequest(parts = parts))
        }
        return post("/session/$sessionId/message", body) { it }
    }

    suspend fun sendMessageAsync(
        sessionId: String,
        text: String,
        model: ModelRef? = null,
        agent: String? = null
    ) {
        val parts = listOf(TextOnlyPromptPart(text = text))
        val body = if (model != null || agent != null) {
            json.encodeToString(SendMessageRequestFull(parts = parts, model = model, agent = agent))
        } else {
            json.encodeToString(SendMessageRequest(parts = parts))
        }
        postNoResponse("/session/$sessionId/prompt_async", body)
    }

    suspend fun sendMessageAsyncMixed(
        sessionId: String,
        parts: List<PromptPart>,
        model: ModelRef? = null,
        agent: String? = null
    ) {
        val body = buildMixedPartsRequestJson(parts, model, agent).toString()
        postNoResponse("/session/$sessionId/prompt_async", body)
    }

    // ==================== Session Operations ====================

    suspend fun forkSession(sessionId: String, messageId: String? = null): Session {
        val body = json.encodeToString(ForkSessionRequest(messageID = messageId))
        return post("/session/$sessionId/fork", body) { json.decodeFromString(it) }
    }

    suspend fun revertMessage(sessionId: String, messageId: String, restoreFiles: Boolean = false): Session {
        val body = json.encodeToString(RevertMessageRequest(messageID = messageId, restoreFiles = restoreFiles))
        return post("/session/$sessionId/revert", body) { json.decodeFromString(it) }
    }

    suspend fun unrevertSession(sessionId: String): Session {
        return post("/session/$sessionId/unrevert") { json.decodeFromString(it) }
    }

    suspend fun getSessionDiff(sessionId: String, messageId: String? = null): List<FileDiff> {
        val params = mutableMapOf<String, Any?>()
        messageId?.let { params["messageID"] = it }
        return get("/session/$sessionId/diff", params) { json.decodeFromString(it) }
    }

    suspend fun getSessionTodos(sessionId: String): List<Todo> {
        return get("/session/$sessionId/todo") { json.decodeFromString(it) }
    }

    // ==================== Permissions ====================

    suspend fun listPermissions(): List<PermissionRequest> {
        return get("/permission") { json.decodeFromString(it) }
    }

    suspend fun replyPermission(requestId: String, reply: String, message: String? = null): Boolean {
        val body = json.encodeToString(PermissionReplyRequest(reply = reply, message = message))
        return post("/permission/$requestId/reply", body) { json.decodeFromString(it) }
    }

    // ==================== Questions ====================

    suspend fun listQuestions(): List<QuestionRequest> {
        return get("/question") { json.decodeFromString(it) }
    }

    suspend fun replyQuestion(requestId: String, answers: List<List<String>>): Boolean {
        val body = json.encodeToString(QuestionReplyRequest(answers = answers))
        return post("/question/$requestId/reply", body) { json.decodeFromString(it) }
    }

    suspend fun rejectQuestion(requestId: String): Boolean {
        return post("/question/$requestId/reject") { json.decodeFromString(it) }
    }

    // ==================== Providers & Models ====================

    suspend fun listProviders(): ProviderListResponse {
        return get("/provider") { json.decodeFromString(it) }
    }

    suspend fun listAgents(): List<Agent> {
        return get("/agent") { json.decodeFromString(it) }
    }

    // ==================== Commands ====================

    suspend fun listCommands(): List<Command> {
        return get("/command") { json.decodeFromString(it) }
    }

    // ==================== Project ====================

    suspend fun getCurrentProject(): Project {
        return get("/project/current") { json.decodeFromString(it) }
    }

    suspend fun listProjects(): List<Project> {
        return get("/project") { json.decodeFromString(it) }
    }

    // ==================== File Operations ====================

    suspend fun searchFiles(query: String, limit: Int = 50): List<String> {
        return get("/find/file", mapOf("query" to query, "limit" to limit)) { json.decodeFromString(it) }
    }

    // ==================== VCS ====================

    suspend fun getVcsInfo(): VcsInfo {
        return get("/vcs") { json.decodeFromString(it) }
    }

    // ==================== Paths ====================

    suspend fun getPaths(): PathInfo {
        return get("/path") { json.decodeFromString(it) }
    }

    /**
     * Get the SSE event stream URL.
     */
    fun getEventStreamUrl(): String {
        return "$baseUrl/event?directory=$directory"
    }

    fun close() {
        // Java HttpClient doesn't need explicit closing
    }
}
