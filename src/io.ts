/**
 * Process-free I/O handed to every command.
 *
 * Commands write through these streams instead of `process.*` or `console.*`, so tests can
 * call `cli.run(argv, createMemoryIo())` and assert on captured text. cliff itself only
 * writes to `stdout` and `stderr`; `cwd`, `env`, and `stdin` are passed through for actions,
 * and `runMain` fills them from the process.
 */
export interface CliIo {
  cwd?: string
  env?: NodeJS.ProcessEnv
  stderr: CliWritable
  stdin?: CliReadable
  stdout: CliWritable
}

export interface CliReadable extends NodeJS.ReadableStream {
  isTTY?: boolean
}

export interface CliWritable {
  columns?: number
  isTTY?: boolean
  rows?: number
  write: (chunk: string) => unknown
}
