import type { CliDefinition, Help, HelpFlag, UsageErrorReport, UsageIssue } from './index'

import { describe, expectTypeOf, it } from 'vitest'

import { createCli, renderHelp, renderUsageError } from './index'

describe('render hook types', () => {
  it('types the hooks as model in, text out', () => {
    expectTypeOf<CliDefinition['renderHelp']>().toEqualTypeOf<((help: Help) => string) | undefined>()
    expectTypeOf<CliDefinition['renderUsageError']>().toEqualTypeOf<((report: UsageErrorReport) => string) | undefined>()
    expectTypeOf(renderHelp).toEqualTypeOf<(help: Help) => string>()
    expectTypeOf(renderUsageError).toEqualTypeOf<(report: UsageErrorReport) => string>()

    createCli({
      action: () => 0,
      description: '',
      name: 'tool',
      renderHelp: (help) => {
        expectTypeOf(help).toEqualTypeOf<Help>()
        return renderHelp(help)
      },
      renderUsageError: (report) => {
        expectTypeOf(report.issue).toEqualTypeOf<undefined | UsageIssue>()
        return renderUsageError(report)
      },
    })
  })

  it('rejects hooks that do not return text', () => {
    // @ts-expect-error A hook returns the text cliff writes, not nothing.
    createCli({ action: () => 0, description: '', name: 'tool', renderHelp: () => {} })
  })

  it('narrows a help flag by builtin', () => {
    const textOf = (flag: HelpFlag): string => {
      if (flag.builtin !== undefined) {
        expectTypeOf(flag.builtin).toEqualTypeOf<'help' | 'version'>()
        expectTypeOf(flag).not.toHaveProperty('description')
        return flag.builtin
      }

      expectTypeOf(flag.description).toEqualTypeOf<string>()
      expectTypeOf(flag.repeatable).toEqualTypeOf<boolean>()
      return flag.description
    }

    expectTypeOf(textOf).parameter(0).toEqualTypeOf<HelpFlag>()
  })

  it('narrows a usage issue by code', () => {
    const textOf = (issue: UsageIssue): string => {
      switch (issue.code) {
        case 'flag-requires-value':
        case 'unknown-flag':
          expectTypeOf(issue.flag).toEqualTypeOf<string>()
          return issue.flag
        case 'invalid-choice':
          expectTypeOf(issue).toEqualTypeOf<{ choices: readonly string[], code: 'invalid-choice', flag: string, received: string }>()
          return issue.received
        case 'invalid-value':
          expectTypeOf(issue.target).toEqualTypeOf<'argument' | 'flag'>()
          expectTypeOf(issue.messages).toEqualTypeOf<readonly string[]>()
          return issue.label
        case 'missing-argument':
          return issue.argument
        case 'missing-command':
          // @ts-expect-error Only an unknown command has a received name.
          return issue.received
        case 'unexpected-argument':
          return issue.received
        case 'unknown-command':
          expectTypeOf(issue).toEqualTypeOf<{ code: 'unknown-command', command: string, received: string }>()
          return issue.command
      }
    }

    expectTypeOf(textOf).parameter(0).toEqualTypeOf<UsageIssue>()
  })
})
