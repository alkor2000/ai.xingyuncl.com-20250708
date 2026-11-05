jest.mock('../../../database/connection', () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock('../../../services/imageCensorProvider', () => ({ text: jest.fn(), image: jest.fn() }));
jest.mock('../../../utils/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
const db = require('../../../database/connection');
const provider = require('../../../services/imageCensorProvider');
const safety = require('../../../services/imageSafetyService');
const { publicAddress, download } = require('../../../services/safeImageDownload');

beforeEach(() => { jest.resetAllMocks(); db.query.mockResolvedValue({ rows: [] }); });
test.each(['block', 'review', 'error', 'pending'])('prompt %s cannot reach generation', async state => {
  provider.text.mockResolvedValue({ state, reason: 'test' });
  await expect(safety.checkPrompt(7, 'test')).rejects.toThrow();
  expect(db.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO image_safety_events'), expect.any(Array));
});
test('restriction prevents even submitting text to the external provider', async () => {
  db.query.mockResolvedValue({ rows: [{ restricted: 1 }] });
  await expect(safety.checkPrompt(7, 'test')).rejects.toThrow();
  expect(provider.text).not.toHaveBeenCalled();
});
test('arbitrary remote and data references are not fetched', async () => {
  for (const url of ['http://127.0.0.1/secret', 'https://cdn.example/x.jpg', 'data:image/png;base64,eA==']) {
    await expect(safety.references(7, [url])).rejects.toThrow();
  }
  expect(db.query).not.toHaveBeenCalled();
});
test('DTO strips unapproved URLs from nested batch responses and personal details', async () => {
  db.query.mockResolvedValue({ rows: [{ state: 'block', reason: 'test' }] });
  const out = await safety.project({ results: [{ id: 42, image_url: 'https://secret.example/asset', local_path: '/uploads/a', thumbnail_path: '/uploads/t', email: 'private', reference_images: 'private' }] });
  expect(out.results[0]).toMatchObject({ local_path: null, image_url: null, thumbnail_path: null, moderation_status: 'block' });
  expect(JSON.stringify(out)).not.toMatch(/secret|private/);
});
test('approved DTO points only to the authenticated asset endpoint', async () => {
  db.query.mockResolvedValue({ rows: [{ state: 'pass', file_key: 'safe', reason: 'ok' }] });
  const out = await safety.project({ id: 42, image_url: 'https://secret.example/asset', local_path: '/uploads/a' });
  expect(out.local_path).toBe('/api/image/generation/42/asset');
  expect(out.image_url).toBeNull();
});
test.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::ffff:127.0.0.1'])('download rejects private address %s', address => {
  expect(publicAddress(address)).toBe(false);
});
test('non-HTTPS, credentials and private IP downloads are rejected before I/O', async () => {
  for (const url of ['http://example.com/a', 'https://u:p@example.com/a', 'https://127.0.0.1/a', 'https://[::1]/a', 'https://example.com:444/a']) await expect(download(url)).rejects.toThrow();
});
test('unsafe artifact paths cannot escape private storage', () => {
  for (const key of ['../../.env', '/etc/passwd', 'abc.jpg', null]) expect(() => safety.assetPath(key)).toThrow();
});
