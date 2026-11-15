// Builders for tiny synthetic WebM (EBML) and MP4 (sidx) structures.
// Only the bytes the segment-index parsers read are produced.

/**
 * Concatenates byte arrays / plain number arrays into one Uint8Array.
 * @param {...(Uint8Array | number[])} parts
 */
export function concat(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** Big-endian bytes of a non-negative integer, at least `minBytes` long. */
export function uintBytes(value, minBytes = 1) {
  const bytes = []
  let remaining = value
  while (remaining > 0) {
    bytes.unshift(remaining % 256)
    remaining = Math.floor(remaining / 256)
  }
  while (bytes.length < minBytes) {
    bytes.unshift(0)
  }
  return bytes
}

/** EBML IDs are written with their length marker already included. */
function idBytes(id) {
  return uintBytes(id)
}

/** Encodes `size` as an EBML vint of `width` bytes (default: smallest that fits). */
export function vintSize(size, width = undefined) {
  let w = width
  if (w === undefined) {
    w = 1
    // all-ones values are reserved for "unknown size", so stay below them
    while (size >= 2 ** (7 * w) - 1) {
      w++
    }
  }
  const bytes = uintBytes(size, w)
  bytes[0] |= 0x80 >> (w - 1)
  return bytes
}

/** The 8-byte "unknown size" vint. */
export const UNKNOWN_SIZE = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]

/**
 * @param {number} id
 * @param {Uint8Array | number[]} data
 * @param {number[]} [sizeBytes] override the encoded size
 */
export function ebmlElement(id, data, sizeBytes = undefined) {
  return concat(idBytes(id), sizeBytes ?? vintSize(data.length), data)
}

export function ebmlUint(id, value) {
  return ebmlElement(id, uintBytes(value))
}

export function ebmlFloat64(id, value) {
  const view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, value)
  return ebmlElement(id, new Uint8Array(view.buffer))
}

export function ebmlFloat32(id, value) {
  const view = new DataView(new ArrayBuffer(4))
  view.setFloat32(0, value)
  return ebmlElement(id, new Uint8Array(view.buffer))
}

export const WEBM_IDS = {
  EBML: 0x1a45dfa3,
  SEGMENT: 0x18538067,
  INFO: 0x1549a966,
  TIMECODE_SCALE: 0x2ad7b1,
  DURATION: 0x4489,
  TRACKS: 0x1654ae6b,
  CUES: 0x1c53bb6b,
  CUE_POINT: 0xbb,
  CUE_TIME: 0xb3,
  CUE_TRACK_POSITIONS: 0xb7,
  CUE_TRACK: 0xf7,
  CUE_CLUSTER_POSITION: 0xf1,
  VOID: 0xec,
}

/**
 * Builds WebM init data: an EBML header and a Segment holding an Info element.
 * @param {{ timecodeScale?: number, duration?: number | null, prefix?: Uint8Array[], unknownSegmentSize?: boolean }} options
 */
export function buildWebmInit({ timecodeScale, duration = 10000, prefix = [], unknownSegmentSize = false } = {}) {
  const infoChildren = []
  if (timecodeScale !== undefined) {
    infoChildren.push(ebmlUint(WEBM_IDS.TIMECODE_SCALE, timecodeScale))
  }
  if (duration !== null) {
    infoChildren.push(ebmlFloat64(WEBM_IDS.DURATION, duration))
  }

  const ebmlHeader = ebmlElement(WEBM_IDS.EBML, [0x42, 0x86, 0x81, 0x01]) // EBMLVersion = 1
  const segmentBody = concat(...prefix, ebmlElement(WEBM_IDS.INFO, concat(...infoChildren)))
  const segment = ebmlElement(WEBM_IDS.SEGMENT, segmentBody, unknownSegmentSize ? UNKNOWN_SIZE : undefined)

  return {
    data: concat(ebmlHeader, segment),
    // byte offset of the Segment's payload inside the init data
    segmentOffset: ebmlHeader.length + 4 + (unknownSegmentSize ? 8 : vintSize(segmentBody.length).length),
  }
}

/**
 * @param {{ time: number, clusterPosition: number }[]} points
 */
export function buildWebmCues(points) {
  return ebmlElement(WEBM_IDS.CUES, concat(...points.map(({ time, clusterPosition }) => {
    return ebmlElement(WEBM_IDS.CUE_POINT, concat(
      ebmlUint(WEBM_IDS.CUE_TIME, time),
      ebmlElement(WEBM_IDS.CUE_TRACK_POSITIONS, concat(
        ebmlUint(WEBM_IDS.CUE_TRACK, 1),
        ebmlUint(WEBM_IDS.CUE_CLUSTER_POSITION, clusterPosition)
      ))
    ))
  })))
}

function ascii(text) {
  return [...text].map(char => char.charCodeAt(0))
}

/**
 * Builds an ISO BMFF `sidx` box.
 * @param {{
 *   version?: 0 | 1,
 *   timescale: number,
 *   earliestPresentationTime?: number,
 *   firstOffset?: number,
 *   references: { size: number, duration: number, type?: 0 | 1 }[]
 * }} options
 */
export function buildSidx({ version = 0, timescale, earliestPresentationTime = 0, firstOffset = 0, references }) {
  const timeWidth = version === 0 ? 4 : 8
  const body = concat(
    [version, 0, 0, 0], // version + flags
    uintBytes(1, 4), // reference_ID
    uintBytes(timescale, 4),
    uintBytes(earliestPresentationTime, timeWidth),
    uintBytes(firstOffset, timeWidth),
    [0, 0], // reserved
    uintBytes(references.length, 2),
    ...references.map(({ size, duration, type = 0 }) => concat(
      uintBytes(((type << 31) >>> 0) + size, 4),
      uintBytes(duration, 4),
      [0x90, 0, 0, 0] // starts_with_SAP = 1, SAP_type = 1
    ))
  )
  return concat(uintBytes(8 + body.length, 4), ascii('sidx'), body)
}

/** A box of an arbitrary type with an opaque payload. */
export function buildBox(type, payload = []) {
  return concat(uintBytes(8 + payload.length, 4), ascii(type), payload)
}
