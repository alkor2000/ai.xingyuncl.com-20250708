/**
 * 视频生成"有效分辨率必须显式传给上游"的契约用例（反馈 745765ba / SEEDANCE-RESOLUTION-20261019）。
 *
 * 2026-10-19 核出：平台默认 720p、上游（火山方舟 Seedance）默认 1080p，旧 buildTextContent 只在参数"不等于平台默认"时才写
 * --rs，于是用户选 720p 或不选时都被上游按 1080p 生成并计费（206 条）。这里锁住的是：
 *   - 选 720p（= 平台默认）仍发送 --rs 720p；显式 1080p 发送 --rs 1080p；用户省略时发送合法的平台默认；
 *   - 非法分辨率在算有效参数时就被拒绝，绝不以"省略"落到上游默认；缺失的平台默认同样拒绝；
 *   - 时长同样显式；宽高比文生视频显式、图生视频未选择时不强加（上游自适应）；其余可选项行为不变；
 *   - 计费与落库用的就是发给上游的那组值；其它 provider 不走火山文本命令。
 * 全部用假模型/假 axios，不发任何付费请求。
 */
jest.mock('../../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../../database/connection', () => ({ query: jest.fn(), simpleQuery: jest.fn(), transaction: jest.fn() }));
jest.mock('../../../models/VideoModel', () => ({ findById: jest.fn(), decryptApiKey: jest.fn(() => 'test-key'), calculatePrice: jest.fn(() => 75) }));
jest.mock('../../../models/VideoGeneration', () => ({ create: jest.fn(async () => 4242), update: jest.fn(async () => true), findByTaskId: jest.fn() }));
jest.mock('../../../models/User', () => ({ findById: jest.fn() }));
jest.mock('../../../services/ossService', () => ({ initialize: jest.fn(), uploadFile: jest.fn() }));
jest.mock('../../../services/klingVideoService', () => ({ submitText2Video: jest.fn(async () => ({ taskId: 'kling-1', status: 'submitted' })), submitImage2Video: jest.fn(), queryTaskStatus: jest.fn() }));
jest.mock('../../../services/sora2VideoService', () => ({ submitText2Video: jest.fn(async () => ({ taskId: 'sora-1', status: 'submitted' })), submitImage2Video: jest.fn(), queryTaskStatus: jest.fn(), convertRatioToOrientation: jest.fn(() => 'landscape') }));
jest.mock('../../../services/imageSafetyService', () => ({ checkPrompt: jest.fn(async () => {}) }));
jest.mock('../../../services/videoSafetyService', () => ({ framesForProvider: jest.fn(async (_, params) => params) }));
jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));

const axios = require('axios');
const VideoModel = require('../../../models/VideoModel');
const VideoGeneration = require('../../../models/VideoGeneration');
const User = require('../../../models/User');
const klingVideoService = require('../../../services/klingVideoService');
const VideoService = require('../../../services/videoService');

/* 与生产 video_models 表第 1 行同形：Seedance 1.0 Pro，平台默认 720p / 16:9 / 5 秒 / 24fps */
const seedance = () => ({
  id: 1, is_active: 1, provider: 'volcano', model_id: 'doubao-seedance-1-0-pro-250528', display_name: 'Doubao-Seedance-1.0-pro',
  endpoint: 'https://ark.example.invalid/api/v3/contents/generations/tasks', api_key: 'enc',
  resolutions_supported: ['480p', '720p', '1080p'], durations_supported: [5, 10], fps_supported: [24], ratios_supported: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
  default_resolution: '720p', default_duration: 5, default_fps: 24, default_ratio: '16:9', max_prompt_length: 500, api_config: {}
});
const commands = (text) => text.slice(text.indexOf(' --') + 1).split(' --').filter(Boolean).map(c => (c.startsWith('--') ? c : `--${c}`));

beforeEach(() => { jest.clearAllMocks(); });

describe('buildTextContent: resolution is always explicit', () => {
  it('720p chosen while the platform default is 720p still sends --rs 720p (the 206-task defect)', () => {
    const text = VideoService.buildTextContent({ prompt: '一只猫', resolution: '720p', duration: 5, ratio: '16:9' }, seedance());
    expect(text.startsWith('一只猫 ')).toBe(true);
    expect(commands(text)).toEqual(['--rs 720p', '--rt 16:9', '--dur 5']);
  });
  it('explicit 1080p sends --rs 1080p', () => {
    expect(commands(VideoService.buildTextContent({ prompt: 'p', resolution: '1080p', duration: 10 }, seedance()))).toEqual(['--rs 1080p', '--rt 16:9', '--dur 10']);
  });
  it('omitted resolution/duration/ratio fall back to the legal platform defaults, explicitly', () => {
    expect(commands(VideoService.buildTextContent({ prompt: 'p' }, seedance()))).toEqual(['--rs 720p', '--rt 16:9', '--dur 5']);
  });
  it('an illegal resolution is refused before anything is sent — never silently dropped', () => {
    expect(() => VideoService.buildTextContent({ prompt: 'p', resolution: '4k' }, seedance())).toThrow('不支持的分辨率: 4k');
    expect(() => VideoService.buildTextContent({ prompt: 'p', resolution: '720p; rm -rf' }, seedance())).toThrow('不支持的分辨率');
    const noDefault = { ...seedance(), default_resolution: null };
    expect(() => VideoService.buildTextContent({ prompt: 'p' }, noDefault)).toThrow('不支持的分辨率: （空）');
    const noList = { ...seedance(), resolutions_supported: null, default_resolution: 'high' };
    expect(() => VideoService.buildTextContent({ prompt: 'p' }, noList)).toThrow('不支持的分辨率: high');
    expect(commands(VideoService.buildTextContent({ prompt: 'p', resolution: '640x352' }, { ...seedance(), resolutions_supported: null }))).toContain('--rs 640x352');
  });
  it('illegal duration or ratio is refused too', () => {
    expect(() => VideoService.buildTextContent({ prompt: 'p', duration: 7 }, seedance())).toThrow('不支持的时长: 7');
    expect(() => VideoService.buildTextContent({ prompt: 'p', ratio: '2:1' }, seedance())).toThrow('不支持的宽高比: 2:1');
  });
  it('review R1: without a ratios_supported list the ratio must still look like a ratio — no second --rs can ride along', () => {
    const noList = { ...seedance(), ratios_supported: null };
    expect(() => VideoService.buildTextContent({ prompt: 'p', ratio: '16:9 --rs 1080p' }, noList)).toThrow('不支持的宽高比: 16:9 --rs 1080p');
    expect(() => VideoService.buildTextContent({ prompt: 'p', ratio: 'nonsense' }, noList)).toThrow('不支持的宽高比: nonsense');
    expect(() => VideoService.buildTextContent({ prompt: 'p', ratio: ' 9:16' }, noList)).toThrow('不支持的宽高比');
    expect(commands(VideoService.buildTextContent({ prompt: 'p', ratio: '9:16' }, noList))).toEqual(['--rs 720p', '--rt 9:16', '--dur 5']);
    expect(commands(VideoService.buildTextContent({ prompt: 'p', ratio: 'adaptive' }, noList))).toEqual(['--rs 720p', '--rt adaptive', '--dur 5']);
    const noListNoDefault = { ...noList, default_ratio: null };
    expect(commands(VideoService.buildTextContent({ prompt: 'p' }, noListNoDefault))).toEqual(['--rs 720p', '--dur 5']);
  });
  it('review R1: fps and seed are written only as integers, so a string cannot smuggle another command', () => {
    const text = VideoService.buildTextContent({ prompt: 'p', fps: '24 --rs 1080p', seed: '7 --rs 1080p' }, { ...seedance(), fps_supported: null });
    expect(commands(text)).toEqual(['--rs 720p', '--rt 16:9', '--dur 5']);
    expect(text.match(/--rs /g)).toHaveLength(1);
    expect(commands(VideoService.buildTextContent({ prompt: 'p', fps: 30, seed: 7 }, { ...seedance(), fps_supported: [24, 30] }))).toEqual(['--rs 720p', '--rt 16:9', '--dur 5', '--fps 30', '--seed 7']);
  });
  it('image-to-video keeps the upstream adaptive ratio unless the user chose one', () => {
    const img = { prompt: 'p', generation_mode: 'first_frame', first_frame_image: 'https://img.example/a.jpg' };
    expect(commands(VideoService.buildTextContent(img, seedance()))).toEqual(['--rs 720p', '--dur 5']);
    expect(commands(VideoService.buildTextContent({ ...img, ratio: '9:16' }, seedance()))).toEqual(['--rs 720p', '--rt 9:16', '--dur 5']);
    expect(commands(VideoService.buildTextContent({ prompt: 'p', first_frame_image: 'https://img.example/a.jpg' }, seedance()))).toEqual(['--rs 720p', '--dur 5']);
  });
  it('the other optional switches behave as before', () => {
    const text = VideoService.buildTextContent({ prompt: 'p', fps: 24, watermark: false, camera_fixed: true, seed: 7 }, seedance());
    expect(commands(text)).toEqual(['--rs 720p', '--rt 16:9', '--dur 5', '--wm false', '--cf true', '--seed 7']);
    expect(commands(VideoService.buildTextContent({ prompt: 'p', fps: 30, seed: -1 }, { ...seedance(), fps_supported: [24, 30] }))).toEqual(['--rs 720p', '--rt 16:9', '--dur 5', '--fps 30']);
  });
});

describe('resolveEffectiveParams', () => {
  it('returns the values that pricing, persistence and the upstream command all share', () => {
    expect(VideoService.resolveEffectiveParams({ resolution: '720p' }, seedance())).toEqual({ resolution: '720p', duration: 5, ratio: '16:9', ratioExplicit: false, isImageMode: false });
    expect(VideoService.resolveEffectiveParams({ duration: '10', ratio: '4:3', generation_mode: 'last_frame' }, seedance())).toEqual({ resolution: '720p', duration: 10, ratio: '4:3', ratioExplicit: true, isImageMode: true });
  });
});

describe('submitToVolcano sends the explicit command text upstream (fake axios, no paid call)', () => {
  it('request text carries --rs 720p for a 720p request and the log records the command parameters', async () => {
    axios.post.mockResolvedValue({ data: { id: 'cgt-test-1' } });
    const result = await VideoService.submitToVolcano(seedance(), { prompt: '海边的日落', resolution: '720p', duration: 5, ratio: '16:9' });
    expect(result).toEqual({ taskId: 'cgt-test-1', status: 'submitted' });
    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, body, opts] = axios.post.mock.calls[0];
    expect(url).toBe('https://ark.example.invalid/api/v3/contents/generations/tasks');
    expect(body.model).toBe('doubao-seedance-1-0-pro-250528');
    expect(body.content[0]).toEqual({ type: 'text', text: '海边的日落 --rs 720p --rt 16:9 --dur 5' });
    expect(opts.headers.Authorization).toBe('Bearer test-key');
    const logger = require('../../../utils/logger');
    const logged = logger.info.mock.calls.find(c => c[0] === '调用火山方舟API');
    expect(logged[1].commandParams).toBe('--rs 720p --rt 16:9 --dur 5');
  });
  it('an illegal resolution never reaches axios', async () => {
    await expect(VideoService.submitToVolcano(seedance(), { prompt: 'p', resolution: '2160p' })).rejects.toThrow('不支持的分辨率: 2160p');
    expect(axios.post).not.toHaveBeenCalled();
  });
});

describe('submitVideoGeneration: one set of effective values for price, record and upstream; other providers untouched', () => {
  const user = () => ({ id: 7, hasCredits: jest.fn(() => true), consumeCredits: jest.fn(async () => true) });
  beforeEach(() => {
    VideoService.pollTaskStatus = jest.fn();
    User.findById.mockResolvedValue(user());
    axios.post.mockResolvedValue({ data: { id: 'cgt-test-2' } });
  });
  it('720p with the platform default charges 720p, records 720p and sends --rs 720p', async () => {
    VideoModel.findById.mockResolvedValue(seedance());
    const result = await VideoService.submitVideoGeneration(7, 1, { prompt: '校园', resolution: '720p', duration: 5, ratio: '16:9' });
    expect(result.success).toBe(true);
    expect(VideoModel.calculatePrice).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), '720p', 5);
    expect(VideoGeneration.create).toHaveBeenCalledWith(expect.objectContaining({ resolution: '720p', duration: 5, ratio: '16:9', credits_consumed: 75 }));
    expect(axios.post.mock.calls[0][1].content[0].text).toBe('校园 --rs 720p --rt 16:9 --dur 5');
  });
  it('omitted parameters are priced and recorded with the platform defaults that are also sent upstream', async () => {
    VideoModel.findById.mockResolvedValue(seedance());
    await VideoService.submitVideoGeneration(7, 1, { prompt: '校园' });
    expect(VideoModel.calculatePrice).toHaveBeenCalledWith(expect.anything(), '720p', 5);
    expect(VideoGeneration.create).toHaveBeenCalledWith(expect.objectContaining({ resolution: '720p', duration: 5 }));
    expect(axios.post.mock.calls[0][1].content[0].text).toBe('校园 --rs 720p --rt 16:9 --dur 5');
  });
  it('an illegal resolution is refused before credits are checked or any record is created', async () => {
    VideoModel.findById.mockResolvedValue(seedance());
    await expect(VideoService.submitVideoGeneration(7, 1, { prompt: '校园', resolution: '4k' })).rejects.toThrow('不支持的分辨率: 4k');
    expect(VideoGeneration.create).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });
  it('a kling model goes through the kling service, never the Volcano text command', async () => {
    VideoModel.findById.mockResolvedValue({ ...seedance(), id: 9, provider: 'kling', model_id: 'kling-v1' });
    await VideoService.submitVideoGeneration(7, 9, { prompt: '校园', resolution: '720p' });
    expect(klingVideoService.submitText2Video).toHaveBeenCalledTimes(1);
    expect(axios.post).not.toHaveBeenCalled();
  });
  /* 评审项 2：其它 provider 的配置不一定有 *_supported 列表、默认值也可能缺，新规则不能碰它们 */
  const klingLike = () => ({
    id: 9, is_active: 1, provider: 'kling', model_id: 'kling-v1-5', display_name: 'Kling 1.5', endpoint: 'https://kling.example.invalid', api_key: 'enc',
    resolutions_supported: null, durations_supported: null, fps_supported: null, ratios_supported: null,
    default_resolution: null, default_duration: null, default_fps: null, default_ratio: null, max_prompt_length: 2500, api_config: { model_version: 'kling-v1-5', mode: 'std' }
  });
  const soraLike = () => ({
    id: 11, is_active: 1, provider: 'sora2_goapi', model_id: 'sora-2', display_name: 'Sora 2', endpoint: 'https://goapi.example.invalid', api_key: 'enc',
    resolutions_supported: ['std', 'hd'], durations_supported: [10, 15], fps_supported: null, ratios_supported: ['16:9', '9:16', '1:1'],
    default_resolution: 'std', default_duration: 10, default_fps: null, default_ratio: '16:9', max_prompt_length: 2000, api_config: { model_name: 'sora-2' }
  });
  it('review R2: a kling model with no lists and no defaults behaves exactly as before — no new validation, previous values priced and recorded', async () => {
    VideoModel.findById.mockResolvedValue(klingLike());
    const params = { prompt: '校园', resolution: 'ultra-wide', duration: 5, ratio: '16:9', generation_mode: 'text_to_video' };
    const result = await VideoService.submitVideoGeneration(7, 9, params);
    expect(result.success).toBe(true);
    expect(VideoModel.calculatePrice).toHaveBeenCalledWith(expect.objectContaining({ id: 9 }), 'ultra-wide', 5);
    expect(VideoGeneration.create).toHaveBeenCalledWith(expect.objectContaining({ resolution: 'ultra-wide', duration: 5, ratio: '16:9', provider: 'kling' }));
    expect(klingVideoService.submitText2Video).toHaveBeenCalledWith(expect.objectContaining({ id: 9 }), params);
    expect(axios.post).not.toHaveBeenCalled();
    jest.clearAllMocks(); VideoModel.findById.mockResolvedValue(klingLike()); User.findById.mockResolvedValue(user()); VideoService.pollTaskStatus = jest.fn();
    await VideoService.submitVideoGeneration(7, 9, { prompt: '校园' });
    expect(VideoModel.calculatePrice).toHaveBeenCalledWith(expect.anything(), null, null);
    expect(VideoGeneration.create).toHaveBeenCalledWith(expect.objectContaining({ resolution: null, duration: null }));
  });
  it('review R2: a sora2 model keeps its orientation conversion and raw parameter pass-through', async () => {
    const sora2VideoService = require('../../../services/sora2VideoService');
    VideoModel.findById.mockResolvedValue(soraLike());
    const params = { prompt: '校园', ratio: '9:16', resolution: 'hd', duration: 15 };
    await VideoService.submitVideoGeneration(7, 11, params);
    expect(sora2VideoService.convertRatioToOrientation).toHaveBeenCalledWith('9:16');
    expect(sora2VideoService.submitText2Video).toHaveBeenCalledWith(expect.objectContaining({ id: 11 }), params);
    expect(VideoModel.calculatePrice).toHaveBeenCalledWith(expect.anything(), 'hd', 15);
    expect(axios.post).not.toHaveBeenCalled();
  });
  it('review R2: the Volcano rule still refuses what the other providers let through', async () => {
    VideoModel.findById.mockResolvedValue({ ...seedance(), resolutions_supported: null });
    await expect(VideoService.submitVideoGeneration(7, 1, { prompt: '校园', resolution: 'ultra-wide' })).rejects.toThrow('不支持的分辨率: ultra-wide');
    expect(VideoGeneration.create).not.toHaveBeenCalled();
  });
});
