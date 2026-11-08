import type { CommandDefinition } from './command'
import type { FlagsDefinition } from './flags'
import type { Invocation } from './invocation'
import type { CliIo } from './io'
import type { RunOptions } from './main'
import type { ArgvParser } from './parser'

import { UsageError } from './errors'
import { formatCommands } from './help'
import { resolveInvocation } from './invocation'
import { nodeParser } from './parsers/node'
import { buildTree } from './tree'

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
  TArguments extends string = string,
> extends Omit<CommandDefinition<TFlags, TArguments>, 'alias' | 'default'> {
  /** Defaults to the zero-dependency `node:util` `parseArgs` adapter. */
  parser?: ArgvParser
  /** Enables `--version` / `-v`, which print exactly this string. */
  version?: string
}

export interface ExecuteOptions {
  signal?: AbortSignal
}

export function createCli<
  const TFlags extends FlagsDefinition = [],
  const TArguments extends string = '',
>(definition: CliDefinition<TFlags, TArguments>): Cli {
  const { parser = nodeParser, version, ...root } = definition as CliDefinition
  const tree = buildTree(root, version)

  const cli: Cli = {
    async execute(argv, io, options = {}) {
      // A signal that never aborts keeps `context.signal` non-optional for every action.
      const signal = options.signal ?? new AbortController().signal
      const invocation = await resolveInvocation(tree, parser, argv, signal)

      if (invocation.kind !== 'action') {
        return report(invocation, io)
      }

      try {
        const result = await invocation.action({ ...invocation.context, io, signal })

        return typeof result === 'number' ? result : 0
      }
      catch (error) {
        // Actions may throw `UsageError` for checks the flag definitions cannot express,
        // such as two flags that exclude each other.
        if (error instanceof UsageError) {
          return report({ kind: 'usage-error', message: error.message, usage: invocation.usage }, io)
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

function report(invocation: Exclude<Invocation, { kind: 'action' }>, io: CliIo): number {
  if (invocation.kind !== 'usage-error') {
    io.stdout.write(invocation.text)
    return 0
  }

  const commands = invocation.children ? ['', 'Commands', formatCommands(invocation.children)] : []

  io.stderr.write([
    `error: ${invocation.message}`,
    ...commands,
    '',
    `Run \`${invocation.usage} --help\` for usage.`,
    '',
  ].join('\n'))
  return 2
}
