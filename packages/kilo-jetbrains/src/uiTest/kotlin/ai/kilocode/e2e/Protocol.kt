package ai.kilocode.e2e

import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.nio.file.Files
import java.nio.file.Path

/** K1 driver/result contract, version 1. Keep these models to the fields the adapter consumes. */
object DriverProtocol {
    const val VERSION = 1

    // K1 requires provenance.clientHash/cliHash to be present even when null, so nulls are encoded
    // for those fields. Assertion.detail must stay absent when null, hence @EncodeDefault(NEVER).
    val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    fun request(path: Path): DriverRequest {
        if (!Files.isRegularFile(path)) throw ProtocolException("driver request not found: $path")
        val text = Files.readString(path)
        val root = runCatching { json.parseToJsonElement(text).jsonObject }.getOrElse {
            throw ProtocolException("driver request is not a JSON object", it)
        }
        val runId = root["runId"]?.jsonPrimitive?.content
            ?: throw ProtocolException("driver request has no runId")
        val scenarioId = root["scenario"]?.jsonObject?.get("id")?.jsonPrimitive?.content
            ?: throw ProtocolException("driver request has no scenario.id")
        val lane = root["scenario"]?.jsonObject?.get("lane")?.jsonPrimitive?.content
            ?: throw ProtocolException("driver request has no scenario.lane")
        val request = runCatching { json.decodeFromString<DriverRequest>(text) }.getOrElse {
            throw ProtocolException("driver request does not match K1 v1 (runId=$runId)", it)
        }
        if (request.schemaVersion != VERSION) {
            throw ProtocolException("unsupported driver request schemaVersion=${request.schemaVersion}")
        }
        if (request.scenario.schemaVersion != VERSION) {
            throw ProtocolException("unsupported scenario schemaVersion=${request.scenario.schemaVersion}")
        }
        if (request.runId != runId || request.scenario.id != scenarioId || request.scenario.lane != lane) {
            throw ProtocolException("driver request fields disagree with its raw JSON")
        }
        return request
    }

    fun descriptor(path: Path): FixtureDescriptor {
        if (!Files.isRegularFile(path)) throw DescriptorException("fixture descriptor not found: $path")
        val descriptor = runCatching {
            json.decodeFromString<FixtureDescriptor>(Files.readString(path))
        }.getOrElse {
            throw DescriptorException("fixture descriptor does not match K1 v1", it)
        }
        if (descriptor.schemaVersion != VERSION) {
            throw DescriptorException("unsupported fixture descriptor schemaVersion=${descriptor.schemaVersion}")
        }
        return descriptor
    }

    fun write(path: Path, result: DriverResult) {
        path.parent?.let { Files.createDirectories(it) }
        Files.writeString(path, json.encodeToString(result))
    }
}

class ProtocolException(message: String, cause: Throwable? = null) : RuntimeException(message, cause)
class DescriptorException(message: String, cause: Throwable? = null) : RuntimeException(message, cause)

@Serializable
data class DriverRequest(
    val schemaVersion: Int,
    val runId: String,
    val runDir: String,
    val descriptorPath: String,
    val artifactsDir: String,
    val scenario: Scenario,
    val project: Project,
)

@Serializable
data class Scenario(
    val schemaVersion: Int,
    val id: String,
    val lane: String,
    val prompt: Prompt,
    val expected: Expected,
    val requires: List<String> = emptyList(),
    val timeoutMs: Long,
)

@Serializable
data class Prompt(val directive: String, val token: String)

@Serializable
data class Expected(
    val ui: List<String> = emptyList(),
    val model: List<String> = emptyList(),
    val terminalTranscriptToken: String,
)

@Serializable
data class Project(val path: String, val branch: String, val commit: String)

@Serializable
data class FixtureDescriptor(
    val schemaVersion: Int,
    val runId: String,
    val lane: String,
    val fakeLlmScope: String = "",
    val origins: Origins,
    val credentials: Credentials,
    val cleanup: Cleanup,
    val state: State,
)

@Serializable
data class Origins(
    val web: String? = null,
    val cloudAgent: String? = null,
    val sessionIngest: String? = null,
    val events: String? = null,
    val gateway: String? = null,
    val fakeLlm: String? = null,
)

@Serializable
data class Credentials(val apiKey: String, val orgId: String? = null)

@Serializable
data class Cleanup(val token: String, val ids: List<CleanupId> = emptyList())

@Serializable
data class CleanupId(val kind: String, val id: String)

@Serializable
data class State(val data: String, val config: String, val state: String, val cache: String)

@Serializable
data class DriverResult(
    val schemaVersion: Int = DriverProtocol.VERSION,
    val runId: String,
    val scenarioId: String,
    val lane: String,
    val driver: DriverInfo,
    val ide: IdeInfo,
    val provenance: Provenance,
    val capabilities: List<String>,
    val outcome: String,
    val startedAt: String,
    val endedAt: String,
    val assertions: List<Assertion>,
    val lastState: Map<String, String>,
    val artifacts: Artifacts,
)

@Serializable data class DriverInfo(val id: String, val version: String)

@Serializable data class IdeInfo(val name: String, val version: String)

@Serializable data class Provenance(val clientHash: String? = null, val cliHash: String? = null)

@Serializable
data class Assertion(
    val name: String,
    val status: String,
    @EncodeDefault(EncodeDefault.Mode.NEVER) val detail: String? = null,
)

@Serializable
data class Artifacts(
    val logs: List<String> = emptyList(),
    val screenshots: List<String> = emptyList(),
    val snapshots: List<String> = emptyList(),
)
