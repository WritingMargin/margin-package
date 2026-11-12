import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const catalog = JSON.parse(await readFile(new URL('../catalog.json', import.meta.url), 'utf8'));
assert.equal(catalog.schemaVersion, 1);
assert(Array.isArray(catalog.plugins) && catalog.plugins.length <= 100);
const ids = new Set();
for (const plugin of catalog.plugins) {
  assert(/^[a-z0-9][a-z0-9-]{0,63}$/.test(plugin.id));
  assert(!ids.has(plugin.id), `Duplicate plugin ${plugin.id}`);
  ids.add(plugin.id);
  for (const [key, limit] of Object.entries({name:120, description:3000, version:100, publisher:120, homepage:2048, releaseNotes:12000})) {
    assert(typeof plugin[key] === 'string' && plugin[key].trim().length > 0 && Buffer.byteLength(plugin[key]) <= limit, `${plugin.id}.${key}`);
  }
  assert.equal(new URL(plugin.homepage).protocol, 'https:');
  assert(Array.isArray(plugin.features) && plugin.features.length > 0 && plugin.features.length <= 32 && plugin.features.every(value => typeof value === 'string' && value.trim().length > 0 && Buffer.byteLength(value) <= 200));
  assert(Array.isArray(plugin.packages) && plugin.packages.length > 0 && plugin.packages.length <= 8);
  const targets = new Set();
  for (const asset of plugin.packages) {
    assert(['linux', 'darwin'].includes(asset.os));
    assert(['amd64', 'arm64'].includes(asset.arch));
    const target = `${asset.os}/${asset.arch}`;
    assert(!targets.has(target), `Duplicate target ${plugin.id}/${target}`);
    targets.add(target);
    assert(/^[a-f0-9]{64}$/.test(asset.sha256));
    assert(Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size <= 256 * 1024 * 1024);
    const filename = `${plugin.id}-${plugin.version}-${asset.os}-${asset.arch}.margin-plugin`;
    const tag = `${plugin.id}-v${plugin.version}`;
    assert.equal(asset.url, `https://github.com/WritingMargin/margin-package/releases/download/${tag}/${filename}`);
    if (process.argv.includes('--verify-assets')) await verifyAsset(asset);
    console.log(`Validated ${plugin.id} ${plugin.version} ${target}${process.argv.includes('--verify-assets') ? ' and release bytes' : ''}`);
  }
}
async function verifyAsset(asset) {
  const response = await fetch(asset.url, { signal: AbortSignal.timeout(180000) });
  assert.equal(response.status, 200, `Cannot download ${asset.url}`);
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    assert(size <= asset.size, 'Asset exceeds its declared size');
    hash.update(chunk);
  }
  assert.equal(size, asset.size);
  assert.equal(hash.digest('hex'), asset.sha256);
}
