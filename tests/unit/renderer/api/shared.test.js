import { describe, expect, it } from 'vitest'
import { Utils } from 'youtubei.js'
import { ClipParams } from '../../../../node_modules/youtubei.js/dist/protos/generated/misc/params'

import { parseVideoClipsParams } from '../../../../src/renderer/helpers/api/shared.js'

function encodeClipParams(data) {
  const bytes = ClipParams.encode({ clipParamData: { clipId: 'Ugkx', clipMetadata: '', ...data } }).finish()
  return encodeURIComponent(Utils.u8ToBase64(bytes))
}

describe('parseVideoClipsParams', () => {
  it('decodes the clip protobuf and converts times from ms to seconds', () => {
    const params = encodeClipParams({ startTime: 12500, endTime: 27000, clipTitle: 'Best bit', clipMetadata: 'meta' })

    expect(parseVideoClipsParams('dQw4w9WgXcQ', params)).toEqual({
      videoId: 'dQw4w9WgXcQ',
      startTime: 12.5,
      endTime: 27,
      clipTitle: 'Best bit',
      clipMetadata: 'meta',
    })
  })

  it('accepts params that are not URI-encoded', () => {
    const params = decodeURIComponent(encodeClipParams({ startTime: 0, endTime: 1000, clipTitle: '' }))
    expect(parseVideoClipsParams('id', params)).toMatchObject({ startTime: 0, endTime: 1 })
  })
})
