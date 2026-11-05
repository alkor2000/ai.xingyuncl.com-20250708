const dns = require('dns');
const https = require('https');
const net = require('net');
const axios = require('axios');

function publicAddress(address) {
  // Only global IPv4 is accepted. Reject IPv6, mapped IPv4 and special networks.
  if (net.isIP(address) !== 4) return false;
  const [a, b] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && [0, 168].includes(b)) || (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && [18, 19, 51].includes(b)) || (a === 203 && b === 0));
}
const agent = new https.Agent({ lookup(hostname, options, callback) {
  dns.lookup(hostname, { family: 4, all: true }, (err, addresses) => {
    if (err || !addresses?.length || addresses.some(a => !publicAddress(a.address))) return callback(new Error('Image host rejected'));
    // Pin the checked address to this actual connection (no second DNS lookup).
    if (options?.all) callback(null, addresses);
    else callback(null, addresses[0].address, 4);
  });
} });
function checkedUrl(value) {
  const url = new URL(value);
  if (url.hostname.includes(':') || url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
      (net.isIP(url.hostname) && !publicAddress(url.hostname))) throw new Error('Image URL rejected');
  return url;
}
async function openMediaStream(value, signal) {
  const url = checkedUrl(value);
  try {
    return (await axios.get(url.href, { httpsAgent: agent, proxy: false, responseType: 'stream',
      signal, timeout: 120000, maxRedirects: 0 })).data;
  } catch { throw new Error('媒体下载失败'); }
}
async function download(value) {
  const url = checkedUrl(value);
  try {
    const response = await axios.get(url.href, { httpsAgent: agent, proxy: false, responseType: 'arraybuffer',
      timeout: 30000, maxRedirects: 0, maxContentLength: 20 * 1024 * 1024 });
    return Buffer.from(response.data);
  } catch { throw new Error('图片下载失败，请稍后重试'); }
}
module.exports = { download, publicAddress, openMediaStream };
