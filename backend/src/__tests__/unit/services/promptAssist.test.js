/**
 * 「帮我写提示词」的解析与组装：模型答什么样都不能把垃圾塞进学生的输入框。
 */
const {
  writeCandidates, parseCandidates, buildMessages, MAX_DRAFT, MAX_CANDIDATES
} = require('../../../services/promptAssistService');

describe('提示词协助', () => {
  test('带序号、引号、项目符号的几行，切成干净的候选', () => {
    const text = '好的，以下是三条：\n1. 夕阳下的校园水池，暖光，低角度\n2) "雨后操场，水洼倒影，冷色调"\n- 清晨的教学楼，逆光剪影';
    expect(parseCandidates(text, 3)).toEqual([
      '夕阳下的校园水池，暖光，低角度',
      '雨后操场，水洼倒影，冷色调',
      '清晨的教学楼，逆光剪影'
    ]);
  });

  test('模型只回一整段时当成一条，不编造第二条', () => {
    expect(parseCandidates('一只橘猫趴在窗台上，午后的光', 3)).toEqual(['一只橘猫趴在窗台上，午后的光']);
  });

  test('什么都没有就是没有：不返回空字符串充数', () => {
    expect(parseCandidates('   \n\n  ', 2)).toEqual([]);
  });

  test('出图与出片给模型的指令不同：视频要讲镜头，图像明确不要讲', () => {
    const image = buildMessages({ target: 'image', draft: '校园', request: '' })[0].content;
    const video = buildMessages({ target: 'video', draft: '校园', request: '' })[0].content;
    expect(image).toContain('不要写镜头运动');
    expect(video).toContain('镜头运动');
  });

  test('学生什么都没写时，请模型给课堂上安全的主题，而不是空手发问', () => {
    const asked = buildMessages({ target: 'image', draft: '', request: '' })[1].content;
    expect(asked).toContain('安全');
  });

  test('超长草稿被截断后才发出去，且条数上限不被越过', async () => {
    let seen = null;
    const candidates = await writeCandidates({
      model: { id: 1 }, target: 'image', draft: '猫'.repeat(MAX_DRAFT + 500), count: 9,
      call: async (_model, messages) => { seen = messages; return '1. 一只猫\n2. 两只猫\n3. 三只猫\n4. 四只猫'; }
    });
    expect(seen[1].content.length).toBeLessThan(MAX_DRAFT + 200);
    expect(candidates).toHaveLength(MAX_CANDIDATES);        // 要 9 条也只给 3 条
  });

  test('模型答了但一条可用的都没有：抛错，让路由去走"不扣分"那条路', async () => {
    await expect(writeCandidates({
      model: { id: 1 }, target: 'image', draft: '猫', call: async () => '   '
    })).rejects.toThrow();
  });
});
