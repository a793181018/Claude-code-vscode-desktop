declare module 'node-pty' {
  export interface IPty {
    pid: number
    write(data: string): void
    resize(columns: number, rows: number): void
    onData(callback: (data: string) => void): void
    onExit(callback: (result: { exitCode: number; signal?: number }) => void): void
    kill(signal?: string): void
  }

  export interface SpawnOptions {
    name?: string
    cols?: number
    rows?: number
    cwd?: string
    env?: Record<string, string>
    encoding?: string
  }

  export function spawn(
    file: string,
    args: string | string[],
    options: SpawnOptions,
  ): IPty

  export default { spawn }
}
