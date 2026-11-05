package ai.kilocode.e2e

import com.intellij.driver.sdk.application.fullProductName
import com.intellij.ide.starter.driver.runIdeTest
import com.intellij.ide.starter.ide.IDERemDevTestContext
import com.intellij.ide.starter.ide.IDETestContext
import com.intellij.ide.starter.ide.IdeProductProvider
import com.intellij.ide.starter.junit5.RemoteDevRun
import com.intellij.ide.starter.models.TestCase
import com.intellij.ide.starter.plugins.PluginConfigurator
import com.intellij.ide.starter.project.LocalProjectInfo
import com.intellij.ide.starter.runner.Starter
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

        val preflight = preflight(request, evidence)
        if (!preflight) {
            evidence.write(resultPath)
            return
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
            }
        } catch (error: Throwable) {
            evidence.fail("driver.error", actionable(error))
            context?.let { copyIdeLogs(it, testName, evidence) }
            evidence.log("driver failed: ${actionable(error)}")
            evidence.log(error.stackTraceToString().take(8000))
        }

        evidence.write(resultPath)
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
