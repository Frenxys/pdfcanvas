interface TableRecord {
  tag: string;
  offset: number;
  length: number;
}

interface FontOptions {
  bold: boolean;
  italic: boolean;
  widthClass: number;
}

const SFNT_CHECKSUM = 0xb1b0afba;

function tableRecords(bytes: Uint8Array): TableRecord[] | null {
  if (bytes.length < 12) return null;
  const tag = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  if (
    !(
      (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0) ||
      tag === "true"
    )
  ) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(4);
  if (12 + count * 16 > bytes.length) return null;
  const records: TableRecord[] = [];
  for (let index = 0; index < count; index += 1) {
    const base = 12 + index * 16;
    const tableTag = String.fromCharCode(
      bytes[base]!,
      bytes[base + 1]!,
      bytes[base + 2]!,
      bytes[base + 3]!,
    );
    const offset = view.getUint32(base + 8);
    const length = view.getUint32(base + 12);
    if (offset + length > bytes.length) return null;
    records.push({ tag: tableTag, offset, length });
  }
  return records;
}

function checksum(bytes: Uint8Array, offset: number, length: number): number {
  let sum = 0;
  for (let index = 0; index < length; index += 4) {
    const a = bytes[offset + index] ?? 0;
    const b = bytes[offset + index + 1] ?? 0;
    const c = bytes[offset + index + 2] ?? 0;
    const d = bytes[offset + index + 3] ?? 0;
    sum = (sum + (((a << 24) | (b << 16) | (c << 8) | d) >>> 0)) >>> 0;
  }
  return sum;
}

function readInt16(
  bytes: Uint8Array,
  table: TableRecord | undefined,
  field: number,
): number {
  if (!table) return 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getInt16(table.offset + field);
}

function makeOs2(bytes: Uint8Array, records: TableRecord[], options: FontOptions): Uint8Array {
  const head = records.find((record) => record.tag === "head");
  const hhea = records.find((record) => record.tag === "hhea");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const unitsPerEm = head ? view.getUint16(head.offset + 18) : 1000;
  const yMax = readInt16(bytes, head, 42);
  const yMin = readInt16(bytes, head, 38);
  const ascender = readInt16(bytes, hhea, 4);
  const descender = readInt16(bytes, hhea, 6);
  const lineGap = readInt16(bytes, hhea, 8);
  const capHeight = Math.round(unitsPerEm * 0.7);
  const xHeight = Math.round(unitsPerEm * 0.5);
  const table = new Uint8Array(96);
  const out = new DataView(table.buffer);
  let selection = 0x0040;
  if (options.bold) selection = (selection & ~0x0040) | 0x0020;
  if (options.italic) selection |= 0x0001;

  out.setUint16(0, 4);
  out.setInt16(2, 0);
  out.setUint16(4, options.bold ? 700 : 400);
  out.setUint16(6, options.widthClass);
  out.setUint16(8, 0);
  out.setInt16(10, Math.round(unitsPerEm * 0.65));
  out.setInt16(12, Math.round(unitsPerEm * 0.6));
  out.setInt16(14, 0);
  out.setInt16(16, Math.round(unitsPerEm * 0.075));
  out.setInt16(18, Math.round(unitsPerEm * 0.65));
  out.setInt16(20, Math.round(unitsPerEm * 0.6));
  out.setInt16(22, 0);
  out.setInt16(24, Math.round(unitsPerEm * 0.35));
  out.setInt16(26, Math.round(unitsPerEm * 0.05));
  out.setInt16(28, Math.round(unitsPerEm * 0.25));
  out.setInt16(30, 0);
  table.set([2, 0, 5, 3, 0, 0, 0, 0, 0, 0], 32);
  out.setUint32(42, 0x00000003);
  out.setUint32(46, 0);
  out.setUint32(50, 0);
  out.setUint32(54, 0);
  table.set([0x50, 0x44, 0x46, 0x43], 58);
  out.setUint16(62, selection);
  out.setUint16(64, 0x0020);
  out.setUint16(66, 0xffff);
  out.setInt16(68, ascender || Math.round(unitsPerEm * 0.8));
  out.setInt16(70, descender || -Math.round(unitsPerEm * 0.2));
  out.setInt16(72, lineGap);
  out.setUint16(74, Math.max(0, yMax || ascender));
  out.setUint16(76, Math.max(0, -yMin || -descender));
  out.setUint32(78, 0x00000001);
  out.setUint32(82, 0);
  out.setInt16(86, xHeight);
  out.setInt16(88, capHeight);
  out.setUint16(90, 0);
  out.setUint16(92, 32);
  out.setUint16(94, 1);
  return table;
}

function rebuildCmap(bytes: Uint8Array, table: TableRecord): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const base = table.offset;
  if (table.length < 12) return null;
  const count = view.getUint16(base + 2);
  if (count < 1) return null;
  let subtable = -1;
  for (let index = 0; index < count; index += 1) {
    const record = base + 4 + index * 8;
    const platform = view.getUint16(record);
    const encoding = view.getUint16(record + 2);
    const offset = view.getUint32(record + 4);
    if (platform === 1 && encoding === 0 && base + offset + 2 <= bytes.length) {
      if (view.getUint16(base + offset) === 6) {
        subtable = base + offset;
        break;
      }
    }
  }
  if (subtable < 0) return null;
  const first = view.getUint16(subtable + 6);
  const entries = view.getUint16(subtable + 8);
  const codes: number[] = [];
  const glyphs: number[] = [];
  for (let index = 0; index < entries; index += 1) {
    const code = first + index;
    const glyph = view.getUint16(subtable + 10 + index * 2);
    if (glyph !== 0 && code < 0xffff) {
      codes.push(code);
      glyphs.push(glyph);
    }
  }
  if (codes.length === 0) return null;

  const segments: Array<{ start: number; end: number; delta: number }> = [];
  codes.forEach((code, index) => {
    const glyph = glyphs[index]!;
    const delta = (glyph - code) & 0xffff;
    const last = segments[segments.length - 1];
    if (last && code === last.end + 1 && delta === last.delta) {
      last.end = code;
    } else {
      segments.push({ start: code, end: code, delta });
    }
  });
  const segCount = segments.length + 1;
  const subLength = 16 + segCount * 8;
  const data = new Uint8Array(12 + subLength);
  const out = new DataView(data.buffer);
  out.setUint16(0, 0);
  out.setUint16(2, 1);
  out.setUint16(4, 3);
  out.setUint16(6, 1);
  out.setUint32(8, 12);
  const sub = 12;
  out.setUint16(sub, 4);
  out.setUint16(sub + 2, subLength);
  out.setUint16(sub + 4, 0);
  out.setUint16(sub + 6, segCount * 2);
  const power = 2 ** Math.floor(Math.log2(segCount));
  out.setUint16(sub + 8, power * 2);
  out.setUint16(sub + 10, Math.floor(Math.log2(power)));
  out.setUint16(sub + 12, segCount * 2 - power * 2);
  const endBase = sub + 14;
  const startBase = endBase + segCount * 2 + 2;
  const deltaBase = startBase + segCount * 2;
  const rangeBase = deltaBase + segCount * 2;
  segments.forEach((segment, index) => {
    out.setUint16(endBase + index * 2, segment.end);
    out.setUint16(startBase + index * 2, segment.start);
    out.setUint16(deltaBase + index * 2, segment.delta);
    out.setUint16(rangeBase + index * 2, 0);
  });
  out.setUint16(endBase + segments.length * 2, 0xffff);
  out.setUint16(startBase + segments.length * 2, 0xffff);
  out.setUint16(deltaBase + segments.length * 2, 1);
  out.setUint16(rangeBase + segments.length * 2, 0);
  return data;
}

/**
 * The browser rejects PDF subset fonts that lack an OS/2 table. Rebuild the
 * sfnt with a minimal OS/2 table so FontFace can use the embedded font for
 * previews. The PDF export never uses this copy.
 */
export function withOs2Table(
  bytes: Uint8Array,
  options: FontOptions,
): Uint8Array | null {
  const records = tableRecords(bytes);
  if (!records) return null;
  if (records.some((record) => record.tag === "OS/2")) return bytes;
  const os2 = makeOs2(bytes, records, options);
  const tables = [
    ...records.map((record) => ({
      tag: record.tag,
      data:
        record.tag === "cmap"
          ? (rebuildCmap(bytes, record) ??
            bytes.slice(record.offset, record.offset + record.length))
          : bytes.slice(record.offset, record.offset + record.length),
    })),
    { tag: "OS/2", data: os2 },
  ].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));

  const count = tables.length;
  const power = 2 ** Math.floor(Math.log2(count));
  const searchRange = power * 16;
  const entrySelector = Math.floor(Math.log2(power));
  const rangeShift = count * 16 - searchRange;
  let offset = 12 + count * 16;
  const positions: number[] = [];
  for (const table of tables) {
    offset = (offset + 3) & ~3;
    positions.push(offset);
    offset += (table.data.length + 3) & ~3;
  }
  const result = new Uint8Array(offset);
  const view = new DataView(result.buffer);
  result.set(bytes.subarray(0, 4), 0);
  view.setUint16(4, count);
  view.setUint16(6, searchRange);
  view.setUint16(8, entrySelector);
  view.setUint16(10, rangeShift);

  let headPosition = -1;
  tables.forEach((table, index) => {
    const base = 12 + index * 16;
    let data = table.data;
    if (table.tag === "head") {
      data = data.slice();
      new DataView(data.buffer).setUint32(8, 0);
    }
    result.set([...table.tag].map((char) => char.charCodeAt(0)), base);
    view.setUint32(base + 4, checksum(data, 0, data.length));
    view.setUint32(base + 8, positions[index]!);
    view.setUint32(base + 12, data.length);
    result.set(data, positions[index]!);
    if (table.tag === "head") headPosition = positions[index]!;
  });
  const total = checksum(result, 0, result.length);
  if (headPosition >= 0) {
    view.setUint32(headPosition + 8, (SFNT_CHECKSUM - total) >>> 0);
  }
  return result;
}
