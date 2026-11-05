const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const config = require('../config');
const safeDownload = require('./safeImageDownload');
const root = () => path.join(config.storage.paths.uploads, '..', 'video-safety');
const MAX_BYTES = 250 * 1024 * 1024;
const filePath = key => {
  if (!/^[a-f0-9]{64}\.mp4$/.test(key || '')) throw Error('Invalid private video key');
  return path.join(root(), key);
};
async function putStream(input) {
  await fs.promises.mkdir(root(), { recursive: true, mode: 0o700 });
  const temp = path.join(root(), `${crypto.randomUUID()}.part`);
  const sha = crypto.createHash('sha256'); let size = 0, prefix = Buffer.alloc(0);
  const meter = new Transform({ transform(chunk, encoding, callback) {
    size += chunk.length;
    if (size > MAX_BYTES) return callback(Error('Video exceeds private storage limit'));
    if (prefix.length < 12) prefix = Buffer.concat([prefix, chunk.subarray(0, 12 - prefix.length)]);
    sha.update(chunk); callback(null, chunk);
  } });
  try {
    await pipeline(input, meter, fs.createWriteStream(temp, { flags: 'wx', mode: 0o600 }));
    if (size < 12 || prefix.toString('ascii', 4, 8) !== 'ftyp') throw Error('Only MP4 video is supported');
    const digest = sha.digest('hex'), key = `${digest}.mp4`;
    await fs.promises.link(temp, filePath(key)).catch(e => { if (e.code !== 'EEXIST') throw e; });
    return { sha: digest, key, size };
  } finally { await fs.promises.unlink(temp).catch(() => {}); }
}
async function fromUrl(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try { return await putStream(await safeDownload.openMediaStream(url, controller.signal)); }
  finally { controller.abort(); clearTimeout(timer); }
}
async function verify(key, expected) {
  const sha = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath(key))) sha.update(chunk);
  if (sha.digest('hex') !== expected) throw Error('Video integrity check failed');
  return filePath(key);
}
module.exports = { putStream, fromUrl, verify, filePath, MAX_BYTES };
