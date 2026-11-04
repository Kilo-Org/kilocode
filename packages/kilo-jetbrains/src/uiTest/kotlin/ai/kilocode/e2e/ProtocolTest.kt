package ai.kilocode.e2e

import org.junit.jupiter.api.Test
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.readText
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue

class ProtocolTest {
    @Test
    fun roundTripsARequest() {
        val json = """
            {
              "schemaVersion": 1,
              "runId": "run-1",
              "runDir": "/tmp/run-1",
              "descriptorPath": "/tmp/run-1/descriptor.json",
              "artifactsDir": "/tmp/run-1/artifacts",
              "scenario": {
                "schemaVersion": 1,
                "id": "session.open",
                "lane": "local",
                "prompt": {"directive": "open", "token": "K1-SESSION-OPEN"},
                "expected": {"ui": ["transcript.visible"], "model": ["session.ready"], "terminalTranscriptToken": "K1-SESSION-OPEN"},
                "requires": ["transcript.read"],
                "timeoutMs": 60000
              },
              "project": {"path": "/tmp/run-1/project", "branch": "main", "commit": "abc"}
            }
        """.trimIndent()
        val dir = Files.createTempDirectory("k1-request")
        val file = dir.resolve("request.json")
        Files.writeString(file, json)
        val request = DriverProtocol.request(file)
        assertEquals("run-1", request.runId)
        assertEquals("session.open", request.scenario.id)
        assertEquals(listOf("transcript.read"), request.scenario.requires)
    }

    @Test
    fun redactsDescriptorSecretsFromResultAndArtifacts() {
        val dir = Files.createTempDirectory("k1-result")
        val artifacts = dir.resolve("artifacts")
        Files.createDirectories(artifacts)
        val request = request(dir, artifacts)
        val descriptor = descriptor(dir)
        val evidence = DriverEvidence(request, descriptor)
        evidence.pass("transcript.visible", "api key ${descriptor.credentials.apiKey} token ${descriptor.cleanup.token}")
        evidence.pass("session.ready")
        evidence.state("note", descriptor.credentials.apiKey)
        evidence.artifact("snapshot", Files.createDirectories(artifacts.resolve("snapshots")).resolve("tree.xml").also {
            Files.writeString(it, "secret ${descriptor.credentials.apiKey}")
        })

        val resultPath = dir.resolve("driver-result.json")
        evidence.write(resultPath)

        val text = resultPath.readText()
        assertFalse(text.contains(descriptor.credentials.apiKey))
        assertFalse(text.contains(descriptor.cleanup.token))
        assertTrue(text.contains("[redacted]"))
        assertTrue(text.contains("\"outcome\":\"passed\""))
        assertTrue(text.contains("snapshots/tree.xml"))

        val log = artifacts.resolve("logs/driver.log").readText()
        assertFalse(log.contains(descriptor.credentials.apiKey))
    }

    @Test
    fun missingExpectedAssertionFailsTheResult() {
        val dir = Files.createTempDirectory("k1-fail")
        val artifacts = dir.resolve("artifacts")
        Files.createDirectories(artifacts)
        val evidence = DriverEvidence(request(dir, artifacts), descriptor(dir))
        evidence.pass("transcript.visible")
        val resultPath = dir.resolve("driver-result.json")
        evidence.write(resultPath)
        assertTrue(resultPath.readText().contains("\"outcome\":\"failed\""))
    }

    private fun request(dir: Path, artifacts: Path) = DriverRequest(
        schemaVersion = 1,
        runId = "run-2",
        runDir = dir.toString(),
        descriptorPath = dir.resolve("descriptor.json").toString(),
        artifactsDir = artifacts.toString(),
        scenario = Scenario(
            schemaVersion = 1,
            id = "session.open",
            lane = "local",
            prompt = Prompt("open", "K1-SESSION-OPEN"),
            expected = Expected(
                ui = listOf("transcript.visible"),
                model = listOf("session.ready"),
                terminalTranscriptToken = "K1-SESSION-OPEN",
            ),
            requires = listOf("transcript.read"),
            timeoutMs = 60_000,
        ),
        project = Project(dir.resolve("project").toString(), "main", "abc"),
    )

    private fun descriptor(dir: Path) = FixtureDescriptor(
        schemaVersion = 1,
        runId = "run-2",
        lane = "local",
        origins = Origins(web = "http://127.0.0.1:1", cloudAgent = "http://127.0.0.1:2"),
        credentials = Credentials("secret-api-key", "secret-org"),
        cleanup = Cleanup("secret-cleanup-token", emptyList()),
        state = State(
            data = dir.resolve("state/data").toString(),
            config = dir.resolve("state/config").toString(),
            state = dir.resolve("state/state").toString(),
            cache = dir.resolve("state/cache").toString(),
        ),
    )
}
