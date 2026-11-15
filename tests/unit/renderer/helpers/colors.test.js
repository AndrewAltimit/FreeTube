import { describe, expect, it, vi } from 'vitest'

import {
  calculateColorLuminance,
  colors,
  getRandomColor,
  getRandomColorClass,
} from '../../../../src/renderer/helpers/colors.js'

// colors.js pulls in utils.js, which imports i18n and the router.
vi.mock('../../../../src/renderer/i18n/index', () => ({ default: { global: { t: (key) => key } } }))
vi.mock('../../../../src/renderer/router/index', () => ({ default: { push: () => {} } }))

describe('colors', () => {
  it('has unique names and values that are valid 6-digit hex colours', () => {
    const names = colors.map(c => c.name)
    expect(new Set(names).size).toBe(names.length)

    for (const { value } of colors) {
      expect(value).toMatch(/^#[\da-f]{6}$/i)
    }
  })
})

describe('getRandomColor / getRandomColorClass', () => {
  it('picks the colour indexed by Math.random', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(getRandomColor()).toBe(colors[0])
    expect(getRandomColorClass()).toBe('mainRed')
  })

  it('never goes out of bounds', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9999999)
    expect(getRandomColor()).toBe(colors.at(-1))
  })
})

describe('calculateColorLuminance', () => {
  it.each([
    ['#000000', '#FFFFFF'],
    ['#ffffff', '#000000'],
    ['#FFD600', '#000000'],
    ['#d50000', '#FFFFFF'],
    ['#304FFE', '#FFFFFF'],
  ])('6-digit hex %s gives text colour %s', (input, expected) => {
    expect(calculateColorLuminance(input)).toBe(expected)
  })

  it('expands 3-digit hex shorthand', () => {
    expect(calculateColorLuminance('#fff')).toBe('#000000')
    expect(calculateColorLuminance('#000')).toBe('#FFFFFF')
    expect(calculateColorLuminance('#ff0')).toBe('#000000')
  })

  it('ignores the alpha channel of 8-digit hex', () => {
    expect(calculateColorLuminance('#ffffff00')).toBe('#000000')
  })

  it.each([
    ['rgb(255, 255, 255)', '#000000'],
    ['rgb(0, 0, 0)', '#FFFFFF'],
    ['rgba(255, 255, 255, 0.1)', '#000000'],
    ['rgb(250.5 250.5 250.5)', '#000000'],
  ])('rgb notation %s gives %s', (input, expected) => {
    expect(calculateColorLuminance(input)).toBe(expected)
  })

  it('treats luminance of exactly 0.5 as dark', () => {
    // 0.299 * x + 0.587 * x + 0.114 * x = x, so grey 127.5 is exactly 0.5
    expect(calculateColorLuminance('rgb(127.5, 127.5, 127.5)')).toBe('#FFFFFF')
  })

  it.each(['red', '', '#zzzzzz', 'transparent'])('falls back to white for unparseable %j', (input) => {
    expect(calculateColorLuminance(input)).toBe('#FFFFFF')
  })
})
