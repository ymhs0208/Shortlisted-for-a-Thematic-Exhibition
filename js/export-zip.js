const crcTable = Uint32Array.from({ length: 256 }, (_, start) => {
  let n = start;
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});

export function crc32(data) {
  let c = 0xffffffff;
  for (const b of data) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipHeader(size) {
  const a = new Uint8Array(size);
  return { a, v: new DataView(a.buffer) };
}

export async function zip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  let centralSize = 0;
  for (const file of files) {
    const name = new TextEncoder().encode(file.name);
    const data = new Uint8Array(await file.blob.arrayBuffer());
    const crc = crc32(data);
    const local = zipHeader(30);
    local.v.setUint32(0, 0x04034b50, true);
    local.v.setUint16(4, 20, true);
    local.v.setUint16(6, 0x800, true);
    local.v.setUint32(14, crc, true);
    local.v.setUint32(18, data.length, true);
    local.v.setUint32(22, data.length, true);
    local.v.setUint16(26, name.length, true);
    chunks.push(local.a, name, data);
    const header = zipHeader(46);
    header.v.setUint32(0, 0x02014b50, true);
    header.v.setUint16(4, 20, true);
    header.v.setUint16(6, 20, true);
    header.v.setUint16(8, 0x800, true);
    header.v.setUint32(16, crc, true);
    header.v.setUint32(20, data.length, true);
    header.v.setUint32(24, data.length, true);
    header.v.setUint16(28, name.length, true);
    header.v.setUint32(42, offset, true);
    central.push(header.a, name);
    centralSize += 46 + name.length;
    offset += 30 + name.length + data.length;
  }
  const end = zipHeader(22);
  end.v.setUint32(0, 0x06054b50, true);
  end.v.setUint16(8, files.length, true);
  end.v.setUint16(10, files.length, true);
  end.v.setUint32(12, centralSize, true);
  end.v.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, end.a], { type: 'application/zip' });
}
