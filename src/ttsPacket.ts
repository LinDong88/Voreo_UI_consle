/**
 * 上位机不再按 GTA 帧切包：整段入固件 4KB 队列，由固件按 ≤127 切给模组。
 * 单次文本上限 = 固件缓冲 4KB；仅当触及 AT 单行上限时粗切（流控靠 +TTS:PAUSE/RESUME）。
 */
export const TTS_FW_BUF_MAX = 4096
/** 单次 AT+TTS 载荷上限（与固件行缓冲一致，留一点余量给命令头） */
export const TTS_AT_CHUNK_MAX = 4000
/** 单次发送文本 UTF-8 上限（对齐固件 4KB 池） */
export const TTS_TOTAL_MAX = TTS_FW_BUF_MAX

const encoder = new TextEncoder()

export function utf8ByteLength(text: string): number {
  return encoder.encode(text).length
}

/**
 * 仅当整段超过 AT 单行上限时，按 UTF-8 字节硬切成 ≤ maxBytes 的块（无标点策略）。
 * 正常短文返回单元素数组。
 */
export function splitForAtLine(text: string, maxBytes = TTS_AT_CHUNK_MAX): string[] {
  const src = text.replace(/\r?\n/g, ' ').trim()
  if (!src) return []
  if (utf8ByteLength(src) <= maxBytes) return [src]

  const bytes = encoder.encode(src)
  const chunks: string[] = []
  const decoder = new TextDecoder()
  let i = 0
  while (i < bytes.length) {
    let end = Math.min(i + maxBytes, bytes.length)
    if (end < bytes.length) {
      while (end > i && (bytes[end] & 0xc0) === 0x80) end--
      if (end === i) end = Math.min(i + maxBytes, bytes.length)
    }
    chunks.push(decoder.decode(bytes.subarray(i, end)))
    i = end
  }
  return chunks
}
