import { toStandardJsonSchema as s } from '@valibot/to-json-schema'
import { describe, expectTypeOf, it } from 'vitest'

import * as v from 'valibot'

import { defineCommand, defineGlobalOptions } from './command'

describe('command context types', () => {
  it('infers options from their schemas', () => {
    defineCommand({
      description: '',
      name: 'lint',
      options: {
        dirty: { schema: s(v.optional(v.boolean(), false)) },
        format: { schema: s(v.optional(v.picklist(['stylish', 'json']), 'stylish')) },
        name: { schema: s(v.optional(v.string())) },
        port: { schema: s(v.pipe(v.string(), v.transform(Number))) },
        rule: { schema: s(v.optional(v.array(v.string()), [])) },
        timeoutMs: { schema: s(v.optional(v.number())) },
      },
      run: ({ options }) => {
        expectTypeOf(options.dirty).toEqualTypeOf<boolean>()
        expectTypeOf(options.format).toEqualTypeOf<'json' | 'stylish'>()
        expectTypeOf(options.name).toEqualTypeOf<string | undefined>()
        expectTypeOf(options.rule).toEqualTypeOf<string[]>()
        expectTypeOf(options.timeoutMs).toEqualTypeOf<number | undefined>()
        expectTypeOf(options.port).toEqualTypeOf<number>()
      },
    })
  })

  it('infers arguments from the pattern', () => {
    defineCommand({
      args: '<report-path> [target] [...files]',
      description: '',
      name: 'compare',
      run: ({ args }) => {
        expectTypeOf(args).toEqualTypeOf<{ files: string[], reportPath: string, target?: string }>()
      },
    })
  })

  it('types globals declared through defineGlobalOptions', () => {
    const globals = defineGlobalOptions({
      config: { schema: s(v.optional(v.string())) },
    })

    globals.defineCommand({
      description: '',
      name: 'lint',
      run: ({ globals }) => {
        expectTypeOf(globals.config).toEqualTypeOf<string | undefined>()
      },
    })
  })
})
