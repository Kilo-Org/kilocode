package ai.kilocode.e2e

import com.intellij.driver.sdk.application.fullProductName
import com.intellij.driver.sdk.ui.components.UiComponent
import com.intellij.ide.starter.driver.runIdeTest
import com.intellij.ide.starter.ide.IDERemDevTestContext
import com.intellij.ide.starter.ide.IDETestContext
import com.intellij.ide.starter.ide.IdeProductProvider
import com.intellij.ide.starter.junit5.RemoteDevRun
import com.intellij.ide.starter.models.TestCase
import com.intellij.ide.starter.plugins.PluginConfigurator
import com.intellij.ide.starter.project.LocalProjectInfo
import com.intellij.ide.starter.runner.Starter
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Timeout
import org.junit.jupiter.api.extension.ExtendWith
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.TimeUnit
import kotlin.time.Duration.Companion.minutes

/**
 * Headful Starter/Driver adapter for K1. One named watchdog owns every wait; a failed
 * run still writes a K1 DriverResult so the coordinator can report driver_failed with evidence.
 */
@ExtendWith(RemoteDevRun::class)
@Timeout(value = 45, unit = TimeUnit.MINUTES)
class JetBrainsDriverTest {
    private val watchdog = Watchdog("jetbrains-driver", 5.minutes)

    @OptIn(ExperimentalSerializationApi::class)
    private val jsonc = Json {
        allowComments = true
        allowTrailingComma = true
    }

    @Test
    fun drive() {
        val requestPath = required("kilo.e2e.request")
        val resultPath = Path.of(required("kilo.e2e.result"))
        val request = DriverProtocol.request(Path.of(requestPath))

        val descriptorPath = Path.of(request.descriptorPath)
        val descriptor = runCatching { DriverProtocol.descriptor(descriptorPath) }.getOrElse { error ->
            val evidence = DriverEvidence(request, null)
            evidence.fail("descriptor.valid", actionable(error))
            evidence.write(resultPath)
            return
        }
        val evidence = DriverEvidence(request, descriptor)
        evidence.log("run=${request.runId} scenario=${request.scenario.id} lane=${request.scenario.lane}")

        seedModel(descriptor, evidence)
        val preflight = preflight(request, evidence)
        if (!preflight) {
            evidence.write(resultPath)
            return
        }

        if (isTranscriptScenario(request) && request.scenario.lane == "cloud") {
            if (!setOrigin(request.project.path, descriptor.project.gitUrl, evidence)) {
                evidence.write(resultPath)
                return
            }
        }

        val testName = "kilo-${request.runId}"
        var context: IDETestContext? = null
        try {
            val ideVersion = System.getProperty("kilo.e2e.ideVersion")?.takeIf { it.isNotBlank() } ?: "2026.1"
            val testCase = TestCase(
                IdeProductProvider.IU,
                LocalProjectInfo(Path.of(request.project.path)),
            ).useRelease(ideVersion)
            val started = Starter.newContext(testName, testCase)
            val split = started as? IDERemDevTestContext
                ?: error("Starter did not create a split-mode context; RemoteDevRun is not active")
            val isolatedHome = Path.of(request.runDir, "home")
            Files.createDirectories(isolatedHome)
            split.applyVMOptionsPatch {
                withXmx(4096)
                addSystemProperty("user.home", isolatedHome.toString())
                addSystemProperty("idea.is.internal", "true")
                addSystemProperty("idea.trust.all.projects", "true")
                addSystemProperty("idea.suppress.statistics.report", true)
                addSystemProperty("feature.usage.event.log.send.on.ide.close", false)
                addSystemProperty("vcs.log.index.enable", false)
            }
            context = split

            val plugin = Path.of(required("kilo.e2e.pluginArchive"))
            PluginConfigurator(split).installPluginFromPath(plugin)
            PluginConfigurator(split.frontendIDEContext).installPluginFromPath(plugin)
            evidence.log("installed plugin in backend and frontend contexts from ${plugin.fileName}")

            split.runIdeTest(
                testName = testName,
                timeout = 20.minutes,
                onTestComplete = { copyIdeLogs(split, testName, evidence) },
                onTestFailure = { failed, _ ->
                    copyIdeLogs(failed, testName, evidence)
                },
            ) {
                evidence.ideName = fullProductName
                evidence.ideVersion = getProductVersion().asString
                evidence.state("ide.name", evidence.ideName)
                evidence.state("ide.version", evidence.ideVersion)

                val ide = KiloIdePage(this, watchdog, evidence)
                if (isRemDevMode) evidence.pass("ide.split-mode", "frontend driver")
                else evidence.fail("ide.split-mode", "driver is not a frontend split-mode driver")

                if (ide.isDispatchThread()) evidence.pass("ide.edt", "Application.isDispatchThread")
                else evidence.fail("ide.edt", "remote call did not run on the EDT")

                assertEnvironment(ide, descriptor, request, evidence)

                val project = ide.project()
                val toolWindow = KiloToolWindowPage(this, watchdog)
                val window = toolWindow.open(project)
                evidence.pass("kilo.tool-window.visible", KILO_TOOL_WINDOW_ID)
                evidence.state("toolwindow.visible", window.isVisible())

                toolWindow.select(window, "Chat")
                val transcript = TranscriptPage(ide, watchdog)
                transcript.awaitVisible(toolWindow, window)
                evidence.pass("kilo.chat.visible", "Chat content")
                evidence.state("chat.visible", true)

                toolWindow.select(window, "Agents")
                AgentManagerPage(ide, watchdog).awaitVisible()
                evidence.pass("kilo.agent-manager.visible", "Agents content")
                evidence.state("agentmanager.visible", true)

                ide.snapshot("kilo-agent-manager", window)
                ide.screenshot("kilo-agent-manager")

                toolWindow.select(window, "Chat")
                transcript.awaitVisible(toolWindow, window)
                ide.snapshot("kilo-chat", window)
                ide.screenshot("kilo-chat")

                val frontend = runCatching { ide.frontend().getVersion() }
                if (frontend.isSuccess) {
                    evidence.pass("plugin.frontend", "KiloAppService resolved in the frontend classloader")
                    frontend.getOrNull()?.takeIf { it.isNotBlank() }?.let {
                        evidence.state("plugin.frontend.version", it)
                    }
                } else {
                    evidence.fail("plugin.frontend", actionable(frontend.exceptionOrNull()!!))
                }

                val cli = ide.cli()
                val pinned = cli.pinned()
                evidence.state("cli.pinned", pinned)
                if (!pinned) evidence.pass("cli.local", "KiloProps.pinned=false")
                else evidence.fail("cli.local", "the IDE loaded a pinned/released CLI")

                val version = cli.cliVersion()
                if (!version.isNullOrBlank()) {
                    evidence.state("cli.version", version)
                    evidence.pass("cli.version", version)
                } else {
                    evidence.fail("cli.version", "KiloProps.cliVersion() was null")
                }

                val backend = ide.backend()
                val port = watchdog.value("local CLI port", timeout = 3.minutes) {
                    backend.getPort().takeIf { it > 0 }
                }
                evidence.state("cli.port", port)
                evidence.pass("cli.ready", "port=$port")
                evidence.pass("plugin.backend", "KiloBackendAppService")

                if (frontend.isSuccess) {
                    evidence.pass("plugin.both-classloaders", "frontend and backend services resolved")
                } else {
                    evidence.fail("plugin.both-classloaders", "frontend service did not resolve")
                }

                evidence.state("scenario.id", request.scenario.id)
                evidence.state("scenario.lane", request.scenario.lane)

                if (isTranscriptSessionOpen(request)) {
                    openSession(request, descriptor, ide, toolWindow, window, evidence)
                } else if (isPromptStream(request)) {
                    promptStream(request, descriptor, ide, toolWindow, window, evidence)
                }
            }
        } catch (error: Throwable) {
            evidence.fail("driver.error", actionable(error))
            context?.let { copyIdeLogs(it, testName, evidence) }
            evidence.log("driver failed: ${actionable(error)}")
            evidence.log(error.stackTraceToString().take(8000))
        }

        evidence.write(resultPath)
    }

    private fun isTranscriptSessionOpen(request: DriverRequest): Boolean =
        request.scenario.id == "session.open" &&
            "transcript.visible" in request.scenario.expected.ui &&
            "session.ready" in request.scenario.expected.model

    private fun isPromptStream(request: DriverRequest): Boolean =
        request.scenario.id == "prompt.stream" &&
            "assistant.streaming" in request.scenario.expected.ui &&
            "assistant.complete" in request.scenario.expected.ui &&
            "prompt.completed" in request.scenario.expected.model &&
            "transcript.token" in request.scenario.expected.model

    private fun isTranscriptScenario(request: DriverRequest): Boolean =
        isTranscriptSessionOpen(request) || isPromptStream(request)

    private fun setOrigin(project: String, url: String, evidence: DriverEvidence): Boolean {
        val existing = git(project, "remote", "get-url", "origin")
        val changed = when {
            existing == null -> gitRun(project, "remote", "add", "origin", url)
            existing != url -> gitRun(project, "remote", "set-url", "origin", url)
            else -> true
        }
        if (!changed) {
            evidence.fail("git.origin", "could not set origin to the descriptor gitUrl")
            return false
        }
        val actual = git(project, "remote", "get-url", "origin")
        if (actual != url) {
            evidence.fail("git.origin", "origin is '$actual' instead of '$url'")
            return false
        }
        evidence.pass("git.origin", actual)
        evidence.state("git.origin", actual)
        return true
    }

    private fun git(dir: String, vararg args: String): String? = runCatching {
        val proc = ProcessBuilder(listOf("git", *args))
            .directory(Path.of(dir).toFile())
            .redirectErrorStream(true)
            .start()
        if (!proc.waitFor(10, TimeUnit.SECONDS)) {
            proc.inputStream.close()
            proc.destroyForcibly()
            return@runCatching null
        }
        val output = proc.inputStream.bufferedReader().use { it.readText() }.trim()
        output.takeIf { proc.exitValue() == 0 && it.isNotEmpty() }
    }.getOrNull()

    private fun gitRun(dir: String, vararg args: String): Boolean = runCatching {
        val proc = ProcessBuilder(listOf("git", *args))
            .directory(Path.of(dir).toFile())
            .redirectErrorStream(true)
            .start()
        proc.inputStream.close()
        if (!proc.waitFor(10, TimeUnit.SECONDS)) {
            proc.destroyForcibly()
            return@runCatching false
        }
        proc.exitValue() == 0
    }.getOrDefault(false)

    private fun openSession(
        request: DriverRequest,
        descriptor: FixtureDescriptor,
        ide: KiloIdePage,
        toolWindow: KiloToolWindowPage,
        window: ToolWindow,
        evidence: DriverEvidence,
    ) {
        val page = SessionOpenPage(ide, watchdog)
        val lane = request.scenario.lane
        val token = if (lane == "cloud") descriptor.fakeLlmScope else request.scenario.prompt.token
        if (token.isBlank()) {
            evidence.fail("transcript.visible", "scenario or descriptor has no transcript token")
            evidence.fail("session.ready", "scenario or descriptor has no transcript token")
            return
        }
        val hosted = if (lane == "cloud") {
            openCloud(request, descriptor, ide, toolWindow, window, page, evidence)
        } else {
            openLocal(request, page, evidence)
        }
        if (hosted == null) return

        val model = runCatching { page.awaitModel() }.getOrElse { error ->
            evidence.fail("session.ready", actionable(error))
            null
        }
        if (model != null) {
            evidence.pass("session.ready", "turnCount=${model.turns}, model dump present")
            evidence.state("transcript.turns", model.turns)
            evidence.state("transcript.dump", model.dump.take(4000))
            evidence.state("transcript.detailed", model.detailed.take(4000))
        }

        val render = runCatching { page.awaitRender(token) }.getOrElse { error ->
            evidence.fail("transcript.visible", actionable(error))
            null
        }
        if (render != null) {
            evidence.pass("transcript.visible", "component text or accessible name contains '$token'")
            evidence.state("transcript.expected", token)
            evidence.state("transcript.text", render.text.take(4000))
            evidence.state("transcript.accessibleNames", render.accessibleNames.take(20).joinToString(" | ").take(2000))
        }

        val selected = runCatching { page.hostedSelection() }.getOrNull()
        if (lane == "cloud") {
            if (selected == hosted) evidence.pass("session.hosted", selected) else {
                evidence.fail("session.hosted", "selected '${selected ?: "none"}' instead of '$hosted'")
            }
            if (page.hostedEditorVisible()) evidence.pass("session.hosted.editor", "Cloud workspace editor visible")
            else evidence.fail("session.hosted.editor", "Cloud workspace editor is not visible")
            evidence.state("session.hosted", true)
            evidence.state("session.key", selected.orEmpty())
        } else {
            if (!page.hostedEditorVisible() && selected == null) {
                evidence.pass("session.local", "no hosted editor or selected hosted session")
            } else {
                evidence.fail("session.local", "hosted attachment leaked into the local lane: ${selected ?: "editor"}")
            }
            evidence.state("session.hosted", false)
        }

        runCatching { ide.snapshot("session-open-$lane", window) }
        runCatching {
            page.transcriptComponent()?.let { ide.snapshotComponent("session-open-$lane-transcript", it) }
        }
        runCatching { ide.screenshot("session-open-$lane") }
    }

    private fun promptStream(
        request: DriverRequest,
        descriptor: FixtureDescriptor,
        ide: KiloIdePage,
        toolWindow: KiloToolWindowPage,
        window: ToolWindow,
        evidence: DriverEvidence,
    ) {
        val lane = request.scenario.lane
        val token = request.scenario.prompt.token
        if (token.isBlank()) {
            failStream(evidence, "scenario has no prompt token")
            return
        }
        val fake = FakeLlm.create(descriptor.origins.fakeLlm)
        if (fake == null) {
            failStream(evidence, "descriptor has no loopback fakeLlm origin")
            return
        }

        val page = SessionOpenPage(ide, watchdog)
        val scope = descriptor.fakeLlmScope.ifBlank { "kilo-e2e-${request.runId}" }
        val tag = "$scope-stream"
        val prompt = "__e2e_scope__:$scope\n__fake__:gate:$tag:$token"

        val hosted = if (lane == "cloud") {
            openCloud(request, descriptor, ide, toolWindow, window, page, evidence, label = "prompt.hosted") ?: run {
                failStream(evidence, "hosted session did not open")
                return
            }
        } else {
            ""
        }
        val root = if (lane == "cloud") page.hostedEditor() else null
        if (lane == "cloud" && root == null) {
            failStream(evidence, "hosted workspace editor is not visible")
            return
        }
        if (root != null) {
            val loaded = runCatching { page.awaitLoaded(root) }.getOrElse { error ->
                failStream(evidence, "hosted transcript did not load before the prompt: ${actionable(error)}")
                return
            }
            evidence.state("prompt.loaded.turns", loaded.turns)
        }

        evidence.state("prompt.directive", prompt)
        evidence.state("prompt.scope", scope)
        evidence.state("prompt.gate", tag)
        val before = runCatching { fake.scenarioRequests(tag) }.getOrNull()
        val scopedBefore = runCatching { fake.requests(scope) }.getOrNull()
        evidence.state("stream.observations.before", before)
        evidence.state("stream.observations.scope.before", scopedBefore)

        runCatching { page.submit(prompt, root) }.onFailure { error ->
            capture(ide, window, page, root, lane, "submit-failed")
            evidence.fail("stream.gate", "could not submit the stream prompt: ${actionable(error)}")
            failStream(evidence, "could not submit the stream prompt: ${actionable(error)}")
            return
        }
        runCatching { watchdog.await("fake LLM gate '$tag' engaged") { fake.gateEngaged(tag) == true } }
            .onFailure { error ->
                capture(ide, window, page, root, lane, "gate-failed")
                evidence.fail("stream.gate", "gate '$tag' did not engage: ${actionable(error)}")
                failStream(evidence, "gate '$tag' did not engage: ${actionable(error)}")
                return
            }
        evidence.pass("stream.gate", "the scoped fake-LLM gate is holding the turn")

        val streaming = runCatching { page.awaitStreaming(token, root) }.getOrElse { error ->
            capture(ide, window, page, root, lane, "streaming-failed")
            failStream(evidence, "the turn did not reach the streaming state: ${actionable(error)}")
            return
        }
        evidence.pass("assistant.streaming", "turn is busy while the gate holds the stream")
        evidence.state("stream.state", streaming.state)
        evidence.state("stream.assistant.during", streaming.assistant.take(2000))
        evidence.state("stream.ui.occurrences", page.occurrences(streaming, token))
        streaming.message?.let { evidence.state("stream.state.message", it) }

        if (streaming.user.contains(prompt)) {
            evidence.pass("prompt.user", "authoritative user message contains the submitted directive")
        } else {
            evidence.fail("prompt.user", "user message '${streaming.user.take(400)}' does not contain the submitted directive")
        }
        if (page.occurrences(streaming, token) >= 1) {
            evidence.pass("prompt.user.visible", "the submitted prompt is rendered before the gate is released")
        } else {
            evidence.fail("prompt.user.visible", "the submitted prompt is not rendered in the transcript")
        }
        if (streaming.assistant.contains(token)) {
            evidence.fail("stream.held", "assistant text completed before the gate was released")
        } else {
            evidence.pass("stream.held", "assistant text is still empty while the gate holds")
        }

        capture(ide, window, page, root, lane, "streaming")

        val status = runCatching { fake.release(tag) }.getOrNull()
        if (status == null || status !in 200..299) {
            evidence.fail("stream.release", "gate release returned ${status ?: "no response"}")
            failStream(evidence, "the fake-LLM gate was not released")
            return
        }
        evidence.pass("stream.release", "HTTP $status")

        val complete = runCatching { page.awaitSettled(root) }.getOrElse { error ->
            capture(ide, window, page, root, lane, "complete-failed")
            failStream(evidence, "the turn did not settle after the gate release: ${actionable(error)}")
            return
        }

        val occurrences = page.occurrences(complete, token)
        if (complete.state == "Idle" && complete.assistant.contains(token) && complete.errors.isBlank() && occurrences >= 2) {
            evidence.pass("assistant.complete", "the transcript renders the completed assistant token")
        } else {
            evidence.fail(
                "assistant.complete",
                "state=${complete.state} errors='${complete.errors.take(400)}' " +
                    "assistant='${complete.assistant.take(400)}' occurrences=$occurrences",
            )
        }
        evidence.state("stream.state", complete.state)
        evidence.state("stream.assistant.final", complete.assistant.take(4000))
        evidence.state("stream.ui.occurrences", occurrences)
        evidence.state("stream.turns", complete.turns)
        evidence.state("transcript.dump", complete.dump.take(4000))
        evidence.state("transcript.detailed", complete.detailed.take(4000))

        if (complete.assistant.contains(token)) {
            evidence.pass("transcript.token", "assistant text contains '$token'")
        } else {
            evidence.fail("transcript.token", "assistant text '${complete.assistant.take(400)}' does not contain '$token'")
        }
        if (complete.state == "Idle") {
            evidence.pass("prompt.completed", "state=Idle after the turn completed")
        } else {
            evidence.fail(
                "prompt.completed",
                "state=${complete.state}${complete.message?.let { ": $it" } ?: ""}",
            )
        }
        val failed = complete.state == "Error" || complete.state == "TurnEnded" || complete.state == "LoginRequired"
        if (complete.errors.isBlank() && !failed) {
            evidence.pass("prompt.no-error", "no message failure and no error state")
        } else {
            evidence.fail("prompt.no-error", "message errors '${complete.errors.take(400)}' state=${complete.state}")
        }

        val after = runCatching { fake.scenarioRequests(tag) }.getOrNull()
        val scopedAfter = runCatching { fake.requests(scope) }.getOrNull()
        evidence.state("stream.observations.after", after)
        evidence.state("stream.observations.scope.after", scopedAfter)
        if (before != null && after != null && after > before) {
            evidence.pass("stream.observe", "fake-LLM scenario requests $before -> $after")
        } else {
            evidence.fail("stream.observe", "fake-LLM scenario request count did not increase (before=$before after=$after)")
        }

        val selected = runCatching { page.hostedSelection() }.getOrNull()
        if (lane == "cloud") {
            if (selected == hosted) evidence.pass("session.hosted", selected) else {
                evidence.fail("session.hosted", "selected '${selected ?: "none"}' instead of '$hosted'")
            }
            if (page.hostedEditorVisible()) evidence.pass("session.hosted.editor", "Cloud workspace editor visible")
            else evidence.fail("session.hosted.editor", "Cloud workspace editor is not visible")
            val native = descriptor.resources.nativeSessionId
            if (complete.session == hosted) {
                evidence.pass("session.hosted.session", "loaded hosted composite '$hosted'")
            } else {
                evidence.fail("session.hosted.session", "loaded '${complete.session ?: "none"}' instead of '$hosted'")
            }
            evidence.state("session.native", native.orEmpty())
            evidence.state("session.hosted", true)
            evidence.state("session.key", selected.orEmpty())
        } else {
            if (!page.hostedEditorVisible() && selected == null) {
                evidence.pass("session.local", "no hosted editor or selected hosted session")
            } else {
                evidence.fail("session.local", "hosted attachment leaked into the local lane: ${selected ?: "editor"}")
            }
            evidence.state("session.hosted", false)
        }

        capture(ide, window, page, root, lane, "complete")
    }

    private fun capture(
        ide: KiloIdePage,
        window: ToolWindow,
        page: SessionOpenPage,
        root: UiComponent?,
        lane: String,
        phase: String,
    ) {
        runCatching { ide.snapshot("prompt-stream-$lane-$phase", window) }
        runCatching {
            page.transcriptComponent(root)?.let { ide.snapshotComponent("prompt-stream-$lane-$phase-transcript", it) }
        }
        runCatching { ide.screenshot("prompt-stream-$lane-$phase") }
    }

    private fun failStream(evidence: DriverEvidence, message: String) {
        val names = listOf(
            "assistant.streaming",
            "assistant.complete",
            "prompt.completed",
            "transcript.token",
            "prompt.no-error",
        )
        for (name in names.filterNot(evidence::passed)) evidence.fail(name, message)
    }

    private fun openLocal(request: DriverRequest, page: SessionOpenPage, evidence: DriverEvidence): String? =
        runCatching {
            page.submitLocal(request.scenario.prompt.token)
            evidence.pass("session.open", "local prompt submitted through Chat")
            ""
        }.getOrElse { error ->
            evidence.fail("session.open", actionable(error))
            evidence.fail("transcript.visible", "local session did not open: ${actionable(error)}")
            evidence.fail("session.ready", "local session did not open: ${actionable(error)}")
            null
        }

    private fun openCloud(
        request: DriverRequest,
        descriptor: FixtureDescriptor,
        ide: KiloIdePage,
        toolWindow: KiloToolWindowPage,
        window: ToolWindow,
        page: SessionOpenPage,
        evidence: DriverEvidence,
        label: String = "session.open",
    ): String? {
        val workspace = descriptor.resources.workspaceId
        val session = descriptor.resources.nativeSessionId
        if (workspace == null || session == null) {
            evidence.fail(label, "Cloud descriptor has no workspaceId/nativeSessionId")
            evidence.fail("transcript.visible", "Cloud descriptor has no hosted identity")
            evidence.fail("session.ready", "Cloud descriptor has no hosted identity")
            return null
        }
        return runCatching {
            toolWindow.select(window, "Agents")
            AgentManagerPage(ide, watchdog).awaitVisible()
            val row = page.discoverHosted(workspace)
            val remote = git(request.project.path, "remote", "get-url", "origin")
            evidence.state("hosted.remote", remote)
            evidence.state("hosted.key", row.key)
            evidence.state("hosted.row.key", row.selectedKey)
            evidence.state("hosted.row.tooltip", row.tooltip)
            if (row.selectedKey == row.key) evidence.pass("hosted.identity", row.key)
            else evidence.fail("hosted.identity", "selected '${row.selectedKey}' instead of '${row.key}'")
            val reported = row.tooltip.lineSequence().map(String::trim).firstOrNull {
                it.startsWith("http://") || it.startsWith("https://") || it.startsWith("git@") || it.startsWith("file:")
            }
            if (remote != null && sameRemote(reported, remote)) {
                evidence.pass("hosted.discovery", "row tooltip reports the raw origin '$remote'")
            } else {
                evidence.fail("hosted.discovery", "row tooltip '$reported' does not match raw origin '$remote'")
            }
            page.awaitHostedSession(workspace, session)
            evidence.pass(label, "hosted workspace and root session opened")
            val expected = "hosted:$KILO_CLOUD_PROVIDER_ID:$workspace:$session"
            evidence.state("hosted.session", expected)
            expected
        }.getOrElse { error ->
            evidence.fail(label, actionable(error))
            evidence.fail("transcript.visible", "Cloud session did not open: ${actionable(error)}")
            evidence.fail("session.ready", "Cloud session did not open: ${actionable(error)}")
            null
        }
    }

    private fun sameRemote(a: String?, b: String): Boolean {
        fun normalize(value: String) = value.trim().removeSuffix("/").removeSuffix(".git").lowercase()
        return a != null && normalize(a) == normalize(b)
    }

    private fun seedModel(descriptor: FixtureDescriptor, evidence: DriverEvidence) {
        val model = descriptor.project.model.takeIf { it.isNotBlank() } ?: return
        val file = Path.of(descriptor.state.config, "kilo", "kilo.jsonc")
        runCatching {
            Files.createDirectories(file.parent)
            val existing = if (Files.exists(file)) Files.readString(file) else "{}"
            val fields = jsonc.parseToJsonElement(existing).jsonObject.toMutableMap()
            fields["model"] = JsonPrimitive(model)
            fields["small_model"] = JsonPrimitive(model)
            Files.writeString(file, JsonObject(fields).toString())
        }.onSuccess {
            evidence.state("model.seeded", model)
        }.onFailure { error ->
            evidence.fail("model.seeded", actionable(error))
        }
    }

    private fun preflight(request: DriverRequest, evidence: DriverEvidence): Boolean {
        val inherited = System.getenv("KILO_E2E_RUN_ID")
        if (inherited != request.runId) {
            evidence.fail(
                "env.descriptor",
                "KILO_E2E_RUN_ID was '$inherited' instead of '${request.runId}'; " +
                    "Gradle lost the descriptor environment (do not use the daemon)",
            )
            return false
        }
        if (System.getenv("KILO_API_KEY").isNullOrBlank()) {
            evidence.fail("env.descriptor", "KILO_API_KEY is missing from the driver environment")
            return false
        }

        val mode = System.getProperty("kilo.e2e.cliMode")
        if (mode != "repo") {
            evidence.fail("cli.local", "kilo.e2e.cliMode=$mode; expected repo (kilo.cli.pinned=false)")
        }

        val plugin = System.getProperty("kilo.e2e.pluginArchive")?.takeIf { it.isNotBlank() }?.let(Path::of)
        if (plugin == null || !Files.isRegularFile(plugin)) {
            evidence.fail("plugin.archive", "plugin archive is missing; expected path.to.build.plugin")
        }

        val cli = System.getProperty("kilo.e2e.cliArchive")?.takeIf { it.isNotBlank() }?.let(Path::of)
        if (cli == null || !Files.isRegularFile(cli)) {
            evidence.fail("cli.artifact", "local CLI archive is missing; run :backend:buildRepoCli")
        }

        return !evidence.hasFailure()
    }

    private fun assertEnvironment(
        ide: KiloIdePage,
        descriptor: FixtureDescriptor,
        request: DriverRequest,
        evidence: DriverEvidence,
    ) {
        val env = ide.environment()
        val expected = buildMap {
            descriptor.origins.web?.let { put("KILO_API_URL", it) }
            descriptor.origins.cloudAgent?.let { put("CLOUD_AGENT_NEXT_BASE_URL", it) }
            put("KILO_API_KEY", descriptor.credentials.apiKey)
            put("XDG_DATA_HOME", descriptor.state.data)
            put("XDG_CONFIG_HOME", descriptor.state.config)
            put("XDG_STATE_HOME", descriptor.state.state)
            put("XDG_CACHE_HOME", descriptor.state.cache)
            put("KILO_E2E_RUN_ID", request.runId)
        }
        for ((key, value) in expected) {
            val actual = runCatching { env.getValue(key) }.getOrNull()
            if (actual == value) {
                evidence.pass("env.$key", "matches descriptor")
            } else {
                evidence.fail("env.$key", "IDE EnvironmentUtil did not expose the descriptor value")
            }
        }
        evidence.state("env.descriptor", "checked")
    }

    private fun copyIdeLogs(context: IDETestContext, testName: String, evidence: DriverEvidence) {
        val frontend = (context as? IDERemDevTestContext)?.frontendIDEContext
        evidence.copyIdeLogs(findLogDir(context.paths.testHome, testName), frontend?.let {
            findLogDir(it.paths.testHome, testName)
        })
    }

    private fun findLogDir(home: Path, testName: String): Path? {
        val direct = home.resolve(testName).resolve("log")
        if (Files.isDirectory(direct)) return direct
        val fallback = home.resolve("log")
        if (Files.isDirectory(fallback)) return fallback
        return runCatching {
            Files.walk(home, 3).use { stream ->
                stream.iterator().asSequence().firstOrNull { it.fileName.toString() == "idea.log" }?.parent
            }
        }.getOrNull()
    }

    private fun required(name: String): String =
        System.getProperty(name)?.takeIf { it.isNotBlank() }
            ?: error("missing system property $name; run the adapter through script/e2e-driver.ts")

    private fun actionable(error: Throwable): String {
        val message = error.message?.replace('\n', ' ')?.take(400)
        return listOfNotNull(error::class.qualifiedName, message).joinToString(": ")
    }
}
