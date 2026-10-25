import type { Cli } from './cli'

import process from 'node:process'

import { errorMessageFrom } from '@moeru/std'

export interface RunMainOptions {
  /** Defaults to `process.argv.slice(2)`. */
  argv?: readonly string[]
}

/**
 * Runs `cli` as the process entrypoint: real stdio, `process.exitCode`, and an abort signal.
 *
 * The first SIGINT or SIGTERM aborts `context.signal` so commands can stop gracefully. The
 * listeners are `once`, so a second signal falls through to Node's default and terminates.
 * Errors a command throws are printed as `<name>: <message>` with exit code 1.
 */
export async function runMain(cli: Cli, options: RunMainOptions = {}): Promise<void> {
  const controller = new AbortController()
  const abort = () => controller.abort()

  process.once('SIGINT', abort)
  process.once('SIGTERM', abort)

  try {
    process.exitCode = await cli.run(options.argv ?? process.argv.slice(2), {
      cwd: process.cwd(),
      env: process.env,
      stderr: process.stderr,
      stdin: process.stdin,
      stdout: process.stdout,
    }, { signal: controller.signal })
  }
  catch (error) {
    process.stderr.write(`${cli.name}: ${errorMessageFrom(error) ?? 'Unknown error'}\n`)
    process.exitCode = 1
  }
  finally {
    process.off('SIGINT', abort)
    process.off('SIGTERM', abort)
  }
}
