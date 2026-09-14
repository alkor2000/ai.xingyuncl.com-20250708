/**
 * aiLabUploadMiddleware - AI训练专区样本上传中间件单元测试（音频分流部分）
 *
 * 测试范围：
 * - resolveAudioExt：按 mimetype 定扩展名；application/octet-stream 按文件扩展名放行 .wav/.webm/.ogg/.mp3；其余拒绝
 * - looksLikeAudio：wav（RIFF/WAVE）、webm（EBML）、ogg（OggS）、mp3（ID3 / 帧同步）文件头校验；过短 / 错头拒绝
 * - handleSampleUpload：table / text 数据集直接 400，不进入 multer
 *
 * Mock策略：logger 静默；multer / sharp 用真实模块但不触发（只测纯函数与分流入口）
 */

jest.mock('../../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

const {
  resolveAudioExt,
  looksLikeAudio,
  handleSampleUpload,
  ALLOWED_AUDIO_MIMES,
  AUDIO_EXTENSIONS,
  MAX_AUDIO_FILE_SIZE
} = require('../../../middleware/aiLabUploadMiddleware');

const wavHeader = () => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.alloc(8)]);

describe('aiLabUploadMiddleware - resolveAudioExt', () => {
  test('按 mimetype 定扩展名（忽略参数与大小写）', () => {
    expect(resolveAudioExt({ mimetype: 'audio/wav', originalname: 'a.bin' })).toBe('wav');
    expect(resolveAudioExt({ mimetype: 'audio/x-wav', originalname: 'a' })).toBe('wav');
    expect(resolveAudioExt({ mimetype: 'audio/wave', originalname: 'a' })).toBe('wav');
    expect(resolveAudioExt({ mimetype: 'audio/webm;codecs=opus', originalname: 'rec' })).toBe('webm');
    expect(resolveAudioExt({ mimetype: 'Audio/OGG', originalname: 'a' })).toBe('ogg');
    expect(resolveAudioExt({ mimetype: 'audio/mpeg', originalname: 'a.wav' })).toBe('mp3');
    expect(ALLOWED_AUDIO_MIMES).toHaveLength(6);
    expect(AUDIO_EXTENSIONS).toEqual(['wav', 'webm', 'ogg', 'mp3']);
    expect(MAX_AUDIO_FILE_SIZE).toBe(2 * 1024 * 1024);
  });

  test('application/octet-stream 按文件扩展名放行', () => {
    expect(resolveAudioExt({ mimetype: 'application/octet-stream', originalname: 'clip.WAV' })).toBe('wav');
    expect(resolveAudioExt({ mimetype: 'application/octet-stream', originalname: 'clip.webm' })).toBe('webm');
    expect(resolveAudioExt({ mimetype: 'application/octet-stream', originalname: 'clip.ogg' })).toBe('ogg');
    expect(resolveAudioExt({ mimetype: 'application/octet-stream', originalname: 'clip.mp3' })).toBe('mp3');
    expect(resolveAudioExt({ mimetype: 'application/octet-stream', originalname: 'clip.flac' })).toBeNull();
    expect(resolveAudioExt({ mimetype: 'application/octet-stream', originalname: 'noext' })).toBeNull();
  });

  test('其他类型拒绝', () => {
    expect(resolveAudioExt({ mimetype: 'image/jpeg', originalname: 'a.wav' })).toBeNull();
    expect(resolveAudioExt({ mimetype: 'audio/flac', originalname: 'a.flac' })).toBeNull();
    expect(resolveAudioExt({ mimetype: 'text/plain', originalname: 'a.mp3' })).toBeNull();
    expect(resolveAudioExt({ mimetype: '', originalname: 'a.mp3' })).toBeNull();
  });
});

describe('aiLabUploadMiddleware - looksLikeAudio', () => {
  test('四种格式的文件头', () => {
    expect(looksLikeAudio(wavHeader(), 'wav')).toBe(true);
    expect(looksLikeAudio(Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(12)]), 'webm')).toBe(true);
    expect(looksLikeAudio(Buffer.concat([Buffer.from('OggS'), Buffer.alloc(12)]), 'ogg')).toBe(true);
    expect(looksLikeAudio(Buffer.concat([Buffer.from('ID3'), Buffer.alloc(12)]), 'mp3')).toBe(true);
    expect(looksLikeAudio(Buffer.concat([Buffer.from([0xff, 0xfb]), Buffer.alloc(12)]), 'mp3')).toBe(true);
  });

  test('错误的头、扩展名不匹配、过短、非 Buffer 都拒绝', () => {
    expect(looksLikeAudio(wavHeader(), 'webm')).toBe(false);
    expect(looksLikeAudio(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('AVI LIST')]), 'wav')).toBe(false);
    expect(looksLikeAudio(Buffer.from('not an audio file at all'), 'mp3')).toBe(false);
    expect(looksLikeAudio(Buffer.from('RIFF'), 'wav')).toBe(false);
    expect(looksLikeAudio('RIFFxxxxWAVE', 'wav')).toBe(false);
    expect(looksLikeAudio(wavHeader(), 'flac')).toBe(false);
  });
});

describe('aiLabUploadMiddleware - handleSampleUpload 分流', () => {
  const makeRes = () => {
    const res = { statusCode: 200, body: null };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    return res;
  };

  test('table / text 数据集不进入上传管线，直接 400', () => {
    for (const kind of ['table', 'text']) {
      const req = { aiLabUpload: { dataset: { kind } }, headers: {} };
      const res = makeRes();
      const next = jest.fn();
      handleSampleUpload(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/rows/);
    }
  });
});
