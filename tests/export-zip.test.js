import assert from 'node:assert/strict';
import test from 'node:test';
import { crc32, zip } from '../js/export-zip.js';

function u16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u32(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

test('crc32 matches the ISO-HDLC check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(crc32(Uint8Array.of()), 0);
});

test('zip writes a stored UTF-8 entry with local, central, and end headers', async () => {
  const payload = new TextEncoder().encode('海報');
  const blob = await zip([{ name: '領域/海報.png', blob: new Blob([payload]) }]);
  assert.equal(blob.type, 'application/zip');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const name = new TextEncoder().encode('領域/海報.png');
  const crc = crc32(payload);

  assert.equal(u32(bytes, 0), 0x04034b50);
  assert.equal(u16(bytes, 4), 20);
  assert.equal(u16(bytes, 6), 0x800);
  assert.equal(u16(bytes, 8), 0);
  assert.equal(u16(bytes, 10), 0);
  assert.equal(u32(bytes, 14), crc);
  assert.equal(u32(bytes, 18), payload.length);
  assert.equal(u32(bytes, 22), payload.length);
  assert.equal(u16(bytes, 26), name.length);
  assert.equal(u16(bytes, 28), 0);
  assert.deepEqual(bytes.slice(30, 30 + name.length), name);
  assert.deepEqual(bytes.slice(30 + name.length, 30 + name.length + payload.length), payload);

  const central = 30 + name.length + payload.length;
  assert.equal(u32(bytes, central), 0x02014b50);
  assert.equal(u16(bytes, central + 4), 20);
  assert.equal(u16(bytes, central + 6), 20);
  assert.equal(u16(bytes, central + 8), 0x800);
  assert.equal(u32(bytes, central + 16), crc);
  assert.equal(u32(bytes, central + 20), payload.length);
  assert.equal(u32(bytes, central + 24), payload.length);
  assert.equal(u16(bytes, central + 28), name.length);
  assert.equal(u32(bytes, central + 42), 0);

  const end = central + 46 + name.length;
  assert.equal(u32(bytes, end), 0x06054b50);
  assert.equal(u16(bytes, end + 8), 1);
  assert.equal(u16(bytes, end + 10), 1);
  assert.equal(u32(bytes, end + 12), 46 + name.length);
  assert.equal(u32(bytes, end + 16), central);
  assert.equal(bytes.length, end + 22);
});
