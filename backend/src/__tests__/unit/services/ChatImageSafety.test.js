jest.mock('../../../database/connection', () => ({ query: jest.fn() }));
jest.mock('../../../services/imageSafetyService', () => ({ assertUser: jest.fn(), putImage: jest.fn(), event: jest.fn(), error: message => new Error(message) }));
jest.mock('../../../services/imageCensorProvider', () => ({ image: jest.fn() }));
jest.mock('../../../services/ossService', () => ({ initialize: jest.fn(), uploadFile: jest.fn(), isLocal: false }));
jest.mock('../../../services/safeImageDownload', () => ({ download: jest.fn() }));
jest.mock('../../../utils/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
const service = require('../../../services/imageGenerationService');
const safety = require('../../../services/imageSafetyService');
const provider = require('../../../services/imageCensorProvider');
const db = require('../../../database/connection');
const oss = require('../../../services/ossService');
const downloader = require('../../../services/safeImageDownload');
beforeEach(() => {
  jest.resetAllMocks();
  db.query.mockResolvedValue({ rows: [] });
  safety.putImage.mockResolvedValue({ buffer: Buffer.from('normalized-test'), sha: 'sha-test' });
});
test.each(['block', 'review', 'error'])('chat image %s never enters public storage', async state => {
  provider.image.mockResolvedValue({ state, reason: 'test' });
  await expect(service.saveGeneratedImage('dGVzdA==', 'image/png', 41, 7)).rejects.toThrow();
  expect(oss.uploadFile).not.toHaveBeenCalled();
  expect(safety.event).toHaveBeenCalled();
});
test('external image URL is downloaded and reviewed, never returned as a bypass', async () => {
  db.query.mockResolvedValueOnce({ rows: [{ user_id: 7 }] }).mockResolvedValue({ rows: [] });
  provider.image.mockResolvedValue({ state: 'block', reason: 'test' });
  downloader.download.mockResolvedValue(Buffer.from('test'));
  const result = await service.processOpenRouterImageResponse({ choices: [{ message: { images: [{ url: 'https://upstream.example/image' }] } }] }, 41);
  expect(result.images).toEqual([]);
  expect(oss.uploadFile).not.toHaveBeenCalled();
  expect(downloader.download).toHaveBeenCalledTimes(1);
});
