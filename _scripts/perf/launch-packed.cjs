// Starts the production bundles from `pnpm run pack` against a throwaway profile, so packaged-build
// performance can be measured without touching the real FreeTube profile. A packaged build normally uses
// %APPDATA%/FreeTube; this sets userData before dist/main.js is loaded, the same way devUserData.js does in
// development.
//
// Usage: electron _scripts/perf/launch-packed.cjs --remote-debugging-port=9223 --inspect=9222
//   with FREETUBE_PERF_USER_DATA set to the profile directory (required)

const path = require('path')
const { app } = require('electron')

const userData = process.env.FREETUBE_PERF_USER_DATA
if (!userData) {
  console.error('Set FREETUBE_PERF_USER_DATA to a profile directory; refusing to start against the real profile')
  process.exit(2)
}

app.setPath('userData', path.resolve(userData))
require('../../dist/main.js')
