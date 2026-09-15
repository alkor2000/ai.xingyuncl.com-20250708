/**
 * AIStreamService._handleStreamResponse × ArtifactStreamGuard
 * - 用 PassThrough 模拟上游 SSE：先流出一份 ```pptx 课件，再开始"方式二"python 脚本
 * - 断言：客户端收到截断后的 message/done，onComplete 只调一次且是截断内容，
 *   上游流被 destroy，之后再喂数据也不再处理；无守卫时原样透传
 */
const { PassThrough } = require('stream');

jest.mock('../../../../models/AIModel', () => ({ findByName: jest.fn() }));
jest.mock('../../../../services/imageGenerationService', () => ({ isImageGenerationModel: jest.fn(() => false) }));
jest.mock('../../../../config', () => ({ app: { domain: 'test.local', name: 'test' } }));
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('../../../../utils/logger', () => mockLogger);

const AIStreamService = require('../../../../services/aiStreamService');
const { ArtifactStreamGuard } = require('../../../../services/chat/artifactStreamGuard');

const DECK = '好的，课件如下。\n\n```pptx\n# 光合作用\n\n---\n\n# 谢谢\n```';
const TAIL = '\n\n### 方式二：Python 脚本\n\n```bash\npip install python-pptx\n```\n\n```python\nfrom pptx import Presentation\n';

function sseChunk(delta) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`;
}

function fakeRes() {
  const res = {
    headersSent: true,
    writableEnded: false,
    chunks: [],
    write: jest.fn((s) => { res.chunks.push(s); return true; }),
    end: jest.fn(() => { res.writableEnded = true; }),
    on: jest.fn()
  };
  return res;
}

function parseEvents(res) {
  // sendSSE 分两次 write（event 行、data 行），拼起来再按空行切
  return res.chunks.join('').split('\n\n').map(block => {
    const m = block.match(/^event: (\w+)\ndata: (.*)$/s);
    return m ? { event: m[1], data: JSON.parse(m[2]) } : null;
  }).filter(Boolean);
}

function runStream(deltas, options) {
  const upstream = new PassThrough();
  const destroySpy = jest.spyOn(upstream, 'destroy');
  const response = { data: upstream, request: { destroy: jest.fn() } };
  const res = fakeRes();
  const promise = AIStreamService._handleStreamResponse(res, response, { name: 'm' }, options, Date.now());
  // 逐段异步写入，模拟网络分片
  let i = 0;
  const tick = () => {
    if (i < deltas.length && !upstream.destroyed) {
      upstream.write(sseChunk(deltas[i++]));
      setImmediate(tick);
    } else if (!upstream.destroyed) {
      upstream.write('data: [DONE]\n\n');
      upstream.end();
    }
  };
  setImmediate(tick);
  return { promise, res, upstream, destroySpy, response };
}

describe('AIStreamService 流式产物守卫', () => {
  beforeEach(() => jest.clearAllMocks());

  test('模型写完课件又附赠脚本：截到课件末尾，停止上游，done 与 onComplete 都是截断内容', async () => {
    const onComplete = jest.fn();
    const deltas = [...DECK.match(/[\s\S]{1,9}/g), ...TAIL.match(/[\s\S]{1,9}/g), 'prs = Presentation()\n', 'prs.save()\n'];
    const { promise, res, destroySpy, response } = runStream(deltas, {
      messageId: 'msg-1', contentGuard: new ArtifactStreamGuard(), onComplete
    });
    const result = await promise;

    expect(result.truncatedByGuard).toBe(true);
    expect(result.content).toBe(DECK);
    const events = parseEvents(res);
    const done = events.find(e => e.event === 'done');
    expect(done.data.content).toBe(DECK);
    const lastMessage = [...events].reverse().find(e => e.event === 'message');
    expect(lastMessage.data.fullContent).toBe(DECK);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0]).toBe(DECK);
    expect(destroySpy).toHaveBeenCalled();
    expect(response.request.destroy).toHaveBeenCalled();
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  test('没有守卫（普通对话）：内容原样透传', async () => {
    const onComplete = jest.fn();
    const full = DECK + TAIL;
    const { promise, res } = runStream(full.match(/[\s\S]{1,11}/g), { messageId: 'msg-2', onComplete });
    const result = await promise;
    expect(result.content).toBe(full);
    expect(parseEvents(res).find(e => e.event === 'done').data.content).toBe(full);
    expect(onComplete).toHaveBeenCalledWith(full, expect.any(Number));
  });

  test('有守卫但模型规矩（只有课件加一句话）：不截断', async () => {
    const full = DECK + '\n\n可在右侧画布预览。';
    const { promise } = runStream(full.match(/[\s\S]{1,5}/g), { messageId: 'msg-3', contentGuard: new ArtifactStreamGuard() });
    const result = await promise;
    expect(result.truncatedByGuard).toBeUndefined();
    expect(result.content).toBe(full);
  });
});
