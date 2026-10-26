/**
 * MediaRecorder writes WebM without a Duration, so servers (and some players) see "unknown length".
 * This inserts the real duration into the Segment Info element. It only touches the header, never
 * re-encodes, and quietly returns the original file if anything looks unexpected.
 */
const INFO_ID = [0x15, 0x49, 0xa9, 0x66]
const DURATION_ID = 0x4489

function findInfo(b: Uint8Array): number {
  const lim = Math.min(b.length - 4, 65536)
  for (let i = 0; i < lim; i++) {
    if (b[i] === INFO_ID[0] && b[i + 1] === INFO_ID[1] && b[i + 2] === INFO_ID[2] && b[i + 3] === INFO_ID[3]) return i
  }
  return -1
}

/** EBML variable-length size: returns [value, byteLength] (value -1 = unknown size). */
function readSize(b: Uint8Array, at: number): [number, number] {
  const first = b[at]
  let len = 1
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++
  if (len > 8) return [-1, 1]
  let v = first & (0xff >> len)
  let allOnes = v === 0xff >> len
  for (let i = 1; i < len; i++) {
    v = v * 256 + b[at + i]
    if (b[at + i] !== 0xff) allOnes = false
  }
  return [allOnes ? -1 : v, len]
}

export async function patchWebmDuration(blob: Blob, seconds: number): Promise<Blob> {
  try {
    if (!blob.type.includes('webm') || !(seconds > 0)) return blob
    const head = new Uint8Array(await blob.slice(0, 65536 + 16).arrayBuffer())
    const info = findInfo(head)
    if (info < 0) return blob
    const [size, sizeLen] = readSize(head, info + 4)
    if (size < 0 || size > 4096) return blob
    const start = info + 4 + sizeLen
    // already has a Duration child? then leave it alone
    for (let i = start; i < start + size - 1; i++) {
      if (head[i] === DURATION_ID >> 8 && head[i + 1] === (DURATION_ID & 0xff)) return blob
    }
    const newSize = size + 11
    if (newSize >= 2 ** (7 * sizeLen) - 1) return blob // size field would need to grow: skip
    const el = new Uint8Array(11)
    el[0] = DURATION_ID >> 8
    el[1] = DURATION_ID & 0xff
    el[2] = 0x88 // 8-byte float
    // default TimecodeScale = 1,000,000 ns, so Duration is in milliseconds
    new DataView(el.buffer).setFloat64(3, seconds * 1000, false)
    const sizeBytes = new Uint8Array(sizeLen)
    let rest = newSize
    for (let i = sizeLen - 1; i >= 0; i--) {
      sizeBytes[i] = rest & 0xff
      rest = Math.floor(rest / 256)
    }
    sizeBytes[0] |= 0x80 >> (sizeLen - 1)
    const insertAt = start + size
    return new Blob([head.slice(0, info + 4), sizeBytes, head.slice(start, insertAt), el, blob.slice(insertAt)], {
      type: blob.type,
    })
  } catch {
    return blob
  }
}
