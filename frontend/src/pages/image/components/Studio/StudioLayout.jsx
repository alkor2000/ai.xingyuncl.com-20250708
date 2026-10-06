import React, { useCallback, useMemo, useState } from 'react';
import { Button, Drawer, Tooltip } from 'antd';
import { LayoutOutlined, PictureOutlined } from '@ant-design/icons';
import ConversationArea from './ConversationArea';
import GallerySection from './GallerySection';
import PromptComposer from './PromptComposer';

/**
 * 新版工作台：上面是这一次的对话，下面是写字的地方，图库收在右边抽屉里。
 *
 * 和经典视图共用同一套数据与处理函数（生成、收藏、公开、删除、分页都是页面原来那一份），
 * 这里只负责怎么摆。手机与桌面同一套信息架构，compact 只是压紧。
 */
export default function StudioLayout(props) {
  const {
    t, compact, onExitStudio, generation, upload, parameterPanel, galleryProps,
    handleGenerate, renderActions, handleViewImage, handleViewTurnImage, turns, turnItems, assist
  } = props;
  const [galleryOpen, setGalleryOpen] = useState(false);

  /**
   * 对话区的图只从页面给的 turnItems 里取。
   * 这里**不能**去读 galleryProps.getCurrentData()：那是图库当前 Tab / 搜索 / 分页的切片，
   * 一切 Tab 或一搜索，本轮的图就会被过滤掉、在对话区凭空消失。
   */
  const byId = useMemo(() => {
    const map = turnItems instanceof Map ? turnItems : new Map(Object.entries(turnItems || {}));
    return id => map.get(id);
  }, [turnItems]);
  const viewTurnImage = handleViewTurnImage || handleViewImage;

  const rerun = useCallback((prompt) => {
    generation.setPrompt(prompt);            // 只是把提示词放回输入框，要不要再生成由学生自己按
  }, [generation]);

  return (
    <div className={`image-studio ${compact ? 'compact' : ''}`} data-testid="image-studio">
      <div className="studio-head">
        <Button size="small" icon={<PictureOutlined />} onClick={() => setGalleryOpen(true)}
          data-testid="studio-open-gallery">{t('image.studio.gallery')}</Button>
        <Tooltip title={t('image.studio.classicHint')}>
          <Button size="small" type="text" icon={<LayoutOutlined />} onClick={onExitStudio}
            data-testid="studio-to-classic">{t('image.studio.classic')}</Button>
        </Tooltip>
      </div>

      <div className="studio-main">
        <ConversationArea
          t={t} turns={turns} itemById={byId}
          generating={generation.generating} progress={generation.generationProgress}
          onView={viewTurnImage} onRerun={rerun}
        />
      </div>

      <PromptComposer
        t={t} compact={compact}
        models={generation.models} selectedModel={generation.selectedModel}
        onModelChange={generation.handleModelChange}
        assist={assist}
        prompt={generation.prompt} onPromptChange={generation.setPrompt}
        onGenerate={handleGenerate} generating={generation.generating}
        totalPrice={generation.getTotalPrice()} quantity={generation.quantity}
        selectedSize={generation.selectedSize} seed={generation.seed}
        referenceCount={upload.referenceImages?.length || 0}
        parameterPanel={parameterPanel}
      />

      {/* 图库：平时收着，点开才翻；收藏、公开、删除这些管理动作只在这里 */}
      <Drawer open={galleryOpen} onClose={() => setGalleryOpen(false)}
        placement={compact ? 'bottom' : 'right'}
        width={compact ? undefined : 'min(880px, 92vw)'} height={compact ? '88dvh' : undefined}
        title={t('image.studio.gallery')} rootClassName="studio-gallery-drawer"
        destroyOnClose={false}>
        <GallerySection {...galleryProps} className="studio-gallery" renderActions={renderActions} />
      </Drawer>
    </div>
  );
}
