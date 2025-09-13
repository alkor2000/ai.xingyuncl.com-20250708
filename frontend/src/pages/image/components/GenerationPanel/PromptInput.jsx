/**
 * 提示词输入组件
 */

import React, { memo, useCallback } from 'react';
import { Card, Input, Alert, Tag } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { MIDJOURNEY_EXAMPLES } from '../../utils/constants';
import { isMidjourneyModel } from '../../utils/imageHelpers';

const { TextArea } = Input;

const PromptInput = memo(({ 
  prompt,
  negativePrompt,
  selectedModel,
  onPromptChange,
  onNegativePromptChange
}) => {
  const { t } = useTranslation();
  const isMj = selectedModel && isMidjourneyModel(selectedModel);

  // 处理参数点击
  const handleParamClick = useCallback((param) => {
    const currentPrompt = prompt.trim();
    if (currentPrompt) {
      onPromptChange(currentPrompt + ' ' + param);
    }
  }, [prompt, onPromptChange]);

  return (
    <Card title={t('image.inputPrompt', '输入提示词')} className="prompt-input">
      <TextArea
        value={prompt}
        onChange={(e) => onPromptChange(e.target.value)}
        placeholder={
          isMj 
            ? t('image.mjPromptPlaceholder', '描述你想生成的图片，可直接添加参数如 --ar 16:9 --v 6 --s 750...')
            : t('image.promptPlaceholder', '描述你想生成的图片内容...')
        }
        rows={3}
        maxLength={isMj ? 4000 : 1000}
        showCount
      />
      
      {/* Midjourney参数提示 */}
      {isMj && (
        <div style={{ marginTop: 12 }}>
          <Alert
            message={t('image.parameterTips', '参数提示')}
            description={
              <div>
                <div style={{ marginBottom: 8 }}>
                  {t('image.parameterTipsDesc', '直接在提示词末尾添加参数即可，常用参数：')}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {MIDJOURNEY_EXAMPLES.map(example => (
                    <Tag 
                      key={example.param}
                      style={{ cursor: 'pointer' }}
                      onClick={() => handleParamClick(example.param)}
                    >
                      <code>{example.param}</code> - {t(`image.param.${example.param}`, example.desc)}
                    </Tag>
                  ))}
                </div>
                <div style={{ marginTop: 8, fontSize: 12, color: '#8c8c8c' }}>
                  {t('image.clickToAddParam', '点击参数标签可快速添加到提示词末尾')}
                </div>
              </div>
            }
            type="info"
            showIcon
            icon={<InfoCircleOutlined />}
          />
        </div>
      )}
      
      {!isMj && (
        <div className="negative-prompt">
          <div className="label">{t('image.negativePrompt', '负面提示词（可选）')}</div>
          <TextArea
            value={negativePrompt}
            onChange={(e) => onNegativePromptChange(e.target.value)}
            placeholder={t('image.negativePromptPlaceholder', '描述你不想在图片中出现的内容...')}
            rows={2}
            maxLength={500}
          />
        </div>
      )}
    </Card>
  );
});

PromptInput.displayName = 'PromptInput';

export default PromptInput;
