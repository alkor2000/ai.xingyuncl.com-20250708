/**
 * 通用图片查看器组件
 * 支持：缩放、拖动、多图切换、下载、键盘快捷键
 *
 * ===== v1.1 国际化改造要点 =====
 *
 * 1. 本组件此前完全未接入 i18n，9 处界面文案为硬编码中文。
 *    现全部走 t()，其中带快捷键的 Tooltip（如"放大 (+)"）把快捷键符号
 *    一并放进译文，而不是用 JSX 拼接：
 *    因为中英文标点与空格习惯不同，分段拼接会产生多余空格或标点错位。
 *
 * 2. 不翻译的内容（遵循翻译边界原则）：
 *    - title / currentImage.title：调用方传入的业务数据（图片提示词等）
 *    - 缩放百分比、图片尺寸、"1 / 5"计数：纯数值与符号
 *    - 缩略图 alt=""：装饰性图片留空 alt 是无障碍规范的正确做法
 *
 * ===== v1.1 附带的死代码清理 =====
 *
 * 移除原 handleWheel（useCallback 定义后从未被引用）：
 * 滚轮监听实际由下方 useEffect 内的 wheelHandler 承担
 * （因为需要 passive:false 才能调 preventDefault，React 的 onWheel 无法做到）。
 * 保留两份逻辑容易让后续维护者改错地方，故删除未使用的那份。
 *
 * ===== 已知遗留（本次不动，避免样式风险）=====
 *
 * Modal 的 bodyStyle 在 Antd v5 已标记废弃（建议改 styles.body），
 * 但它承载了全屏黑底等关键样式，改动需先确认项目 antd 小版本对
 * styles API 的支持情况，故本次仅标注不修改。
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Modal, Button, Space, Tooltip, message } from 'antd';
import {
  CloseOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
  DownloadOutlined,
  LeftOutlined,
  RightOutlined,
  ReloadOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import './ImageViewer.less';

/* 缩放步进倍率与上下限（抽为常量，避免多处出现同一魔法数字） */
const ZOOM_STEP = 1.2;
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 5;
/* 适应屏幕时预留的边距比例：横向留 10%，纵向留 15%（给工具栏和缩略图条） */
const FIT_WIDTH_RATIO = 0.9;
const FIT_HEIGHT_RATIO = 0.85;

const ImageViewer = ({
  visible,
  images = [],
  initialIndex = 0,
  onClose,
  title = '',
  showDownload = true,
  showThumbnails = true
}) => {
  const { t } = useTranslation();

  /* ============ 状态管理 ============ */
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [loading, setLoading] = useState(true);
  /* 'fit' 适应屏幕 | 'original' 原始大小，双击可在两者间切换 */
  const [fitMode, setFitMode] = useState('fit');

  /* ============ Refs ============ */
  const imageRef = useRef(null);
  const containerRef = useRef(null);
  const contentRef = useRef(null);
  /* 拖动位移用 ref 同步保存，避免闭包读到过期 state */
  const moveRef = useRef({ x: 0, y: 0 });

  /* 兼容调用方传单张图片（非数组）的情况 */
  const imageList = Array.isArray(images) ? images : [images];
  const currentImage = imageList[currentIndex] || {};
  const imageUrl = typeof currentImage === 'string'
    ? currentImage
    : (currentImage.url || currentImage.local_path || currentImage.image_url);

  /* 重置缩放与位移 */
  const resetState = useCallback(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
    setFitMode('fit');
    moveRef.current = { x: 0, y: 0 };
  }, []);

  /* 打开时重置到调用方指定的起始图片 */
  useEffect(() => {
    if (visible) {
      setCurrentIndex(initialIndex);
      resetState();
      setLoading(true);
    }
  }, [visible, initialIndex, resetState]);

  /* 切换图片时重置缩放状态 */
  useEffect(() => {
    resetState();
    setLoading(true);
  }, [currentIndex, resetState]);

  /* 计算"适应屏幕"所需的缩放比例 */
  const calculateFitScale = useCallback(() => {
    if (!imageRef.current || !containerRef.current) return 1;

    const container = containerRef.current.getBoundingClientRect();
    const img = imageRef.current;

    const maxWidth = container.width * FIT_WIDTH_RATIO;
    const maxHeight = container.height * FIT_HEIGHT_RATIO;

    const imgWidth = img.naturalWidth || img.width;
    const imgHeight = img.naturalHeight || img.height;
    if (!imgWidth || !imgHeight) return 1;

    const scaleX = maxWidth / imgWidth;
    const scaleY = maxHeight / imgHeight;

    /* 与 1 取最小值：小图不放大，保持原始清晰度 */
    return Math.min(scaleX, scaleY, 1);
  }, []);

  /* 图片加载完成：按当前模式套用缩放并记录原始尺寸 */
  const handleImageLoad = useCallback(() => {
    setLoading(false);
    if (fitMode === 'fit') {
      setScale(calculateFitScale());
    }
    if (imageRef.current) {
      setImageSize({
        width: imageRef.current.naturalWidth,
        height: imageRef.current.naturalHeight
      });
    }
  }, [fitMode, calculateFitScale]);

  /* 缩放控制：delta > 0 放大，否则缩小 */
  const handleZoom = useCallback((delta) => {
    setScale(prevScale => {
      const newScale = delta > 0 ? prevScale * ZOOM_STEP : prevScale / ZOOM_STEP;
      return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newScale));
    });
  }, []);

  /**
   * 滚轮缩放监听
   * 必须用原生 addEventListener 且 passive:false，
   * React 的 onWheel 默认是 passive 事件，调 preventDefault 会被浏览器忽略并告警。
   */
  useEffect(() => {
    const contentElement = contentRef.current;
    if (!contentElement || !visible) return;

    const wheelHandler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY > 0 ? -1 : 1;
      handleZoom(delta);
    };

    contentElement.addEventListener('wheel', wheelHandler, { passive: false });
    return () => {
      contentElement.removeEventListener('wheel', wheelHandler);
    };
  }, [visible, handleZoom]);

  /* 适应屏幕 */
  const handleFitScreen = useCallback(() => {
    setScale(calculateFitScale());
    setPosition({ x: 0, y: 0 });
    moveRef.current = { x: 0, y: 0 };
    setFitMode('fit');
  }, [calculateFitScale]);

  /* 原始大小（100%） */
  const handleOriginalSize = useCallback(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
    moveRef.current = { x: 0, y: 0 };
    setFitMode('original');
  }, []);

  /* 拖动开始：只响应鼠标左键 */
  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setIsDragging(true);
    setDragStart({
      x: e.clientX - moveRef.current.x,
      y: e.clientY - moveRef.current.y
    });
  }, []);

  /* 拖动中 */
  const handleMouseMove = useCallback((e) => {
    if (!isDragging) return;
    e.preventDefault();

    const newX = e.clientX - dragStart.x;
    const newY = e.clientY - dragStart.y;

    moveRef.current = { x: newX, y: newY };
    setPosition({ x: newX, y: newY });
  }, [isDragging, dragStart]);

  /* 拖动结束 */
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  /* 拖动期间把监听挂到 document，防止鼠标移出图片区域后丢失 mouseup */
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  /* 上一张 / 下一张 */
  const handlePrev = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  }, [currentIndex]);

  const handleNext = useCallback(() => {
    if (currentIndex < imageList.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  }, [currentIndex, imageList.length]);

  /**
   * 键盘快捷键
   * 与工具栏 Tooltip 中标注的按键保持一致：
   * ESC 关闭 / ← → 切换 / +- 缩放 / 0 适应屏幕 / 1 原始大小
   */
  useEffect(() => {
    if (!visible) return;

    const handleKeyDown = (e) => {
      switch (e.key) {
        case 'Escape':
          onClose();
          break;
        case 'ArrowLeft':
          handlePrev();
          break;
        case 'ArrowRight':
          handleNext();
          break;
        case '+':
        case '=':
          handleZoom(1);
          break;
        case '-':
        case '_':
          handleZoom(-1);
          break;
        case '0':
          handleFitScreen();
          break;
        case '1':
          handleOriginalSize();
          break;
        default:
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [visible, onClose, handlePrev, handleNext, handleZoom, handleFitScreen, handleOriginalSize]);

  /**
   * 下载当前图片
   * 文件名优先取业务数据（title/prompt），兜底用序号，均不参与翻译
   */
  const handleDownload = useCallback(() => {
    if (!imageUrl) return;

    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = currentImage.title || currentImage.prompt || `image_${currentIndex + 1}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    message.success(t('image.viewer.downloadStarted'));
  }, [imageUrl, currentImage, currentIndex, t]);

  /* 双击在"适应屏幕"与"原始大小"间切换 */
  const handleDoubleClick = useCallback(() => {
    if (fitMode === 'fit') {
      handleOriginalSize();
    } else {
      handleFitScreen();
    }
  }, [fitMode, handleOriginalSize, handleFitScreen]);

  return (
    <Modal
      open={visible}
      onCancel={onClose}
      footer={null}
      width="100%"
      style={{ maxWidth: '100vw', top: 0, padding: 0 }}
      /* 注意：bodyStyle 在 Antd v5 已废弃，但承载全屏黑底关键样式，暂不替换 */
      bodyStyle={{ padding: 0, height: '100vh', overflow: 'hidden', background: '#000' }}
      className="image-viewer-modal"
      closable={false}
      maskClosable={true}
      destroyOnClose={true}
    >
      <div className="image-viewer-container" ref={containerRef}>
        {/* ============ 顶部工具栏 ============ */}
        <div className="image-viewer-toolbar">
          <div className="toolbar-left">
            <Space>
              {imageList.length > 1 && (
                /* 计数为纯数值与斜杠，无需 i18n */
                <span className="image-counter">
                  {currentIndex + 1} / {imageList.length}
                </span>
              )}
              {/* title 由调用方传入的业务数据，原样展示 */}
              {title && <span className="image-title">{title}</span>}
            </Space>
          </div>

          <div className="toolbar-center">
            <Space>
              <Tooltip title={t('image.viewer.zoomIn')}>
                <Button
                  type="text"
                  icon={<ZoomInOutlined />}
                  onClick={() => handleZoom(1)}
                  className="toolbar-btn"
                />
              </Tooltip>

              {/* 缩放百分比为纯数值 */}
              <span className="zoom-info">{Math.round(scale * 100)}%</span>

              <Tooltip title={t('image.viewer.zoomOut')}>
                <Button
                  type="text"
                  icon={<ZoomOutOutlined />}
                  onClick={() => handleZoom(-1)}
                  className="toolbar-btn"
                />
              </Tooltip>

              <Tooltip title={t('image.viewer.fitScreen')}>
                <Button
                  type="text"
                  icon={<FullscreenExitOutlined />}
                  onClick={handleFitScreen}
                  className="toolbar-btn"
                />
              </Tooltip>

              <Tooltip title={t('image.viewer.originalSize')}>
                <Button
                  type="text"
                  icon={<FullscreenOutlined />}
                  onClick={handleOriginalSize}
                  className="toolbar-btn"
                />
              </Tooltip>

              <Tooltip title={t('image.viewer.reset')}>
                <Button
                  type="text"
                  icon={<ReloadOutlined />}
                  onClick={handleFitScreen}
                  className="toolbar-btn"
                />
              </Tooltip>

              {showDownload && (
                /* 下载按钮复用全局通用键，不新建 image.viewer.download */
                <Tooltip title={t('common.download')}>
                  <Button
                    type="text"
                    icon={<DownloadOutlined />}
                    onClick={handleDownload}
                    className="toolbar-btn"
                  />
                </Tooltip>
              )}
            </Space>
          </div>

          <div className="toolbar-right">
            <Tooltip title={t('image.viewer.close')}>
              <Button
                type="text"
                icon={<CloseOutlined />}
                onClick={onClose}
                className="toolbar-btn"
              />
            </Tooltip>
          </div>
        </div>

        {/* ============ 图片显示区 ============ */}
        <div
          ref={contentRef}
          className={`image-viewer-content ${isDragging ? 'dragging' : ''}`}
          onMouseDown={handleMouseDown}
          onDoubleClick={handleDoubleClick}
        >
          {/* 左右切换按钮（多图时才显示） */}
          {imageList.length > 1 && (
            <>
              <Button
                className="nav-btn nav-prev"
                type="text"
                icon={<LeftOutlined />}
                onClick={handlePrev}
                disabled={currentIndex === 0}
              />
              <Button
                className="nav-btn nav-next"
                type="text"
                icon={<RightOutlined />}
                onClick={handleNext}
                disabled={currentIndex === imageList.length - 1}
              />
            </>
          )}

          {imageUrl && (
            <img
              ref={imageRef}
              src={imageUrl}
              /* alt 取业务数据，无则留空（装饰性图片留空 alt 符合无障碍规范） */
              alt={currentImage.title || ''}
              className="viewer-image"
              style={{
                transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
                opacity: loading ? 0 : 1,
                cursor: isDragging ? 'grabbing' : 'grab'
              }}
              onLoad={handleImageLoad}
              onError={() => {
                setLoading(false);
                /* 复用 image.error.loadFailed，与图片卡片的失败提示保持一致 */
                message.error(t('image.error.loadFailed'));
              }}
              draggable={false}
            />
          )}

          {loading && (
            <div className="loading-spinner">
              <div className="spinner"></div>
            </div>
          )}
        </div>

        {/* ============ 底部缩略图条 ============ */}
        {showThumbnails && imageList.length > 1 && (
          <div className="image-viewer-thumbnails">
            {imageList.map((img, index) => {
              const thumbUrl = typeof img === 'string'
                ? img
                : (img.thumbnail_path || img.url || img.local_path || img.image_url);
              return (
                <div
                  key={index}
                  className={`thumbnail-item ${index === currentIndex ? 'active' : ''}`}
                  onClick={() => setCurrentIndex(index)}
                >
                  {/* 缩略图为纯装饰，alt 留空避免读屏软件重复朗读 */}
                  <img src={thumbUrl} alt="" />
                </div>
              );
            })}
          </div>
        )}

        {/* ============ 图片原始尺寸信息（纯数值，无需 i18n） ============ */}
        {imageSize.width > 0 && (
          <div className="image-info">
            {imageSize.width} × {imageSize.height}
          </div>
        )}
      </div>
    </Modal>
  );
};

export default ImageViewer;
