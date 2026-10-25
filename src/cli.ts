import type { CommandDefinition } from './command'
import type { FlagsDefinition } from './flags'
import type { Invocation } from './invocation'
import type { CliIo } from './io'
import type { ArgvParser } from './parser'

import { UsageError } from './errors'
import { formatCommands } from './help'
import { resolveInvocation } from './invocation'
import { nodeParser } from './parsers/node'
import { buildTree } from './tree'

export interface Cli {
  name: string
  /**
   * Runs one invocation and resolves to its exit code: the action's own code, 0 for help
   * and version, 2 for usage errors. Errors thrown by an action are rethrown.
   *
   * `argv` excludes the node executable and script path, as in `process.argv.slice(2)`.
   */
  run: (argv: readonly string[], io: CliIo, options?: RunOptions) => Promise<number>
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

export interface RunOptions {
  signal?: AbortSignal
}

export function createCli<
  const TFlags extends FlagsDefinition = [],
  const TArguments extends string = '',
>(definition: CliDefinition<TFlags, TArguments>): Cli {
  const { parser = nodeParser, version, ...root } = definition as CliDefinition
  const tree = buildTree(root, version)

  return {
    name: root.name,
    async run(argv, io, options = {}) {
      const invocation = await resolveInvocation(tree, parser, argv)

      if (invocation.kind !== 'action') {
        return report(invocation, io)
      }

      try {
        const result = await invocation.action({ ...invocation.context, io, signal: options.signal })

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
  }
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
