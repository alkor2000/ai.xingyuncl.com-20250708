/**
 * Midjourney 操作按钮组件
 * 提供 U1-U4 放大、V1-V4 变体、重新生成三组操作
 *
 * ===== v1.1 国际化改造要点 =====
 *
 * 1. 修正三个错误的 i18n 键路径（这是本次发现的真实缺陷）：
 *      原写法                  实际存在的键
 *      image.upscale     ->    image.action.upscaleLabel
 *      image.variation   ->    image.action.variationLabel
 *      image.reroll      ->    image.action.reroll
 *    原键在中英两侧都不存在，i18next 找不到键时会返回第二参数（中文兜底），
 *    因此中文界面看起来完全正常，切英文后仍然显示中文 —— 属于最隐蔽的一类问题。
 *    现已改为正确键路径，并移除所有中文兜底参数。
 *
 * 2. "放大："中的冒号包含在译文内（中文全角"："、英文半角":"），
 *    不在 JSX 里拼接，否则英文环境会出现全角冒号或多余空格。
 *
 * 3. U1-U4 / V1-V4 按钮文字是 Midjourney 官方操作代号，属技术专有名词，不翻译。
 *
 * ===== v1.1 附带的缺陷修复 =====
 *
 * 移除原本的 buttons 解析语句：
 *   const buttons = typeof item.buttons === 'string' ? JSON.parse(item.buttons) : item.buttons;
 * 该变量定义后从未被任何代码使用，但 JSON.parse 在后端返回非法 JSON 时会抛异常。
 * 本组件由 React.Suspense 懒加载且外层没有 ErrorBoundary，
 * 一旦抛错会导致整个图片列表白屏。既然解析结果无用途，直接移除以消除风险。
 * （item.buttons 仍用于下方的存在性判断，不影响原有显示逻辑。）
 */

import React, { memo } from 'react';
import { Button } from 'antd';
import { ZoomInOutlined, ExperimentOutlined, SyncOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

/* Midjourney 固定提供 4 个网格位置，对应 U1-U4 与 V1-V4 */
const GRID_INDEXES = [1, 2, 3, 4];

/* 允许显示操作按钮的任务类型：只有这三类产出 4 图网格 */
const ACTIONABLE_TYPES = ['IMAGINE', 'VARIATION', 'REROLL'];

const MidjourneyActions = memo(({ item, onAction }) => {
  const { t } = useTranslation();

  /**
   * 不显示操作按钮的情况：
   * - 无 buttons 数据（非 Midjourney 任务或数据缺失）
   * - 无 grid_layout（不是 4 图网格，无法定位第 N 张）
   * - 已是 UPSCALE 结果（单图，不能再放大或变体）
   */
  if (!item.buttons || !item.grid_layout || item.action_type === 'UPSCALE') {
    return null;
  }

  /* 仅对产出网格的任务类型显示按钮 */
  if (!ACTIONABLE_TYPES.includes(item.action_type)) {
    return null;
  }

  return (
    <div className="midjourney-actions">
      {/* 放大组 U1-U4 */}
      <div className="action-group">
        <span className="action-label">{t('image.action.upscaleLabel')}</span>
        {GRID_INDEXES.map(i => (
          <Button
            key={`u${i}`}
            size="small"
            icon={<ZoomInOutlined />}
            onClick={() => onAction(item.id, 'UPSCALE', i)}
          >
            {/* U1-U4 为 Midjourney 官方操作代号，不翻译 */}
            U{i}
          </Button>
        ))}
      </div>

      {/* 变体组 V1-V4 */}
      <div className="action-group">
        <span className="action-label">{t('image.action.variationLabel')}</span>
        {GRID_INDEXES.map(i => (
          <Button
            key={`v${i}`}
            size="small"
            icon={<ExperimentOutlined />}
            onClick={() => onAction(item.id, 'VARIATION', i)}
          >
            {/* V1-V4 为 Midjourney 官方操作代号，不翻译 */}
            V{i}
          </Button>
        ))}
      </div>

      {/* 重新生成 */}
      <Button
        size="small"
        icon={<SyncOutlined />}
        onClick={() => onAction(item.id, 'REROLL')}
      >
        {t('image.action.reroll')}
      </Button>
    </div>
  );
});

MidjourneyActions.displayName = 'MidjourneyActions';

export default MidjourneyActions;
