import { describe, expect, it } from 'vitest'
import shaka from 'shaka-player'

import { EbmlParser } from '../../../../src/renderer/helpers/player/EbmlParser.js'
import { concat, ebmlElement, ebmlFloat32, ebmlFloat64, ebmlUint, UNKNOWN_SIZE } from './fixtures/binary.js'

const { Code } = shaka.util.Error

function expectShakaError(fn, code) {
  let caught
  try {
    fn()
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(shaka.util.Error)
  expect(caught.code).toBe(code)
}

describe('EbmlParser', () => {
  it('parses consecutive elements with 1- and 4-byte IDs', () => {
    const data = concat(ebmlUint(0xb3, 42), ebmlUint(0x2ad7b1, 1000000))
    const parser = new EbmlParser(data)

    const first = parser.parseElement()
    expect(first.id).toBe(0xb3)
    expect(first.getUint()).toBe(42)
    expect(parser.hasMoreData()).toBe(true)

    const second = parser.parseElement()
    expect(second.id).toBe(0x2ad7b1)
    expect(second.getUint()).toBe(1000000)
    expect(parser.hasMoreData()).toBe(false)
  })

  it('decodes multi-byte size vints', () => {
    // 2-byte size vint 0x40 0x05 = 5
    const data = concat([0xb3, 0x40, 0x05], [0, 0, 0, 0x01, 0x00])
    const element = new EbmlParser(data).parseElement()
    expect(element.getUint()).toBe(256)
  })

  it('reports the element payload offset relative to the buffer', () => {
    const data = concat(ebmlUint(0xb3, 1), ebmlUint(0xf1, 7))
    const parser = new EbmlParser(data)
    parser.parseElement()
    // second element starts at byte 3: id (1) + size (1) -> payload at 5
    expect(parser.parseElement().getOffset()).toBe(5)
  })

  it('treats an unknown size as "the rest of the buffer"', () => {
    const payload = ebmlUint(0xb3, 9)
    const data = concat([0x18, 0x53, 0x80, 0x67], UNKNOWN_SIZE, payload)
    const element = new EbmlParser(data).parseElement()

    const child = element.createParser().parseElement()
    expect(child.id).toBe(0xb3)
    expect(child.getUint()).toBe(9)
  })

  it('clamps a partial element to the available data', () => {
    // claims 10 bytes but only 2 follow
    const data = new Uint8Array([0xb3, 0x8a, 0x01, 0x02])
    const parser = new EbmlParser(data)
    const element = parser.parseElement()
    expect(element.getUint()).toBe(0x0102)
    expect(parser.hasMoreData()).toBe(false)
  })

  it('creates nested parsers over the element payload', () => {
    const data = ebmlElement(0xb7, concat(ebmlUint(0xf7, 1), ebmlUint(0xf1, 300)))
    const children = new EbmlParser(data).parseElement().createParser()
    expect(children.parseElement().id).toBe(0xf7)
    const position = children.parseElement()
    expect(position.id).toBe(0xf1)
    expect(position.getUint()).toBe(300)
  })

  it('reads 32-bit and 64-bit floats', () => {
    const parser = new EbmlParser(concat(ebmlFloat32(0x4489, 1.5), ebmlFloat64(0x4489, 12345.678)))
    expect(parser.parseElement().getFloat()).toBe(1.5)
    expect(parser.parseElement().getFloat()).toBe(12345.678)
  })

  it('rejects floats that are neither 4 nor 8 bytes', () => {
    const element = new EbmlParser(ebmlElement(0x4489, [0, 0])).parseElement()
    expectShakaError(() => element.getFloat(), Code.EBML_BAD_FLOATING_POINT_SIZE)
  })

  it('rejects unsigned integers wider than 8 bytes', () => {
    const element = new EbmlParser(ebmlElement(0xb3, new Array(9).fill(0))).parseElement()
    expectShakaError(() => element.getUint(), Code.EBML_OVERFLOW)
  })

  it('rejects 8-byte unsigned integers with more than 53 significant bits', () => {
    const element = new EbmlParser(ebmlElement(0xb3, [0x20, 0, 0, 0, 0, 0, 0, 0])).parseElement()
    expectShakaError(() => element.getUint(), Code.JS_INTEGER_OVERFLOW)
  })

  it('accepts an 8-byte unsigned integer at the 53-bit limit', () => {
    const element = new EbmlParser(ebmlElement(0xb3, [0x00, 0x1f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])).parseElement()
    expect(element.getUint()).toBe(Number.MAX_SAFE_INTEGER)
  })

  // Suspected bug (inherited from upstream shaka-player): getUint() only checks the
  // top 3 bits of the first byte, so 8-byte values with up to 61 significant bits
  // pass the "at most 53 meaningful bits" guard and silently lose precision.
  // The guard should require the whole first byte and the top 3 bits of the second to be 0.
  it.fails('rejects 8-byte unsigned integers between 54 and 61 significant bits', () => {
    const element = new EbmlParser(ebmlElement(0xb3, [0x1f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])).parseElement()
    expectShakaError(() => element.getUint(), Code.JS_INTEGER_OVERFLOW)
  })

  it('rejects a zero leading byte in a vint', () => {
    expectShakaError(() => new EbmlParser(new Uint8Array([0x00, 0x81, 0x00])).parseElement(), Code.EBML_OVERFLOW)
  })

  it('rejects IDs longer than 7 bytes', () => {
    // leading 0x01 marks an 8-byte vint
    const data = new Uint8Array([0x01, 1, 2, 3, 4, 5, 6, 7, 0x80])
    expectShakaError(() => new EbmlParser(data).parseElement(), Code.EBML_OVERFLOW)
  })

  it('rejects 8-byte sizes with more than 53 significant bits', () => {
    const data = new Uint8Array([0xb3, 0x01, 0xe0, 0, 0, 0, 0, 0, 0])
    expectShakaError(() => new EbmlParser(data).parseElement(), Code.JS_INTEGER_OVERFLOW)
  })
})
