/**
 * 模型选择器组件
 */

import React, { memo } from 'react';
import { Select, Space, Tag } from 'antd';
import { FireOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { isMidjourneyModel } from '../../utils/imageHelpers';

const { Option } = Select;

const ModelSelector = memo(({ 
  models, 
  selectedModel, 
  onModelChange 
}) => {
  const { t } = useTranslation();

  return (
    <div className="model-selection-compact">
      <div className="section-title">{t('image.selectModel', '选择模型')}</div>
      <Select
        className="model-select"
        placeholder={t('image.selectModelPlaceholder', '请选择生成模型')}
        value={selectedModel?.id}
        onChange={onModelChange}
        style={{ width: '100%' }}
      >
        {models.map(model => {
          const isMj = isMidjourneyModel(model);
          return (
            <Option key={model.id} value={model.id}>
              <Space>
                {isMj ? (
                  <ThunderboltOutlined style={{ color: '#722ed1' }} />
                ) : (
                  <FireOutlined style={{ color: '#ff6b6b' }} />
                )}
                <span>{model.display_name}</span>
                <Tag color={isMj ? 'purple' : 'blue'} style={{ marginLeft: 'auto' }}>
                  {isMj 
                    ? t('image.creditsPerGroup', '{{credits}} 积分/组', { credits: model.price_per_image * 4 })
                    : t('image.creditsPerImage', '{{credits}} 积分', { credits: model.price_per_image })
                  }
                </Tag>
              </Space>
            </Option>
          );
        })}
      </Select>
      
      {selectedModel && (
        <div className="model-description">
          <Space>
            <Tag color={isMidjourneyModel(selectedModel) ? 'purple' : 'volcano'}>
              {selectedModel.provider}
            </Tag>
            {isMidjourneyModel(selectedModel) && (
              <Tag color="cyan">{t('image.asyncGeneration', '异步生成')}</Tag>
            )}
            <span style={{ fontSize: '11px', color: '#8c8c8c' }}>
              {selectedModel.description}
            </span>
          </Space>
        </div>
      )}
    </div>
  );
});

ModelSelector.displayName = 'ModelSelector';

export default ModelSelector;
