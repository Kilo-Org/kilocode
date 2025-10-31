// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.ipc.proxy.interfaces

import ai.kilocode.jetbrains.ipc.proxy.LazyPromise

data class TerminalCommandDto(
    val commandLine: String?,
    val cwd: String?,
    val exitCode: Int?,
    val output: String?,
)

data class TerminalTabAction(
    val id: String,
    val label: String,
    val icon: Any?,
)

data class ReconnectionProperties(
    val ownerId: String,
    val data: Any?,
)

data class ShellLaunchConfigDto(
    val name: String?,
    val executable: String?,
    val args: List<String>?,
    val cwd: String?,
    val env: Map<String, String>?,
    val useShellEnvironment: Boolean?,
    val hideFromUser: Boolean?,
    val reconnectionProperties: Map<String, ReconnectionProperties>?,
    val type: String?,
    val isFeatureTerminal: Boolean?,
    val tabActions: List<TerminalTabAction>?,
    val shellIntegrationEnvironmentReporting: Boolean?,
)

data class TerminalDimensionsDto(
    val columns: Int,
    val rows: Int,
)

data class TerminalLaunchError(
    val message: String,
    val code: Int?,
)

data class TerminalProfile(
    val profileName: String,
    val path: String,
    val isDefault: Boolean,
    /**
     * Whether the terminal profile contains a potentially unsafe {@link path}. For example, the path
     * `C:\Cygwin` is the default install for Cygwin on Windows, but it could be created by any
     * user in a multi-user environment. As such, we don't want to blindly present it as a profile
     * without a warning.
     */
    val isUnsafePath: Boolean?,
    /**
     * An additional unsafe path that must exist, for example a script that appears in {@link args}.
     */
    val requiresUnsafePath: String?,
    val isAutoDetected: Boolean?,
    /**
     * Whether the profile path was found on the `$PATH` environment variable, if so it will be
     * cleaner to display this profile in the UI using only `basename(path)`.
     */
    val isFromPath: Boolean?,
    val args: List<String>?,
    val env: Map<String, String>?,
    val overrideName: Boolean?,
    val color: String?,
    val icon: Any?,
)

// export interface ExtHostTerminalServiceShape {
//    $acceptTerminalClosed(id: number, exitCode: number | undefined, exitReason: TerminalExitReason): void;
//    $acceptTerminalOpened(id: number, extHostTerminalId: string | undefined, name: string, shellLaunchConfig: IShellLaunchConfigDto): void;
//    $acceptActiveTerminalChanged(id: number | null): void;
//    $acceptTerminalProcessId(id: number, processId: number): void;
//    $acceptTerminalProcessData(id: number, data: string): void;
//    $acceptDidExecuteCommand(id: number, command: ITerminalCommandDto): void;
//    $acceptTerminalTitleChange(id: number, name: string): void;
//    $acceptTerminalDimensions(id: number, cols: number, rows: number): void;
//    $acceptTerminalMaximumDimensions(id: number, cols: number, rows: number): void;
//    $acceptTerminalInteraction(id: number): void;
//    $acceptTerminalSelection(id: number, selection: string | undefined): void;
//    $acceptTerminalShellType(id: number, shellType: TerminalShellType | undefined): void;
//    $startExtensionTerminal(id: number, initialDimensions: ITerminalDimensionsDto | undefined): Promise<ITerminalLaunchError | undefined>;
//    $acceptProcessAckDataEvent(id: number, charCount: number): void;
//    $acceptProcessInput(id: number, data: string): void;
//    $acceptProcessResize(id: number, cols: number, rows: number): void;
//    $acceptProcessShutdown(id: number, immediate: boolean): void;
//    $acceptProcessRequestInitialCwd(id: number): void;
//    $acceptProcessRequestCwd(id: number): void;
//    $acceptProcessRequestLatency(id: number): Promise<number>;
//    $provideLinks(id: number, line: string): Promise<ITerminalLinkDto[]>;
//    $activateLink(id: number, linkId: number): void;
//    $initEnvironmentVariableCollections(collections: [string, ISerializableEnvironmentVariableCollection][]): void;
//    $acceptDefaultProfile(profile: ITerminalProfile, automationProfile: ITerminalProfile): void;
//    $createContributedProfileTerminal(id: string, options: ICreateContributedTerminalProfileOptions): Promise<void>;
//    $provideTerminalQuickFixes(id: string, matchResult: TerminalCommandMatchResultDto, token: CancellationToken): Promise<SingleOrMany<TerminalQuickFix> | undefined>;
//    $provideTerminalCompletions(id: string, options: ITerminalCompletionContextDto, token: CancellationToken): Promise<TerminalCompletionListDto | undefined>;
// }

interface ExtHostTerminalServiceProxy {
    fun acceptTerminalClosed(id: Int, exitCode: Int?, exitReason: Int)
    fun acceptTerminalOpened(id: Int, extHostTerminalId: String?, name: String, shellLaunchConfig: ShellLaunchConfigDto)
    fun acceptActiveTerminalChanged(id: Int?)
    fun acceptTerminalProcessId(id: Int, processId: Int)
    fun acceptTerminalProcessData(id: Int, data: String)
    fun acceptDidExecuteCommand(id: Int, command: TerminalCommandDto)
    fun acceptTerminalTitleChange(id: Int, name: String)
    fun acceptTerminalDimensions(id: Int, cols: Int, rows: Int)
    fun acceptTerminalMaximumDimensions(id: Int, cols: Int, rows: Int)
    fun acceptTerminalInteraction(id: Int)
    fun acceptTerminalSelection(id: Int, selection: String?)
    fun acceptTerminalShellType(id: Int, shellType: String?)
    fun startExtensionTerminal(id: Int, initialDimensions: TerminalDimensionsDto?): LazyPromise
    fun acceptProcessAckDataEvent(id: Int, charCount: Int)
    fun acceptProcessInput(id: Int, data: String)
    fun acceptProcessResize(id: Int, cols: Int, rows: Int)
    fun acceptProcessShutdown(id: Int, immediate: Boolean)
    fun acceptProcessRequestInitialCwd(id: Int)
    fun acceptProcessRequestCwd(id: Int)
    fun acceptProcessRequestLatency(id: Int): LazyPromise
    fun provideLinks(id: Int, line: String): LazyPromise
    fun activateLink(id: Int, linkId: Int)
    fun initEnvironmentVariableCollections(collections: List<Pair<String, Any>>)
    fun acceptDefaultProfile(profile: TerminalProfile, automationProfile: TerminalProfile)
    fun createContributedProfileTerminal(id: String, options: Any): LazyPromise
    fun provideTerminalQuickFixes(id: String, matchResult: Any, token: Any): LazyPromise
    fun provideTerminalCompletions(id: String, options: Any, token: Any): LazyPromise
}
