jest.mock('../../../database/connection', () => ({ query: jest.fn() }));
jest.mock('../../../services/imageService', () => ({}));
jest.mock('../../../services/midjourneyService', () => ({}));
jest.mock('../../../services/videoService', () => ({}));
jest.mock('../../../services/ossService', () => ({}));
jest.mock('../../../utils/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const db = require('../../../database/connection');
const cases = [
  ['image', require('../../../models/ImageGeneration'), require('../../../controllers/imageController').ImageController, 'success', 'gallery_reviewer_id'],
  ['video', require('../../../models/VideoGeneration'), require('../../../controllers/videoController').VideoController, 'succeeded', 'reviewer_id'],
];

describe.each(cases)('%s public detail boundary', (media, Model, Controller, status, reviewerField) => {
  let generation, decision, res;
  beforeEach(() => {
    generation = { id: 42, user_id: 7, is_public: 1, status, prompt: 'school garden',
      local_path: 'https://private.example/media', image_url: 'https://private.example/image',
      video_url: 'https://private.example/video', task_id: 'provider-private-id',
      raw_response: 'private payload', future_private_column: 'future secret', reference_images: 'private reference' };
    decision = { state: 'pass', gallery_state: 'approved', file_key: 'safe', [reviewerField]: 9 };
    jest.spyOn(Model, 'findById').mockImplementation(async () => generation);
    jest.spyOn(Model, 'incrementViewCount').mockResolvedValue(true);
    db.query.mockImplementation(async () => ({ rows: [decision] }));
    res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  });
  afterEach(() => jest.restoreAllMocks());
  const request = id => ({ params: { id: 42 }, user: { id } });

  test('approved detail exposes only public fields and protected media', async () => {
    await Controller.getGeneration(request(8), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const out = res.json.mock.calls[0][0].data;
    expect(out.prompt).toBe('school garden');
    expect(out.local_path).toBe(`/api/${media}/generation/42/asset`);
    for (const field of ['task_id', 'raw_response', 'future_private_column', 'reference_images']) expect(out).not.toHaveProperty(field);
    expect(JSON.stringify(out)).not.toContain('private.example');
    expect(Model.incrementViewCount).toHaveBeenCalledTimes(1);
  });
  test('owner identity accepts numeric strings and retains personal task metadata', async () => {
    generation.is_public = 0;
    await Controller.getGeneration(request('7'), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.task_id).toBe('provider-private-id');
    expect(res.json.mock.calls[0][0].data.local_path).toBe(`/api/${media}/generation/42/asset`);
    expect(Model.incrementViewCount).not.toHaveBeenCalled();
  });
  test.each(['pending', 'failed', 'processing'])('status %s hides even previously approved work', async nextStatus => {
    generation.status = nextStatus;
    await Controller.getGeneration(request(8), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(Model.incrementViewCount).not.toHaveBeenCalled();
  });
  test.each(['pending_review', 'private', 'self_review', 'missing_reviewer', 'missing_file', 'machine_block'])('%s cannot bypass teacher gate', async condition => {
    if (condition === 'pending_review') decision.gallery_state = 'pending';
    if (condition === 'private') generation.is_public = 0;
    if (condition === 'self_review') decision[reviewerField] = 7;
    if (condition === 'missing_reviewer') decision[reviewerField] = null;
    if (condition === 'missing_file') decision.file_key = null;
    if (condition === 'machine_block') decision.state = 'block';
    await Controller.getGeneration(request(8), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(Model.incrementViewCount).not.toHaveBeenCalled();
  });
});
