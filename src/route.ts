import type { Command } from './command'
import type { ResolvedFlag } from './flags'
import type { CommandTree } from './tree'

import { UsageError } from './errors'
import { indexFlags } from './tree'

export interface Route {
  /** argv for the parser: command-name tokens removed, nothing from the first bare `--`. */
  argv: string[]
  help: boolean
  /** Commands from the CLI root (inclusive) to the selected command. */
  nodes: Command[]
  rest: string[]
  /** Flag tokens the selected command does not declare, as typed (`--nope`, `-x`). */
  unknown: string[]
  /** First positional on a command that has children but matched none of them. */
  unmatched?: string
  version: boolean
}

/**
 * Finds the selected command and splits argv for the parser in one left-to-right pass.
 *
 * Routing has to know whether a flag consumes the next token: in `cli --config x lint`,
 * `x` is a value, not a command name. Flags of the command reached so far are looked up
 * first; a flag that only a deeper command declares (`cli --config x lint`, where `lint`
 * declares `--config`) falls back to `treeIndex`, which holds every flag in the tree.
 * Whether the flag is actually accepted is checked against the selected command afterwards,
 * which is what `unknown` reports.
 */
export function resolveRoute(tree: CommandTree, argv: readonly string[]): Route {
  const { flagsOf, index: treeIndex, root } = tree
  const hasVersion = tree.version !== undefined
  const nodes: Command[] = [root]
  const parserArgv: string[] = []
  const flagTokens: Array<{ name: string, token: string, type: 'long' | 'short' }> = []
  let currentFlags = flagsOf(root)
  let currentIndex = indexFlags(currentFlags)
  let help = false
  let version = false
  let positionalSeen = false
  let unmatched: string | undefined

  const lookupLong = (name: string) => currentIndex.long.get(name) ?? treeIndex.long.get(name)
  const lookupShort = (name: string) => currentIndex.short.get(name) ?? treeIndex.short.get(name)
  const enter = (command: Command) => {
    nodes.push(command)
    currentFlags = flagsOf(command)
    currentIndex = indexFlags(currentFlags)
    positionalSeen = false
  }

  const separator = argv.indexOf('--')
  const tokens = separator === -1 ? argv : argv.slice(0, separator)
  const rest = separator === -1 ? [] : argv.slice(separator + 1)

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!

    if (token.startsWith('--')) {
      const equals = token.indexOf('=')
      const name = token.slice(2, equals === -1 ? undefined : equals)

      if (name === 'help') {
        help = true
        continue
      }

      if (name === 'version' && hasVersion) {
        version = true
        continue
      }

      flagTokens.push({ name, token, type: 'long' })

      const flag = lookupLong(name) ?? negatedBoolean(lookupLong, name)

      if (flag && flag.type !== 'boolean' && equals === -1) {
        index += 1
        parserArgv.push(`--${flag.long}=${takeValue(tokens, index, `--${flag.long}`)}`)
      }
      else {
        parserArgv.push(token)
      }

      continue
    }

    if (isShortFlagToken(token)) {
      // Known short flags are rewritten to their long form (`-ac x` -> `--all --config=x`).
      // Parsers differ on clusters, attached values, and values that look like flags
      // (cac reads `-c -1` as two flags); the `--flag=value` form is unambiguous to all of them.
      const characters = token.slice(1)

      for (let position = 0; position < characters.length; position += 1) {
        const character = characters[position]!

        if (character === 'h') {
          help = true
          continue
        }

        if (character === 'v' && hasVersion) {
          version = true
          continue
        }

        flagTokens.push({ name: character, token: `-${character}`, type: 'short' })

        const flag = lookupShort(character)

        if (!flag) {
          parserArgv.push(`-${character}`)
          continue
        }

        // A short alias of `--no-x` turns `x` off, so it has to keep the negation.
        if (flag.type === 'boolean') {
          parserArgv.push(flag.negated ? `--no-${flag.long}` : `--${flag.long}`)
          continue
        }

        // The rest of the cluster is the value: `-cfoo` means `-c foo`.
        const attached = characters.slice(position + 1)

        if (!attached) {
          index += 1
        }

        parserArgv.push(`--${flag.long}=${attached || takeValue(tokens, index, `-${character}`)}`)
        break
      }

      continue
    }

    const current = nodes.at(-1)!

    if (!positionalSeen && current.children) {
      const next = matchChild(current, token)

      if (next) {
        // The matched names are routing tokens, not positionals, so they never reach the parser.
        for (const command of next) {
          enter(command)
        }

        if (next.at(-1)!.name === token || next.at(-1)!.alias?.includes(token)) {
          continue
        }
      }

      const target = nodes.at(-1)!

      if (target.children && !target.action) {
        unmatched ??= token
      }
    }

    positionalSeen = true
    parserArgv.push(token)
  }

  // `cli` alone runs the default chain, but `cli --help` still shows the root help.
  if (!help && !positionalSeen) {
    for (let command = defaultChild(nodes.at(-1)!); command; command = defaultChild(command)) {
      enter(command)
    }
  }

  const routeLong = new Set(currentFlags.map(flag => flag.long))
  const routeShort = new Set(currentFlags.flatMap(flag => flag.short ?? []))
  const unknown = flagTokens
    .filter(({ name, type }) => type === 'long'
      ? !routeLong.has(name) && (!name.startsWith('no-') || !routeLong.has(name.slice(3)))
      : !routeShort.has(name))
    .map(({ token }) => token.split('=')[0]!)

  return { argv: parserArgv, help, nodes, rest, unknown, unmatched, version }
}

function defaultChild(command: Command): Command | undefined {
  return command.children?.find(child => child.default)
}

function isShortFlagToken(token: string): boolean {
  // `-` alone means stdin by convention and `-5` is a negative number; both are positionals.
  return token.startsWith('-') && token.length > 1 && !/^-\d/u.test(token)
}

/**
 * Returns the commands to enter for `token`: the matching child, or a chain through
 * `default` children that ends at a command matching it (or at a leaf that takes it as
 * a positional). Returns `undefined` when the token is a positional of `parent` itself.
 */
function matchChild(parent: Command, token: string): Command[] | undefined {
  const direct = parent.children?.find(child => child.name === token || child.alias?.includes(token))

  if (direct) {
    return [direct]
  }

  const fallback = defaultChild(parent)

  if (!fallback) {
    return undefined
  }

  return [fallback, ...(fallback.children && !fallback.action ? matchChild(fallback, token) ?? [] : [])]
}

function negatedBoolean(
  lookup: (name: string) => ResolvedFlag | undefined,
  name: string,
): ResolvedFlag | undefined {
  if (!name.startsWith('no-')) {
    return undefined
  }

  const flag = lookup(name.slice(3))

  return flag?.type === 'boolean' ? flag : undefined
}

function takeValue(tokens: readonly string[], index: number, spelling: string): string {
  const value = tokens[index]

  // A following flag means the value was forgotten; consuming it would silently swallow
  // that flag. Negative numbers and `-` (stdin/stdout by convention) still count as values.
  if (value === undefined || (value.startsWith('-') && value !== '-' && !/^-\d/u.test(value))) {
    throw new UsageError(`flag ${spelling} requires a value`)
  }

  return value
}
