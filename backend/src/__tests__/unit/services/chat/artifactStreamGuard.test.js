/**
 * artifactStreamGuard 单元测试
 * - 正常课件不截断；产物之后附赠生成脚本时截到产物末尾并要求停止
 * - 课件内部混了裸 ``` 的情况要保住整份课件
 * - 短小的多余块不触发；流式分片与整段喂入结果一致
 */
const { ArtifactStreamGuard, EXTRA_BLOCK_MAX_LINES } = require('../../../../services/chat/artifactStreamGuard');

const DECK = [
  '为您制作一份 3 页课件。',
  '',
  '```pptx',
  '# 光合作用',
  '副标题',
  '',
  '---',
  '',
  '# 过程',
  '- 光反应',
  '- 暗反应',
  '',
  '---',
  '',
  '# 谢谢',
  '```'
].join('\n');

const SCRIPT_TAIL = [
  '',
  '---',
  '',
  '### 方式二：Python 脚本（自动生成 deck.pptx）',
  '',
  '本脚本采用暖色调，一键生成 16:9 幻灯片。',
  '',
  '#### 步骤 1：安装依赖',
  '```bash',
  'pip install python-pptx',
  '```',
  '',
  '#### 步骤 2：运行',
  '```python',
  'from pptx import Presentation',
  'prs = Presentation()',
  ...Array.from({ length: 40 }, (_, i) => `slide_${i} = prs.slides.add_slide(prs.slide_layouts[6])`),
  'prs.save("deck.pptx")',
  '```'
].join('\n');

function feedInChunks(guard, text, size) {
  let stopped = false;
  for (let i = 0; i < text.length && !stopped; i += size) {
    stopped = guard.push(text.slice(i, i + size)).stop;
  }
  return stopped;
}

describe('ArtifactStreamGuard', () => {
  test('只有一个产物块加一句说明：不触发', () => {
    const guard = new ArtifactStreamGuard();
    const content = DECK + '\n\n以上课件可在右侧画布预览并下载。\n';
    expect(guard.push(content).stop).toBe(false);
    expect(guard.end().stop).toBe(false);
    expect(guard.cutContent(content)).toBe(content);
  });

  test('产物之后附赠 pip install / python-pptx 脚本：在签名行触发，截到产物末尾', () => {
    const guard = new ArtifactStreamGuard();
    const content = DECK + SCRIPT_TAIL;
    expect(guard.push(content).stop).toBe(true);
    expect(guard.reason).toBe('script_signature');
    expect(guard.cutContent(content)).toBe(DECK);
  });

  test('多余块没有签名但超过上限行数：触发，截到产物末尾', () => {
    const guard = new ArtifactStreamGuard();
    const longBlock = ['```js', ...Array.from({ length: EXTRA_BLOCK_MAX_LINES + 1 }, (_, i) => `console.log(${i})`), '```'].join('\n');
    const content = DECK + '\n\n### 方式二：Node 版本\n\n' + longBlock + '\n';
    expect(guard.push(content).stop).toBe(true);
    expect(guard.reason).toBe('extra_block_too_long');
    expect(guard.cutContent(content)).toBe(DECK);
  });

  test('短小的多余块（用法说明）：不触发', () => {
    const guard = new ArtifactStreamGuard();
    const content = DECK + '\n\n用法：\n\n```bash\nopen deck.pptx\n```\n';
    expect(guard.push(content).stop).toBe(false);
    expect(guard.end().stop).toBe(false);
  });

  test('课件内部混了裸 ```（提前闭合）再附赠脚本：保住整份课件', () => {
    const deckWithBare = [
      '```pptx',
      '# 实验步骤',
      '',
      '```',
      '暗处理 → 遮光 → 观察',
      '```',
      '',
      '---',
      '',
      '# 结论',
      '- 淀粉遇碘变蓝',
      '```'
    ].join('\n');
    const guard = new ArtifactStreamGuard();
    const content = deckWithBare + SCRIPT_TAIL;
    expect(guard.push(content).stop).toBe(true);
    expect(guard.cutContent(content)).toBe(deckWithBare);
  });

  test('课件内部用 ```python 写代码页（违反 ~~~ 约定）但块很短：不触发', () => {
    const deck = [
      '```pptx',
      '# 代码示例',
      '```python',
      'print(1)',
      '```',
      '',
      '---',
      '',
      '# 再来一页',
      '```python',
      'print(2)',
      '```',
      '',
      '---',
      '',
      '# 谢谢',
      '```'
    ].join('\n');
    const guard = new ArtifactStreamGuard();
    expect(guard.push(deck + '\n').stop).toBe(false);
  });

  test('docx 产物后附赠 python-docx 脚本：触发', () => {
    const doc = '```docx\n# 通知\n\n各年级组：\n\n正文。\n```';
    const tail = '\n\n### 方式二\n\n```python\nfrom docx import Document\n```\n';
    const guard = new ArtifactStreamGuard();
    const content = doc + tail;
    expect(guard.push(content).stop).toBe(true);
    expect(guard.cutContent(content)).toBe(doc);
  });

  test('没有产物块的普通回答里有长代码块：不触发', () => {
    const guard = new ArtifactStreamGuard();
    const content = '这是一个例子：\n\n```python\n' + Array.from({ length: 50 }, (_, i) => `x${i} = ${i}`).join('\n') + '\n```\n';
    expect(guard.push(content).stop).toBe(false);
  });

  test('产物块尚未闭合：无论多长都不触发', () => {
    const guard = new ArtifactStreamGuard();
    const content = '```pptx\n' + Array.from({ length: 200 }, (_, i) => `- 要点 ${i}`).join('\n') + '\n```python\nfrom pptx import Presentation\n';
    expect(guard.push(content).stop).toBe(false);
  });

  test('流式按 7 字符分片喂入与整段喂入结果一致', () => {
    const content = DECK + SCRIPT_TAIL;
    const whole = new ArtifactStreamGuard();
    whole.push(content);
    const chunked = new ArtifactStreamGuard();
    expect(feedInChunks(chunked, content, 7)).toBe(true);
    expect(chunked.cutOffset).toBe(whole.cutOffset);
    expect(chunked.cutContent(content)).toBe(DECK);
  });

  test('触发之后继续 push 不再改变结果', () => {
    const guard = new ArtifactStreamGuard();
    const content = DECK + SCRIPT_TAIL;
    guard.push(content);
    const cut = guard.cutOffset;
    guard.push('\n```pptx\n# 又一份\n```\n');
    expect(guard.cutOffset).toBe(cut);
  });
});
