import type { ArgumentDefinition } from './arguments'
import type { Command, CommandDefinition, Globals } from './command'
import type { CliIo } from './io'
import type { InferOptions, OptionsDefinition, ResolvedOption } from './options'
import type { ArgvParser } from './parser'

import { bindArguments, parseArgumentPattern } from './arguments'
import { DefinitionError, UsageError } from './errors'
import { formatCommands, renderHelp } from './help'
import { normalizeOptionValue, resolveOption, validateOptionValue } from './options'
import { nodeParser } from './parsers/node'
import { indexOptions, resolveRoute } from './route'

export interface Cli {
  name: string
  /**
   * Runs one invocation and resolves to its exit code: the command's own code, 0 for help
   * and version, 2 for usage errors. Errors thrown by a command are rethrown.
   *
   * `argv` excludes the node executable and script path, as in `process.argv.slice(2)`.
   */
  run: (argv: readonly string[], io: CliIo, options?: RunOptions) => Promise<number>
}

export interface CliDefinition<
  TOptions extends OptionsDefinition = OptionsDefinition,
  TArguments extends string = string,
> extends Omit<CommandDefinition<TOptions, TArguments>, 'alias' | 'default'> {
  /** Defaults to the zero-dependency `node:util` `parseArgs` adapter. */
  parser?: ArgvParser
  /** Enables `--version` / `-v`, which print exactly this string. */
  version?: string
}

export interface RunOptions {
  signal?: AbortSignal
}

export function createCli<
  const TOptions extends OptionsDefinition = Record<never, never>,
  const TArguments extends string = '',
>(definition: CliDefinition<TOptions, TArguments>): Cli {
  const { parser = nodeParser, version, ...root } = definition as CliDefinition
  const argumentPatterns = new Map<Command, ArgumentDefinition[]>()
  const resolved = new Map<Command, ResolvedOption[]>()

  validateCommand(root, [], version !== undefined, argumentPatterns, resolved)

  const treeIndex = indexOptions([...resolved.values()].flat())

  return {
    name: root.name,
    async run(argv, io, options = {}) {
      let nodes: Command[] = [root]

      try {
        const route = resolveRoute(root, argv, resolved, treeIndex, version !== undefined)
        nodes = route.nodes

        const command = nodes.at(-1)!

        if (route.help) {
          io.stdout.write(renderHelp(nodes, resolved, version))
          return 0
        }

        if (route.version) {
          io.stdout.write(`${version}\n`)
          return 0
        }

        if (command.commands && !command.run) {
          io.stderr.write([
            route.unmatched === undefined
              ? `error: missing command for "${formatPath(nodes)}"`
              : `error: unknown command "${route.unmatched}" for "${formatPath(nodes)}"`,
            '',
            'Commands',
            formatCommands(command.commands),
            '',
            `Run \`${formatPath(nodes)} --help\` for usage.`,
            '',
          ].join('\n'))
          return 2
        }

        if (route.unknown.length > 0 && !nodes.some(node => node.allowUnknownOptions)) {
          throw new UsageError(`unknown option ${route.unknown[0]}`)
        }

        const ownOptions = resolved.get(command) ?? []
        const routeOptions = nodes.flatMap(node => resolved.get(node) ?? [])
        const parsed = parser.parse(route.argv, routeOptions.map(option => ({
          flag: option.flag,
          key: option.key,
          multiple: option.multiple,
          short: option.short,
          type: option.type,
        })))
        const values = new Map<string, unknown>()

        for (const option of routeOptions) {
          values.set(option.key, await validateOptionValue(option, normalizeOptionValue(option, parsed.flags[option.key])))
        }

        const ownKeys = new Set(ownOptions.map(option => option.key))
        const args = bindArguments(argumentPatterns.get(command) ?? [], [...parsed.positionals, ...route.rest])

        if (!command.run) {
          return 0
        }

        const result = await command.run({
          args,
          globals: pick(values, key => !ownKeys.has(key)),
          io,
          // Each value already passed its own schema, so it matches the command's inferred types.
          options: pick(values, key => ownKeys.has(key)) as InferOptions<OptionsDefinition>,
          path: nodes.slice(1).map(node => node.name),
          rest: route.rest,
          signal: options.signal,
        })

        return typeof result === 'number' ? result : 0
      }
      catch (error) {
        if (!(error instanceof UsageError)) {
          throw error
        }

        io.stderr.write(`error: ${error.message}\n\nRun \`${formatPath(nodes)} --help\` for usage.\n`)
        return 2
      }
    },
  }
}

function formatPath(nodes: readonly Command[]): string {
  return nodes.map(node => node.name).join(' ')
}

function pick(values: ReadonlyMap<string, unknown>, include: (key: string) => boolean): Globals {
  return Object.fromEntries([...values].filter(([key]) => include(key)))
}

/**
 * Rejects trees that would route or parse ambiguously, before any argv is seen.
 *
 * Options are checked per root-to-leaf path because that is the set one invocation parses
 * together; two unrelated leaves may reuse a flag with different meanings.
 */
function validateCommand(
  command: Command,
  inherited: readonly ResolvedOption[],
  hasVersion: boolean,
  argumentPatterns: Map<Command, ArgumentDefinition[]>,
  resolved: Map<Command, ResolvedOption[]>,
): void {
  const where = `command "${command.name}"`
  const own = Object.entries(command.options ?? {}).map(([key, option]) => resolveOption(key, option, where))
  const routeOptions = [...inherited, ...own]
  const reservedFlags = new Set(hasVersion ? ['help', 'version'] : ['help'])
  const reservedShorts = new Set(hasVersion ? ['h', 'v'] : ['h'])

  for (const option of own) {
    const label = `option "${option.key}" of ${where}`

    if (reservedFlags.has(option.flag) || (option.short !== undefined && reservedShorts.has(option.short))) {
      throw new DefinitionError(`${label} uses a flag reserved for help or version.`)
    }

    if (option.short !== undefined && !/^[a-z]$/iu.test(option.short)) {
      throw new DefinitionError(`${label} needs a single-letter short flag, received "${option.short}".`)
    }

    // `--no-cache` would be read as the negation of `cache` instead of an option named `noCache`.
    if (option.flag.startsWith('no-')) {
      throw new DefinitionError(`${label} is named like a negation. Declare "${option.key.slice(2, 3).toLowerCase()}${option.key.slice(3)}" with a default of true instead.`)
    }

    const clash = inherited.find(other =>
      other.key === option.key || other.flag === option.flag || (option.short !== undefined && other.short === option.short))

    if (clash) {
      throw new DefinitionError(`${label} clashes with option "${clash.key}" inherited from an ancestor command.`)
    }
  }

  resolved.set(command, own)
  argumentPatterns.set(command, parseArgumentPattern(command.args))

  if (command.commands?.length && command.args && !command.run) {
    throw new DefinitionError(`${where} declares arguments but no run, so they can never be used.`)
  }

  const children = command.commands ?? []
  const names = new Set<string>()
  const defaults = children.filter(child => child.default)

  if (defaults.length > 1) {
    throw new DefinitionError(`${where} has more than one default subcommand.`)
  }

  // A parent that runs itself and also has a default child could not tell which one
  // `parent value` means.
  if (defaults.length === 1 && command.run) {
    throw new DefinitionError(`${where} has both run and a default subcommand.`)
  }

  for (const child of children) {
    for (const name of [child.name, ...(child.alias ?? [])]) {
      if (names.has(name)) {
        throw new DefinitionError(`${where} has more than one subcommand named "${name}".`)
      }

      names.add(name)
    }

    validateCommand(child, routeOptions, hasVersion, argumentPatterns, resolved)
  }
}
