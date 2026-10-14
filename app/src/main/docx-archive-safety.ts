import { inflateRawSync } from 'node:zlib'

const MAX_DOCX_ENTRIES = 1_000
const MAX_DOCX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024
const MAX_DOCX_ENTRY_BYTES = 20 * 1024 * 1024
const MAX_COMPRESSION_RATIO = 100

function inspectDocxArchive(buffer: Buffer, verifyActualOutput: boolean): void {
  let eocd = -1
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 65_557); index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) { eocd = index; break }
  }
  if (eocd < 0) throw new Error('Word文件结构无效')
  const entryCount = buffer.readUInt16LE(eocd + 10)
  const centralSize = buffer.readUInt32LE(eocd + 12)
  const centralOffset = buffer.readUInt32LE(eocd + 16)
  if (entryCount === 0 || entryCount > MAX_DOCX_ENTRIES || entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw new Error('Word文件条目数量或ZIP格式不受支持')
  if (centralOffset + centralSize > buffer.length) throw new Error('Word文件中央目录越界')
  let offset = centralOffset; let totalUncompressed = 0
  const names = new Set<string>()
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Word文件中央目录损坏')
    const flags = buffer.readUInt16LE(offset + 8)
    const method = buffer.readUInt16LE(offset + 10)
    const compressed = buffer.readUInt32LE(offset + 20)
    const uncompressed = buffer.readUInt32LE(offset + 24)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const end = offset + 46 + nameLength + extraLength + commentLength
    if (end > buffer.length || (flags & 1) !== 0 || ![0, 8].includes(method)) throw new Error('Word文件包含不支持的ZIP条目')
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')
    if (name.startsWith('/') || name.split('/').includes('..') || names.has(name)) throw new Error('Word文件包含越界或重复条目')
    names.add(name)
    if (uncompressed > MAX_DOCX_ENTRY_BYTES || (uncompressed > 0 && compressed === 0) || (compressed > 0 && uncompressed / compressed > MAX_COMPRESSION_RATIO)) throw new Error('Word文件解压规模异常')

    if (localOffset + 30 > centralOffset || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Word文件本地条目损坏')
    const localFlags = buffer.readUInt16LE(localOffset + 6)
    const localMethod = buffer.readUInt16LE(localOffset + 8)
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const dataEnd = dataStart + compressed
    if ((localFlags & 1) !== 0 || localMethod !== method || dataStart > centralOffset || dataEnd > centralOffset) throw new Error('Word文件本地条目与中央目录不一致')
    const localName = buffer.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString('utf8')
    if (localName !== name) throw new Error('Word文件条目名不一致')

    let actualUncompressed = uncompressed
    if (verifyActualOutput) {
      const compressedBytes = buffer.subarray(dataStart, dataEnd)
      try {
        actualUncompressed = method === 0 ? compressedBytes.byteLength : inflateRawSync(compressedBytes, { maxOutputLength: Math.min(MAX_DOCX_ENTRY_BYTES, uncompressed + 1) }).byteLength
      } catch { throw new Error('Word文件实际解压规模异常') }
      if (actualUncompressed !== uncompressed || (method === 0 && compressed !== uncompressed)) throw new Error('Word文件实际解压规模与声明不一致')
    }
    totalUncompressed += actualUncompressed
    if (totalUncompressed > MAX_DOCX_UNCOMPRESSED_BYTES) throw new Error('Word文件解压后不能超过50MB')
    offset = end
  }
  if (offset !== centralOffset + centralSize) throw new Error('Word文件中央目录尺寸不一致')
  if (!names.has('[Content_Types].xml') || !names.has('word/document.xml')) throw new Error('不是有效的Word .docx文件')
}

export function assertDeclaredSafeDocxArchive(buffer: Buffer): void { inspectDocxArchive(buffer, false) }
export function assertActuallySafeDocxArchive(buffer: Buffer): void { inspectDocxArchive(buffer, true) }
