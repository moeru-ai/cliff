import type { Command } from './command'
import type { OptionSchema, ResolvedOption } from './options'

interface HelpSection {
  body: string
  title?: string
}

export function formatCommands(commands: readonly Command[]): string {
  const rows = commands.map(command => ({
    description: command.default ? `${command.description} (default)` : command.description,
    label: [
      [command.name, ...(command.alias ?? [])].join(', '),
      command.commands ? '<command>' : command.args,
    ].filter(Boolean).join(' '),
  }))

  return formatRows(rows)
}

/**
 * Renders help for the last command in `nodes` (the CLI root is `nodes[0]`).
 *
 * Options of the command itself are listed under "Options"; options inherited from the
 * root and ancestors are listed under "Global Options" so a leaf's help stays focused on
 * what that leaf adds.
 */
export function renderHelp(
  nodes: readonly Command[],
  resolved: ReadonlyMap<Command, readonly ResolvedOption[]>,
  version: string | undefined,
): string {
  const command = nodes.at(-1)!
  const isRoot = nodes.length === 1
  const builtins = builtinOptions(version)
  const own = resolved.get(command) ?? []
  const inherited = nodes.slice(0, -1).flatMap(node => resolved.get(node) ?? [])
  const sections: HelpSection[] = [
    { body: command.help ?? command.description },
    { body: formatUsage(nodes).map(line => `  $ ${line}`).join('\n'), title: 'Usage' },
  ]

  if (command.commands?.length) {
    sections.push({ body: formatCommands(command.commands), title: 'Commands' })
  }

  const options = isRoot ? [...own, ...builtins] : own
  const globals = isRoot ? [] : [...inherited, ...builtins]

  if (options.length > 0) {
    sections.push({ body: formatOptions(options), title: 'Options' })
  }

  if (globals.length > 0) {
    sections.push({ body: formatOptions(globals), title: 'Global Options' })
  }

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

// Built-in flags are handled by the router and never validated; the schema only fills the shape.
const builtinSchema: OptionSchema = {
  '~standard': {
    jsonSchema: { input: () => ({ type: 'boolean' }), output: () => ({ type: 'boolean' }) },
    validate: value => ({ value }),
    vendor: 'cliff',
    version: 1,
  },
}

function builtinOptions(version: string | undefined): ResolvedOption[] {
  const options: ResolvedOption[] = [
    { description: 'Show help', flag: 'help', key: 'help', multiple: false, schema: builtinSchema, short: 'h', type: 'boolean' },
  ]

  if (version !== undefined) {
    options.push({ description: 'Show version', flag: 'version', key: 'version', multiple: false, schema: builtinSchema, short: 'v', type: 'boolean' })
  }

  return options
}

function formatOptionDescription(option: ResolvedOption): string {
  const notes: string[] = []

  if (option.multiple) {
    notes.push('repeatable')
  }

  // Booleans show their default through the `--no-` spelling, and an empty list is noise.
  const hidden = option.type === 'boolean' || (Array.isArray(option.default) && option.default.length === 0)

  if (option.default !== undefined && !hidden) {
    notes.push(`default: ${Array.isArray(option.default) ? option.default.join(', ') : String(option.default)}`)
  }

  return notes.length > 0 ? `${option.description} (${notes.join(', ')})` : option.description
}

function formatOptionLabel(option: ResolvedOption): string {
  // A boolean that defaults to on is only useful in its negated form.
  const flag = option.type === 'boolean' && option.default === true
    ? `--no-${option.flag}`
    : `--${option.flag}`
  const short = option.short === undefined || option.default === true ? '    ' : `-${option.short}, `
  const value = option.type === 'boolean'
    ? ''
    : ` <${option.placeholder ?? (option.choices ? option.choices.join('|') : option.type === 'number' ? 'n' : 'value')}>`

  return `${short}${flag}${value}`
}

function formatOptions(options: readonly ResolvedOption[]): string {
  return formatRows(options.map(option => ({
    description: formatOptionDescription(option),
    label: formatOptionLabel(option),
  })))
}

function formatRows(rows: ReadonlyArray<{ description: string, label: string }>): string {
  const width = Math.max(...rows.map(row => row.label.length))

  return rows.map(row => `  ${row.label.padEnd(width)}  ${row.description}`).join('\n')
}

function formatUsage(nodes: readonly Command[]): string[] {
  const command = nodes.at(-1)!
  const path = nodes.map(node => node.name).join(' ')
  const lines: string[] = []

  if (command.commands?.length) {
    lines.push(`${path} <command> [options]`)
  }

  if (command.run || !command.commands?.length) {
    lines.push([path, command.args, '[options]'].filter(Boolean).join(' '))
  }

  return lines
}
