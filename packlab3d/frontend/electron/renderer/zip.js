// Minimal ZIP reader (central directory + local headers), method 0 (stored) and
// method 8 (deflate). Uses the native DecompressionStream('deflate-raw') API —
// available in both Electron's Chromium and Node 18+ — instead of adding a
// JSZip dependency.

async function inflateRaw(compressedBytes) {
  const stream = new Blob([compressedBytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

export async function parseZip(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const bytes = new Uint8Array(arrayBuffer);

  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= 0; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error('Not a valid ZIP file (end-of-central-directory not found)');

  const numEntries = view.getUint16(eocdOffset + 10, true);
  const centralDirOffset = view.getUint32(eocdOffset + 16, true);

  const files = {};
  let offset = centralDirOffset;

  for (let i = 0; i < numEntries; i += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error(`Invalid central directory entry at offset ${offset}`);
    }
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const filenameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);

    const filename = new TextDecoder().decode(bytes.slice(offset + 46, offset + 46 + filenameLen));

    const localFilenameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localFilenameLen + localExtraLen;
    const compressedData = bytes.slice(dataStart, dataStart + compressedSize);

    if (method === 0) {
      files[filename] = compressedData;
    } else if (method === 8) {
      files[filename] = await inflateRaw(compressedData);
    } else {
      throw new Error(`Unsupported ZIP compression method: ${method}`);
    }

    offset += 46 + filenameLen + extraLen + commentLen;
  }

  return files;
}
