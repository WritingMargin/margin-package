import { open, readFile, stat, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
export const MAX_ARCHIVE = 256 * 1024 * 1024;
export const MAX_EXTRACTED = 768 * 1024 * 1024;
export const MAX_FILES = 20000;
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function safePath(path) {
  if (typeof path !== "string" || !path || path.length > 1024 || /[\\:\x00-\x1f]/.test(path) || path.startsWith("/") || path.split("/").some((part) => !part || part === "." || part === "..")) throw new Error(`Unsafe package path: ${JSON.stringify(path)}`);
  return path;
}
export function rejectSecretPath(path) {
  const parts = path.toLowerCase().split("/");
  if (parts.some((part) => part === ".git" || part === ".ssh" || part === ".aws" || part === ".env" || part.startsWith(".env.") || /\.(pem|key|p12|pfx|secret|margin-plugin)$/.test(part) || part === "id_rsa" || part === "id_ed25519")) throw new Error(`Refusing secret or development file '${path}'. Supply only distributable payload files.`);
}
function localHeader(name, bytes, crc) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6);
  header.writeUInt32LE(crc, 14); header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(name.length, 26);
  return header;
}
function centralHeader(name, bytes, crc, offset, executable) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50); header.writeUInt16LE(0x0314, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(0x0800, 8);
  header.writeUInt32LE(crc, 16); header.writeUInt32LE(bytes.length, 20); header.writeUInt32LE(bytes.length, 24); header.writeUInt16LE(name.length, 28);
  header.writeUInt32LE(((executable ? 0o100700 : 0o100600) << 16) >>> 0, 38); header.writeUInt32LE(offset, 42);
  return header;
}
/** Store-only ZIP: predictable bounds, no shell/archiver dependency, all entries regular files. */
export async function writePackage(output, metadata, entries) {
  if (metadata.packageVersion !== "margin.package/v2" || Object.keys(metadata).some(key => !["packageVersion", "plugin"].includes(key))) throw new Error("Use portable margin.package/v2 metadata without target, launch or runtime.");
  if (entries.length + 1 > MAX_FILES) throw new Error("Package exceeds 20000 files.");
  const seen = new Set();
  let expectedSize = 0;
  for (const entry of entries) {
    safePath(entry.path); rejectSecretPath(entry.path);
    if (entry.path === "margin-package.json" || seen.has(entry.path.toLowerCase())) throw new Error(`Duplicate or reserved path: ${entry.path}`);
    seen.add(entry.path.toLowerCase());
    expectedSize += entry.bytes?.length ?? (await stat(entry.source)).size;
  }
  if (expectedSize > MAX_EXTRACTED || expectedSize > MAX_ARCHIVE - 4 * 1024 * 1024) throw new Error("Payload is too large for a 256 MiB package (store-only ZIP).");
  const file = await open(output, "wx", 0o600);
  let offset = 0;
  const central = [];
  const hashes = Object.create(null);
  async function append(path, bytes, executable = false) {
    const name = Buffer.from(path);
    const crc = crc32(bytes);
    const header = localHeader(name, bytes, crc);
    const directory = centralHeader(name, bytes, crc, offset, executable);
    await file.writeFile(Buffer.concat([header, name])); await file.writeFile(bytes);
    central.push(directory, name); offset += header.length + name.length + bytes.length;
  }
  try {
    for (const entry of entries) {
      const bytes = entry.bytes ?? await readFile(entry.source);
      hashes[entry.path] = createHash("sha256").update(bytes).digest("hex");
      await append(entry.path, bytes, false);
      if (offset > MAX_ARCHIVE) throw new Error("Package exceeds 256 MiB.");
    }
    const manifest = Buffer.from(JSON.stringify({ ...metadata, files: hashes }, null, 2) + "\n");
    if (manifest.length > 4 * 1024 * 1024) throw new Error("Package metadata exceeds 4 MiB.");
    await append("margin-package.json", manifest);
    const directory = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length + 1, 8); end.writeUInt16LE(entries.length + 1, 10);
    end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
    if (offset + directory.length + end.length > MAX_ARCHIVE) throw new Error("Package exceeds 256 MiB.");
    await file.writeFile(directory); await file.writeFile(end);
    await file.close();
    return { ...metadata, files: hashes };
  } catch (error) {
    await file.close(); await unlink(output); throw error;
  }
}
