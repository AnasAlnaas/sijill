// Read and write .zip files with no libraries (from Jotter).
// Reading streams entries straight out of the File (Takeout archives can be large)
// and inflates with the built-in DecompressionStream. Writing uses "store" (no
// compression) — exports are mostly images, which don't compress anyway.

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_CENTRAL = 0x02014b50;
const utf8 = new TextDecoder();
const encoder = new TextEncoder();

// Files picked on the phone read lazily through the native bridge (sliceAsync).
async function sliceOf(file, start, end) {
  return file.sliceAsync ? file.sliceAsync(start, end) : file.slice(start, end);
}

async function readRange(file, start, end) {
  return new DataView(await (await sliceOf(file, start, end)).arrayBuffer());
}

function u64(view, off) {
  return Number(view.getBigUint64(off, true));
}

export async function readZip(file) {
  const size = file.size;
  const tailLen = Math.min(size, 65536 + 22 + 20);
  const tail = await readRange(file, size - tailLen, size);
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`${file.name} is not a zip file`);

  let count = tail.getUint16(eocd + 10, true);
  let cdSize = tail.getUint32(eocd + 12, true);
  let cdOffset = tail.getUint32(eocd + 16, true);

  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const loc = eocd - 20;
    if (loc >= 0 && tail.getUint32(loc, true) === SIG_ZIP64_LOCATOR) {
      const z64 = await readRange(file, u64(tail, loc + 8), u64(tail, loc + 8) + 56);
      count = u64(z64, 32);
      cdSize = u64(z64, 40);
      cdOffset = u64(z64, 48);
    }
  }

  const cd = await readRange(file, cdOffset, cdOffset + cdSize);
  const entries = [];
  let p = 0;
  for (let n = 0; n < count && p + 46 <= cd.byteLength; n++) {
    if (cd.getUint32(p, true) !== SIG_CENTRAL) break;
    const method = cd.getUint16(p + 10, true);
    let compSize = cd.getUint32(p + 20, true);
    let rawSize = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    let offset = cd.getUint32(p + 42, true);
    const name = utf8.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));

    // Zip64 sizes live in the "extra" field when the 32-bit ones are maxed out.
    let e = p + 46 + nameLen;
    const eEnd = e + extraLen;
    while (e + 4 <= eEnd) {
      const id = cd.getUint16(e, true);
      const len = cd.getUint16(e + 2, true);
      if (id === 0x0001) {
        let q = e + 4;
        if (rawSize === 0xffffffff) { rawSize = u64(cd, q); q += 8; }
        if (compSize === 0xffffffff) { compSize = u64(cd, q); q += 8; }
        if (offset === 0xffffffff) { offset = u64(cd, q); q += 8; }
      }
      e += 4 + len;
    }
    p = eEnd + commentLen;
    if (name.endsWith('/')) continue;
    entries.push({
      name,
      size: rawSize,
      async blob(type = '') {
        const local = await readRange(file, offset, offset + 30);
        const start = offset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
        const raw = await sliceOf(file, start, start + compSize);
        if (method === 0) return new Blob([raw], { type });
        if (method !== 8) throw new Error(`Unsupported compression in ${name}`);
        const stream = raw.stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Blob([await new Response(stream).arrayBuffer()], { type });
      },
      async text() {
        return (await this.blob()).text();
      },
    });
  }
  return entries;
}

let CRC_TABLE = null;
function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** files: [{ name, data: Blob | string | Uint8Array, date? }] → Blob */
export async function makeZip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const nameBytes = encoder.encode(f.name);
    const data = typeof f.data === 'string' ? encoder.encode(f.data)
      : f.data instanceof Uint8Array ? f.data : new Uint8Array(await f.data.arrayBuffer());
    const crc = crc32(data);
    const { time, date } = dosDateTime(f.date || new Date());

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    parts.push(local, nameBytes, data);

    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, SIG_CENTRAL, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, time, true);
    c.setUint16(14, date, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, nameBytes.length, true);
    c.setUint32(42, offset, true);
    central.push(c, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const cdSize = central.reduce((s, b) => s + b.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, SIG_EOCD, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
