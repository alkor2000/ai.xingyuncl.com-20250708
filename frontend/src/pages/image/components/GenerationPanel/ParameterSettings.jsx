/**
 * 参数设置面板组件
 * 支持图生图和Midjourney参考图片
 * 修复：Midjourney也遵守后台的图生图开关设置
 *
 * ── 本次 i18n 清理（零行为变更）──
 * 剥离全部 23 处 t() 的中文兜底第二参数。
 * 原因：i18next 在键缺失时会直接返回 defaultValue，使得"键没配"在中文
 * 环境下完全看不出来（显示正常），只有切到英文才暴露。诊断已确认本文件
 * 引用的 23 个键在 zh-CN/image.json 与 en-US/image.json 两侧均存在，
 * 兜底纯属冗余且有害，故一并移除。
 *
 * 注意插值调用的参数形态变化：
 *   旧: t('key', '默认文案 {{n}}', { n })   // 三参数：键 + defaultValue + options
 *   新: t('key', { n })                    // 两参数：键 + options
 * 若误写成 t('key', { n }) 之外的形式（例如漏掉 options），插值会渲染成
 * 原始的 {{n}} 字面量，因此下方每处插值都保留了 options 对象。
 *
 * i18n 结构说明:
 *   - QUANTITY_OPTIONS 为纯数值数组 [1,2,3,4]（常量文件不存文案）
 *   - Segmented 的 options 在组件内用 t('image.imageCount', { count }) 实时生成，
 *     且 useMemo 依赖包含 t，保证语言切换后选项文案刷新
 */

import React, { memo, useMemo } from 'react';
import { Card, Button, Space, Row, Col, Slider, InputNumber, Switch, Segmented, Alert, Collapse, Tag, Tooltip } from 'antd';
import { SendOutlined, CaretRightOutlined, SettingOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import MidjourneyUploader from './MidjourneyUploader';
import ReferenceUploader from './ReferenceUploader';
import { PRESET_SIZES, QUANTITY_OPTIONS } from '../../utils/constants';
import { isMidjourneyModel } from '../../utils/imageHelpers';

const { Panel } = Collapse;

/** 未配置 max_reference_images 时的默认参考图数量上限 */
const DEFAULT_MAX_REFERENCE_IMAGES = 2;

/** 引导系数取值范围与步长（模型侧约束） */
const GUIDANCE_SCALE_MIN = 1;
const GUIDANCE_SCALE_MAX = 10;
const GUIDANCE_SCALE_STEP = 0.5;

/** 随机种子取值范围：-1 表示随机，上限为 int32 最大值 */
const SEED_RANDOM = -1;
const SEED_MAX = 2147483647;

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

  // 检查模型是否支持图生图 - 统一检查逻辑
  const supportsImage2Image = selectedModel?.api_config?.supports_image2image === true;
  const maxReferenceImages = selectedModel?.api_config?.max_reference_images || DEFAULT_MAX_REFERENCE_IMAGES;

  // 是否处于图生图模式（已上传参考图且非 Midjourney）
  const isImage2ImageMode = Boolean(referenceImages && referenceImages.length > 0);

  /**
   * 数量选项 label 由 t() 实时生成
   * 依赖必须含 t：t 在语言切换时是新引用，若不加入依赖则 useMemo 缓存不失效，
   * 切换语言后"1张/2张"不会更新（该问题在中文环境完全无法察觉）
   */
  const quantitySegmentedOptions = useMemo(
    () => QUANTITY_OPTIONS.map(n => ({
      label: t('image.imageCount', { count: n }),
      value: n
    })),
    [t]
  );

  return (
    <Card title={t('image.parameterSettings')} className="parameters">
      {/* 生成数量 - Midjourney和图生图模式不显示 */}
      {selectedModel && !isMj && !isImage2ImageMode && (
        <div className="param-item">
          <div className="param-label">
            {t('image.quantity')}
            <Tooltip title={t('image.quantityTip')}>
              {/* ❓ 为视觉符号，保留在 JSX 不进语言包 */}
              <span className="info-icon"> ❓</span>
            </Tooltip>
          </div>
          <Segmented
            options={quantitySegmentedOptions}
            value={quantity}
            onChange={onQuantityChange}
            block
          />
          {quantity > 1 && (
            <div style={{ marginTop: 8 }}>
              <Alert
                message={t('image.batchGenerateInfo', { credits: getTotalPrice() })}
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
          <div className="param-label">{t('image.imageSize')}</div>
          <div className="size-grid">
            {PRESET_SIZES.default.map(size => (
              <Button
                key={size.value}
                className={selectedSize === size.value ? 'selected' : ''}
                onClick={() => onSizeChange(size.value)}
              >
                {/* 比例写法为国际通用技术标识，不翻译 */}
                {size.ratio}
              </Button>
            ))}
          </div>
          {/* 像素尺寸为技术参数，不翻译 */}
          <div className="size-display">{selectedSize}</div>
        </div>
      )}

      {/* Midjourney参考图片功能 - 检查supports_image2image配置 */}
      {selectedModel && isMj && supportsImage2Image && (
        <MidjourneyUploader
          referenceImages={referenceImages}
          onUpload={onReferenceUpload}
          onRemove={onRemoveReference}
        />
      )}

      {/* 普通模型的图生图功能 */}
      {selectedModel && !isMj && supportsImage2Image && (
        <ReferenceUploader
          referenceImages={referenceImages}
          onUpload={onReferenceUpload}
          onRemove={onRemoveReference}
          maxCount={maxReferenceImages}
          modelConfig={selectedModel.api_config}
        />
      )}

      {/* 如果模型不支持图生图，显示提示 */}
      {selectedModel && !supportsImage2Image && (
        <Alert
          message={t('image.noImage2ImageSupport')}
          description={
            isMj
              ? t('image.mjNoImage2ImageDesc')
              : t('image.noImage2ImageDesc')
          }
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      {/* 图生图模式提示 */}
      {isImage2ImageMode && !isMj && (
        <Alert
          message={t('image.image2imageMode')}
          description={t('image.image2imageDesc')}
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
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
            t('image.generating')
          ) : (
            <Space>
              <span>
                {isImage2ImageMode && !isMj
                  ? t('image.generateFromImage')
                  : t('image.generateImage')}
              </span>
              <Tag color="blue">{t('image.credits', { credits: getTotalPrice() })}</Tag>
            </Space>
          )}
        </Button>
      </div>

      {/* 高级选项 - Midjourney和图生图模式下部分选项不可用 */}
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
                <span>{t('image.advancedOptions')}</span>
              </Space>
            }
            key="1"
          >
            {/* 引导系数 - 图生图模式可能不支持 */}
            <div className="param-item">
              <div className="param-label">
                {t('image.guidanceScale')}
                <Tooltip title={t('image.guidanceScaleTip')}>
                  <span className="info-icon"> ❓</span>
                </Tooltip>
                {isImage2ImageMode && (
                  <Tag color="orange" style={{ marginLeft: 8 }}>
                    {t('image.mayNotSupport')}
                  </Tag>
                )}
              </div>
              <Row gutter={16}>
                <Col span={16}>
                  <Slider
                    min={GUIDANCE_SCALE_MIN}
                    max={GUIDANCE_SCALE_MAX}
                    step={GUIDANCE_SCALE_STEP}
                    value={guidanceScale}
                    onChange={onGuidanceScaleChange}
                    disabled={isImage2ImageMode}
                  />
                </Col>
                <Col span={8}>
                  <InputNumber
                    min={GUIDANCE_SCALE_MIN}
                    max={GUIDANCE_SCALE_MAX}
                    step={GUIDANCE_SCALE_STEP}
                    value={guidanceScale}
                    onChange={onGuidanceScaleChange}
                    style={{ width: '100%' }}
                    disabled={isImage2ImageMode}
                  />
                </Col>
              </Row>
            </div>

            <div className="param-item">
              <div className="param-label">
                {t('image.seed')}
                <Tooltip title={t('image.seedTip')}>
                  <span className="info-icon"> ❓</span>
                </Tooltip>
              </div>
              <InputNumber
                min={SEED_RANDOM}
                max={SEED_MAX}
                value={seed}
                onChange={onSeedChange}
                style={{ width: '100%' }}
                placeholder={t('image.seedPlaceholder')}
              />
            </div>

            <div className="param-item">
              <Row justify="space-between" align="middle">
                <Col>{t('image.addWatermark')}</Col>
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
