import type { ArgumentDefinition } from './arguments'
import type { Command } from './command'
import type { ResolvedFlag } from './flags'

import { parseArgumentPattern } from './arguments'
import { DefinitionError } from './errors'
import { resolveFlag } from './flags'

/** A validated command tree with every flag spelling and argument pattern parsed once. */
export interface CommandTree {
  argumentsOf: (command: Command) => readonly ArgumentDefinition[]
  flagsOf: (command: Command) => readonly ResolvedFlag[]
  /** Every flag in the tree, used by routing to tell value flags from booleans early. */
  index: FlagIndex
  root: Command
  version?: string
}

export interface FlagIndex {
  long: Map<string, ResolvedFlag>
  short: Map<string, ResolvedFlag>
}

/** Validates `root` and everything under it, throwing `DefinitionError` before any argv is seen. */
export function buildTree(root: Command, version: string | undefined): CommandTree {
  const argumentPatterns = new Map<Command, ArgumentDefinition[]>()
  const flags = new Map<Command, ResolvedFlag[]>()

  validateCommand(root, version !== undefined, argumentPatterns, flags)

  return {
    argumentsOf: command => argumentPatterns.get(command) ?? [],
    flagsOf: command => flags.get(command) ?? [],
    index: indexFlags([...flags.values()].flat()),
    root,
    version,
  }
}

export function indexFlags(flags: Iterable<ResolvedFlag>): FlagIndex {
  const index: FlagIndex = { long: new Map(), short: new Map() }

  for (const flag of flags) {
    if (!index.long.has(flag.long)) {
      index.long.set(flag.long, flag)
    }

    if (flag.short !== undefined && !index.short.has(flag.short)) {
      index.short.set(flag.short, flag)
    }
  }

  return index
}

function validateCommand(
  command: Command,
  hasVersion: boolean,
  argumentPatterns: Map<Command, ArgumentDefinition[]>,
  resolved: Map<Command, ResolvedFlag[]>,
): void {
  const where = `command "${command.name}"`
  const flags = (command.flags ?? []).map(definition => resolveFlag(definition, where))
  const reservedLongs = new Set(hasVersion ? ['help', 'version'] : ['help'])
  const reservedShorts = new Set(hasVersion ? ['h', 'v'] : ['h'])

  for (const [index, flag] of flags.entries()) {
    const label = `flag "${flag.spelling}" of ${where}`

    if (reservedLongs.has(flag.long) || (flag.short !== undefined && reservedShorts.has(flag.short))) {
      throw new DefinitionError(`${label} uses a name reserved for help or version.`)
    }

    // Spreading the same shared set twice, or declaring both `--cache` and `--no-cache`,
    // would make one key mean two flags.
    const clash = flags.slice(0, index).find(other =>
      other.key === flag.key || (flag.short !== undefined && other.short === flag.short))

    if (clash) {
      throw new DefinitionError(`${label} clashes with flag "${clash.spelling}".`)
    }
  }

  resolved.set(command, flags)
  argumentPatterns.set(command, parseArgumentPattern(command.arguments))

  const children = command.children ?? []

  if (children.length === 0 && !command.action) {
    throw new DefinitionError(`${where} has neither an action nor children, so running it could do nothing.`)
  }

  if (children.length > 0 && command.arguments && !command.action) {
    throw new DefinitionError(`${where} declares arguments but no action, so they can never be used.`)
  }

  const names = new Set<string>()
  const defaults = children.filter(child => child.default)

  if (defaults.length > 1) {
    throw new DefinitionError(`${where} has more than one default subcommand.`)
  }

  // A parent with its own action and a default child could not tell which one
  // `parent value` means.
  if (defaults.length === 1 && command.action) {
    throw new DefinitionError(`${where} has both an action and a default subcommand.`)
  }

  for (const child of children) {
    for (const name of [child.name, ...(child.alias ?? [])]) {
      if (names.has(name)) {
        throw new DefinitionError(`${where} has more than one subcommand named "${name}".`)
      }

      names.add(name)
    }

    validateCommand(child, hasVersion, argumentPatterns, resolved)
  }
}
