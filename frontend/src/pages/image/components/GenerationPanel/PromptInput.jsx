/**
 * 提示词输入组件
 * 优化：精简参数提示内容和样式
 *
 * ── 本次 i18n 清理（零行为变更）──
 * 1) 剥离 6 处 t() 的中文兜底第二参数。
 *    诊断已确认这 6 个键在 zh/en 两侧语言包均存在，兜底从未生效；
 *    保留兜底会让"键缺失"在中文环境隐形（切英文才暴露）。
 *
 * 2) Midjourney 参数说明改为纯 i18n 取值。
 *    原写法 t(`image.param.${example.param}`, example.desc) 中，
 *    第二参数是 i18next 的 defaultValue。由于 image.param.* 键已全部存在，
 *    example.desc 永远不会被取用，属死数据，已随 constants.js 一并删除。
 *    删除后若将来新增参数却漏配语言包键，界面会直接显示键名
 *    （如 "image.param.--chaos 50"），问题立即可见——这正是我们想要的行为。
 */

import React, { memo, useCallback, useState } from 'react';
import { Card, Input, Tag, Space, Button } from 'antd';
import { QuestionCircleOutlined, CaretRightOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { MIDJOURNEY_EXAMPLES } from '../../utils/constants';
import { isMidjourneyModel } from '../../utils/imageHelpers';

const { TextArea } = Input;

/**
 * 提示词长度上限
 * Midjourney 支持更长的提示词（含大量 --xx 参数），普通模型限制更严
 */
const PROMPT_MAX_LENGTH_MJ = 4000;
const PROMPT_MAX_LENGTH_NORMAL = 1000;

/** 负面提示词长度上限 */
const NEGATIVE_PROMPT_MAX_LENGTH = 500;

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

  // 处理参数点击：把 Midjourney 参数追加到提示词末尾
  const handleParamClick = useCallback((param) => {
    const currentPrompt = prompt.trim();
    if (currentPrompt) {
      onPromptChange(currentPrompt + ' ' + param);
    }
  }, [prompt, onPromptChange]);

  return (
    <Card title={t('image.inputPrompt')} className="prompt-input">
      <TextArea
        value={prompt}
        onChange={(e) => onPromptChange(e.target.value)}
        placeholder={
          isMj
            ? t('image.mjPromptPlaceholder')
            : t('image.promptPlaceholder')
        }
        rows={3}
        maxLength={isMj ? PROMPT_MAX_LENGTH_MJ : PROMPT_MAX_LENGTH_NORMAL}
        showCount
      />

      {/* Midjourney参数提示 */}
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
              {t('image.parameterHelper')}
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
                  {/* 参数本体为 Midjourney 官方写法，属技术标识不翻译 */}
                  <span className="param-code">{example.param}</span>
                  {/* 说明文字按 image.param.{参数} 从语言包取，不再用 desc 兜底 */}
                  <span className="param-desc">{t(`image.param.${example.param}`)}</span>
                </Tag>
              ))}
            </div>
          )}
        </div>
      )}

      {!isMj && (
        <div className="negative-prompt">
          <div className="label">{t('image.negativePrompt')}</div>
          <TextArea
            value={negativePrompt}
            onChange={(e) => onNegativePromptChange(e.target.value)}
            placeholder={t('image.negativePromptPlaceholder')}
            rows={2}
            maxLength={NEGATIVE_PROMPT_MAX_LENGTH}
          />
        </div>
      )}
    </Card>
  );
});

PromptInput.displayName = 'PromptInput';

export default PromptInput;
