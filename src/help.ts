import type { Command } from './command'
import type { ResolvedFlag } from './flags'
import type { CommandTree } from './tree'

/**
 * Everything help shows for one command, taken from the definitions before any wording or
 * layout is applied. `renderHelp` turns it into the default English text.
 */
export interface Help {
  arguments: readonly HelpArgument[]
  /** The command path from the CLI name, as usage shows it: `tool providers ls`. */
  command: string
  commands: readonly HelpCommand[]
  description: string
  examples: readonly string[]
  /** Declared flags in order, then the built-in `--help` and, when enabled, `--version`. */
  flags: readonly HelpFlag[]
  /** The longer paragraph, when the command declares one. Default help shows it instead of `description`. */
  help?: string
  name: string
  /** Usage lines without the `$ ` prompt, such as `tool lint [...files] [flags]`. */
  usage: readonly string[]
}

export interface HelpArgument {
  /** Absent when help shows none, as for an empty list. */
  default?: unknown
  description: string
  /** `<name>`, `[name]`, `<...name>`, or `[...name]`. */
  label: string
  name: string
  required: boolean
  variadic: boolean
}

/** A built-in flag. It carries no description, so a renderer supplies its own text. */
export interface HelpBuiltinFlag {
  builtin: 'help' | 'version'
  /** `-h, --help` or `-v, --version`. */
  label: string
  long: string
  short: string
}

export interface HelpCommand {
  aliases: readonly string[]
  /** The arguments as usage shows them (`[...files]`), or empty. */
  argumentsLabel: string
  /** Runs when the parent receives no matching subcommand name. */
  default: boolean
  description: string
  hasChildren: boolean
  name: string
}

export interface HelpDeclaredFlag {
  builtin?: undefined
  /** The alternatives of a `<a|b>` placeholder. */
  choices?: readonly string[]
  /** Absent when help shows none: for booleans, whose `--no-` spelling tells it, and empty lists. */
  default?: unknown
  description: string
  /** The flag as written, such as `-c, --config <path>`. */
  label: string
  long: string
  repeatable: boolean
  short?: string
}

export type HelpFlag = HelpBuiltinFlag | HelpDeclaredFlag

/** One line of a two-column help list. */
export interface HelpRow {
  description: string
  label: string
}

export function formatCommands(commands: readonly HelpCommand[]): string {
  return formatRows(commands.map(command => ({
    description: command.default ? `${command.description} (default)` : command.description,
    label: [
      [command.name, ...command.aliases].join(', '),
      command.hasChildren ? '<command>' : command.argumentsLabel,
    ].filter(Boolean).join(' '),
  })))
}

/** Lays rows out as help does: indented, with the descriptions in one column after the widest label. */
export function formatRows(rows: readonly HelpRow[]): string {
  const width = Math.max(...rows.map(row => row.label.length))

  return rows.map(row => `  ${row.label.padEnd(width)}  ${row.description}`).join('\n')
}

export function listCommands(tree: CommandTree, commands: readonly Command[]): HelpCommand[] {
  return commands.map(command => ({
    aliases: command.alias ?? [],
    argumentsLabel: formatArguments(tree, command),
    default: command.default === true,
    description: command.description,
    hasChildren: (command.children?.length ?? 0) > 0,
    name: command.name,
  }))
}

/** The default English help text. */
export function renderHelp(help: Help): string {
  const sections: Array<{ body: string, title?: string }> = [
    { body: help.help ?? help.description },
    { body: help.usage.map(line => `  $ ${line}`).join('\n'), title: 'Usage' },
  ]

  if (help.arguments.length > 0) {
    sections.push({
      body: formatRows(help.arguments.map(argument => ({
        description: withNotes(argument.description, argument.default === undefined ? [] : [`default: ${formatValue(argument.default)}`]),
        label: argument.label,
      }))),
      title: 'Arguments',
    })
  }

  if (help.commands.length > 0) {
    sections.push({ body: formatCommands(help.commands), title: 'Commands' })
  }

  sections.push({
    body: formatRows(help.flags.map(flag => ({
      description: formatFlagDescription(flag),
      // Indent long-only flags so their `--` lines up with the flags that have a short alias.
      label: flag.short === undefined ? `    ${flag.label}` : flag.label,
    }))),
    title: 'Flags',
  })

  if (help.examples.length > 0) {
    sections.push({
      body: help.examples
        .map(example => example.split('\n').map(line => `  ${line}`).join('\n'))
        .join('\n\n'),
      title: 'Examples',
    })
  }

  return `${sections
    .filter(section => section.body)
    .map(section => section.title ? `${section.title}\n${section.body}` : section.body)
    .join('\n\n')}\n`
}

/** The help model of the last command in `nodes` (the CLI root is `nodes[0]`). */
export function resolveHelp(tree: CommandTree, nodes: readonly Command[]): Help {
  const command = nodes.at(-1)!
  const builtins: HelpBuiltinFlag[] = [{ builtin: 'help', label: '-h, --help', long: 'help', short: 'h' }]

  if (tree.version !== undefined) {
    builtins.push({ builtin: 'version', label: '-v, --version', long: 'version', short: 'v' })
  }

  return {
    arguments: tree.argumentsOf(command).map(argument => ({
      default: shownDefault(argument.default),
      description: argument.description,
      label: argument.label,
      name: argument.name,
      required: argument.required,
      variadic: argument.variadic,
    })),
    command: nodes.map(node => node.name).join(' '),
    commands: listCommands(tree, command.children ?? []),
    description: command.description,
    examples: command.examples ?? [],
    flags: [...tree.flagsOf(command).map(describeFlag), ...builtins],
    help: command.help,
    name: command.name,
    usage: formatUsage(tree, nodes),
  }
}

function describeFlag(flag: ResolvedFlag): HelpDeclaredFlag {
  return {
    choices: flag.choices,
    // A boolean's default is told by its `--no-` spelling, so help never shows it.
    default: flag.type === 'boolean' ? undefined : shownDefault(flag.default),
    description: flag.description,
    label: flag.spelling,
    long: flag.long,
    repeatable: flag.multiple,
    short: flag.short,
  }
}

function formatArguments(tree: CommandTree, command: Command): string {
  return tree.argumentsOf(command).map(argument => argument.label).join(' ')
}

function formatFlagDescription(flag: HelpFlag): string {
  if (flag.builtin !== undefined) {
    return flag.builtin === 'help' ? 'Show help' : 'Show version'
  }

  return withNotes(flag.description, [
    ...(flag.repeatable ? ['repeatable'] : []),
    ...(flag.default === undefined ? [] : [`default: ${formatValue(flag.default)}`]),
  ])
}

function formatUsage(tree: CommandTree, nodes: readonly Command[]): string[] {
  const command = nodes.at(-1)!
  const path = nodes.map(node => node.name).join(' ')
  const lines: string[] = []

  if (command.children?.length) {
    lines.push(`${path} <command> [flags]`)
  }

  if (command.action || !command.children?.length) {
    // Flags after the first argument of a passThrough command belong to what it runs.
    const parts = command.passThrough
      ? [path, '[flags]', formatArguments(tree, command)]
      : [path, formatArguments(tree, command), '[flags]']

    lines.push(parts.filter(Boolean).join(' '))
  }

  return lines
}

function formatValue(value: unknown): string {
  return Array.isArray(value) ? value.join(', ') : String(value)
}

/** The default as help shows it: an empty list is noise, so it counts as no default. */
function shownDefault(value: unknown): unknown {
  return Array.isArray(value) && value.length === 0 ? undefined : value
}

function withNotes(description: string, notes: readonly string[]): string {
  return notes.length > 0 ? `${description} (${notes.join(', ')})` : description
}
