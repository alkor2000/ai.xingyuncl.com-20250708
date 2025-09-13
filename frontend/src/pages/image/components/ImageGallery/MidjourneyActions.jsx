/**
 * Midjourney操作按钮组件
 */

import React, { memo } from 'react';
import { Button } from 'antd';
import { ZoomInOutlined, ExperimentOutlined, SyncOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

const MidjourneyActions = memo(({ item, onAction }) => {
  const { t } = useTranslation();

  // 不显示操作按钮的条件
  if (!item.buttons || !item.grid_layout || item.action_type === 'UPSCALE') {
    return null;
  }
  
  const buttons = typeof item.buttons === 'string' ? JSON.parse(item.buttons) : item.buttons;
  
  // 只对IMAGINE、VARIATION、REROLL类型显示操作按钮
  if (item.action_type === 'IMAGINE' || item.action_type === 'VARIATION' || item.action_type === 'REROLL') {
    return (
      <div className="midjourney-actions">
        <div className="action-group">
          <span className="action-label">{t('image.upscale', '放大：')}</span>
          {[1, 2, 3, 4].map(i => (
            <Button
              key={`u${i}`}
              size="small"
              icon={<ZoomInOutlined />}
              onClick={() => onAction(item.id, 'UPSCALE', i)}
            >
              U{i}
            </Button>
          ))}
        </div>
        <div className="action-group">
          <span className="action-label">{t('image.variation', '变体：')}</span>
          {[1, 2, 3, 4].map(i => (
            <Button
              key={`v${i}`}
              size="small"
              icon={<ExperimentOutlined />}
              onClick={() => onAction(item.id, 'VARIATION', i)}
            >
              V{i}
            </Button>
          ))}
        </div>
        <Button
          size="small"
          icon={<SyncOutlined />}
          onClick={() => onAction(item.id, 'REROLL')}
        >
          {t('image.reroll', '重新生成')}
        </Button>
      </div>
    );
  }
  
  return null;
});

MidjourneyActions.displayName = 'MidjourneyActions';

export default MidjourneyActions;
