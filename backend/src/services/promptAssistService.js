'use strict';

/**
 * 「帮我写提示词」：把学生写了一半的话，变成两三条可以直接用来生成图像/视频的提示词。
 *
 * 它不是一个会话，是一次性的一问一答：不建会话、不存消息、不留历史，只把候选词还给页面，
 * 用不用由学生自己决定。模型走的是这个学生本来就能用的那几个（组权限与个人限制都不放宽），
 * 计费也用对话那套 credits_per_chat —— 这是一次真实的模型调用，不该假装免费。
 */

const AICallHelper = require('./agent/nodes/AICallHelper');

const MAX_DRAFT = 1000;          // 学生已经写下的半成品
const MAX_REQUEST = 300;         // "再亮一点""换成夜景"这类一句话诉求
const MAX_CANDIDATES = 3;
const CALL_TIMEOUT_MS = 30000;

// 出图与出片吃的提示词不一样：一个讲画面，一个还要讲镜头怎么动。
const TARGETS = Object.freeze({
  image: {
    label: '图像',
    hint: '描述画面主体、环境、光线、材质、构图与风格；不要写镜头运动或时间变化。'
  },
  video: {
    label: '视频',
    hint: '先描述画面主体与环境，再描述镜头运动与时间上的变化；避免要求画面中出现文字。'
  }
});

function clean(value, limit) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, limit);
}

/**
 * 模型返回的是带序号的几行。这里按行切，把序号、引号、markdown 记号剥掉，
 * 只留下能直接粘进输入框的那句话；解析不出来就原样当成一条，不编造。
 */
function parseCandidates(text, count) {
  const lines = String(text || '')
    .split('\n')
    .map(line => line.replace(/^\s*(?:[-*•]|\d+[.)、])\s*/, '').replace(/^["“]|["”]$/g, '').trim())
    .filter(line => line.length > 0 && !/^(?:以下|这里|好的|当然)/.test(line));
  const picked = lines.slice(0, count);
  if (picked.length > 0) return picked;
  const whole = String(text || '').trim();
  return whole ? [whole.slice(0, 600)] : [];
}

function buildMessages({ target, draft, request }) {
  const spec = TARGETS[target];
  const system = [
    `你在帮一位中小学生把想法写成${spec.label}生成提示词。`,
    spec.hint,
    '每条都要能直接使用：具体、可视、不超过 120 个字，不要解释、不要标题、不要反问。',
    '只输出提示词本身，一行一条。'
  ].join('\n');
  const parts = [];
  if (draft) parts.push(`学生已经写的：${draft}`);
  if (request) parts.push(`学生的要求：${request}`);
  if (parts.length === 0) parts.push('学生还没有写，请先给几个适合课堂练习的安全主题。');
  return [
    { role: 'system', content: system },
    { role: 'user', content: parts.join('\n') }
  ];
}

/**
 * 真正去问模型。调用失败就抛，由路由决定"不扣分"——学生没拿到东西就不该付钱。
 */
async function writeCandidates({ model, target, draft, request, count, call = AICallHelper.callAI }) {
  const wanted = Math.min(Math.max(Number(count) || 2, 1), MAX_CANDIDATES);
  const messages = buildMessages({
    target,
    draft: clean(draft, MAX_DRAFT),
    request: clean(request, MAX_REQUEST)
  });
  messages[1].content += `\n请给 ${wanted} 条不同风格的写法。`;
  const answer = await call(model, messages, { temperature: 0.9, max_tokens: 600, timeout: CALL_TIMEOUT_MS });
  const text = typeof answer === 'string' ? answer : (answer?.content || answer?.text || '');
  const candidates = parseCandidates(text, wanted);
  if (candidates.length === 0) throw new Error('模型没有给出可用的提示词');
  return candidates;
}

module.exports = { writeCandidates, parseCandidates, buildMessages, TARGETS, MAX_DRAFT, MAX_REQUEST, MAX_CANDIDATES };
