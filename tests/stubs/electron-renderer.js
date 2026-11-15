// Stand-in for the `electron/renderer` module, which only exists inside
// Electron. Lets tests import src/preload/interface.js and assert which IPC
// channels it uses. Spy on these in a test with vi.spyOn.
import { vi } from 'vitest'

export const ipcRenderer = {
  invoke: vi.fn(async () => undefined),
  send: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  removeListener: vi.fn(),
}

export const webFrame = {
  setZoomFactor: vi.fn(),
  getZoomFactor: vi.fn(() => 1),
}

export const contextBridge = {
  exposeInMainWorld: vi.fn(),
}
