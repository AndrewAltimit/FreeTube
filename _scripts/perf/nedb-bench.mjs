// Times what the main process does with one NeDB datastore file: loading it (which also rewrites it),
// finding every document, copying the result the way IPC does, one update and a compaction. Works on a
// temporary copy, so the file passed in is never modified.
//
// Usage: node _scripts/perf/nedb-bench.mjs <path to a .db file, e.g. a copy of subscription-cache.db>

import { copyFileSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { deserialize, serialize } from 'node:v8'
import Datastore from '@seald-io/nedb'

const source = process.argv[2]
if (!source) {
  console.error('Usage: node _scripts/perf/nedb-bench.mjs <file.db>')
  process.exit(2)
}

const file = `${source}.bench`
copyFileSync(source, file)

const mb = (bytes) => `${(bytes / 1e6).toFixed(2)} MB`
async function time(label, fn) {
  const start = performance.now()
  const result = await fn()
  console.log(`${label.padEnd(28)} ${(performance.now() - start).toFixed(1).padStart(7)} ms`)
  return result
}

try {
  const lines = readFileSync(file, 'utf8').split('\n').filter(line => line.length > 0)
  console.log(`file: ${mb(statSync(file).size)}, ${lines.length} lines`)

  const db = new Datastore({ filename: file, autoload: false })
  await time('load (parse + rewrite)', () => db.loadDatabaseAsync())
  console.log(`documents: ${db.getAllData().length}, ${mb(statSync(file).size)} after the load rewrote it`)

  const docs = await time('find all', () => db.findAsync({}))
  const copy = await time('structured clone, serialize', () => serialize(docs))
  await time('structured clone, deserialize', () => deserialize(copy))
  console.log(`structured clone size: ${mb(copy.length)}`)

  const first = docs[0]
  if (first) {
    await time('one update', () => db.updateAsync({ _id: first._id }, { $set: { touched: Date.now() } }))
  }
  await time('compact', () => db.compactDatafileAsync())

  const bytesByField = {}
  for (const doc of docs) {
    for (const [key, value] of Object.entries(doc)) {
      if (Array.isArray(value)) {
        bytesByField[key] = (bytesByField[key] ?? 0) + JSON.stringify(value).length
      }
    }
  }
  console.log('JSON size of array fields:')
  for (const [key, bytes] of Object.entries(bytesByField).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key.padEnd(20)} ${mb(bytes)}`)
  }
} finally {
  unlinkSync(file)
}
