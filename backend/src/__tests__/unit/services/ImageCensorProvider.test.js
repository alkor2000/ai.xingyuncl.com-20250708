jest.mock('axios', () => ({ post: jest.fn() }));
const axios = require('axios');
const provider = require('../../../services/imageCensorProvider');
beforeEach(() => { delete process.env.BAIDU_CENSOR_API_KEY; delete process.env.BAIDU_CENSOR_SECRET_KEY; });
test.each([[1, 'pass'], [2, 'block'], [3, 'review'], [4, 'error']])('maps documented conclusion %i to %s', (value, expected) => {
  expect(provider.classify({ conclusionType: value }).state).toBe(expected);
});
test.each([null, {}, { conclusionType: '1' }, { conclusionType: 0 }, { conclusionType: 1, error_code: 500 }])('invalid response never passes: %j', data => {
  expect(provider.classify(data).state).toBe('error');
});
test('missing credentials fail closed without a network call', async () => {
  expect(await provider.text('safe')).toEqual({ state: 'error', reason: 'not_configured' });
  expect(axios.post).not.toHaveBeenCalled();
});
test('timeout and Axios request secrets never leave the provider', async () => {
  process.env.BAIDU_CENSOR_API_KEY = 'test-key'; process.env.BAIDU_CENSOR_SECRET_KEY = 'test-secret';
  axios.post.mockRejectedValue(new Error('secret=request-body&access_token=sensitive'));
  expect(await provider.text('safe')).toEqual({ state: 'error', reason: 'provider_unavailable' });
});
