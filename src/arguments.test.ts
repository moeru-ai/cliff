import { describe, expect, it } from 'vitest'

import { bindArguments, parseArgumentPattern } from './arguments'

describe('parseArgumentPattern', () => {
  it('parses required, optional, and variadic arguments into camelCase keys', () => {
    expect(parseArgumentPattern('<report-path> [target] [...rest]')).toEqual([
      { key: 'reportPath', name: 'report-path', required: true, variadic: false },
      { key: 'target', name: 'target', required: false, variadic: false },
      { key: 'rest', name: 'rest', required: false, variadic: true },
    ])
  })

  it('rejects a variadic argument that is not last', () => {
    expect(() => parseArgumentPattern('[...files] <out>')).toThrow('must be last')
  })

  it('rejects a required argument after an optional one', () => {
    expect(() => parseArgumentPattern('[a] <b>')).toThrow('cannot follow an optional argument')
  })
})

describe('bindArguments', () => {
  it('requires at least one value for a required variadic argument', () => {
    expect(() => bindArguments(parseArgumentPattern('<...files>'), [])).toThrow('missing required argument <...files>')
  })

  it('leaves absent optional arguments undefined', () => {
    expect(bindArguments(parseArgumentPattern('<a> [b]'), ['x'])).toEqual({ a: 'x', b: undefined })
  })
})
