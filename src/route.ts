import type { Command } from './command'
import type { ResolvedOption } from './options'

import { UsageError } from './errors'

export interface OptionIndex {
  long: Map<string, ResolvedOption>
  short: Map<string, ResolvedOption>
}

export interface Route {
  /** argv for the parser: command-name tokens removed, nothing from the first bare `--`. */
  argv: string[]
  help: boolean
  /** Commands from the CLI root (inclusive) to the selected command. */
  nodes: Command[]
  rest: string[]
  /** Flag tokens that no command on the route declares, as typed (`--nope`, `-x`). */
  unknown: string[]
  /** First positional on a command that has children but matched none of them. */
  unmatched?: string
  version: boolean
}

export function indexOptions(options: Iterable<ResolvedOption>): OptionIndex {
  const index: OptionIndex = { long: new Map(), short: new Map() }

  for (const option of options) {
    if (!index.long.has(option.flag)) {
      index.long.set(option.flag, option)
    }

    if (option.short !== undefined && !index.short.has(option.short)) {
      index.short.set(option.short, option)
    }
  }

  return index
}

/**
 * Finds the selected command and splits argv for the parser in one left-to-right pass.
 *
 * Routing has to know whether a flag consumes the next token: in `cli --config x lint`,
 * `x` is a value, not a command name. Flags of commands on the route are known as soon as
 * the route reaches them; a flag that only a deeper command declares (`cli --dirty lint`)
 * falls back to `treeIndex`, which holds every option in the tree. Whether the flag is
 * actually allowed is checked against the final route afterwards, which is what `unknown`
 * reports.
 */
export function resolveRoute(
  root: Command,
  argv: readonly string[],
  resolved: ReadonlyMap<Command, readonly ResolvedOption[]>,
  treeIndex: OptionIndex,
  hasVersion: boolean,
): Route {
  const nodes: Command[] = [root]
  const parserArgv: string[] = []
  const flagTokens: Array<{ name: string, token: string, type: 'long' | 'short' }> = []
  const routeOptions: ResolvedOption[] = [...resolved.get(root) ?? []]
  let routeIndex = indexOptions(routeOptions)
  let help = false
  let version = false
  let positionalSeen = false
  let unmatched: string | undefined

  const lookupLong = (name: string) => routeIndex.long.get(name) ?? treeIndex.long.get(name)
  const lookupShort = (name: string) => routeIndex.short.get(name) ?? treeIndex.short.get(name)
  const enter = (command: Command) => {
    nodes.push(command)
    routeOptions.push(...resolved.get(command) ?? [])
    routeIndex = indexOptions(routeOptions)
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

      const option = lookupLong(name) ?? negatedBoolean(lookupLong, name)

      if (option && option.type !== 'boolean' && equals === -1) {
        index += 1
        parserArgv.push(`--${option.flag}=${takeValue(tokens, index, `--${option.flag}`)}`)
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

        const option = lookupShort(character)

        if (!option) {
          parserArgv.push(`-${character}`)
          continue
        }

        if (option.type === 'boolean') {
          parserArgv.push(`--${option.flag}`)
          continue
        }

        // The rest of the cluster is the value: `-cfoo` means `-c foo`.
        const attached = characters.slice(position + 1)

        if (!attached) {
          index += 1
        }

        parserArgv.push(`--${option.flag}=${attached || takeValue(tokens, index, `-${character}`)}`)
        break
      }

      continue
    }

    const current = nodes.at(-1)!

    if (!positionalSeen && current.commands) {
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

      if (target.commands && !target.run) {
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

  const routeLong = new Set(routeOptions.map(option => option.flag))
  const routeShort = new Set(routeOptions.flatMap(option => option.short ?? []))
  const unknown = flagTokens
    .filter(({ name, type }) => type === 'long'
      ? !routeLong.has(name) && (!name.startsWith('no-') || !routeLong.has(name.slice(3)))
      : !routeShort.has(name))
    .map(({ token }) => token.split('=')[0]!)

  return { argv: parserArgv, help, nodes, rest, unknown, unmatched, version }
}

function defaultChild(command: Command): Command | undefined {
  return command.commands?.find(child => child.default)
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
  const direct = parent.commands?.find(child => child.name === token || child.alias?.includes(token))

  if (direct) {
    return [direct]
  }

  const fallback = defaultChild(parent)

  if (!fallback) {
    return undefined
  }

  return [fallback, ...(fallback.commands && !fallback.run ? matchChild(fallback, token) ?? [] : [])]
}

function negatedBoolean(
  lookup: (name: string) => ResolvedOption | undefined,
  name: string,
): ResolvedOption | undefined {
  if (!name.startsWith('no-')) {
    return undefined
  }

  const option = lookup(name.slice(3))

  return option?.type === 'boolean' ? option : undefined
}

function takeValue(tokens: readonly string[], index: number, flag: string): string {
  const value = tokens[index]

  // A following flag means the value was forgotten; consuming it would silently swallow
  // that flag. Negative numbers and `-` (stdin/stdout by convention) still count as values.
  if (value === undefined || (value.startsWith('-') && value !== '-' && !/^-\d/u.test(value))) {
    throw new UsageError(`option ${flag} requires a value`)
  }

  return value
}
