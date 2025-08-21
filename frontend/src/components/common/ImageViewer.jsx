/**
 * 通用图片查看器组件
 * 支持：缩放、拖动、多图切换、下载等功能
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
import './ImageViewer.less';

const ImageViewer = ({ 
  visible, 
  images = [], 
  initialIndex = 0, 
  onClose,
  title = '',
  showDownload = true,
  showThumbnails = true
}) => {
  // 状态管理
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [loading, setLoading] = useState(true);
  const [fitMode, setFitMode] = useState('fit'); // 'fit' | 'original'
  
  // Refs
  const imageRef = useRef(null);
  const containerRef = useRef(null);
  const contentRef = useRef(null);
  const moveRef = useRef({ x: 0, y: 0 });
  
  // 确保 images 是数组
  const imageList = Array.isArray(images) ? images : [images];
  const currentImage = imageList[currentIndex] || {};
  const imageUrl = typeof currentImage === 'string' ? currentImage : (currentImage.url || currentImage.local_path || currentImage.image_url);
  
  // 重置状态
  const resetState = useCallback(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
    setFitMode('fit');
    moveRef.current = { x: 0, y: 0 };
  }, []);
  
  // 当切换图片或打开/关闭时重置
  useEffect(() => {
    if (visible) {
      setCurrentIndex(initialIndex);
      resetState();
      setLoading(true);
    }
  }, [visible, initialIndex, resetState]);
  
  // 切换图片时重置
  useEffect(() => {
    resetState();
    setLoading(true);
  }, [currentIndex, resetState]);
  
  // 计算适应屏幕的缩放比例
  const calculateFitScale = useCallback(() => {
    if (!imageRef.current || !containerRef.current) return 1;
    
    const container = containerRef.current.getBoundingClientRect();
    const img = imageRef.current;
    
    // 留出边距
    const maxWidth = container.width * 0.9;
    const maxHeight = container.height * 0.85; // 留出工具栏和缩略图空间
    
    const imgWidth = img.naturalWidth || img.width;
    const imgHeight = img.naturalHeight || img.height;
    
    if (!imgWidth || !imgHeight) return 1;
    
    const scaleX = maxWidth / imgWidth;
    const scaleY = maxHeight / imgHeight;
    
    return Math.min(scaleX, scaleY, 1); // 不超过原始大小
  }, []);
  
  // 图片加载完成
  const handleImageLoad = useCallback(() => {
    setLoading(false);
    if (fitMode === 'fit') {
      const fitScale = calculateFitScale();
      setScale(fitScale);
    }
    
    if (imageRef.current) {
      setImageSize({
        width: imageRef.current.naturalWidth,
        height: imageRef.current.naturalHeight
      });
    }
  }, [fitMode, calculateFitScale]);
  
  // 缩放控制
  const handleZoom = useCallback((delta) => {
    setScale(prevScale => {
      const newScale = delta > 0 ? prevScale * 1.2 : prevScale / 1.2;
      return Math.max(0.1, Math.min(5, newScale));
    });
  }, []);
  
  // 滚轮缩放 - 修复：正确处理passive事件
  const handleWheel = useCallback((e) => {
    // 不再调用 preventDefault，让它自然处理
    // 通过缩放来实现放大缩小效果
    const delta = e.deltaY > 0 ? -1 : 1;
    handleZoom(delta);
  }, [handleZoom]);
  
  // 添加滚轮事件监听器 - 使用 passive: false
  useEffect(() => {
    const contentElement = contentRef.current;
    if (!contentElement || !visible) return;
    
    const wheelHandler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY > 0 ? -1 : 1;
      handleZoom(delta);
    };
    
    // 使用 passive: false 来允许 preventDefault
    contentElement.addEventListener('wheel', wheelHandler, { passive: false });
    
    return () => {
      contentElement.removeEventListener('wheel', wheelHandler);
    };
  }, [visible, handleZoom]);
  
  // 适应屏幕
  const handleFitScreen = useCallback(() => {
    const fitScale = calculateFitScale();
    setScale(fitScale);
    setPosition({ x: 0, y: 0 });
    moveRef.current = { x: 0, y: 0 };
    setFitMode('fit');
  }, [calculateFitScale]);
  
  // 原始大小
  const handleOriginalSize = useCallback(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
    moveRef.current = { x: 0, y: 0 };
    setFitMode('original');
  }, []);
  
  // 拖动开始
  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return; // 只响应左键
    e.preventDefault();
    setIsDragging(true);
    setDragStart({
      x: e.clientX - moveRef.current.x,
      y: e.clientY - moveRef.current.y
    });
  }, []);
  
  // 拖动中
  const handleMouseMove = useCallback((e) => {
    if (!isDragging) return;
    e.preventDefault();
    
    const newX = e.clientX - dragStart.x;
    const newY = e.clientY - dragStart.y;
    
    moveRef.current = { x: newX, y: newY };
    setPosition({ x: newX, y: newY });
  }, [isDragging, dragStart]);
  
  // 拖动结束
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);
  
  // 添加全局鼠标事件监听
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
  
  // 切换图片
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
  
  // 键盘控制
  useEffect(() => {
    if (!visible) return;
    
    const handleKeyDown = (e) => {
      switch(e.key) {
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
  
  // 下载图片
  const handleDownload = useCallback(() => {
    if (!imageUrl) return;
    
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = currentImage.title || currentImage.prompt || `image_${currentIndex + 1}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    message.success('开始下载');
  }, [imageUrl, currentImage, currentIndex]);
  
  // 双击切换适应/原始
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
      bodyStyle={{ padding: 0, height: '100vh', overflow: 'hidden', background: '#000' }}
      className="image-viewer-modal"
      closable={false}
      maskClosable={true}
      destroyOnClose={true}
    >
      <div className="image-viewer-container" ref={containerRef}>
        {/* 工具栏 */}
        <div className="image-viewer-toolbar">
          <div className="toolbar-left">
            <Space>
              {imageList.length > 1 && (
                <span className="image-counter">
                  {currentIndex + 1} / {imageList.length}
                </span>
              )}
              {title && <span className="image-title">{title}</span>}
            </Space>
          </div>
          
          <div className="toolbar-center">
            <Space>
              <Tooltip title="放大 (+)">
                <Button
                  type="text"
                  icon={<ZoomInOutlined />}
                  onClick={() => handleZoom(1)}
                  className="toolbar-btn"
                />
              </Tooltip>
              
              <span className="zoom-info">{Math.round(scale * 100)}%</span>
              
              <Tooltip title="缩小 (-)">
                <Button
                  type="text"
                  icon={<ZoomOutOutlined />}
                  onClick={() => handleZoom(-1)}
                  className="toolbar-btn"
                />
              </Tooltip>
              
              <Tooltip title="适应屏幕 (0)">
                <Button
                  type="text"
                  icon={<FullscreenExitOutlined />}
                  onClick={handleFitScreen}
                  className="toolbar-btn"
                />
              </Tooltip>
              
              <Tooltip title="原始大小 (1)">
                <Button
                  type="text"
                  icon={<FullscreenOutlined />}
                  onClick={handleOriginalSize}
                  className="toolbar-btn"
                />
              </Tooltip>
              
              <Tooltip title="重置">
                <Button
                  type="text"
                  icon={<ReloadOutlined />}
                  onClick={() => {
                    handleFitScreen();
                  }}
                  className="toolbar-btn"
                />
              </Tooltip>
              
              {showDownload && (
                <Tooltip title="下载">
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
            <Tooltip title="关闭 (ESC)">
              <Button
                type="text"
                icon={<CloseOutlined />}
                onClick={onClose}
                className="toolbar-btn"
              />
            </Tooltip>
          </div>
        </div>
        
        {/* 图片显示区域 */}
        <div 
          ref={contentRef}
          className={`image-viewer-content ${isDragging ? 'dragging' : ''}`}
          onMouseDown={handleMouseDown}
          onDoubleClick={handleDoubleClick}
        >
          {/* 左右切换按钮 */}
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
          
          {/* 图片 */}
          {imageUrl && (
            <img
              ref={imageRef}
              src={imageUrl}
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
                message.error('图片加载失败');
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
        
        {/* 缩略图 */}
        {showThumbnails && imageList.length > 1 && (
          <div className="image-viewer-thumbnails">
            {imageList.map((img, index) => {
              const thumbUrl = typeof img === 'string' ? img : (img.thumbnail_path || img.url || img.local_path || img.image_url);
              return (
                <div
                  key={index}
                  className={`thumbnail-item ${index === currentIndex ? 'active' : ''}`}
                  onClick={() => setCurrentIndex(index)}
                >
                  <img src={thumbUrl} alt="" />
                </div>
              );
            })}
          </div>
        )}
        
        {/* 图片信息 */}
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
