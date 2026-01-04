// Type declarations for @lydell/node-pty
// This file provides TypeScript definitions for the node-pty module

declare module "@lydell/node-pty" {
	export interface IBasePtyForkOptions {
		/**
		 * Name of the terminal to be set in environment ($TERM variable).
		 */
		name?: string

		/**
		 * Number of initial cols of the pty.
		 */
		cols?: number

		/**
		 * Number of initial rows of the pty.
		 */
		rows?: number

		/**
		 * The working directory to be set for the terminal.
		 */
		cwd?: string

		/**
		 * Environment variables for the terminal.
		 */
		env?: { [key: string]: string | undefined }
	}

	export interface IPtyForkOptions extends IBasePtyForkOptions {
		/**
		 * Whether to use UTF8 encoding.
		 */
		encoding?: string

		/**
		 * Whether to handle flow control.
		 */
		handleFlowControl?: boolean

		/**
		 * Whether to use conpty on Windows.
		 */
		useConpty?: boolean

		/**
		 * Whether to use conpty shell integration.
		 */
		useConptyShell?: boolean
	}

	export interface IWindowsPtyForkOptions extends IBasePtyForkOptions {
		/**
		 * Whether to use UTF8 encoding.
		 */
		encoding?: string

		/**
		 * Whether to handle flow control.
		 */
		handleFlowControl?: boolean

		/**
		 * Whether to use conpty on Windows.
		 */
		useConpty?: boolean

		/**
		 * Whether to use conpty shell integration.
		 */
		useConptyShell?: boolean
	}

	/**
	 * An object that can be disposed via a dispose function.
	 */
	export interface IDisposable {
		dispose(): void
	}

	/**
	 * An event that can be listened to.
	 * @returns an `IDisposable` to stop listening.
	 */
	export interface IEvent<T> {
		(listener: (e: T) => any): IDisposable
	}

	export interface IPty {
		/**
		 * The process ID of the outer process.
		 */
		readonly pid: number

		/**
		 * The column size in characters.
		 */
		readonly cols: number

		/**
		 * The row size in characters.
		 */
		readonly rows: number

		/**
		 * The title of the active process.
		 */
		readonly process: string

		/**
		 * (EXPERIMENTAL)
		 * Whether to handle flow control. Useful to disable/re-enable flow control during runtime.
		 * Use this for binary data that is likely to contain the `flowControlPause` string by accident.
		 */
		handleFlowControl: boolean

		/**
		 * Adds an event listener for when a data event fires. This happens when data is returned from
		 * the pty.
		 * @returns an `IDisposable` to stop listening.
		 */
		readonly onData: IEvent<string>

		/**
		 * Adds an event listener for when an exit event fires. This happens when the pty exits.
		 * @returns an `IDisposable` to stop listening.
		 */
		readonly onExit: IEvent<{ exitCode: number; signal?: number }>

		/**
		 * Resizes the dimensions of the pty.
		 * @param columns The number of columns to use.
		 * @param rows The number of rows to use.
		 */
		resize(columns: number, rows: number): void

		/**
		 * Write data to the terminal.
		 */
		write(data: string): void

		/**
		 * Kill the terminal process.
		 */
		kill(): void

		/**
		 * Whether the terminal process is still running.
		 */
		killed: boolean
	}

	/**
	 * Forks a process as a pseudoterminal.
	 * @param file The file to launch.
	 * @param args The file's arguments as argv (string[]) or in a pre-escaped CommandLine format
	 * (string). Note that the CommandLine option is only available on Windows and is expected to be
	 * escaped properly.
	 * @param options The options of the terminal.
	 */
	export function spawn(
		file: string,
		args: string[] | string,
		options: IPtyForkOptions | IWindowsPtyForkOptions,
	): IPty
}
