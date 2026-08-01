/**
 * @jest-environment node
 */
import zlib from 'zlib';
import { parseZip } from '../../frontend/electron/renderer/zip.js';

function crc32(buf) {
  return zlib.crc32(buf) >>> 0;
}

function buildZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf-8');
    const uncompressed = Buffer.from(entry.data);
    const method = entry.method === 'deflate' ? 8 : 0;
    const compressed = method === 8 ? zlib.deflateRawSync(uncompressed) : uncompressed;
    const crc = crc32(uncompressed);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(uncompressed.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const localEntry = Buffer.concat([localHeader, nameBuf, compressed]);
    localParts.push(localEntry);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(uncompressed.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(Buffer.concat([centralHeader, nameBuf]));
    offset += localEntry.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const centralDirOffset = offset;
  const localData = Buffer.concat(localParts);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(centralDirOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localData, centralDir, eocd]);
}

function toArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

test('parses a zip with zero entries', async () => {
  const zip = buildZip([]);
  const files = await parseZip(toArrayBuffer(zip));
  expect(Object.keys(files)).toEqual([]);
});

test('parses a large (100KB) deflated entry, matching label texture sizes', async () => {
  const bigText = 'x'.repeat(100 * 1024);
  const zip = buildZip([{ name: 'big.bin', data: Buffer.from(bigText), method: 'deflate' }]);
  const files = await parseZip(toArrayBuffer(zip));
  expect(files['big.bin'].length).toBe(bigText.length);
});

test('parses entries with unicode filenames', async () => {
  const zip = buildZip([{ name: 'étiquette.svg', data: Buffer.from('<svg/>'), method: 'stored' }]);
  const files = await parseZip(toArrayBuffer(zip));
  expect(Object.keys(files)).toContain('étiquette.svg');
});

test('rejects truncated zip data', async () => {
  const zip = buildZip([{ name: 'a.txt', data: Buffer.from('hello'), method: 'stored' }]);
  const truncated = zip.subarray(0, zip.length - 30);
  await expect(parseZip(toArrayBuffer(Buffer.from(truncated)))).rejects.toThrow();
});
