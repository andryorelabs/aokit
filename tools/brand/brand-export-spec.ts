/** Expected shape of one generated raster, relative to `docs/brand/`. */
export interface RasterSpec {
  path: string;
  width: number;
  height: number;
  maxBytes: number;
}

/** Sizes of the mark PNGs. */
export const MARK_SIZES = [16, 32, 48, 128, 512] as const;

/** Sizes of the entries inside `favicon.ico`. */
export const ICO_SIZES = [16, 32, 48] as const;

const MARK_MAX_BYTES = 64 * 1024;
const COVER_MAX_BYTES = 1024 * 1024;

/** The cover and social preview PNGs, one per grade, with their pixel sizes. */
export const COVER_SPECS = [
  { name: "cover", width: 1280, height: 440 },
  { name: "cover-light", width: 1280, height: 440 },
  { name: "social-preview", width: 1280, height: 640 },
  { name: "social-preview-light", width: 1280, height: 640 },
] as const;

/** Every raster the export writes, with its dimensions and byte budget. */
export const rasterSpecs: readonly RasterSpec[] = [
  ...MARK_SIZES.map((size) => ({
    path: `logo/png/mark-${size}.png`,
    width: size,
    height: size,
    maxBytes: MARK_MAX_BYTES,
  })),
  {
    path: "logo/png/favicon.ico",
    width: Math.max(...ICO_SIZES),
    height: Math.max(...ICO_SIZES),
    maxBytes: MARK_MAX_BYTES,
  },
  ...COVER_SPECS.map((cover) => ({
    path: `og/${cover.name}.png`,
    width: cover.width,
    height: cover.height,
    maxBytes: COVER_MAX_BYTES,
  })),
];

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ICO_HEADER_BYTES = 6;
const ICO_ENTRY_BYTES = 16;

/** Dimensions read from a PNG header, or `undefined` when the bytes are not a PNG. */
export function readPngSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length < 24 || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) {
    return undefined;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Colour type byte of a PNG header (6 is truecolour with alpha), or `undefined` when not a PNG. */
export function readPngColourType(bytes: Uint8Array): number | undefined {
  return readPngSize(bytes) === undefined ? undefined : bytes[25];
}

/** Entry sizes of an ICO file in file order; empty when the bytes are not an ICO. */
export function readIcoSizes(bytes: Uint8Array): number[] {
  if (bytes.length < ICO_HEADER_BYTES) {
    return [];
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(0, true) !== 0 || view.getUint16(2, true) !== 1) {
    return [];
  }
  const sizes: number[] = [];
  for (let index = 0; index < view.getUint16(4, true); index += 1) {
    const offset = ICO_HEADER_BYTES + index * ICO_ENTRY_BYTES;
    if (offset + ICO_ENTRY_BYTES > bytes.length) {
      return [];
    }
    const width = view.getUint8(offset);
    sizes.push(width === 0 ? 256 : width);
  }
  return sizes;
}

/** Throws unless `bytes` match the dimensions and byte budget of `spec`. */
export function assertSpec(spec: RasterSpec, bytes: Uint8Array): void {
  if (bytes.length > spec.maxBytes) {
    throw new Error(`${spec.path}: ${bytes.length} bytes exceeds the ${spec.maxBytes} byte budget`);
  }
  const size = spec.path.endsWith(".ico")
    ? icoLargestSize(bytes)
    : (readPngSize(bytes) ?? failNotPng(spec.path));
  if (size.width !== spec.width || size.height !== spec.height) {
    throw new Error(
      `${spec.path}: expected ${spec.width}x${spec.height}, got ${size.width}x${size.height}`,
    );
  }
}

function failNotPng(path: string): never {
  throw new Error(`${path}: not a PNG file`);
}

function icoLargestSize(bytes: Uint8Array): { width: number; height: number } {
  const sizes = readIcoSizes(bytes);
  if (sizes.length === 0) {
    throw new Error("favicon.ico: not an ICO file");
  }
  const largest = Math.max(...sizes);
  return { width: largest, height: largest };
}

/** Packs PNG-compressed entries into one ICO file, in the given order. */
export function encodeIco(entries: readonly { size: number; png: Uint8Array }[]): Uint8Array {
  const headerBytes = ICO_HEADER_BYTES + entries.length * ICO_ENTRY_BYTES;
  const total = entries.reduce((sum, entry) => sum + entry.png.length, headerBytes);
  const output = new Uint8Array(total);
  const view = new DataView(output.buffer);
  view.setUint16(2, 1, true);
  view.setUint16(4, entries.length, true);
  let dataOffset = headerBytes;
  entries.forEach((entry, index) => {
    const offset = ICO_HEADER_BYTES + index * ICO_ENTRY_BYTES;
    const dimension = entry.size >= 256 ? 0 : entry.size;
    view.setUint8(offset, dimension);
    view.setUint8(offset + 1, dimension);
    view.setUint16(offset + 4, 1, true);
    view.setUint16(offset + 6, 32, true);
    view.setUint32(offset + 8, entry.png.length, true);
    view.setUint32(offset + 12, dataOffset, true);
    output.set(entry.png, dataOffset);
    dataOffset += entry.png.length;
  });
  return output;
}
