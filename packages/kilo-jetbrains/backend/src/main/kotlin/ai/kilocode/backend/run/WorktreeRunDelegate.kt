package ai.kilocode.backend.run

import ai.kilocode.log.KiloLog
import com.intellij.execution.BeforeRunTask
import com.intellij.execution.CommonProgramRunConfigurationParameters
import com.intellij.execution.ExecutionTarget
import com.intellij.execution.RunManager
import com.intellij.execution.RunnerAndConfigurationSettings
import com.intellij.execution.configurations.ConfigurationPerRunnerSettings
import com.intellij.execution.configurations.ConfigurationType
import com.intellij.execution.configurations.ModuleBasedConfiguration
import com.intellij.execution.configurations.RunConfiguration
import com.intellij.execution.configurations.RunProfile
import com.intellij.execution.configurations.RunnerSettings
import com.intellij.execution.executors.DefaultRunExecutor
import com.intellij.openapi.externalSystem.ExternalSystemModulePropertyManager
import com.intellij.openapi.externalSystem.model.ProjectSystemId
import com.intellij.openapi.externalSystem.service.execution.ExternalSystemRunConfiguration
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.InvalidDataException
import com.intellij.openapi.util.WriteExternalException
import com.intellij.task.ExecuteRunConfigurationTask
import com.intellij.task.ProjectTaskRunner
import org.jdom.Element

/**
 * Delegates run configurations the platform's own build-system delegation pipeline knows how to run
 * (Application, Kotlin/Groovy app, Spring Boot, ...) into a worktree, by reusing
 * [ProjectTaskRunner]/`GradleExecutionEnvironmentProvider`-style extensions — the same machinery
 * behind "Delegate IDE build/run actions to Gradle". [WorktreeRunAdapter] covers the direct-transplant
 * path (external-system + CLI-style configs); this file covers everything else the IDE itself knows
 * how to hand off to a build tool.
 *
 * Why this runs the worktree's own code and not the main checkout's: the init script a Gradle
 * provider generates resolves the classpath from `project.sourceSets[...].runtimeClasspath` inside
 * the Gradle build itself, so once [adapt] rebases `externalProjectPath` onto the worktree, Gradle
 * computes the classpath from the worktree's build — nothing IDE-computed from the main checkout
 * ends up on it.
 */
internal object WorktreeRunDelegate {
    private val LOG = KiloLog.create(WorktreeRunDelegate::class.java)

    /**
     * What a user can do about a build system declining a configuration. IntelliJ ships one such
     * setting per framework — "Run using Gradle" under Advanced Settings, off by default for Spring
     * Boot so that its own run configuration keeps the endpoint tabs — and a worktree run has no way
     * to honour a configuration whose framework refuses to be built by Gradle.
     */
    const val DECLINED_HINT = "enable \"Run using Gradle\" in Settings | Advanced Settings, " +
        "or use Open in New Frame"

    /** Configuration type id of the platform's plain JVM application configuration. */
    private const val APPLICATION_TYPE = "Application"

    /** `JvmConfigurationOptions.mainClassName`'s option tag — present iff a config runs a main class. */
    private const val MAIN_CLASS = "MAIN_CLASS_NAME"

    private const val OPTION = "option"
    private const val BEFORE_RUN = "method"

    /** Whether a configuration can be delegated, or why it cannot — [Skip.reason] is for logs and errors. */
    sealed interface Support {
        /** [via] is the build system's readable name, e.g. "Gradle". */
        data class Delegate(val via: String) : Support

        data class Skip(val reason: String) : Support
    }

    /**
     * Listing probe: module properties and the configuration's own serialized state, no extension
     * dispatch, so it is safe to call for every configuration whenever the popup opens. Whether the
     * build system will actually accept the configuration is only known once [derive] runs it past the
     * delegation extensions.
     *
     * Requiring a main class is what keeps test configurations out of the popup. They are module-based
     * and Gradle-imported like an application is, so they would otherwise be offered and then fail at
     * run time with a hint about running applications through Gradle, which is not their problem — and
     * neither delegation path can run them: no application provider claims them, and [plain] refuses
     * anything without a main class.
     */
    fun support(config: RunConfiguration): Support {
        if (config !is ModuleBasedConfiguration<*, *>) {
            return Support.Skip("not module-based (${config.javaClass.simpleName})")
        }
        val module = config.configurationModule.module
            ?: return Support.Skip("no module assigned")
        val systemId = ExternalSystemModulePropertyManager.getInstance(module).getExternalSystemId()
        if (systemId.isNullOrEmpty()) {
            return Support.Skip("module '${module.name}' was not imported by a build system")
        }
        if (mainClass(config).isNullOrBlank()) {
            return Support.Skip("runs no main class")
        }
        return Support.Delegate(ProjectSystemId(systemId).readableName)
    }

    /** [MAIN_CLASS] from [config]'s serialized state, which every JVM application configuration writes. */
    private fun mainClass(config: RunConfiguration): String? {
        val element = Element("configuration")
        try {
            config.writeExternal(element)
        } catch (e: WriteExternalException) {
            LOG.warn("worktree run: cannot read ${config.name}'s state", e)
            return null
        }
        return options(element)[MAIN_CLASS]
    }

    /**
     * Runs [source] past the delegation extensions, falling back to [plain] when they all decline.
     * [Attempt.dropped] is empty unless the fallback was used.
     */
    fun delegate(project: Project, source: RunConfiguration, worktree: String, repo: String): Attempt? {
        task(source, worktree, repo)?.let { task ->
            derive(project, task)?.let { return Attempt(it, emptyList()) }
        }
        val plain = plain(project, source, worktree, repo) ?: return null
        LOG.info("worktree run: retrying '${source.name}' as a plain application, dropping ${plain.dropped}")
        val result = derive(project, Task(plain.config)) ?: return null
        return Attempt(result, plain.dropped)
    }

    /**
     * Builds the [ExecuteRunConfigurationTask] the platform's delegation extensions expect: a clone of
     * [source] with its working directory and environment already rebased onto [worktree], so whatever
     * init script a provider generates already points at the worktree. Keeps the clone as the exact
     * source type — providers match on it (e.g.
     * `task.runProfile.javaClass == ApplicationConfiguration::class.java`), so it must stay identical.
     */
    fun task(source: RunConfiguration, worktree: String, repo: String): ExecuteRunConfigurationTask? {
        // Same failure mode as ExternalSystemRunConfiguration.clone() in WorktreeRunAdapter: a missing
        // factory or a serialization round-trip failure, treated as unsupported rather than crashing.
        val clone = source.clone() ?: run {
            LOG.warn("worktree run: delegated clone failed for ${source.name}")
            return null
        }
        return Task(rebase(clone, worktree, repo))
    }

    /**
     * Copies [source] into a plain "Application" configuration so the build system's *generic*
     * application provider claims it, for frameworks whose own provider declines.
     *
     * This is the path that makes a Spring Boot configuration runnable in a worktree without touching
     * IDE-wide settings: `SpringBootGradleExecutionEnvironmentProvider` refuses unless the advanced
     * setting `spring.boot.run.using.gradle` is on, and turning that on would also reroute the user's
     * normal runs through `bootRun` and cost them the endpoint tabs. Gradle's generic
     * `GradleApplicationEnvironmentProvider` accepts only an exact `ApplicationConfiguration`
     * (`javaClass ==`), so a copy is required rather than a subclass instance; it then runs the app's
     * main class against the worktree's own runtime classpath — bare Gradle, no framework extras.
     *
     * The copy is a serialization round trip, which is what keeps this free of any Java-plugin
     * dependency: every field the two configurations share is an option of the same
     * `JvmMainMethodRunConfigurationOptions` (main class, module, program/VM parameters, working
     * directory, environment), so it transfers verbatim, and framework-only options are silently
     * dropped by the reader. [Plain.dropped] names exactly those, computed by writing the result back
     * out and diffing, so the caller can tell the user what will not apply instead of running
     * something subtly different in silence.
     *
     * Returns null when the copy carries no main class — the honest signal that [source] is not an
     * application configuration at all (a test configuration, say), so running it this way would be
     * meaningless rather than merely reduced.
     */
    fun plain(project: Project, source: RunConfiguration, worktree: String, repo: String): Plain? {
        val type = ConfigurationType.CONFIGURATION_TYPE_EP.extensionList.firstOrNull { it.id == APPLICATION_TYPE }
            ?: return null
        val factory = type.configurationFactories.firstOrNull() ?: return null
        val target = RunManager.getInstance(project).createConfiguration(source.name, factory).configuration
        val from = Element("configuration")
        val kept = Element("configuration")
        try {
            source.writeExternal(from)
            target.readExternal(from)
            target.writeExternal(kept)
        } catch (e: InvalidDataException) {
            LOG.warn("worktree run: cannot copy '${source.name}' into a plain application", e)
            return null
        } catch (e: WriteExternalException) {
            LOG.warn("worktree run: cannot copy '${source.name}' into a plain application", e)
            return null
        }
        if (options(kept)[MAIN_CLASS].isNullOrBlank()) {
            LOG.info("worktree run: '${source.name}' has no main class, not runnable as a plain application")
            return null
        }
        // `method` is the before-run task element, which every worktree run drops anyway.
        val dropped = (options(from).keys - options(kept).keys).filter { it != BEFORE_RUN }.sorted()
        return Plain(rebase(target, worktree, repo), dropped)
    }

    /** Points a configuration's working directory and environment at the worktree, in place. */
    private fun rebase(config: RunConfiguration, worktree: String, repo: String): RunConfiguration {
        if (config is CommonProgramRunConfigurationParameters) {
            config.workingDirectory = WorktreeRunAdapter.rebase(config.workingDirectory, repo, worktree)
            config.envs = HashMap(config.envs).apply { putAll(WorktreeRunAdapter.env(worktree, repo)) }
        }
        return config
    }

    /** Serialized option values by name, plus other child elements keyed by tag, e.g. `method`. */
    private fun options(element: Element): Map<String, String?> = element.children.associate {
        val name = it.getAttributeValue("name")
        if (it.name == OPTION && name != null) name to it.getAttributeValue("value") else it.name to null
    }

    /**
     * Asks every [ProjectTaskRunner] to build an execution environment for [task] — the same lookup
     * [com.intellij.task.ProjectTaskManager] performs for a delegated run — and returns the first one
     * that produces an external-system settings object. Deliberately skips each runner's own `canRun`
     * gate, which keys off the IDE-wide *Run using Gradle* preference: that preference is about the
     * user's normal runs, and a worktree run of a module-based configuration has no other way to work.
     *
     * A runner can still decline on its own terms — notably a framework provider extending
     * `CustomGradleApplicationEnvironmentProvider`, whose `shouldRunUsingGradle` reads a per-framework
     * advanced setting (`spring.boot.run.using.gradle` defaults to off). [DECLINED_HINT] is the
     * actionable part of that outcome. [ProjectTaskRunner.EP_NAME.computeSafeIfAny] logs and skips a
     * runner that throws, so a provider failing to resolve a JDK cannot break the whole lookup.
     */
    fun derive(project: Project, task: ExecuteRunConfigurationTask): DeriveResult? {
        val result = ProjectTaskRunner.EP_NAME.computeSafeIfAny<DeriveResult> { runner ->
            val env = runner.createExecutionEnvironment(project, task, DefaultRunExecutor.getRunExecutorInstance())
            val settings = env?.runnerAndConfigurationSettings
            val configuration = settings?.configuration as? ExternalSystemRunConfiguration
            LOG.debug {
                "worktree run: ${runner.javaClass.simpleName} -> " +
                    when {
                        env == null -> "declined"
                        settings == null -> "environment without run settings"
                        configuration == null -> "non-external-system ${settings.configuration.javaClass.simpleName}"
                        else -> "${configuration.settings.externalSystemId} ${configuration.settings.taskNames}"
                    }
            }
            if (settings != null && configuration != null) DeriveResult(settings, configuration) else null
        }
        if (result == null) {
            val runners = ProjectTaskRunner.EP_NAME.extensionList.joinToString { it.javaClass.simpleName }
            LOG.info("worktree run: no build system claimed '${task.presentableName}'; asked: $runners")
        }
        return result
    }

    /** Rebases the derived build-system settings onto [worktree] and names it like a direct transplant. */
    fun adapt(result: DeriveResult, worktree: String, repo: String, label: String, sourceName: String) {
        val task = result.configuration.settings
        task.externalProjectPath = WorktreeRunAdapter.rebase(task.externalProjectPath, repo, worktree)
        task.env = task.env + WorktreeRunAdapter.env(worktree, repo)
        // A "Build project" pre-step and parallel restart would target the main checkout, same as a
        // direct transplant.
        result.configuration.beforeRunTasks = emptyList<BeforeRunTask<*>>()
        result.configuration.isAllowRunningInParallel = false
        result.settings.name = "$sourceName [$label]"
        result.settings.isActivateToolWindowBeforeRun = true
    }

    /** A delegated run that is ready to execute. [dropped] names settings that will not apply. */
    class Attempt(val result: DeriveResult, val dropped: List<String>)

    /** [config] is a plain application copy; [dropped] names the source options it could not carry. */
    class Plain(val config: RunConfiguration, val dropped: List<String>)

    /** [settings]/[configuration] are the same object: [configuration] is [settings]'s configuration, narrowed. */
    class DeriveResult(
        val settings: RunnerAndConfigurationSettings,
        val configuration: ExternalSystemRunConfiguration,
    ) {
        val via: String get() = configuration.settings.externalSystemId.readableName
    }

    /**
     * Minimal [ExecuteRunConfigurationTask]: the platform's own impl lives in `com.intellij.task.impl`,
     * an internal package, so delegation extensions are implemented against the public interface only.
     * None of the community delegation extensions read [getExecutionTarget], [getRunnerSettings],
     * [getConfigurationSettings], or [getSettings] — only [getRunProfile] and [getPresentableName].
     */
    private class Task(private val profile: RunProfile) : ExecuteRunConfigurationTask {
        override fun getPresentableName(): String = profile.name
        override fun getRunProfile(): RunProfile = profile
        override fun getExecutionTarget(): ExecutionTarget? = null
        override fun getRunnerSettings(): RunnerSettings? = null
        override fun getConfigurationSettings(): ConfigurationPerRunnerSettings? = null
        override fun getSettings(): RunnerAndConfigurationSettings? = null
    }
}
