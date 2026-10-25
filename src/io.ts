/**
 * Process-free I/O handed to every command.
 *
 * Commands write through these streams instead of `process.*` or `console.*`,
 * so tests can call `cli.run(argv, fakeIo)` and assert on captured text.
 */
export interface CliIo {
  cwd: string
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
