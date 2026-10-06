'use strict';

/**
 * GET /api/studio-pilot/capability?capability=video_studio
 *
 * 页面开页问一次：**这个人现在能不能看到这一套新体验**。只读，不写任何东西。
 *
 * 为什么单独一个路由：图像那一片当初把这个问题挂在 /api/prompt-assist/capability 下面，
 * 名字是历史原因（那时只有「帮我写」一个新能力）。视频工作台跟写提示词没关系，
 * 挂在那个名字下面只会让后来人看不懂，所以这里给它一个说得清的位置。
 * **判定仍然是同一个 decide()**，没有第二套逻辑、没有第二份缺省。
 *
 * 一个能力一个答案：图像放行不等于视频放行（decide 会把 capability 一起交给 provider，
 * provider 回答里写了 capability 就必须对得上）。
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authMiddleware');
const { decide, CAPABILITIES } = require('../services/imagePilot/eligibility');

router.use(authenticate);

/* 说给人听的一句话；未装配时不解释内部状态，只说还没开放 */
const REFUSAL_TEXT = Object.freeze({
  pilot_provider_not_installed: '这个功能还没有对你所在的学校开放',
  pilot_provider_unavailable: '暂时问不到你的使用资格，请稍后再试',
  school_not_in_pilot: '这个功能还没有对你所在的学校开放',
  identity_expired: '你的学校身份信息已过期，请重新从学校入口进来',
  not_registered: '这个功能还没有对你所在的学校开放',
  suspended: '这个功能在你所在的学校已暂停',
  batch_changed: '开放批次已经变了，请联系老师',
  pilot_capability_not_granted: '这个功能还没有单独对你所在的学校开放',
  not_eligible: '你暂时还不能用这个功能'
});

router.get('/capability', async (req, res) => {
  const capability = typeof req.query.capability === 'string' ? req.query.capability : '';
  if (!CAPABILITIES.includes(capability)) {
    return res.status(400).json({
      success: false,
      error: { code: 'invalid_capability', message: `capability 只能是 ${CAPABILITIES.join(' / ')}` }
    });
  }
  const verdict = await decide(req.app, req.user, { capability });
  return res.json({
    success: true,
    data: {
      capability,
      available: verdict.available,
      reason: verdict.reason,
      retryable: verdict.retryable,
      message: verdict.available ? null : (REFUSAL_TEXT[verdict.reason] || REFUSAL_TEXT.not_eligible),
      batch_ref: verdict.batchRef
    }
  });
});

module.exports = router;
