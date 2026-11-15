import { describe, expect, it, vi } from 'vitest'

import {
  getFirstCharacter,
  isKeyboardEventKeyPrintableChar,
  isNullOrEmpty,
  translateWindowTitle,
} from '../../../../src/renderer/helpers/strings.js'

vi.mock('../../../../src/renderer/i18n/index', () => ({
  default: { global: { t: (key) => `t(${key})` } },
}))

describe('isNullOrEmpty', () => {
  it.each([
    [null, true],
    [undefined, true],
    ['', true],
    [' ', false],
    ['a', false],
    ['0', false],
  ])('isNullOrEmpty(%j) is %s', (input, expected) => {
    expect(isNullOrEmpty(input)).toBe(expected)
  })
})

describe('isKeyboardEventKeyPrintableChar', () => {
  it.each(['a', 'Z', '1', ' ', '/', 'é', 'ß'])('treats single character %j as printable', (key) => {
    expect(isKeyboardEventKeyPrintableChar(key)).toBe(true)
  })

  it.each(['Enter', 'Shift', 'ArrowLeft', 'F5', 'Escape', 'Tab', 'Dead', 'Unidentified'])('treats named key %j as not printable', (key) => {
    expect(isKeyboardEventKeyPrintableChar(key)).toBe(false)
  })

  it.each(['😀', '👍🏽', '🇩🇪', '👨‍👩‍👧'])('treats multi-code-unit emoji %j as printable', (key) => {
    expect(isKeyboardEventKeyPrintableChar(key)).toBe(true)
  })
})

describe('translateWindowTitle', () => {
  it.each([
    ['Subscriptions', 'Subscriptions.Subscriptions'],
    ['Channels', 'Channels.Title'],
    ['Trending', 'Trending.Trending'],
    ['Most Popular', 'Most Popular'],
    ['Your Playlists', 'User Playlists.Your Playlists'],
    ['History', 'History.History'],
    ['Settings', 'Settings.Settings'],
    ['About', 'About.About'],
    ['Profile Settings', 'Profile.Profile Settings'],
    ['Playlist', 'Playlist.Playlist'],
  ])('maps %j to the %j locale key', (title, key) => {
    expect(translateWindowTitle(title)).toBe(`t(${key})`)
  })

  it.each(['Watch', 'subscriptions', '', undefined])('returns null for unknown title %j', (title) => {
    expect(translateWindowTitle(title)).toBeNull()
  })
})

describe('getFirstCharacter', () => {
  it('returns an empty string for empty text', () => {
    expect(getFirstCharacter('', 'en-US')).toBe('')
  })

  it('returns the first letter of plain text', () => {
    expect(getFirstCharacter('FreeTube', 'en-US')).toBe('F')
  })

  it.each([
    ['🇩🇪 Germany', '🇩🇪'],
    ['👍🏽 thumbs', '👍🏽'],
    ['👨‍👩‍👧 family', '👨‍👩‍👧'],
    ['éclair', 'é'],
  ])('keeps a multi-codepoint grapheme together in %j', (text, expected) => {
    expect(getFirstCharacter(text, 'en-US')).toBe(expected)
  })

  it('falls back gracefully for an unusual locale', () => {
    expect(getFirstCharacter('abc', 'xx-invalid')).toBe('a')
  })
})
