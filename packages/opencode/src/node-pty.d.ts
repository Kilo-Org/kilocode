declare module "@lydell/node-pty" {
  export interface IPty {
    pid: number
    onData(listener: (data: string) => void): { dispose(): void }
    onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void }
    write(data: string): void
    resize(cols: number, rows: number): void
    kill(signal?: string): void
  }

  export interface IPtyForkOptions {
    name?: string
    cols?: number
    rows?: number
    cwd?: string
    env?: Record<string, string | undefined>
  }

  export function spawn(file: string, args: string[], opts: IPtyForkOptions): IPty
}
