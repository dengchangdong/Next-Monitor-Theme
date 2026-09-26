/**
 * Generate stable, short server key for routes.
 *
 * Rule: serverKey = md5(String(id)).slice(0, 8)
 */

function toUtf8Bytes(str: string) {
  return new TextEncoder().encode(str)
}

function toHex32(num: number) {
  let s = ""
  for (let j = 0; j < 4; j += 1) {
    const byte = (num >>> (j * 8)) & 0xff
    s += byte.toString(16).padStart(2, "0")
  }
  return s
}

function add32(a: number, b: number) {
  return (a + b) >>> 0
}

function rol(num: number, cnt: number) {
  return ((num << cnt) | (num >>> (32 - cnt))) >>> 0
}

function cmn(q: number, a: number, b: number, x: number, s: number, t: number) {
  return add32(rol(add32(add32(a, q), add32(x, t)), s), b)
}

function ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
  return cmn((b & c) | (~b & d), a, b, x, s, t)
}
function gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
  return cmn((b & d) | (c & ~d), a, b, x, s, t)
}
function hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
  return cmn(b ^ c ^ d, a, b, x, s, t)
}
function ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
  return cmn(c ^ (b | ~d), a, b, x, s, t)
}

function md5Blocks(bytes: Uint8Array) {
  const len = bytes.length
  const bitLenLow = (len * 8) >>> 0
  const bitLenHigh = Math.floor((len * 8) / 0x100000000) >>> 0

  const padLen = (56 - ((len + 1) % 64) + 64) % 64
  const totalLen = len + 1 + padLen + 8
  const buffer = new Uint8Array(totalLen)
  buffer.set(bytes)
  buffer[len] = 0x80
  for (let i = 0; i < 4; i += 1) {
    buffer[totalLen - 8 + i] = (bitLenLow >>> (i * 8)) & 0xff
    buffer[totalLen - 4 + i] = (bitLenHigh >>> (i * 8)) & 0xff
  }

  let a = 0x67452301
  let b = 0xefcdab89
  let c = 0x98badcfe
  let d = 0x10325476

  const x = new Uint32Array(16)
  for (let i = 0; i < buffer.length; i += 64) {
    for (let j = 0; j < 16; j += 1) {
      const k = i + j * 4
      x[j] = buffer[k] | (buffer[k + 1] << 8) | (buffer[k + 2] << 16) | (buffer[k + 3] << 24)
    }

    let aa = a
    let bb = b
    let cc = c
    let dd = d

    // Round 1
    aa = ff(aa, bb, cc, dd, x[0], 7, 0xd76aa478)
    dd = ff(dd, aa, bb, cc, x[1], 12, 0xe8c7b756)
    cc = ff(cc, dd, aa, bb, x[2], 17, 0x242070db)
    bb = ff(bb, cc, dd, aa, x[3], 22, 0xc1bdceee)
    aa = ff(aa, bb, cc, dd, x[4], 7, 0xf57c0faf)
    dd = ff(dd, aa, bb, cc, x[5], 12, 0x4787c62a)
    cc = ff(cc, dd, aa, bb, x[6], 17, 0xa8304613)
    bb = ff(bb, cc, dd, aa, x[7], 22, 0xfd469501)
    aa = ff(aa, bb, cc, dd, x[8], 7, 0x698098d8)
    dd = ff(dd, aa, bb, cc, x[9], 12, 0x8b44f7af)
    cc = ff(cc, dd, aa, bb, x[10], 17, 0xffff5bb1)
    bb = ff(bb, cc, dd, aa, x[11], 22, 0x895cd7be)
    aa = ff(aa, bb, cc, dd, x[12], 7, 0x6b901122)
    dd = ff(dd, aa, bb, cc, x[13], 12, 0xfd987193)
    cc = ff(cc, dd, aa, bb, x[14], 17, 0xa679438e)
    bb = ff(bb, cc, dd, aa, x[15], 22, 0x49b40821)

    // Round 2
    aa = gg(aa, bb, cc, dd, x[1], 5, 0xf61e2562)
    dd = gg(dd, aa, bb, cc, x[6], 9, 0xc040b340)
    cc = gg(cc, dd, aa, bb, x[11], 14, 0x265e5a51)
    bb = gg(bb, cc, dd, aa, x[0], 20, 0xe9b6c7aa)
    aa = gg(aa, bb, cc, dd, x[5], 5, 0xd62f105d)
    dd = gg(dd, aa, bb, cc, x[10], 9, 0x02441453)
    cc = gg(cc, dd, aa, bb, x[15], 14, 0xd8a1e681)
    bb = gg(bb, cc, dd, aa, x[4], 20, 0xe7d3fbc8)
    aa = gg(aa, bb, cc, dd, x[9], 5, 0x21e1cde6)
    dd = gg(dd, aa, bb, cc, x[14], 9, 0xc33707d6)
    cc = gg(cc, dd, aa, bb, x[3], 14, 0xf4d50d87)
    bb = gg(bb, cc, dd, aa, x[8], 20, 0x455a14ed)
    aa = gg(aa, bb, cc, dd, x[13], 5, 0xa9e3e905)
    dd = gg(dd, aa, bb, cc, x[2], 9, 0xfcefa3f8)
    cc = gg(cc, dd, aa, bb, x[7], 14, 0x676f02d9)
    bb = gg(bb, cc, dd, aa, x[12], 20, 0x8d2a4c8a)

    // Round 3
    aa = hh(aa, bb, cc, dd, x[5], 4, 0xfffa3942)
    dd = hh(dd, aa, bb, cc, x[8], 11, 0x8771f681)
    cc = hh(cc, dd, aa, bb, x[11], 16, 0x6d9d6122)
    bb = hh(bb, cc, dd, aa, x[14], 23, 0xfde5380c)
    aa = hh(aa, bb, cc, dd, x[1], 4, 0xa4beea44)
    dd = hh(dd, aa, bb, cc, x[4], 11, 0x4bdecfa9)
    cc = hh(cc, dd, aa, bb, x[7], 16, 0xf6bb4b60)
    bb = hh(bb, cc, dd, aa, x[10], 23, 0xbebfbc70)
    aa = hh(aa, bb, cc, dd, x[13], 4, 0x289b7ec6)
    dd = hh(dd, aa, bb, cc, x[0], 11, 0xeaa127fa)
    cc = hh(cc, dd, aa, bb, x[3], 16, 0xd4ef3085)
    bb = hh(bb, cc, dd, aa, x[6], 23, 0x04881d05)
    aa = hh(aa, bb, cc, dd, x[9], 4, 0xd9d4d039)
    dd = hh(dd, aa, bb, cc, x[12], 11, 0xe6db99e5)
    cc = hh(cc, dd, aa, bb, x[15], 16, 0x1fa27cf8)
    bb = hh(bb, cc, dd, aa, x[2], 23, 0xc4ac5665)

    // Round 4
    aa = ii(aa, bb, cc, dd, x[0], 6, 0xf4292244)
    dd = ii(dd, aa, bb, cc, x[7], 10, 0x432aff97)
    cc = ii(cc, dd, aa, bb, x[14], 15, 0xab9423a7)
    bb = ii(bb, cc, dd, aa, x[5], 21, 0xfc93a039)
    aa = ii(aa, bb, cc, dd, x[12], 6, 0x655b59c3)
    dd = ii(dd, aa, bb, cc, x[3], 10, 0x8f0ccc92)
    cc = ii(cc, dd, aa, bb, x[10], 15, 0xffeff47d)
    bb = ii(bb, cc, dd, aa, x[1], 21, 0x85845dd1)
    aa = ii(aa, bb, cc, dd, x[8], 6, 0x6fa87e4f)
    dd = ii(dd, aa, bb, cc, x[15], 10, 0xfe2ce6e0)
    cc = ii(cc, dd, aa, bb, x[6], 15, 0xa3014314)
    bb = ii(bb, cc, dd, aa, x[13], 21, 0x4e0811a1)
    aa = ii(aa, bb, cc, dd, x[4], 6, 0xf7537e82)
    dd = ii(dd, aa, bb, cc, x[11], 10, 0xbd3af235)
    cc = ii(cc, dd, aa, bb, x[2], 15, 0x2ad7d2bb)
    bb = ii(bb, cc, dd, aa, x[9], 21, 0xeb86d391)

    a = add32(a, aa)
    b = add32(b, bb)
    c = add32(c, cc)
    d = add32(d, dd)
  }

  return [a, b, c, d] as const
}

function md5Hex(str: string) {
  const bytes = toUtf8Bytes(String(str ?? ""))
  const [a, b, c, d] = md5Blocks(bytes)
  return `${toHex32(a)}${toHex32(b)}${toHex32(c)}${toHex32(d)}`
}

export function serverIdToServerKey(serverId: number | string) {
  return md5Hex(String(serverId)).slice(0, 8)
}
