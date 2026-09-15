package ai.kilocode.backend.run

import ai.kilocode.backend.testing.PlainApplicationConfig
import ai.kilocode.backend.testing.PlainApplicationType
import ai.kilocode.backend.testing.StubbornJvm
import ai.kilocode.rpc.dto.RunProcessState
import ai.kilocode.rpc.dto.RunStateDto
import com.intellij.execution.BeforeRunTask
import com.intellij.execution.CommonProgramRunConfigurationParameters
import com.intellij.execution.ExecutionManager
import com.intellij.execution.ExecutionTarget
import com.intellij.execution.Executor
import com.intellij.execution.RunManager
import com.intellij.execution.RunnerAndConfigurationSettings
import com.intellij.execution.configurations.ConfigurationFactory
import com.intellij.execution.configurations.ConfigurationPerRunnerSettings
import com.intellij.execution.configurations.ConfigurationType
import com.intellij.execution.configurations.ConfigurationTypeBase
import com.intellij.execution.configurations.ModuleBasedConfiguration
import com.intellij.execution.configurations.RunConfiguration
import com.intellij.execution.configurations.RunConfigurationBase
import com.intellij.execution.configurations.RunConfigurationModule
import com.intellij.execution.configurations.RunProfile
import com.intellij.execution.configurations.RunProfileState
import com.intellij.execution.configurations.RunnerSettings
import com.intellij.execution.KillableProcess
import com.intellij.execution.executors.DefaultRunExecutor
import com.intellij.execution.process.NopProcessHandler
import com.intellij.execution.process.ProcessHandler
import com.intellij.execution.runners.ExecutionEnvironment
import com.intellij.execution.runners.ProgramRunner
import com.intellij.openapi.externalSystem.ExternalSystemModulePropertyManager
import com.intellij.openapi.externalSystem.model.ProjectSystemId
import com.intellij.openapi.externalSystem.service.execution.ExternalSystemRunConfiguration
import com.intellij.openapi.module.Module
import com.intellij.openapi.options.SettingsEditor
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Key
import com.intellij.task.ExecuteRunConfigurationTask
import com.intellij.task.ProjectTask
import com.intellij.task.ProjectTaskRunner
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import org.jdom.Element
import java.io.OutputStream
import java.nio.file.Files
import java.nio.file.Path

class WorktreeRunManagerTest : BasePlatformTestCase() {
    private companion object {
        private const val WAIT_NANOS = 10_000_000_000L

        /** Reaping forks `ps` and polls every 500 ms, so it needs a wider watchdog than a state change. */
        private const val REAP_WAIT_NANOS = 30_000_000_000L

        /**
         * Outlasts the manager's own reap grace period, for the one assertion that has to prove a
         * signal never arrives. Asserting an absence has no state transition to wait for.
         */
        private const val REAP_GRACE_MS = 4_500L
    }

    private lateinit var cs: CoroutineScope
    private val launched = mutableListOf<RunnerAndConfigurationSettings>()
    private val added = mutableListOf<RunnerAndConfigurationSettings>()

    override fun setUp() {
        super.setUp()
        cs = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        launched.clear()
    }

    override fun tearDown() {
        try {
            added.forEach { RunManager.getInstance(project).removeConfiguration(it) }
            added.clear()
            cs.cancel()
        } catch (e: Throwable) {
            addSuppressedException(e)
        } finally {
            super.tearDown()
        }
    }

    fun testConfigsListsOnlySupportedTypes() = runBlocking {
        val params = register(paramsType("kilo.test.params.list"))
        val plain = register(plainType("kilo.test.plain.list"))
        val moduled = register(moduleType("kilo.test.module.list"))
        add(params, "dev")
        add(plain, "app")
        // A module-based config with no module set is not linked to any external system, so it is
        // still absent from the list — the delegated path needs a real Gradle/Maven-imported module.
        add(moduled, "mod")

        val configs = manager().configs().configs
        val names = configs.map { it.name }
        assertTrue("dev" in names)
        assertFalse("app" in names)
        assertFalse("mod" in names)
        assertEquals("Kilo Params kilo.test.params.list", configs.first { it.name == "dev" }.type)
        assertNull(configs.first { it.name == "dev" }.via)
    }

    fun testRunTransplantsAndCachesClone() = runBlocking {
        val type = register(paramsType("kilo.test.params.run"))
        val settings = add(type, "dev")
        val source = settings.configuration as ParamsConfig
        source.envs = mutableMapOf("FOO" to "bar")
        source.beforeRunTasks = listOf(StubTask())
        val mgr = manager()
        val wt = "/tmp/kilo-wt"

        assertTrue(mgr.run(settings.uniqueID, wt).ok)
        val clone = launched.single()
        val cfg = clone.configuration as ParamsConfig
        assertEquals("dev [kilo-wt]", cfg.name)
        assertEquals(wt, cfg.workingDirectory)
        assertEquals(wt, cfg.envs[WorktreeRunAdapter.WORKTREE_ENV])
        assertEquals(project.basePath, cfg.envs[WorktreeRunAdapter.REPO_ENV])
        assertEquals("false", cfg.envs[WorktreeRunAdapter.DEBUGGER_ENV])
        assertEquals("bar", cfg.envs["FOO"])
        assertTrue(cfg.beforeRunTasks.isEmpty())
        assertFalse(cfg.isAllowRunningInParallel)
        assertTrue(clone.isActivateToolWindowBeforeRun)
        // Source is untouched.
        assertEquals("dev", source.name)
        assertNull(source.workingDirectory)
        assertEquals(1, source.beforeRunTasks.size)

        assertTrue(mgr.run(settings.uniqueID, wt).ok)
        assertSame(clone, launched[1])
    }

    fun testNestedWorkingDirectoryIsRebasedOntoWorktree() = runBlocking {
        val type = register(paramsType("kilo.test.params.nested"))
        val settings = add(type, "dev")
        val source = settings.configuration as ParamsConfig
        val repo = requireNotNull(project.basePath)
        source.workingDirectory = "$repo/packages/kilo-jetbrains"
        val wt = "$repo/.kilo/worktrees/nested-wt"

        assertTrue(manager().run(settings.uniqueID, wt).ok)
        val cfg = launched.single().configuration as ParamsConfig
        assertEquals(Path.of("$wt/packages/kilo-jetbrains").toString(), cfg.workingDirectory)
        // The user's own configuration must stay untouched.
        assertEquals("$repo/packages/kilo-jetbrains", source.workingDirectory)
    }

    fun testGradleNestedProjectPathIsRebasedOntoWorktree() = runBlocking {
        val type = register(esType("kilo.test.es.nested"))
        val settings = add(type, "runIdeSplitMode")
        val source = settings.configuration as ExternalSystemRunConfiguration
        val repo = requireNotNull(project.basePath)
        source.settings.externalProjectPath = "$repo/packages/kilo-jetbrains"
        source.settings.taskNames = listOf(":runIdeSplitMode")
        val wt = "$repo/.kilo/worktrees/gradle-wt"

        assertTrue(manager().run(settings.uniqueID, wt).ok)
        val cfg = launched.single().configuration as ExternalSystemRunConfiguration
        assertEquals(Path.of("$wt/packages/kilo-jetbrains").toString(), cfg.settings.externalProjectPath)
        // Subproject task names stay resolvable because the project path kept its subdirectory.
        assertEquals(listOf(":runIdeSplitMode"), cfg.settings.taskNames)
        assertEquals(wt, cfg.settings.env[WorktreeRunAdapter.WORKTREE_ENV])
        assertEquals(repo, cfg.settings.env[WorktreeRunAdapter.REPO_ENV])
        // An IDE launched by "Debug" on a Gradle task exports DEBUGGER_ENABLED=true, and parent envs
        // are inherited. Left alone, Gradle's injected debug script fails every forked start task
        // because the dispatch port system property is absent outside a real debug session.
        assertEquals("false", cfg.settings.env[WorktreeRunAdapter.DEBUGGER_ENV])
        // Cloning an external-system config must not mutate the user's own configuration.
        assertEquals("$repo/packages/kilo-jetbrains", source.settings.externalProjectPath)
        assertTrue(source.settings.env.isEmpty())
    }

    fun testRunRejectsUnknownAndUnsupported() = runBlocking {
        val plain = register(plainType("kilo.test.plain.run"))
        val settings = add(plain, "app")
        val mgr = manager()
        assertNotNull(mgr.run("no-such-id", "/tmp/wt").error)
        assertNotNull(mgr.run(settings.uniqueID, "/tmp/wt").error)
        assertTrue(launched.isEmpty())
    }

    fun testModuleBasedConfigIsListedAndDelegatedToItsBuildSystem() = runBlocking {
        // A Spring Boot / Application style config: module-based, so the adapter refuses to transplant
        // it (its classpath comes from the main checkout's module). The platform's own delegation
        // pipeline runs it as a build-system task instead, which resolves the classpath in the worktree.
        link()
        val settings = add(register(moduleType("kilo.test.module.delegated")), "HvApiGatewayApp")
        val source = settings.configuration as ModuleParamsConfig
        source.setModule(module)
        source.main = "com.example.HvApiGatewayApp"
        val runner = delegatingRunner()
        val mgr = manager()
        val repo = requireNotNull(project.basePath)
        val wt = "$repo/.kilo/worktrees/spring-wt"

        val listed = mgr.configs().configs.single { it.name == "HvApiGatewayApp" }
        assertEquals(ProjectSystemId("GRADLE").readableName, listed.via)

        assertTrue(mgr.run(settings.uniqueID, wt).ok)
        // The clone the delegation produced is what runs, not a transplant of the source config.
        val clone = launched.single()
        assertSame(runner.produced, clone)
        val cfg = clone.configuration as ExternalSystemRunConfiguration
        assertEquals("HvApiGatewayApp [spring-wt]", clone.name)
        assertEquals(Path.of("$wt/api-gateway").toString(), cfg.settings.externalProjectPath)
        assertEquals(listOf(":api-gateway:bootRun"), cfg.settings.taskNames)
        assertEquals(wt, cfg.settings.env[WorktreeRunAdapter.WORKTREE_ENV])
        assertEquals(repo, cfg.settings.env[WorktreeRunAdapter.REPO_ENV])
        assertEquals("false", cfg.settings.env[WorktreeRunAdapter.DEBUGGER_ENV])
        assertTrue(cfg.beforeRunTasks.isEmpty())
        assertFalse(cfg.isAllowRunningInParallel)
        assertTrue(clone.isActivateToolWindowBeforeRun)

        // The provider saw a clone whose working directory was already rebased, so any init script it
        // generates from it points at the worktree, not the main checkout.
        val seen = requireNotNull(runner.seen) as ModuleParamsConfig
        assertNotSame(settings.configuration, seen)
        assertEquals(Path.of("$wt/nested").toString(), seen.workingDirectory)
        assertEquals(wt, seen.envs[WorktreeRunAdapter.WORKTREE_ENV])

        // Re-running reuses the derived settings instance, so the platform restarts it instead of
        // starting a second process; the init script rides along as user data on that instance.
        assertTrue(mgr.run(settings.uniqueID, wt).ok)
        assertSame(clone, launched[1])
        assertEquals(1, runner.calls)
    }

    fun testDeclinedFrameworkConfigStillRunsAsAPlainApplicationAndWarns() = runBlocking {
        // The Spring Boot case: the framework's own provider declines (its "Run using Gradle" advanced
        // setting is off by default), so the config is copied into a plain application the generic
        // provider accepts. It runs, and the settings that could not come along are reported.
        link()
        applicationType()
        val settings = add(register(moduleType("kilo.test.module.fallback")), "HvApiGatewayApp")
        val source = settings.configuration as ModuleParamsConfig
        source.setModule(module)
        source.main = "com.example.HvApiGatewayApp"
        source.profiles = "dev"
        // Accepts only the plain application copy, exactly like GradleApplicationEnvironmentProvider's
        // `javaClass ==` match rejecting a framework subclass.
        val runner = delegatingRunner(accept = { it is PlainApplicationConfig })
        val mgr = manager()
        val wt = "${requireNotNull(project.basePath)}/.kilo/worktrees/fallback-wt"

        val result = mgr.run(settings.uniqueID, wt)
        assertNull(result.error)
        assertTrue(result.ok)
        assertEquals(ModuleParamsConfig.PROFILES_OPTION, result.warning)
        // Asked twice: once with the framework config, then with the plain copy carrying its main class.
        assertEquals(2, runner.calls)
        assertEquals("com.example.HvApiGatewayApp", (runner.seen as PlainApplicationConfig).main)
        assertEquals("HvApiGatewayApp [fallback-wt]", launched.single().name)

        // A re-run reuses the cached reduced clone, so the caveat is reported again rather than only once.
        assertEquals(ModuleParamsConfig.PROFILES_OPTION, mgr.run(settings.uniqueID, wt).warning)
        assertEquals(2, runner.calls)
    }

    fun testDeclinedDelegationTellsTheUserWhatToDoAboutIt() = runBlocking {
        // What a Spring Boot config does out of the box: its Gradle provider declines because the
        // per-framework "Run using Gradle" advanced setting is off, so no runner produces anything.
        link()
        val settings = add(register(moduleType("kilo.test.module.nodelegate")), "app")
        val source = settings.configuration as ModuleParamsConfig
        source.setModule(module)
        source.main = "com.example.App"

        val result = manager().run(settings.uniqueID, "/tmp/kilo-nodelegate-wt")
        assertFalse(result.ok)
        assertEquals("Gradle declined to run 'app' — ${WorktreeRunDelegate.DECLINED_HINT}", result.error)
        assertTrue(launched.isEmpty())
    }

    fun testTestStyleConfigIsNotListedForAWorktree() = runBlocking {
        // A test configuration is module-based and Gradle-imported like an application is, but neither
        // delegation path can run it, so offering it would only produce a misleading failure later.
        link()
        val settings = add(register(moduleType("kilo.test.module.tests")), "MyTest")
        (settings.configuration as ModuleParamsConfig).setModule(module)

        assertTrue(manager().configs().configs.none { it.name == "MyTest" })
        val result = manager().run(settings.uniqueID, "/tmp/kilo-tests-wt")
        assertEquals("cannot run 'MyTest' in a worktree: runs no main class", result.error)
    }

    fun testUnsupportedConfigErrorNamesTheReason() = runBlocking {
        val settings = add(register(plainType("kilo.test.plain.reason")), "app")

        val result = manager().run(settings.uniqueID, "/tmp/kilo-reason-wt")
        assertFalse(result.ok)
        assertEquals("cannot run 'app' in a worktree: not module-based (PlainConfig)", result.error)
    }

    fun testTopicTracksStateStopAndTerminate() = runBlocking {
        val type = register(paramsType("kilo.test.params.topic"))
        val settings = add(type, "srv")
        val mgr = manager()
        val wt = "/tmp/kilo-topic-wt"
        assertTrue(mgr.run(settings.uniqueID, wt).ok)
        val clone = launched.single()

        val env = ExecutionEnvironment(DefaultRunExecutor.getRunExecutorInstance(), FakeRunner(), clone, project)
        // A handler that never finishes terminating keeps the STOPPING state observable.
        val handler = StubbornHandler()
        handler.startNotify()
        val bus = project.messageBus.syncPublisher(ExecutionManager.EXECUTION_TOPIC)

        bus.processStarted(DefaultRunExecutor.EXECUTOR_ID, env, handler)
        assertEquals(
            listOf(RunStateDto(settings.uniqueID, clone.name, wt, RunProcessState.RUNNING, killable = true)),
            mgr.states.value,
        )

        assertTrue(mgr.stop(settings.uniqueID, wt))
        await("stopping state") { mgr.states.value.single().state == RunProcessState.STOPPING }
        assertTrue(handler.isProcessTerminating)

        bus.processTerminated(DefaultRunExecutor.EXECUTOR_ID, env, handler, 0)
        assertTrue(mgr.states.value.isEmpty())
        assertFalse(mgr.stop(settings.uniqueID, wt))
    }

    fun testStopDestroysProcessAndDropsTerminatedHandler() = runBlocking {
        val type = register(paramsType("kilo.test.params.destroy"))
        val settings = add(type, "srv")
        val mgr = manager()
        val wt = "/tmp/kilo-destroy-wt"
        assertTrue(mgr.run(settings.uniqueID, wt).ok)
        val clone = launched.single()

        val env = ExecutionEnvironment(DefaultRunExecutor.getRunExecutorInstance(), FakeRunner(), clone, project)
        val handler = NopProcessHandler()
        handler.startNotify()
        project.messageBus.syncPublisher(ExecutionManager.EXECUTION_TOPIC)
            .processStarted(DefaultRunExecutor.EXECUTOR_ID, env, handler)
        // A plain handler is not killable, so the popup must not offer a force kill for it.
        assertFalse(mgr.states.value.single().killable)

        assertTrue(mgr.stop(settings.uniqueID, wt))
        // NopProcessHandler terminates on destroy — proves destroyProcess ran, not detachProcess.
        await("terminated process") { handler.isProcessTerminated }
        // The handler's own termination event drops the entry without any execution topic event.
        await("dropped handler") { mgr.states.value.isEmpty() }
    }

    fun testEditedSourceStopsTheReplacedCloneAndTracksTheFreshOne() = runBlocking {
        val type = register(paramsType("kilo.test.params.fresh"))
        val settings = add(type, "dev")
        val source = settings.configuration as ParamsConfig
        val mgr = manager()
        val wt = "/tmp/kilo-fresh-wt"
        assertTrue(mgr.run(settings.uniqueID, wt).ok)
        val first = launched[0]

        val bus = project.messageBus.syncPublisher(ExecutionManager.EXECUTION_TOPIC)
        val env1 = ExecutionEnvironment(DefaultRunExecutor.getRunExecutorInstance(), FakeRunner(), first, project)
        val handler1 = NopProcessHandler().also { it.startNotify() }
        bus.processStarted(DefaultRunExecutor.EXECUTOR_ID, env1, handler1)
        assertEquals(RunProcessState.RUNNING, mgr.states.value.single().state)

        // Editing the source makes a fresh clone. The platform's restart matches by settings
        // identity, so it would leave the previous process orphaned and unmanageable from the
        // popup; the manager stops it as part of creating the replacement.
        source.envs = mutableMapOf("PORT" to "3001")
        assertTrue(mgr.run(settings.uniqueID, wt).ok)
        val second = launched[1]
        assertNotSame(first, second)
        assertEquals("3001", (second.configuration as ParamsConfig).envs["PORT"])

        await("replaced clone stopped") { handler1.isProcessTerminated }
        await("no running processes") { mgr.states.value.isEmpty() }

        val env2 = ExecutionEnvironment(DefaultRunExecutor.getRunExecutorInstance(), FakeRunner(), second, project)
        val handler2 = NopProcessHandler().also { it.startNotify() }
        bus.processStarted(DefaultRunExecutor.EXECUTOR_ID, env2, handler2)
        assertEquals(RunProcessState.RUNNING, mgr.states.value.single().state)

        // A late terminate of the replaced clone must not clear the current process.
        bus.processTerminated(DefaultRunExecutor.EXECUTOR_ID, env1, handler1, 0)
        assertEquals(1, mgr.states.value.size)
        bus.processTerminated(DefaultRunExecutor.EXECUTOR_ID, env2, handler2, 0)
        assertTrue(mgr.states.value.isEmpty())
    }

    fun testReleaseStopsProcessesAndForgetsClones() = runBlocking {
        val type = register(paramsType("kilo.test.params.release"))
        val settings = add(type, "srv")
        val mgr = manager()
        val wt = "/tmp/kilo-release-wt"
        assertTrue(mgr.run(settings.uniqueID, wt).ok)
        val clone = launched.single()

        val env = ExecutionEnvironment(DefaultRunExecutor.getRunExecutorInstance(), FakeRunner(), clone, project)
        val handler = NopProcessHandler().also { it.startNotify() }
        project.messageBus.syncPublisher(ExecutionManager.EXECUTION_TOPIC)
            .processStarted(DefaultRunExecutor.EXECUTOR_ID, env, handler)
        assertFalse(mgr.states.value.isEmpty())

        assertTrue(mgr.release(wt))
        await("released process stopped") { handler.isProcessTerminated }
        // Dropping the tracked state is a separate hop after termination, so it needs its own wait.
        await("dropped tracked process") { mgr.states.value.isEmpty() }
        // The clone and handler are forgotten, so a later stop finds nothing and release is a no-op.
        assertFalse(mgr.stop(settings.uniqueID, wt))
        assertFalse(mgr.release(wt))
    }

    fun testReleaseStopsAStartAlreadyInFlight() = runBlocking {
        val type = register(paramsType("kilo.test.params.inflight"))
        val settings = add(type, "srv")
        val mgr = manager()
        val wt = "/tmp/kilo-inflight-wt"
        // run() has created and cached the clone but exec has not produced a processStarted yet.
        assertTrue(mgr.run(settings.uniqueID, wt).ok)
        val clone = launched.single()

        // The worktree is released for removal while that start is still in flight.
        assertTrue(mgr.release(wt))

        // The delayed processStarted must not be tracked; the process is stopped instead so it does
        // not keep running against the about-to-be-deleted worktree directory.
        val env = ExecutionEnvironment(DefaultRunExecutor.getRunExecutorInstance(), FakeRunner(), clone, project)
        val handler = NopProcessHandler().also { it.startNotify() }
        project.messageBus.syncPublisher(ExecutionManager.EXECUTION_TOPIC)
            .processStarted(DefaultRunExecutor.EXECUTOR_ID, env, handler)

        await("in-flight start stopped") { handler.isProcessTerminated }
        await("dropped tracked process") { mgr.states.value.isEmpty() }
        assertFalse(mgr.stop(settings.uniqueID, wt))
    }

    /**
     * The delegated-run failure mode this exists for: the platform's Stop cancels the Gradle build and
     * its process handler goes away, but the app JVM that build forked keeps running against the
     * worktree — holding its port with nothing in the IDE able to stop it. The manager must SIGTERM it
     * (graceful: a real app runs its shutdown hooks), keep a Kill row for it while it is alive, and
     * force-kill on the next click.
     */
    fun testOrphanedAppProcessIsReapedAndStaysKillable() = runBlocking {
        val type = register(paramsType("kilo.test.params.orphan"))
        val settings = add(type, "srv")
        val mgr = manager()
        // A unique real directory, so the reaper's command-line match cannot hit anything else.
        val wt = Files.createTempDirectory("kilo-orphan-wt").toString()
        assertTrue(mgr.run(settings.uniqueID, wt).ok)
        val clone = launched.single()

        // A real JVM referencing this worktree whose shutdown hook never finishes: SIGTERM leaves it
        // running, so the popup's Kill escalation is what stops it.
        val app = StubbornJvm.stubborn(wt)
        try {
            start(clone)
            assertFalse(mgr.states.value.single().orphan)

            assertTrue(mgr.stop(settings.uniqueID, wt))
            await("orphan row", REAP_WAIT_NANOS, { mgr.states.value }) { mgr.states.value.singleOrNull()?.orphan == true }
            val row = mgr.states.value.single()
            assertEquals(clone.name, row.name)
            assertEquals(wt, row.worktree)
            assertEquals(RunProcessState.STOPPING, row.state)
            // The popup offers Kill for an orphan even though an external-system handler never could.
            assertTrue(row.killable)

            // Kill: this app ignores SIGTERM, so only the escalation stops it.
            assertTrue(mgr.stop(settings.uniqueID, wt))
            await("app process killed", REAP_WAIT_NANOS) { !app.isAlive }
            await("orphan row cleared", REAP_WAIT_NANOS, { mgr.states.value }) { mgr.states.value.isEmpty() }
            assertFalse(mgr.stop(settings.uniqueID, wt))
        } finally {
            app.destroyForcibly()
        }
    }

    /**
     * Attribution is by worktree path, so the reaper cannot tell one config's application from
     * another's. Stopping one run while another is still live in the same worktree must therefore leave
     * every process alone rather than SIGTERM an application the user is still using.
     */
    fun testStopLeavesAppProcessesAloneWhileAnotherRunIsLiveInTheWorktree() = runBlocking {
        val type = register(paramsType("kilo.test.params.coexist"))
        val stopped = add(type, "first")
        val kept = add(type, "second")
        val mgr = manager()
        val wt = Files.createTempDirectory("kilo-coexist-wt").toString()
        assertTrue(mgr.run(stopped.uniqueID, wt).ok)
        assertTrue(mgr.run(kept.uniqueID, wt).ok)

        // Ignores SIGTERM, so if reaping were wrongly attributed the row would linger and be visible.
        val app = StubbornJvm.stubborn(wt)
        try {
            val handlers = launched.map { start(it) }
            assertEquals(2, mgr.states.value.size)

            assertTrue(mgr.stop(stopped.uniqueID, wt))
            await("first run stopped") { handlers[0].isProcessTerminated }
            await("first row dropped", REAP_WAIT_NANOS) { mgr.states.value.size == 1 }
            assertTrue(app.isAlive)
            assertFalse(mgr.states.value.single().orphan)

            // Stopping the last run in the worktree does reap it, which is what proves the process
            // survived above because attribution was ambiguous — not because reaping never ran.
            assertTrue(mgr.stop(kept.uniqueID, wt))
            await("second run stopped") { handlers[1].isProcessTerminated }
            await("orphan row", REAP_WAIT_NANOS, { mgr.states.value }) {
                mgr.states.value.singleOrNull()?.orphan == true
            }
            assertEquals(kept.uniqueID, mgr.states.value.single().id)
        } finally {
            app.destroyForcibly()
        }
    }

    /**
     * Editing the source configuration replaces the cached clone. The replaced run's application must
     * still be reaped even though the replacement immediately occupies the very same key: waiting for
     * "no handler on this key" would never observe that, and a scan taken afterwards could not tell the
     * outgoing application from the incoming one.
     */
    fun testReplacingACloneStillReapsTheOldRunsAppProcess() = runBlocking {
        val type = register(paramsType("kilo.test.params.replaced"))
        val settings = add(type, "srv")
        val config = settings.configuration as ParamsConfig
        val mgr = manager()
        val wt = Files.createTempDirectory("kilo-replaced-wt").toString()
        assertTrue(mgr.run(settings.uniqueID, wt).ok)
        val first = launched.single()

        // Exits on SIGTERM, so the process dying is itself the evidence that the reap ran. A
        // SIGTERM-ignoring app would only show up as an orphan row, which stays hidden while the
        // replacement is live and would let a broken implementation recover once it goes away.
        val app = StubbornJvm.start(wt)
        try {
            // A handler that ignores destroy, so the replacement provably takes over the key while the
            // outgoing one is still registered — the ordering that used to abandon the application.
            // With a handler that terminates promptly the race is timing-dependent and hides the bug.
            start(first, StubbornHandler())

            // Editing the source changes its fingerprint, so the next run builds a fresh clone.
            config.programParameters = "--changed"
            assertTrue(mgr.run(settings.uniqueID, wt).ok)
            val second = launched.last()
            assertNotSame(first, second)
            start(second, NopProcessHandler())

            // The outgoing run's application was identified before the replacement could start one, so
            // it is reaped despite the replacement now holding the same key.
            await("outgoing app terminated", REAP_WAIT_NANOS) { !app.isAlive }
        } finally {
            app.destroyForcibly()
        }
    }

    /**
     * Editing one config must not signal a sibling's application. Identification is worktree-wide, so a
     * sibling started after the edited config's clone was created lands in the same candidate set —
     * leaving the outgoing application behind is the lesser evil, exactly as on the stop path.
     */
    fun testReplacingACloneLeavesASiblingRunsAppAlone() = runBlocking {
        val type = register(paramsType("kilo.test.params.sibling"))
        val api = add(type, "api")
        val worker = add(type, "worker")
        val mgr = manager()
        val wt = Files.createTempDirectory("kilo-sibling-wt").toString()
        assertTrue(mgr.run(api.uniqueID, wt).ok)
        val first = launched.single()
        assertTrue(mgr.run(worker.uniqueID, wt).ok)

        // Exits on SIGTERM, so an unwanted reap would be visible as the process disappearing.
        val app = StubbornJvm.start(wt)
        try {
            start(first, StubbornHandler())
            start(launched.last(), NopProcessHandler())
            assertEquals(2, mgr.states.value.size)

            // Editing the api config replaces its clone while the worker is still running.
            (api.configuration as ParamsConfig).programParameters = "--changed"
            assertTrue(mgr.run(api.uniqueID, wt).ok)

            // The decision not to identify anything is made synchronously inside run(), so no reap is
            // pending by this point; the wait only proves nothing arrives late.
            Thread.sleep(REAP_GRACE_MS)
            assertTrue("sibling's app process must survive an unrelated config edit", app.isAlive)
            assertTrue(mgr.states.value.none { it.orphan })
        } finally {
            app.destroyForcibly()
        }
    }

    fun testCloneNameUsesStoredWorktreeLabel() = runBlocking {
        val type = register(paramsType("kilo.test.params.label"))
        val settings = add(type, "dev")
        val repo = requireNotNull(project.basePath)
        val wt = "$repo/.kilo/worktrees/feature"
        val store = Path.of(repo).resolve(".kilo").resolve("worktree-names.json")
        Files.createDirectories(store.parent)
        Files.writeString(store, """{"names":{"$wt":"My Feature"}}""")
        try {
            assertTrue(manager().run(settings.uniqueID, wt).ok)
            assertEquals("dev [My Feature]", launched.single().name)
        } finally {
            Files.deleteIfExists(store)
        }
    }

    fun testFocusReturnsFalseForUnknownProcess() = runBlocking {
        assertFalse(manager().focus("no-such-id", "/tmp/wt"))
    }

    fun testSecondStopForceKills() = runBlocking {
        val type = register(paramsType("kilo.test.params.kill"))
        val settings = add(type, "srv")
        val mgr = manager()
        val wt = "/tmp/kilo-kill-wt"
        assertTrue(mgr.run(settings.uniqueID, wt).ok)
        val clone = launched.single()

        val env = ExecutionEnvironment(DefaultRunExecutor.getRunExecutorInstance(), FakeRunner(), clone, project)
        val handler = StubbornHandler()
        handler.startNotify()
        project.messageBus.syncPublisher(ExecutionManager.EXECUTION_TOPIC)
            .processStarted(DefaultRunExecutor.EXECUTOR_ID, env, handler)

        assertTrue(mgr.stop(settings.uniqueID, wt))
        await("stopping state") { mgr.states.value.single().state == RunProcessState.STOPPING }
        assertFalse(handler.killed)

        assertTrue(mgr.stop(settings.uniqueID, wt))
        await("force kill") { handler.killed }
        assertEquals(RunProcessState.STOPPING, mgr.states.value.single().state)
    }

    fun testBuildIsUnavailableWithoutALinkedExternalProject() = runBlocking {
        val mgr = manager()

        // A bare test project links no Gradle root, so the popup must not offer build actions.
        assertFalse(mgr.configs().buildable)

        val result = mgr.build("/tmp/kilo-build-wt", clean = false)
        assertFalse(result.ok)
        assertEquals("project has no buildable external project", result.error)
        assertTrue(launched.isEmpty())
        assertTrue(mgr.states.value.isEmpty())
    }

    // ------ fixtures ------

    /**
     * Termination goes through the platform's `stopProcess`, which runs off the calling thread, so
     * assertions wait for the observable outcome instead of assuming it already happened.
     *
     * [budget] exists for the orphan path only: reaping forks `ps` and polls on a fixed interval, so
     * under a loaded suite it legitimately needs longer than a handler state change. [detail] is
     * reported on failure, which is what tells a reap that found nothing apart from a slow one.
     */
    private fun await(what: String, budget: Long = WAIT_NANOS, detail: () -> Any? = { null }, cond: () -> Boolean) {
        val end = System.nanoTime() + budget
        while (!cond()) {
            check(System.nanoTime() < end) { "timed out waiting for $what${detail()?.let { " (last: $it)" } ?: ""}" }
            Thread.sleep(1)
        }
    }

    private fun manager() = WorktreeRunManager(project, cs) { launched += it }

    /** Publishes the platform's `processStarted` for [clone], as a real launch would. */
    private fun <T : ProcessHandler> start(clone: RunnerAndConfigurationSettings, handler: T): T {
        val env = ExecutionEnvironment(DefaultRunExecutor.getRunExecutorInstance(), FakeRunner(), clone, project)
        return handler.also {
            it.startNotify()
            project.messageBus.syncPublisher(ExecutionManager.EXECUTION_TOPIC)
                .processStarted(DefaultRunExecutor.EXECUTOR_ID, env, it)
        }
    }

    private fun start(clone: RunnerAndConfigurationSettings) = start(clone, NopProcessHandler())

    private fun <T : ConfigurationType> register(type: T): T {
        ConfigurationType.CONFIGURATION_TYPE_EP.point.registerExtension(type, testRootDisposable)
        return type
    }

    /** Marks the test module as imported by Gradle, which is what makes a config delegable. */
    private fun link() {
        ExternalSystemModulePropertyManager.getInstance(module).setExternalId(ProjectSystemId("GRADLE"))
    }

    /**
     * Registers a real [ProjectTaskRunner] on the real EP, standing in for `GradleProjectTaskRunner`:
     * it turns the run configuration into an external-system task execution the way the Gradle
     * provider does — root project path from the main checkout, fully qualified task path.
     */
    private fun delegatingRunner(accept: (RunProfile) -> Boolean = { true }): DelegatingRunner {
        val root = "${requireNotNull(project.basePath)}/api-gateway"
        val runner = DelegatingRunner(root, ":api-gateway:bootRun", esType("kilo.test.es.delegated"), accept)
        register(runner.type)
        ProjectTaskRunner.EP_NAME.point.registerExtension(runner, testRootDisposable)
        return runner
    }

    private fun applicationType() = register(PlainApplicationType())

    private fun add(type: ConfigurationTypeBase, name: String): RunnerAndConfigurationSettings {
        val manager = RunManager.getInstance(project)
        val settings = manager.createConfiguration(name, type.configurationFactories[0])
        manager.addConfiguration(settings)
        added.add(settings)
        return settings
    }

    private fun paramsType(id: String) = TestType(id) { project, factory, name -> ParamsConfig(project, factory, name) }

    private fun plainType(id: String) = TestType(id) { project, factory, name -> PlainConfig(project, factory, name) }

    private fun moduleType(id: String) = TestType(id) { project, factory, name -> ModuleParamsConfig(project, factory, name) }

    private fun esType(id: String) = TestType(id) { project, factory, name ->
        ExternalSystemRunConfiguration(ProjectSystemId("KILO_TEST"), project, factory, name).also {
            // A blank path makes the platform look up the registered external system on clone,
            // which does not exist for a synthetic test id; seed it so cloning stays local.
            it.settings.externalProjectPath = project.basePath
        }
    }

    private class TestType(
        id: String,
        private val create: (Project, ConfigurationFactory, String) -> RunConfiguration,
    ) : ConfigurationTypeBase(id, "Kilo Params $id", null, null as javax.swing.Icon?) {
        init {
            addFactory(object : ConfigurationFactory(this) {
                override fun getId(): String = type.id
                override fun createTemplateConfiguration(project: Project): RunConfiguration = create(project, this, "")
            })
        }
    }

    private open class PlainConfig(project: Project, factory: ConfigurationFactory, name: String) :
        RunConfigurationBase<Any>(project, factory, name) {
        override fun getConfigurationEditor(): SettingsEditor<out RunConfiguration> = throw UnsupportedOperationException()

        override fun getState(executor: Executor, environment: ExecutionEnvironment): RunProfileState? = null
    }

    private class ParamsConfig(project: Project, factory: ConfigurationFactory, name: String) :
        PlainConfig(project, factory, name), CommonProgramRunConfigurationParameters {
        private var dir: String? = null
        private var params: String? = null
        private var env: MutableMap<String, String> = mutableMapOf()
        private var parent = true

        override fun setProgramParameters(value: String?) {
            params = value
        }

        override fun getProgramParameters(): String? = params

        override fun setWorkingDirectory(value: String?) {
            dir = value
        }

        override fun getWorkingDirectory(): String? = dir

        override fun setEnvs(envs: MutableMap<String, String>) {
            env = HashMap(envs)
        }

        override fun getEnvs(): MutableMap<String, String> = env

        override fun setPassParentEnvs(passParentEnvs: Boolean) {
            parent = passParentEnvs
        }

        override fun isPassParentEnvs(): Boolean = parent

        /** Persist the custom fields so the manager's fingerprint sees source edits, like real configs. */
        override fun writeExternal(element: Element) {
            super.writeExternal(element)
            element.setAttribute("kiloEnv", env.toSortedMap().toString())
            element.setAttribute("kiloDir", dir ?: "")
            element.setAttribute("kiloParams", params ?: "")
        }

        override fun clone(): RunConfiguration {
            val copy = super.clone() as ParamsConfig
            copy.env = HashMap(env)
            return copy
        }
    }

    /**
     * Module-based + params: a Spring Boot / Application shaped config. The adapter must not transplant
     * it — its classpath would come from the main checkout — so it goes through the delegated path.
     */
    private open class ModuleParamsConfig(project: Project, factory: ConfigurationFactory, name: String) :
        ModuleBasedConfiguration<RunConfigurationModule, Any>(name, RunConfigurationModule(project), factory),
        CommonProgramRunConfigurationParameters {
        var main: String? = null
        var profiles: String? = null
        private var dir: String? = "\$PROJECT_DIR\$/nested"
        private var params: String? = null
        private var env: MutableMap<String, String> = mutableMapOf()
        private var parent = true

        override fun getValidModules(): Collection<Module> = emptyList()

        override fun getConfigurationEditor(): SettingsEditor<out RunConfiguration> = throw UnsupportedOperationException()

        override fun getState(executor: Executor, environment: ExecutionEnvironment): RunProfileState? = null

        override fun setProgramParameters(value: String?) {
            params = value
        }

        override fun getProgramParameters(): String? = params

        override fun setWorkingDirectory(value: String?) {
            dir = value
        }

        override fun getWorkingDirectory(): String? = dir

        override fun setEnvs(envs: MutableMap<String, String>) {
            env = HashMap(envs)
        }

        override fun getEnvs(): MutableMap<String, String> = env

        override fun setPassParentEnvs(passParentEnvs: Boolean) {
            parent = passParentEnvs
        }

        override fun isPassParentEnvs(): Boolean = parent

        /**
         * Persist the custom fields so the manager's fingerprint sees source edits, like real configs.
         * The JVM option tags use the platform's own names so a plain application copy can read them
         * back, and [PROFILES_OPTION] stands in for framework state that no plain copy can hold.
         */
        override fun writeExternal(element: Element) {
            super.writeExternal(element)
            element.setAttribute("kiloEnv", env.toSortedMap().toString())
            main?.let { element.addContent(PlainApplicationConfig.option(PlainApplicationConfig.MAIN_CLASS, it)) }
            dir?.let { element.addContent(PlainApplicationConfig.option(PlainApplicationConfig.WORKING_DIR, it)) }
            profiles?.let { element.addContent(PlainApplicationConfig.option(PROFILES_OPTION, it)) }
        }

        companion object {
            /** Stands in for Spring Boot's active profiles. */
            const val PROFILES_OPTION = "ACTIVE_PROFILES"
        }
    }

    /**
     * Stands in for `GradleProjectTaskRunner`: builds an external-system run configuration for the
     * given task path, recording the run profile it was handed so tests can prove the manager passes a
     * worktree-rebased clone rather than the user's own configuration.
     */
    private class DelegatingRunner(
        private val root: String,
        private val task: String,
        val type: ConfigurationTypeBase,
        private val accept: (RunProfile) -> Boolean,
    ) : ProjectTaskRunner() {
        var seen: RunProfile? = null
        var produced: RunnerAndConfigurationSettings? = null
        var calls = 0

        // Abstract in the platform base class. The manager deliberately never consults canRun — a
        // worktree run has no non-delegated fallback — so the value is irrelevant here.
        @Suppress("removal", "OVERRIDE_DEPRECATION")
        override fun canRun(projectTask: ProjectTask): Boolean = false

        override fun createExecutionEnvironment(
            project: Project,
            task: ExecuteRunConfigurationTask,
            executor: Executor?,
        ): ExecutionEnvironment? {
            calls++
            seen = task.runProfile
            if (!accept(task.runProfile)) return null
            val settings = RunManager.getInstance(project).createConfiguration("delegated", type.configurationFactories[0])
            val config = settings.configuration as ExternalSystemRunConfiguration
            config.settings.externalProjectPath = root
            config.settings.taskNames = listOf(this.task)
            produced = settings
            return ExecutionEnvironment(DefaultRunExecutor.getRunExecutorInstance(), FakeRunner(), settings, project)
        }
    }



    private class StubTask : BeforeRunTask<StubTask>(KEY) {
        companion object {
            val KEY = Key.create<StubTask>("kilo.test.before")
        }
    }

    private class FakeRunner : ProgramRunner<RunnerSettings> {
        override fun getRunnerId(): String = "kilo.test.runner"

        override fun canRun(executorId: String, profile: RunProfile): Boolean = true

        override fun execute(environment: ExecutionEnvironment) = Unit
    }

    private class StubbornHandler : ProcessHandler(), KillableProcess {
        var killed = false

        override fun destroyProcessImpl() = Unit

        override fun detachProcessImpl() = Unit

        override fun detachIsDefault(): Boolean = false

        override fun getProcessInput(): OutputStream? = null

        override fun canKillProcess(): Boolean = true

        override fun killProcess() {
            killed = true
        }
    }
}
