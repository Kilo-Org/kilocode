package ai.kilocode.backend.run

import ai.kilocode.backend.testing.PlainApplicationConfig
import ai.kilocode.backend.testing.PlainApplicationType
import com.intellij.execution.BeforeRunTask
import com.intellij.execution.CommonProgramRunConfigurationParameters
import com.intellij.execution.Executor
import com.intellij.execution.RunManager
import com.intellij.execution.configurations.ConfigurationFactory
import com.intellij.execution.configurations.ConfigurationType
import com.intellij.execution.configurations.ConfigurationTypeBase
import com.intellij.execution.configurations.ModuleBasedConfiguration
import com.intellij.execution.configurations.RunConfiguration
import com.intellij.execution.configurations.RunConfigurationBase
import com.intellij.execution.configurations.RunConfigurationModule
import com.intellij.execution.configurations.RunProfileState
import com.intellij.execution.runners.ExecutionEnvironment
import com.intellij.openapi.externalSystem.ExternalSystemModulePropertyManager
import com.intellij.openapi.externalSystem.model.ProjectSystemId
import com.intellij.openapi.externalSystem.service.execution.ExternalSystemRunConfiguration
import com.intellij.openapi.module.Module
import com.intellij.openapi.options.SettingsEditor
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Key
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import org.jdom.Element
import java.nio.file.Path

class WorktreeRunDelegateTest : BasePlatformTestCase() {
    fun testSupportNamesTheConfigTypeWhenItIsNotModuleBased() {
        val settings = add(register(paramsType("kilo.test.delegate.plain")), "dev")
        assertEquals(
            WorktreeRunDelegate.Support.Skip("not module-based (ParamsConfig)"),
            WorktreeRunDelegate.support(settings.configuration),
        )
    }

    fun testSupportReportsAMissingModule() {
        val settings = add(register(moduleType("kilo.test.delegate.nomodule")), "mod")
        assertEquals(
            WorktreeRunDelegate.Support.Skip("no module assigned"),
            WorktreeRunDelegate.support(settings.configuration),
        )
    }

    fun testSupportReportsAModuleThatNoBuildSystemImported() {
        // Explicit: the light fixture shares one module across the class, so another test's link would
        // otherwise decide this one's outcome.
        ExternalSystemModulePropertyManager.getInstance(module).unlinkExternalOptions()
        val settings = add(register(moduleType("kilo.test.delegate.unlinked")), "mod")
        (settings.configuration as ModuleBasedConfiguration<*, *>).setModule(module)
        assertEquals(
            WorktreeRunDelegate.Support.Skip("module '${module.name}' was not imported by a build system"),
            WorktreeRunDelegate.support(settings.configuration),
        )
    }

    fun testSupportReturnsTheBuildSystemNameForALinkedModule() {
        ExternalSystemModulePropertyManager.getInstance(module).setExternalId(ProjectSystemId("GRADLE"))
        val settings = add(register(frameworkType("kilo.test.delegate.linked")), "mod")
        val config = settings.configuration as FrameworkConfig
        config.setModule(module)
        config.main = "com.example.App"
        assertEquals(
            WorktreeRunDelegate.Support.Delegate(ProjectSystemId("GRADLE").readableName),
            WorktreeRunDelegate.support(settings.configuration),
        )
    }

    fun testSupportSkipsALinkedModuleConfigThatRunsNoMainClass() {
        // The test-configuration shape: module-based and Gradle-imported, but nothing here can run it,
        // so it must not reach the popup and get a misleading "Run using Gradle" hint later.
        ExternalSystemModulePropertyManager.getInstance(module).setExternalId(ProjectSystemId("GRADLE"))
        val settings = add(register(frameworkType("kilo.test.delegate.nomain")), "tests")
        (settings.configuration as FrameworkConfig).setModule(module)
        assertEquals(
            WorktreeRunDelegate.Support.Skip("runs no main class"),
            WorktreeRunDelegate.support(settings.configuration),
        )
    }

    fun testTaskRebasesWorkingDirectoryAndMergesEnvOntoAClone() {
        val settings = add(register(paramsType("kilo.test.delegate.task")), "dev")
        val source = settings.configuration as ParamsConfig
        source.workingDirectory = "/repo/packages/kilo-jetbrains"
        source.envs = mutableMapOf("FOO" to "bar")

        val task = requireNotNull(WorktreeRunDelegate.task(source, "/repo/.kilo/worktrees/wt", "/repo"))
        val clone = task.runProfile as ParamsConfig
        assertNotSame(source, clone)
        assertEquals(Path.of("/repo/.kilo/worktrees/wt/packages/kilo-jetbrains").toString(), clone.workingDirectory)
        assertEquals("bar", clone.envs["FOO"])
        assertEquals("/repo/.kilo/worktrees/wt", clone.envs[WorktreeRunAdapter.WORKTREE_ENV])
        assertEquals("/repo", clone.envs[WorktreeRunAdapter.REPO_ENV])
        assertEquals("false", clone.envs[WorktreeRunAdapter.DEBUGGER_ENV])
        assertEquals("dev", task.presentableName)
        // The source configuration is untouched.
        assertEquals("/repo/packages/kilo-jetbrains", source.workingDirectory)
        assertEquals(setOf("FOO"), source.envs.keys)
    }

    fun testAdaptRebasesTheExternalProjectPathAndNamesTheClone() {
        val settings = add(register(esType("kilo.test.delegate.adapt")), "runApp")
        val config = settings.configuration as ExternalSystemRunConfiguration
        config.settings.externalProjectPath = "/repo/packages/kilo-jetbrains"
        config.beforeRunTasks = listOf(StubTask())
        config.isAllowRunningInParallel = true

        val result = WorktreeRunDelegate.DeriveResult(settings, config)
        WorktreeRunDelegate.adapt(result, "/repo/.kilo/worktrees/wt", "/repo", "wt", "dev")

        val expected = Path.of("/repo/.kilo/worktrees/wt/packages/kilo-jetbrains").toString()
        assertEquals(expected, config.settings.externalProjectPath)
        assertEquals("/repo/.kilo/worktrees/wt", config.settings.env[WorktreeRunAdapter.WORKTREE_ENV])
        assertEquals("/repo", config.settings.env[WorktreeRunAdapter.REPO_ENV])
        assertTrue(config.beforeRunTasks.isEmpty())
        assertFalse(config.isAllowRunningInParallel)
        assertEquals("dev [wt]", settings.name)
        assertTrue(settings.isActivateToolWindowBeforeRun)
    }

    fun testPlainCopiesSharedOptionsAndNamesTheDroppedOnes() {
        // The Spring Boot shape: an application configuration carrying framework-only state. The copy
        // keeps every option the plain application type understands and reports the rest.
        applicationType()
        val settings = add(register(frameworkType("kilo.test.delegate.plain.copy")), "HvApiGatewayApp")
        val source = settings.configuration as FrameworkConfig
        source.setModule(module)
        source.main = "com.example.HvApiGatewayApp"
        source.workingDirectory = "/repo/api-gateway"
        source.programParameters = "--server.port=9090"
        source.envs = mutableMapOf("FOO" to "bar")
        source.profiles = "dev"

        val plain = requireNotNull(WorktreeRunDelegate.plain(project, source, "/repo/.kilo/worktrees/wt", "/repo"))

        // Built from the registered "Application" type, which is what makes the build system's generic
        // application provider claim it.
        assertTrue(plain.config is PlainApplicationConfig)
        assertEquals("com.example.HvApiGatewayApp", (plain.config as PlainApplicationConfig).main)
        val copy = plain.config as CommonProgramRunConfigurationParameters
        assertEquals("--server.port=9090", copy.programParameters)
        assertEquals("bar", copy.envs["FOO"])
        // Rebased onto the worktree, like the direct delegation path.
        assertEquals(Path.of("/repo/.kilo/worktrees/wt/api-gateway").toString(), copy.workingDirectory)
        assertEquals("/repo/.kilo/worktrees/wt", copy.envs[WorktreeRunAdapter.WORKTREE_ENV])
        // Only the framework-only option is reported: the before-run element is dropped by every
        // worktree run anyway, and everything the target could read is not a loss.
        assertEquals(listOf(FrameworkConfig.PROFILES_OPTION), plain.dropped)
    }

    fun testPlainRefusesAConfigWithoutAMainClass() {
        // A test configuration has no main class, so running it as an application would be meaningless
        // rather than merely reduced.
        applicationType()
        val settings = add(register(frameworkType("kilo.test.delegate.plain.nomain")), "tests")
        (settings.configuration as FrameworkConfig).setModule(module)
        assertNull(WorktreeRunDelegate.plain(project, settings.configuration, "/repo/.kilo/worktrees/wt", "/repo"))
    }

    fun testPlainIsUnavailableWithoutTheApplicationConfigurationType() {
        // The non-JVM IDE case: no "Application" type is registered, so there is nothing to copy into
        // and the fallback declines instead of failing. This is also the default test platform, which
        // ships without the Java plugin.
        val settings = add(register(frameworkType("kilo.test.delegate.plain.nojava")), "app")
        val source = settings.configuration as FrameworkConfig
        source.setModule(module)
        source.main = "com.example.App"
        assertNull(WorktreeRunDelegate.plain(project, source, "/repo/.kilo/worktrees/wt", "/repo"))
    }

    fun testDeriveResultViaIsTheExternalSystemReadableName() {
        val settings = add(register(esType("kilo.test.delegate.via")), "runApp")
        val config = settings.configuration as ExternalSystemRunConfiguration
        assertEquals(ProjectSystemId("KILO_TEST").readableName, WorktreeRunDelegate.DeriveResult(settings, config).via)
    }

    // ------ fixtures ------

    private fun <T : ConfigurationType> register(type: T): T {
        ConfigurationType.CONFIGURATION_TYPE_EP.point.registerExtension(type, testRootDisposable)
        return type
    }

    /**
     * [RunManager.createConfiguration] only builds the [com.intellij.execution.RunnerAndConfigurationSettings]
     * instance; it is never added to the manager, so there is nothing to unregister after the test.
     */
    private fun add(type: ConfigurationTypeBase, name: String) =
        RunManager.getInstance(project).createConfiguration(name, type.configurationFactories[0])

    private fun paramsType(id: String) = TestType(id) { p, factory, name -> ParamsConfig(p, factory, name) }

    private fun moduleType(id: String) = TestType(id) { p, factory, name -> ModuleParamsConfig(p, factory, name) }

    private fun frameworkType(id: String) = TestType(id) { p, factory, name -> FrameworkConfig(p, factory, name) }

    private fun applicationType() = register(PlainApplicationType())



    private fun esType(id: String) = TestType(id) { p, factory, name ->
        ExternalSystemRunConfiguration(ProjectSystemId("KILO_TEST"), p, factory, name).also {
            // A blank path makes the platform look up the registered external system on clone, which
            // does not exist for a synthetic test id; seed it so cloning stays local.
            it.settings.externalProjectPath = p.basePath
        }
    }

    private class TestType(
        id: String,
        private val create: (Project, ConfigurationFactory, String) -> RunConfiguration,
    ) : ConfigurationTypeBase(id, "Kilo Delegate $id", null, null as javax.swing.Icon?) {
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

        override fun clone(): RunConfiguration {
            val copy = super.clone() as ParamsConfig
            copy.env = HashMap(env)
            return copy
        }
    }

    /** Module-based + params: what a Spring Boot/Application-style configuration looks like. */
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

    /**
     * The shape of a framework application configuration such as Spring Boot's: a module-based config
     * that serializes the same `MAIN_CLASS_NAME`/`PROGRAM_PARAMETERS`/`WORKING_DIRECTORY` options as a
     * plain application, plus one framework-only option that no plain application config can read.
     */
    private class FrameworkConfig(project: Project, factory: ConfigurationFactory, name: String) :
        ModuleBasedConfiguration<RunConfigurationModule, Any>(name, RunConfigurationModule(project), factory),
        CommonProgramRunConfigurationParameters {
        var main: String? = null
        var profiles: String? = null
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

        /** Mirrors how the platform's own JVM options serialize, so a plain copy can read them back. */
        override fun writeExternal(element: Element) {
            super.writeExternal(element)
            main?.let { element.addContent(PlainApplicationConfig.option(PlainApplicationConfig.MAIN_CLASS, it)) }
            dir?.let { element.addContent(PlainApplicationConfig.option(PlainApplicationConfig.WORKING_DIR, it)) }
            params?.let { element.addContent(PlainApplicationConfig.option(PlainApplicationConfig.PROGRAM_PARAMS, it)) }
            profiles?.let { element.addContent(PlainApplicationConfig.option(PROFILES_OPTION, it)) }
            if (env.isNotEmpty()) {
                val envs = Element("envs")
                env.forEach { (k, v) -> envs.addContent(Element("env").setAttribute("name", k).setAttribute("value", v)) }
                element.addContent(envs)
            }
        }

        companion object {
            /** Stands in for Spring Boot's active profiles: real state a plain application cannot hold. */
            const val PROFILES_OPTION = "ACTIVE_PROFILES"
        }
    }

    private class StubTask : BeforeRunTask<StubTask>(KEY) {
        companion object {
            val KEY = Key.create<StubTask>("kilo.test.delegate.before")
        }
    }
}
