import type { UsageIssue } from './errors'
import type { HelpCommand } from './help'

import { formatCommands } from './help'

/** What `renderUsageError` receives for one usage mistake. */
export interface UsageErrorReport {
  /** The command path the `--help` hint points at: `tool config`. */
  command: string
  /** The children of `command`, set when cliff found a missing or unknown subcommand. */
  commands?: readonly HelpCommand[]
  /** Undefined for a `UsageError` an action threw without one. */
  issue?: UsageIssue
  /** The default English message, which is also `UsageError.message`. */
  message: string
}

/** The default English usage error text. */
export function renderUsageError(report: UsageErrorReport): string {
  const commands = report.commands ? ['', 'Commands', formatCommands(report.commands)] : []

  return [
    `error: ${report.message}`,
    ...commands,
    '',
    `Run \`${report.command} --help\` for usage.`,
    '',
  ].join('\n')
}
