package ai.kilocode.backend.run

import ai.kilocode.rpc.dto.RunProcessState
import ai.kilocode.rpc.dto.RunStateDto
import com.intellij.execution.BeforeRunTask
import com.intellij.execution.CommonProgramRunConfigurationParameters
import com.intellij.execution.ExecutionManager
import com.intellij.execution.Executor
import com.intellij.execution.RunManager
import com.intellij.execution.RunnerAndConfigurationSettings
import com.intellij.execution.configurations.ConfigurationFactory
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
import com.intellij.openapi.externalSystem.model.ProjectSystemId
import com.intellij.openapi.externalSystem.service.execution.ExternalSystemRunConfiguration
import com.intellij.openapi.module.Module
import com.intellij.openapi.options.SettingsEditor
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Key
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

    fun testConfigsListsOnlySupportedTypes() {
        val params = register(paramsType("kilo.test.params.list"))
        val plain = register(plainType("kilo.test.plain.list"))
        val moduled = register(moduleType("kilo.test.module.list"))
        add(params, "dev")
        add(plain, "app")
        add(moduled, "mod")

        val configs = manager().configs().configs
        val names = configs.map { it.name }
        assertTrue("dev" in names)
        assertFalse("app" in names)
        assertFalse("mod" in names)
        assertEquals("Kilo Params kilo.test.params.list", configs.first { it.name == "dev" }.type)
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
     */
    private fun await(what: String, cond: () -> Boolean) {
        val end = System.nanoTime() + WAIT_NANOS
        while (!cond()) {
            check(System.nanoTime() < end) { "timed out waiting for $what" }
            Thread.sleep(1)
        }
    }

    private fun manager() = WorktreeRunManager(project, cs) { launched += it }

    private fun <T : ConfigurationType> register(type: T): T {
        ConfigurationType.CONFIGURATION_TYPE_EP.point.registerExtension(type, testRootDisposable)
        return type
    }

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

    /** Module-based + params: must be excluded — it would run main-checkout classes. */
    private class ModuleParamsConfig(project: Project, factory: ConfigurationFactory, name: String) :
        ModuleBasedConfiguration<RunConfigurationModule, Any>(name, RunConfigurationModule(project), factory),
        CommonProgramRunConfigurationParameters {
        private var dir: String? = null
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
