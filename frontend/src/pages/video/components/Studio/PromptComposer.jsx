import React, { useMemo, useState } from 'react';
import { Button, Drawer, Input, Select, Space, Tag, Typography } from 'antd';
import { PictureOutlined, SendOutlined, SlidersOutlined } from '@ant-design/icons';

/**
 * 底部输入条：写一句话，点生成。
 *
 * 和图像那边同一套摆法——写字的地方常驻，模型是个小选择器，分辨率/时长/比例/模式
 * 做成一排 chip，点开才是抽屉；按钮上直接写这次要花多少积分。
 * 视频自己的东西一个没丢：生成模式、首尾帧、时长与分辨率都在抽屉里，
 * 不把图像那套不适用的参数硬搬过来。
 *
 * 这里不自己算价、不自己调接口：价格与生成都用页面原有的那一份。
 */
export default function PromptComposer({
  t, compact = false, models = [], selectedModel, onModelChange,
  prompt, onPromptChange, onGenerate, generating, price,
  resolution, duration, ratio, generationMode, frameCount = 0,
  parameterPanel
}) {
  const [paramsOpen, setParamsOpen] = useState(false);

  const chips = useMemo(() => {
    const modeLabel = {
      text_to_video: t('video.modeTextToVideo'),
      first_frame: t('video.modeFirstFrame'),
      first_last_frame: t('video.modeFirstLastFrame')
    }[generationMode] || generationMode;
    const list = [
      { key: 'mode', label: modeLabel },
      { key: 'res', label: resolution },
      { key: 'dur', label: `${duration}${t('video.seconds')}` },
      { key: 'ratio', label: ratio }
    ];
    if (frameCount > 0) list.push({ key: 'frame', label: t('video.studio.withFrames', { count: frameCount }) });
    return list;
  }, [generationMode, resolution, duration, ratio, frameCount, t]);

  const missingFrames = (generationMode === 'first_frame' && frameCount < 1)
    || (generationMode === 'first_last_frame' && frameCount < 2);
  const canGenerate = Boolean(selectedModel) && selectedModel.has_api_key !== false
    && prompt.trim().length > 0 && !generating && !missingFrames;

  return (
    <div className={`studio-composer ${compact ? 'compact' : ''}`} data-testid="studio-composer">
      <div className="studio-chips">
        <Select className="studio-model" size="small" value={selectedModel?.id} onChange={onModelChange}
          popupMatchSelectWidth={false} data-testid="studio-model"
          options={models.map(m => ({ value: m.id, label: m.display_name || m.name }))} />
        {chips.map(chip => (
          <Tag key={chip.key} className="studio-chip" onClick={() => setParamsOpen(true)}>{chip.label}</Tag>
        ))}
        <Button size="small" type="text" icon={<SlidersOutlined />} onClick={() => setParamsOpen(true)}
          data-testid="studio-params">{t('video.parameters')}</Button>
      </div>

      <div className="studio-input-row">
        <Input.TextArea
          value={prompt}
          onChange={e => onPromptChange(e.target.value)}
          autoSize={{ minRows: compact ? 2 : 3, maxRows: compact ? 5 : 8 }}
          maxLength={selectedModel?.max_prompt_length || 500}
          placeholder={t('video.studio.placeholder')}
          data-testid="studio-prompt"
        />
        <Space direction={compact ? 'horizontal' : 'vertical'} className="studio-actions">
          <Button type="primary" icon={<SendOutlined />} loading={generating} disabled={!canGenerate}
            onClick={onGenerate} data-testid="studio-generate">
            {generating ? t('video.generating') : t('video.studio.generateWithPrice', { price })}
          </Button>
        </Space>
      </div>

      {!selectedModel && (
        <Typography.Text type="secondary" data-testid="studio-no-model">
          <PictureOutlined /> {t('video.studio.pickModelFirst')}
        </Typography.Text>
      )}
      {selectedModel && missingFrames && (
        <Typography.Text type="secondary" data-testid="studio-need-frame">
          {generationMode === 'first_last_frame' ? t('video.pleaseUploadBothFrames') : t('video.pleaseUploadFirstFrame')}
        </Typography.Text>
      )}

      <Drawer open={paramsOpen} onClose={() => setParamsOpen(false)} placement="bottom"
        height="min(620px, 88dvh)" title={t('video.parameters')} rootClassName="studio-params-drawer">
        {parameterPanel}
      </Drawer>
    </div>
  );
}
