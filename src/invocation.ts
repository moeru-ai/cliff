import type { Command, CommandContext } from './command'
import type { ArgvParser } from './parser'
import type { CommandTree } from './tree'

import { bindArguments } from './arguments'
import { UsageError } from './errors'
import { normalizeFlagValue, validateFlagValue } from './flags'
import { renderHelp } from './help'
import { resolveRoute } from './route'

/**
 * What one argv asks for, decided without running anything or writing output.
 *
 * `usage` is the command path (`alint config`) that error hints point `--help` at.
 */
export type Invocation
  = | { action: NonNullable<Command['action']>, context: Omit<CommandContext, 'io' | 'signal'>, kind: 'action', usage: string }
    | { children?: readonly Command[], kind: 'usage-error', message: string, usage: string }
    | { kind: 'help', text: string }
    | { kind: 'version', text: string }

export async function resolveInvocation(tree: CommandTree, parser: ArgvParser, argv: readonly string[]): Promise<Invocation> {
  let usage = tree.root.name

  try {
    const route = resolveRoute(tree, argv)
    const command = route.nodes.at(-1)!
    usage = route.nodes.map(node => node.name).join(' ')

    if (route.help) {
      return { kind: 'help', text: renderHelp(route.nodes, tree.flagsOf, tree.version) }
    }

    if (route.version) {
      return { kind: 'version', text: `${tree.version}\n` }
    }

    // `buildTree` guarantees a command without an action has children.
    if (!command.action) {
      return {
        children: command.children,
        kind: 'usage-error',
        message: route.unmatched === undefined
          ? `missing command for "${usage}"`
          : `unknown command "${route.unmatched}" for "${usage}"`,
        usage,
      }
    }

    if (route.unknown.length > 0 && !command.allowUnknownFlags) {
      throw new UsageError(`unknown flag ${route.unknown[0]}`)
    }

    const flags = tree.flagsOf(command)
    const parsed = parser.parse(route.argv, flags.map(flag => ({
      key: flag.key,
      long: flag.long,
      multiple: flag.multiple,
      short: flag.short,
      type: flag.type,
    })))
    const values: Record<string, unknown> = {}

    for (const flag of flags) {
      values[flag.key] = await validateFlagValue(flag, normalizeFlagValue(flag, parsed.flags[flag.key]))
    }

    return {
      action: command.action,
      context: {
        args: bindArguments(tree.argumentsOf(command), [...parsed.positionals, ...route.rest]),
        flags: values,
        path: route.nodes.slice(1).map(node => node.name),
        rest: route.rest,
      },
      kind: 'action',
      usage,
    }
  }
  catch (error) {
    if (error instanceof UsageError) {
      return { kind: 'usage-error', message: error.message, usage }
    }

    throw error
  }
}
