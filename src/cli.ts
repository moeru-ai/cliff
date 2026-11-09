import type { ArgumentsDefinition } from './arguments'
import type { CommandDefinition } from './command'
import type { FlagsDefinition } from './flags'
import type { Help } from './help'
import type { Invocation } from './invocation'
import type { CliIo } from './io'
import type { RunOptions } from './main'
import type { ArgvParser } from './parser'
import type { UsageErrorReport } from './usage-error'

import { UsageError } from './errors'
import { renderHelp } from './help'
import { resolveInvocation } from './invocation'
import { nodeParser } from './parsers/node'
import { buildTree } from './tree'
import { renderUsageError } from './usage-error'

export interface Cli {
  /**
   * Runs one invocation without touching `process` and resolves to its exit code: the
   * action's own code, 0 for help and version, 2 for usage errors. Errors thrown by an
   * action are rethrown. An aborted `signal` rejects with its reason before the action runs.
   *
   * `argv` excludes the node executable and script path, as in `process.argv.slice(2)`.
   */
  execute: (argv: readonly string[], io: CliIo, options?: ExecuteOptions) => Promise<number>
  name: string
  /** Runs as the process entrypoint: process argv and stdio, `process.exitCode`, and signals. */
  run: (options?: RunOptions) => Promise<void>
}

export interface CliDefinition<
  TFlags extends FlagsDefinition = FlagsDefinition,
  TArguments extends ArgumentsDefinition = ArgumentsDefinition,
> extends Omit<CommandDefinition<TFlags, TArguments>, 'alias' | 'default'> {
  /** Defaults to the zero-dependency `node:util` `parseArgs` adapter. */
  parser?: ArgvParser
  /**
   * Turns the help of the selected command into the text written to stdout, e.g. to translate
   * it or lay it out differently. Defaults to the English `renderHelp`.
   */
  renderHelp?: (help: Help) => string
  /**
   * Turns a usage mistake into the text written to stderr; the exit code stays 2. Defaults to
   * the English `renderUsageError`.
   */
  renderUsageError?: (report: UsageErrorReport) => string
  /** Enables `--version` / `-v`, which print exactly this string. */
  version?: string
}

export interface ExecuteOptions {
  signal?: AbortSignal
}

export function createCli<
  const TFlags extends FlagsDefinition = [],
  const TArguments extends ArgumentsDefinition = [],
>(definition: CliDefinition<TFlags, TArguments>): Cli {
  const {
    parser = nodeParser,
    renderHelp: formatHelp = renderHelp,
    renderUsageError: formatUsageError = renderUsageError,
    version,
    ...root
  } = definition as CliDefinition
  const tree = buildTree(root, version)
  const writeOutcome = (invocation: Exclude<Invocation, { kind: 'action' }>, io: CliIo): number => {
    if (invocation.kind === 'help') {
      io.stdout.write(formatHelp(invocation.help))
      return 0
    }

    if (invocation.kind === 'version') {
      io.stdout.write(invocation.text)
      return 0
    }

    io.stderr.write(formatUsageError(invocation.report))
    return 2
  }

  const cli: Cli = {
    async execute(argv, io, options = {}) {
      // A signal that never aborts keeps `context.signal` non-optional for every action.
      const signal = options.signal ?? new AbortController().signal
      const invocation = await resolveInvocation(tree, parser, argv, signal)

      if (invocation.kind !== 'action') {
        return writeOutcome(invocation, io)
      }

      try {
        const result = await invocation.action({ ...invocation.context, io, signal })

        return typeof result === 'number' ? result : 0
      }
      catch (error) {
        // Actions may throw `UsageError` for checks the flag definitions cannot express,
        // such as two flags that exclude each other.
        if (error instanceof UsageError) {
          return writeOutcome({ kind: 'usage-error', report: { command: invocation.command, issue: error.issue, message: error.message } }, io)
        }

        throw error
      }
    },
    name: root.name,
    async run(options) {
      // Loaded on demand so `execute`-only consumers (tests, embedders) never load the
      // `process`-bound module.
      const { runProcess } = await import('./main')

      return runProcess(cli, options)
    },
  }

  return cli
}
