import type { Command } from './command'
import type { ResolvedFlag } from './flags'

interface HelpSection {
  body: string
  title?: string
}

interface Row {
  description: string
  label: string
}

export function formatCommands(commands: readonly Command[]): string {
  return formatRows(commands.map(command => ({
    description: command.default ? `${command.description} (default)` : command.description,
    label: [
      [command.name, ...(command.alias ?? [])].join(', '),
      command.children ? '<command>' : command.arguments,
    ].filter(Boolean).join(' '),
  })))
}

/** Renders help for the last command in `nodes` (the CLI root is `nodes[0]`). */
export function renderHelp(
  nodes: readonly Command[],
  flagsOf: (command: Command) => readonly ResolvedFlag[],
  version: string | undefined,
): string {
  const command = nodes.at(-1)!
  const sections: HelpSection[] = [
    { body: command.help ?? command.description },
    { body: formatUsage(nodes).map(line => `  $ ${line}`).join('\n'), title: 'Usage' },
  ]

  if (command.children?.length) {
    sections.push({ body: formatCommands(command.children), title: 'Commands' })
  }

  sections.push({
    body: formatRows([
      ...flagsOf(command).map(flag => ({ description: formatFlagDescription(flag), label: formatFlagLabel(flag) })),
      { description: 'Show help', label: '-h, --help' },
      ...(version === undefined ? [] : [{ description: 'Show version', label: '-v, --version' }]),
    ]),
    title: 'Flags',
  })

  if (command.examples?.length) {
    sections.push({
      body: command.examples
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

function formatFlagDescription(flag: ResolvedFlag): string {
  const notes: string[] = []

  if (flag.multiple) {
    notes.push('repeatable')
  }

  // Booleans show their default through the `--no-` spelling, and an empty list is noise.
  const hidden = flag.type === 'boolean' || (Array.isArray(flag.default) && flag.default.length === 0)

  if (flag.default !== undefined && !hidden) {
    notes.push(`default: ${Array.isArray(flag.default) ? flag.default.join(', ') : String(flag.default)}`)
  }

  return notes.length > 0 ? `${flag.description} (${notes.join(', ')})` : flag.description
}

function formatFlagLabel(flag: ResolvedFlag): string {
  // Indent long-only flags so their `--` lines up with the flags that have a short alias.
  return flag.short === undefined ? `    ${flag.spelling}` : flag.spelling
}

function formatRows(rows: readonly Row[]): string {
  const width = Math.max(...rows.map(row => row.label.length))

  return rows.map(row => `  ${row.label.padEnd(width)}  ${row.description}`).join('\n')
}

function formatUsage(nodes: readonly Command[]): string[] {
  const command = nodes.at(-1)!
  const path = nodes.map(node => node.name).join(' ')
  const lines: string[] = []

  if (command.children?.length) {
    lines.push(`${path} <command> [flags]`)
  }

  if (command.action || !command.children?.length) {
    lines.push([path, command.arguments, '[flags]'].filter(Boolean).join(' '))
  }

  return lines
}
