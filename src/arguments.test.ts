import { describe, expect, it } from 'vitest'

import { bindArguments, resolveArguments } from './arguments'

const owner = 'command "tool"'

describe('resolveArguments', () => {
  it('turns kebab-case names into camelCase keys and help labels', () => {
    expect(resolveArguments([
      { description: '', name: 'report-path', required: true },
      { description: '', name: 'target' },
      { description: '', name: 'rest', variadic: true },
    ], owner).map(({ key, label }) => ({ key, label }))).toEqual([
      { key: 'reportPath', label: '<report-path>' },
      { key: 'target', label: '[target]' },
      { key: 'rest', label: '[...rest]' },
    ])
  })

  it.each([
    ['a malformed name', [{ description: '', name: 'two words' }], 'argument "two words" of command "tool" is not a valid name'],
    ['a variadic argument that is not last', [{ description: '', name: 'files', variadic: true }, { description: '', name: 'out' }], 'argument [...files] of command "tool" is variadic, so it must be last'],
    ['a required argument after an optional one', [{ description: '', name: 'a' }, { description: '', name: 'b', required: true }], 'argument <b> of command "tool" is required, so it cannot follow an optional argument'],
    ['two arguments with one key', [{ description: '', name: 'out-dir' }, { description: '', name: 'outDir' }], 'argument [outDir] of command "tool" clashes with argument [out-dir]'],
    ['a required argument with a default', [{ default: 'x', description: '', name: 'a', required: true }], 'argument <a> of command "tool" is required, so its default could never be used'],
  ])('rejects %s', (_, definitions, message) => {
    expect(() => resolveArguments(definitions, owner)).toThrow(message)
  })
})

describe('bindArguments', () => {
  it('requires at least one value for a required variadic argument', () => {
    expect(() => bindArguments(resolveArguments([{ description: '', name: 'files', required: true, variadic: true }], owner), []))
      .toThrow('missing required argument <...files>')
  })

  it('leaves absent optional arguments undefined', () => {
    expect(bindArguments(resolveArguments([
      { description: '', name: 'a', required: true },
      { description: '', name: 'b' },
    ], owner), ['x'])).toEqual({ a: 'x', b: undefined })
  })

  it('uses the default of an absent argument', () => {
    expect(bindArguments(resolveArguments([
      { default: 'dev', description: '', name: 'mode' },
      { default: ['a'], description: '', name: 'files', variadic: true },
    ], owner), [])).toEqual({ files: ['a'], mode: 'dev' })
  })

  it('rejects positionals beyond the last argument', () => {
    expect(() => bindArguments(resolveArguments([{ description: '', name: 'a' }], owner), ['x', 'y']))
      .toThrow('unexpected argument "y"')
  })
})
