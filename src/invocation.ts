import type { Command, CommandContext } from './command'
import type { UsageIssue } from './errors'
import type { Help } from './help'
import type { ArgvParser } from './parser'
import type { CommandTree } from './tree'
import type { UsageErrorReport } from './usage-error'

import { bindArguments } from './arguments'
import { createUsageError, describeIssue, UsageError } from './errors'
import { normalizeFlagValue } from './flags'
import { listCommands, resolveHelp } from './help'
import { resolveRoute } from './route'
import { validateValue } from './schema'

/**
 * What one argv asks for, decided without running anything or writing output.
 *
 * `command` is the command path (`alint config`) that error hints point `--help` at.
 */
export type Invocation
  = | { action: NonNullable<Command['action']>, command: string, context: Omit<CommandContext, 'io' | 'signal'>, kind: 'action' }
    | { help: Help, kind: 'help' }
    | { kind: 'usage-error', report: UsageErrorReport }
    | { kind: 'version', text: string }

export async function resolveInvocation(
  tree: CommandTree,
  parser: ArgvParser,
  argv: readonly string[],
  signal?: AbortSignal,
): Promise<Invocation> {
  let path = tree.root.name

  signal?.throwIfAborted()

  try {
    const route = resolveRoute(tree, argv)
    const command = route.nodes.at(-1)!
    path = route.nodes.map(node => node.name).join(' ')

    if (route.help) {
      return { help: resolveHelp(tree, route.nodes), kind: 'help' }
    }

    if (route.version) {
      return { kind: 'version', text: `${tree.version}\n` }
    }

    // `buildTree` guarantees a command without an action has children.
    if (!command.action) {
      const issue: UsageIssue = route.unmatched === undefined
        ? { code: 'missing-command', command: path }
        : { code: 'unknown-command', command: path, received: route.unmatched }

      return {
        kind: 'usage-error',
        report: { command: path, commands: listCommands(tree, command.children ?? []), issue, message: describeIssue(issue) },
      }
    }

    if (route.unknown.length > 0 && !command.allowUnknownFlags) {
      throw createUsageError({ code: 'unknown-flag', flag: route.unknown[0]! })
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
      values[flag.key] = await validateValue(flag.schema, normalizeFlagValue(flag, parsed.flags[flag.key]), 'flag', `--${flag.long}`)

      // NOTICE: Standard Schema's `validate(value)` takes no signal, so an async schema that is
      // already running cannot be cancelled. Checking between flags is the earliest point an
      // abort can stop resolution.
      signal?.throwIfAborted()
    }

    const definitions = tree.argumentsOf(command)
    const bound = bindArguments(definitions, [...parsed.positionals, ...route.rest])
    const args: Record<string, unknown> = {}

    for (const argument of definitions) {
      args[argument.key] = await validateValue(argument.schema, bound[argument.key], 'argument', argument.label)

      // Same limit as for flags above: a running async schema cannot be cancelled.
      signal?.throwIfAborted()
    }

    return {
      action: command.action,
      command: path,
      context: {
        args,
        flags: values,
        path: route.nodes.slice(1).map(node => node.name),
        rest: route.rest,
      },
      kind: 'action',
    }
  }
  catch (error) {
    if (error instanceof UsageError) {
      return { kind: 'usage-error', report: { command: path, issue: error.issue, message: error.message } }
    }

    throw error
  }
}
