import React, { useMemo, useState } from 'react';
import { Button, Drawer, Input, Select, Space, Tag, Tooltip, Typography } from 'antd';
import { BulbOutlined, PictureOutlined, SendOutlined, SlidersOutlined } from '@ant-design/icons';
import PromptAssistPanel from './PromptAssistPanel';

/**
 * 底部输入条：学生真正动手的地方。
 *
 * 排布的道理很简单——**写字的地方要一直在手边，参数是偶尔才调的**。所以提示词框常驻底部，
 * 模型是一个小选择器，尺寸/数量/种子这些做成一排 chip，点开才是抽屉；「生成」按钮上直接
 * 写明这次要花多少积分，不让人按下去才知道。
 *
 * 这里不自己算价、不自己调接口：价格与生成都用页面原有的那套（getTotalPrice / onGenerate），
 * 新旧两个视图共用同一条业务路径。
 */
export default function PromptComposer({
  t, models = [], selectedModel, onModelChange, prompt, onPromptChange,
  onGenerate, generating, totalPrice, quantity, selectedSize, seed, referenceCount = 0,
  parameterPanel, compact = false
}) {
  const [paramsOpen, setParamsOpen] = useState(false);
  const [assistOpen, setAssistOpen] = useState(false);

  const chips = useMemo(() => {
    const list = [{ key: 'size', label: selectedSize }, { key: 'count', label: t('image.imageCount', { count: quantity }) }];
    if (seed !== undefined && seed !== null && seed !== -1) list.push({ key: 'seed', label: `seed ${seed}` });
    if (referenceCount > 0) list.push({ key: 'ref', label: t('image.studio.withReference', { count: referenceCount }) });
    return list;
  }, [selectedSize, quantity, seed, referenceCount, t]);

  const canGenerate = Boolean(selectedModel) && prompt.trim().length > 0 && !generating;

  return (
    <div className={`studio-composer ${compact ? 'compact' : ''}`} data-testid="studio-composer">
      {/* 参数不常用，就不常驻：一排 chip 说明当前是什么设置，点一下才展开 */}
      <div className="studio-chips">
        <Select className="studio-model" size="small" value={selectedModel?.id} onChange={onModelChange}
          popupMatchSelectWidth={false} data-testid="studio-model"
          options={models.map(m => ({ value: m.id, label: m.display_name || m.name }))} />
        {chips.map(chip => (
          <Tag key={chip.key} onClick={() => setParamsOpen(true)} className="studio-chip">{chip.label}</Tag>
        ))}
        <Button size="small" type="text" icon={<SlidersOutlined />} onClick={() => setParamsOpen(true)}
          data-testid="studio-params">{t('image.studio.parameters')}</Button>
      </div>

      <div className="studio-input-row">
        <Input.TextArea
          value={prompt}
          onChange={e => onPromptChange(e.target.value)}
          autoSize={{ minRows: compact ? 2 : 3, maxRows: compact ? 5 : 8 }}
          placeholder={t('image.studio.placeholder')}
          data-testid="studio-prompt"
        />
        <Space direction={compact ? 'horizontal' : 'vertical'} className="studio-actions">
          <Tooltip title={t('image.assist.title')}>
            <Button icon={<BulbOutlined />} onClick={() => setAssistOpen(true)} data-testid="studio-assist">
              {compact ? null : t('image.assist.short')}
            </Button>
          </Tooltip>
          <Button type="primary" icon={<SendOutlined />} loading={generating} disabled={!canGenerate}
            onClick={onGenerate} data-testid="studio-generate">
            {generating ? t('image.generating') : t('image.studio.generateWithPrice', { price: totalPrice })}
          </Button>
        </Space>
      </div>

      {!selectedModel && (
        <Typography.Text type="secondary" data-testid="studio-no-model">
          <PictureOutlined /> {t('image.studio.pickModelFirst')}
        </Typography.Text>
      )}

      <Drawer open={paramsOpen} onClose={() => setParamsOpen(false)} placement="bottom"
        height="min(560px, 85dvh)" title={t('image.studio.parameters')} rootClassName="studio-params-drawer">
        {parameterPanel}
      </Drawer>

      <PromptAssistPanel
        open={assistOpen} onClose={() => setAssistOpen(false)} t={t} target="image" draft={prompt}
        onUse={(text, mode) => {
          onPromptChange(mode === 'append' && prompt.trim() ? `${prompt.trim()}，${text}` : text);
          setAssistOpen(false);
        }}
      />
    </div>
  );
}
