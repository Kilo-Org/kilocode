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
import java.nio.file.Path

class WorktreeRunManagerTest : BasePlatformTestCase() {
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
        val handler = NopProcessHandler()
        handler.startNotify()
        val bus = project.messageBus.syncPublisher(ExecutionManager.EXECUTION_TOPIC)

        bus.processStarted(DefaultRunExecutor.EXECUTOR_ID, env, handler)
        assertEquals(
            listOf(RunStateDto(settings.uniqueID, clone.name, wt, RunProcessState.RUNNING)),
            mgr.states.value,
        )

        assertTrue(mgr.stop(settings.uniqueID, wt))
        assertEquals(RunProcessState.STOPPING, mgr.states.value.single().state)
        // NopProcessHandler terminates synchronously on destroy — proves destroyProcess was called.
        assertTrue(handler.isProcessTerminated)

        bus.processTerminated(DefaultRunExecutor.EXECUTOR_ID, env, handler, 0)
        assertTrue(mgr.states.value.isEmpty())
        assertFalse(mgr.stop(settings.uniqueID, wt))
    }

    fun testEditedSourceCreatesFreshCloneAndKeepsTracking() = runBlocking {
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

        source.envs = mutableMapOf("PORT" to "3001")
        assertTrue(mgr.run(settings.uniqueID, wt).ok)
        val second = launched[1]
        assertNotSame(first, second)
        assertEquals("3001", (second.configuration as ParamsConfig).envs["PORT"])

        val env2 = ExecutionEnvironment(DefaultRunExecutor.getRunExecutorInstance(), FakeRunner(), second, project)
        val handler2 = NopProcessHandler().also { it.startNotify() }
        bus.processStarted(DefaultRunExecutor.EXECUTOR_ID, env2, handler2)
        assertEquals(RunProcessState.RUNNING, mgr.states.value.single().state)

        // The replaced clone's termination must not clear the current process.
        bus.processTerminated(DefaultRunExecutor.EXECUTOR_ID, env1, handler1, 0)
        assertEquals(1, mgr.states.value.size)
        bus.processTerminated(DefaultRunExecutor.EXECUTOR_ID, env2, handler2, 0)
        assertTrue(mgr.states.value.isEmpty())
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
        assertFalse(handler.killed)
        assertTrue(mgr.stop(settings.uniqueID, wt))
        assertTrue(handler.killed)
        assertEquals(RunProcessState.STOPPING, mgr.states.value.single().state)
    }

    // ------ fixtures ------

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
