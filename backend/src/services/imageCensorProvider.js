const axios = require('axios');
const sharp = require('sharp');

// Credentials stay in the private runtime environment. Never log Axios errors,
// which contain the access token, client secret and image bytes.
let tokenCache = null;
let tokenRequest = null;
const origin = 'https://aip.baidubce.com';
const options = { timeout: 10000, maxRedirects: 0, maxContentLength: 1024 * 1024 };
async function token() {
  const key = process.env.BAIDU_CENSOR_API_KEY;
  const secret = process.env.BAIDU_CENSOR_SECRET_KEY;
  if (!key || !secret) throw new Error('not_configured');
  if (tokenCache && tokenCache.key === key && tokenCache.expires > Date.now()) return tokenCache.value;
  if (!tokenRequest) tokenRequest = (async () => {
    const { data } = await axios.post(`${origin}/oauth/2.0/token`, new URLSearchParams({
      grant_type: 'client_credentials', client_id: key, client_secret: secret
    }).toString(), { ...options, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    if (typeof data.access_token !== 'string' || !Number.isFinite(data.expires_in)) throw new Error('invalid_token');
    tokenCache = { key, value: data.access_token, expires: Date.now() + Math.max(0, data.expires_in - 120) * 1000 };
    return tokenCache.value;
  })().finally(() => { tokenRequest = null; });
  return tokenRequest;
}
function classify(data) {
  if (!data || data.error_code || ![1, 2, 3, 4].includes(data.conclusionType)) return { state: 'error', reason: 'invalid_response' };
  const state = { 1: 'pass', 2: 'block', 3: 'review', 4: 'error' }[data.conclusionType];
  return { state, reason: `baidu_${state}` };
}
async function check(kind, value) {
  if (!process.env.BAIDU_CENSOR_API_KEY || !process.env.BAIDU_CENSOR_SECRET_KEY) return { state: 'error', reason: 'not_configured' };
  try {
    const body = new URLSearchParams({ [kind === 'text' ? 'text' : 'image']: value });
    const path = kind === 'text' ? 'text_censor' : 'img_censor';
    const accessToken = await token();
    const { data } = await axios.post(`${origin}/rest/2.0/solution/v1/${path}/v2/user_defined`, body.toString(), {
      ...options, params: { access_token: accessToken },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, maxBodyLength: 12 * 1024 * 1024
    });
    if (data?.error_code === 110 || data?.error_code === 111) tokenCache = null;
    return classify(data);
  } catch { return { state: 'error', reason: 'provider_unavailable' }; }
}
module.exports = {
  classify,
  configured: () => Boolean(process.env.BAIDU_CENSOR_API_KEY && process.env.BAIDU_CENSOR_SECRET_KEY),
  text: text => check('text', text),
  image: async buffer => {
    try {
      const metadata = await sharp(buffer, { limitInputPixels: 40000000 }).metadata();
      // Never approve an animation after inspecting only its first frame.
      if ((metadata.pages || 1) !== 1) return { state: 'review', reason: 'animated_image' };
      const sample = await sharp(buffer, { limitInputPixels: 40000000 }).rotate()
        .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
      if (sample.length > 3 * 1024 * 1024) return { state: 'review', reason: 'image_too_large' };
      return check('image', sample.toString('base64'));
    } catch { return { state: 'review', reason: 'invalid_image' }; }
  }
};
