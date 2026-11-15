import { describe, expect, it } from 'vitest'

import { IpcChannels, DBActions } from '../../src/constants.js'

describe('test harness', () => {
  it('imports source modules', () => {
    expect(IpcChannels.DB_SETTINGS).toBe('db-settings')
    expect(DBActions.GENERAL.CREATE).toBe(0)
  })

  it('applies the compile-time flags', () => {
    expect(process.env.IS_ELECTRON).toBe(false)
    expect(process.env.SUPPORTS_LOCAL_API).toBe(true)
  })
})
