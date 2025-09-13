/**
 * 参数设置面板组件
 */

import React, { memo } from 'react';
import { Card, Button, Space, Row, Col, Slider, InputNumber, Switch, Segmented, Alert, Collapse, Tag, Tooltip } from 'antd';
import { SendOutlined, CaretRightOutlined, SettingOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import MidjourneyUploader from './MidjourneyUploader';
import { PRESET_SIZES, QUANTITY_OPTIONS } from '../../utils/constants';
import { isMidjourneyModel } from '../../utils/imageHelpers';

const { Panel } = Collapse;

const ParameterSettings = memo(({
  selectedModel,
  selectedSize,
  seed,
  guidanceScale,
  watermark,
  quantity,
  referenceImages,
  onSizeChange,
  onSeedChange,
  onGuidanceScaleChange,
  onWatermarkChange,
  onQuantityChange,
  onReferenceUpload,
  onRemoveReference,
  onGenerate,
  generating,
  getTotalPrice
}) => {
  const { t } = useTranslation();
  const isMj = selectedModel && isMidjourneyModel(selectedModel);

  return (
    <Card title={t('image.parameterSettings', '参数设置')} className="parameters">
      {/* 生成数量 - Midjourney不显示 */}
      {selectedModel && !isMj && (
        <div className="param-item">
          <div className="param-label">
            {t('image.quantity', '生成数量')}
            <Tooltip title={t('image.quantityTip', '一次生成多张图片，每张使用不同的随机种子')}>
              <span className="info-icon"> ❓</span>
            </Tooltip>
          </div>
          <Segmented
            options={QUANTITY_OPTIONS}
            value={quantity}
            onChange={onQuantityChange}
            block
          />
          {quantity > 1 && (
            <div style={{ marginTop: 8 }}>
              <Alert
                message={t('image.batchGenerateInfo', '批量生成将消耗 {{credits}} 积分', { credits: getTotalPrice() })}
                type="info"
                showIcon={false}
                banner
              />
            </div>
          )}
        </div>
      )}

      {/* 图片尺寸 - 仅非Midjourney模型显示 */}
      {selectedModel && !isMj && (
        <div className="param-item">
          <div className="param-label">{t('image.imageSize', '图片尺寸')}</div>
          <div className="size-grid">
            {PRESET_SIZES.default.map(size => (
              <Button
                key={size.value}
                className={selectedSize === size.value ? 'selected' : ''}
                onClick={() => onSizeChange(size.value)}
              >
                {size.ratio}
              </Button>
            ))}
          </div>
          <div className="size-display">{selectedSize}</div>
        </div>
      )}

      {/* Midjourney参考图片功能 */}
      {selectedModel && isMj && (
        <MidjourneyUploader
          referenceImages={referenceImages}
          onUpload={onReferenceUpload}
          onRemove={onRemoveReference}
        />
      )}

      {/* 生成按钮 */}
      <div className="generate-button-section">
        <Button
          type="primary"
          size="large"
          icon={<SendOutlined />}
          onClick={onGenerate}
          loading={generating}
          disabled={!selectedModel}
          block
        >
          {generating ? (
            t('image.generating', '生成中...')
          ) : (
            <Space>
              <span>{t('image.generateImage', '生成图片')}</span>
              <Tag color="blue">{t('image.credits', '{{credits}} 积分', { credits: getTotalPrice() })}</Tag>
            </Space>
          )}
        </Button>
      </div>

      {/* 高级选项 - Midjourney不需要 */}
      {selectedModel && !isMj && (
        <Collapse
          ghost
          expandIcon={({ isActive }) => <CaretRightOutlined rotate={isActive ? 90 : 0} />}
          className="advanced-options"
        >
          <Panel 
            header={
              <Space>
                <SettingOutlined />
                <span>{t('image.advancedOptions', '高级选项')}</span>
              </Space>
            } 
            key="1"
          >
            <div className="param-item">
              <div className="param-label">
                {t('image.guidanceScale', '引导系数')}
                <Tooltip title={t('image.guidanceScaleTip', '控制生成图像与提示词的相关程度，值越大越相关')}>
                  <span className="info-icon"> ❓</span>
                </Tooltip>
              </div>
              <Row gutter={16}>
                <Col span={16}>
                  <Slider
                    min={1}
                    max={10}
                    step={0.5}
                    value={guidanceScale}
                    onChange={onGuidanceScaleChange}
                  />
                </Col>
                <Col span={8}>
                  <InputNumber
                    min={1}
                    max={10}
                    step={0.5}
                    value={guidanceScale}
                    onChange={onGuidanceScaleChange}
                    style={{ width: '100%' }}
                  />
                </Col>
              </Row>
            </div>

            <div className="param-item">
              <div className="param-label">
                {t('image.seed', '随机种子')}
                <Tooltip title={t('image.seedTip', '使用相同的种子值可以生成相似的图片，-1为随机')}>
                  <span className="info-icon"> ❓</span>
                </Tooltip>
              </div>
              <InputNumber
                min={-1}
                max={2147483647}
                value={seed}
                onChange={onSeedChange}
                style={{ width: '100%' }}
                placeholder={t('image.seedPlaceholder', '-1 为随机')}
              />
            </div>

            <div className="param-item">
              <Row justify="space-between" align="middle">
                <Col>{t('image.addWatermark', '添加水印')}</Col>
                <Col>
                  <Switch checked={watermark} onChange={onWatermarkChange} />
                </Col>
              </Row>
            </div>
          </Panel>
        </Collapse>
      )}
    </Card>
  );
});

ParameterSettings.displayName = 'ParameterSettings';

export default ParameterSettings;
