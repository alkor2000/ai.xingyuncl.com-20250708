import React, { useCallback, useMemo, useState } from 'react';
import { Button, Drawer, Tooltip } from 'antd';
import { LayoutOutlined, VideoCameraOutlined } from '@ant-design/icons';
import ConversationArea from './ConversationArea';
import GallerySection from './GallerySection';
import PromptComposer from './PromptComposer';

/**
 * 新版视频工作台：上面是这一次的对话，下面是写字的地方，图库收在右边抽屉里。
 *
 * 和经典视图共用同一套数据与处理函数（生成、收藏、公开、删除、分页都是页面原来那一份），
 * 这里只负责怎么摆。手机与桌面同一套信息架构，compact 只是压紧。
 */
export default function StudioLayout(props) {
  const {
    t, compact, onExitStudio, composer, galleryProps, turns, turnItems, onRerun, onOpen
  } = props;
  const [galleryOpen, setGalleryOpen] = useState(false);

  /**
   * 对话区的视频只从页面给的 turnItems 里取。
   * **不能**去读图库当前页：那是当前 Tab / 搜索 / 分页的切片，
   * 一切页签或一搜索，本轮的视频就会在对话区凭空消失。
   */
  const byId = useMemo(() => {
    const map = turnItems instanceof Map ? turnItems : new Map(Object.entries(turnItems || {}));
    return id => map.get(id);
  }, [turnItems]);

  const rerun = useCallback((prompt) => { onRerun(prompt); }, [onRerun]);

  return (
    <div className={`video-studio ${compact ? 'compact' : ''}`} data-testid="video-studio">
      <div className="studio-head">
        <Button size="small" icon={<VideoCameraOutlined />} onClick={() => setGalleryOpen(true)}
          data-testid="studio-open-gallery">{t('video.studio.gallery')}</Button>
        <Tooltip title={t('video.studio.classicHint')}>
          <Button size="small" type="text" icon={<LayoutOutlined />} onClick={onExitStudio}
            data-testid="studio-to-classic">{t('video.studio.classic')}</Button>
        </Tooltip>
      </div>

      <div className="studio-main">
        <ConversationArea t={t} turns={turns} itemById={byId} onRerun={rerun} onOpen={onOpen} />
      </div>

      <PromptComposer t={t} compact={compact} {...composer} />

      {/* 图库：平时收着，点开才翻；收藏、公开、删除这些管理动作只在这里 */}
      <Drawer open={galleryOpen} onClose={() => setGalleryOpen(false)}
        placement={compact ? 'bottom' : 'right'}
        width={compact ? undefined : 'min(900px, 92vw)'} height={compact ? '88dvh' : undefined}
        title={t('video.studio.gallery')} rootClassName="studio-gallery-drawer" destroyOnClose={false}>
        <GallerySection {...galleryProps} className="studio-gallery" />
      </Drawer>
    </div>
  );
}
