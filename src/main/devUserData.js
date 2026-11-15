// Fork-only: keep development runs out of the real FreeTube profile.
//
// In development Electron derives the user-data directory from productName,
// which is "FreeTube", so `pnpm run dev` would read and write the same
// databases as an installed FreeTube. Point dev runs at a sibling
// "FreeTube-dev" directory instead (FREETUBE_DEV_USER_DATA overrides it).
//
// This must run before anything calls app.getPath('userData'), and
// src/datastores/index.js does so at import time, so this module is the
// first import in src/main/index.js.
import { app } from 'electron'
import path from 'path'

if (process.env.NODE_ENV === 'development') {
  app.setPath('userData', process.env.FREETUBE_DEV_USER_DATA || path.join(app.getPath('appData'), 'FreeTube-dev'))
}
