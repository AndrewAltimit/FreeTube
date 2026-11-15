import { describe, expect, it, vi } from 'vitest'

import { handleDragAndDrop } from '../../../../src/renderer/helpers/dragAndDrop.js'

describe('handleDragAndDrop', () => {
  it('dragVideo configures the data transfer and emits drag-video', () => {
    const emit = vi.fn()
    const { dragVideo } = handleDragAndDrop(emit)
    const event = { dataTransfer: { effectAllowed: 'all', setData: vi.fn() } }

    dragVideo(event, { videoId: 'abc', playlistItemId: 'p1', title: 'ignored' })

    expect(event.dataTransfer.effectAllowed).toBe('move')
    expect(event.dataTransfer.setData).toHaveBeenCalledWith('text/plain', '_')
    expect(emit).toHaveBeenCalledExactlyOnceWith('drag-video', { videoId: 'abc', playlistItemId: 'p1' })
  })

  it('moveDraggedVideo emits when dropped on a different item', () => {
    const emit = vi.fn()
    const { moveDraggedVideo } = handleDragAndDrop(emit)
    const target = { videoId: 'a', playlistItemId: '1' }
    const dragged = { videoId: 'b', playlistItemId: '2' }

    moveDraggedVideo(target, dragged)

    expect(emit).toHaveBeenCalledExactlyOnceWith('move-dragged-video', target, dragged)
  })

  it('moveDraggedVideo emits for the same video at a different playlist position', () => {
    const emit = vi.fn()
    const { moveDraggedVideo } = handleDragAndDrop(emit)

    moveDraggedVideo({ videoId: 'a', playlistItemId: '1' }, { videoId: 'a', playlistItemId: '2' })

    expect(emit).toHaveBeenCalledOnce()
  })

  it('moveDraggedVideo does not emit when dropped on itself', () => {
    const emit = vi.fn()
    const { moveDraggedVideo } = handleDragAndDrop(emit)

    moveDraggedVideo({ videoId: 'a', playlistItemId: '1' }, { videoId: 'a', playlistItemId: '1' })
    moveDraggedVideo({ videoId: null, playlistItemId: null }, { videoId: null, playlistItemId: null })

    expect(emit).not.toHaveBeenCalled()
  })

  it('afterDrag emits drag-video-end', () => {
    const emit = vi.fn()
    handleDragAndDrop(emit).afterDrag()

    expect(emit).toHaveBeenCalledExactlyOnceWith('drag-video-end')
  })
})
