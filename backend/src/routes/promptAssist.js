'use strict';

/**
 * POST /api/prompt-assist —— 「帮我写提示词」的唯一入口（图像与视频共用）。
 *
 * 边界，一条都不放宽：
 *  - 只用这个学生本来就能用的模型（组权限 + 个人限制），传了不在名单里的就按名拒绝；
 *  - 计费与对话同规则（该模型的 credits_per_chat），**先成功再扣分**：模型没给出东西就不收费；
 *  - 不建会话、不存消息、不写历史，提示词只回给页面；
 *  - 不接受任何 URL、文件或会话 id，只有两段短文本。
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authMiddleware');
const AIModel = require('../models/AIModel');
const User = require('../models/User');
const logger = require('../utils/logger');
const {
  writeCandidates, TARGETS, MAX_DRAFT, MAX_REQUEST, MAX_CANDIDATES
} = require('../services/promptAssistService');

router.use(authenticate);

const fail = (res, status, code, message) =>
  res.status(status).json({ success: false, error: { code, message } });

router.post('/', async (req, res) => {
  const userId = req.user.id;
  const { target, draft, request, model_id: modelId, count } = req.body || {};

  if (!Object.prototype.hasOwnProperty.call(TARGETS, target)) {
    return fail(res, 400, 'invalid_target', '只支持 image 或 video');
  }
  for (const [value, limit, name] of [[draft, MAX_DRAFT, 'draft'], [request, MAX_REQUEST, 'request']]) {
    if (value !== undefined && (typeof value !== 'string' || value.length > limit)) {
      return fail(res, 400, 'invalid_request', `${name} 必须是不超过 ${limit} 字的文本`);
    }
  }
  if (count !== undefined && ![1, 2, 3].includes(Number(count))) {
    return fail(res, 400, 'invalid_request', `一次最多 ${MAX_CANDIDATES} 条`);
  }

  try {
    // 能用哪些模型，由平台既有的组权限与个人限制说了算，这里只读不放宽。
    const available = await AIModel.getUserAvailableModels(userId, req.user.group_id);
    if (!available || available.length === 0) {
      return fail(res, 403, 'no_model_available', '你的账号还没有可用的模型，请联系老师');
    }
    const model = modelId === undefined || modelId === null
      // 没指定就挑最便宜的那个：写提示词不该替学生花掉贵模型的积分。
      ? [...available].sort((a, b) => (a.credits_per_chat ?? 10) - (b.credits_per_chat ?? 10))[0]
      : available.find(item => String(item.id) === String(modelId));
    if (!model) return fail(res, 403, 'model_not_allowed', '该模型不在你的可用范围内');
    if (model.has_api_key === false) return fail(res, 503, 'model_unavailable', '该模型暂时不可用');

    const price = model.credits_per_chat !== undefined ? model.credits_per_chat : 10;
    const user = await User.findById(userId);
    if (!user) return fail(res, 403, 'forbidden', '账号不可用');
    if (!user.hasCredits(price)) {
      return fail(res, 402, 'insufficient_credits', `积分不足：这次需要 ${price} 积分`);
    }

    const candidates = await writeCandidates({ model, target, draft, request, count });

    // 先拿到东西，再扣分；调用失败的那条路走不到这里。
    await user.consumeCredits(price, model.id, null, 'AI 协助写提示词', 'chat_consume');

    return res.json({
      success: true,
      data: {
        candidates,
        model: { id: model.id, name: model.name, display_name: model.display_name },
        credits_charged: price
      }
    });
  } catch (error) {
    logger.error('写提示词失败', { userId, target, error: error.message });
    return fail(res, 502, 'assist_failed', '这次没能写出来，请稍后再试（未扣积分）');
  }
});

module.exports = router;
