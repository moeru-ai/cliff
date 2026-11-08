import type { Cli } from './cli'

import process from 'node:process'

import { constants } from 'node:os'

import { errorMessageFrom } from '@moeru/std'

export interface RunOptions {
  /** Defaults to `process.argv.slice(2)`. */
  argv?: readonly string[]
  /** Aborts `context.signal` together with SIGINT and SIGTERM, e.g. `AbortSignal.timeout(ms)`. */
  signal?: AbortSignal
}

/**
 * Backs `cli.run()`. Runs `cli` as the process entrypoint with real stdio, `process.exitCode`,
 * and an abort signal.
 *
 * The first SIGINT or SIGTERM aborts `context.signal` so commands can stop gracefully. The
 * listeners are `once`, so a second signal falls through to Node's default and terminates.
 * Errors a command throws are printed as `<name>: <message>` with exit code 1, including the
 * reason of an aborted `options.signal`.
 */
export async function runProcess(cli: Pick<Cli, 'execute' | 'name'>, options: RunOptions = {}): Promise<void> {
  const controller = new AbortController()
  let received: NodeJS.Signals | undefined
  const abort = (name: NodeJS.Signals) => {
    received = name
    controller.abort()
  }
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal

  process.once('SIGINT', abort)
  process.once('SIGTERM', abort)

  try {
    process.exitCode = await cli.execute(options.argv ?? process.argv.slice(2), {
      cwd: process.cwd(),
      env: process.env,
      stderr: process.stderr,
      stdin: process.stdin,
      stdout: process.stdout,
    }, { signal })
  }
  catch (error) {
    // A command that rethrows the abort reason after SIGINT/SIGTERM is a clean interruption,
    // so it exits like a process killed by that signal (130 for SIGINT) without a message.
    if (received && error === controller.signal.reason) {
      process.exitCode = 128 + constants.signals[received]
      return
    }

    process.stderr.write(`${cli.name}: ${errorMessageFrom(error) ?? 'Unknown error'}\n`)
    process.exitCode = 1
  }
  finally {
    process.off('SIGINT', abort)
    process.off('SIGTERM', abort)
  }
}
