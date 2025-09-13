/**
 * 提示词输入组件
 * 优化：精简参数提示内容和样式
 */

import React, { memo, useCallback, useState } from 'react';
import { Card, Input, Tag, Space, Button } from 'antd';
import { QuestionCircleOutlined, CaretRightOutlined } from '@ant-design/icons';
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
  const [showParams, setShowParams] = useState(false); // 参数提示默认折叠

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
      
      {/* Midjourney参数提示 - 优化版 */}
      {isMj && (
        <div className="mj-params-helper">
          <Button
            type="text"
            size="small"
            icon={<CaretRightOutlined rotate={showParams ? 90 : 0} />}
            onClick={() => setShowParams(!showParams)}
            style={{ 
              padding: '2px 8px', 
              margin: '8px 0 4px 0',
              fontSize: '12px',
              color: '#8c8c8c'
            }}
          >
            <Space size={4}>
              <QuestionCircleOutlined />
              {t('image.parameterHelper', '参数助手')}
            </Space>
          </Button>
          
          {showParams && (
            <div className="params-grid">
              {MIDJOURNEY_EXAMPLES.map(example => (
                <Tag 
                  key={example.param}
                  className="param-tag"
                  onClick={() => handleParamClick(example.param)}
                >
                  <span className="param-code">{example.param}</span>
                  <span className="param-desc">{t(`image.param.${example.param}`, example.desc)}</span>
                </Tag>
              ))}
            </div>
          )}
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
