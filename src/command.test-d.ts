import { describe, expectTypeOf, it } from 'vitest'

import * as v from 'valibot'

import { defineCommand } from './command'
import { defineFlags } from './flags'

describe('command context types', () => {
  it('infers flags from their spellings, defaults, and schemas', () => {
    const sharedFlags = defineFlags([
      { description: '', flag: '-c, --config <path>' },
      { description: '', flag: '--no-cache' },
    ])

    defineCommand({
      action: ({ flags }) => {
        expectTypeOf(flags).toEqualTypeOf<{
          cache: boolean
          config: string | undefined
          dirty: boolean
          format: 'json' | 'stylish'
          level: 'high' | 'low' | undefined
          name: string | undefined
          port: number
          rule: string[]
          timeoutMs: number | undefined
        }>()
      },
      description: '',
      flags: [
        ...sharedFlags,
        { description: '', flag: '--dirty' },
        { default: 'stylish', description: '', flag: '-f, --format <stylish|json>' },
        { description: '', flag: '--level <low|high>' },
        { description: '', flag: '--name <name>' },
        { description: '', flag: '--port <port>', schema: v.pipe(v.string(), v.toNumber()) },
        { description: '', flag: '--rule <pattern...>' },
        { description: '', flag: '--timeout-ms <ms>', schema: v.optional(v.pipe(v.string(), v.toNumber())) },
      ],
      name: 'lint',
    })
  })

  it('infers arguments from the pattern', () => {
    defineCommand({
      action: ({ args }) => {
        expectTypeOf(args).toEqualTypeOf<{ files: string[], reportPath: string, target?: string }>()
      },
      arguments: '<report-path> [target] [...files]',
      description: '',
      name: 'compare',
    })
  })

  it('gives a command without flags an empty flags object', () => {
    defineCommand({
      action: ({ flags }) => {
        expectTypeOf(flags).toEqualTypeOf<Record<never, never>>()
      },
      description: '',
      name: 'noop',
    })
  })
})
