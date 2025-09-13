/**
 * 图片卡片组件
 * 修复：长提示词导致复制按钮消失的问题
 */

import React, { memo, useCallback, useState } from 'react';
import { Card, Button, Space, Tooltip, Tag, Image, Spin, Progress, Popconfirm } from 'antd';
import {
  EyeOutlined,
  DownloadOutlined,
  HeartOutlined,
  HeartFilled,
  GlobalOutlined,
  LockOutlined,
  DeleteOutlined,
  CopyOutlined,
  UserOutlined,
  WarningOutlined,
  ThunderboltOutlined,
  CloseCircleOutlined,
  DownOutlined,
  UpOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { 
  getImageUrl, 
  isTaskCompleted, 
  isTaskFailed, 
  isTaskProcessing,
  downloadImage,
  copyToClipboard
} from '../../utils/imageHelpers';

const ImageCard = memo(({ 
  item, 
  isGallery = false,
  isOwner = true,
  processingTasks = {},
  generationProgress = null,
  onView,
  onToggleFavorite,
  onTogglePublic,
  onDelete,
  renderActions
}) => {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false); // 添加展开状态
  
  const isMj = item.provider === 'midjourney';
  const isCompleted = isTaskCompleted(item);
  const isFailed = isTaskFailed(item);
  const isProcessing = isTaskProcessing(item, processingTasks);
  const hasImage = getImageUrl(item);

  // 判断提示词是否过长（超过100个字符显示展开按钮）
  const isLongPrompt = item.prompt && item.prompt.length > 100;

  // 处理复制提示词
  const handleCopyPrompt = useCallback((e) => {
    e.stopPropagation();
    copyToClipboard(item.prompt);
  }, [item.prompt]);

  // 处理下载
  const handleDownload = useCallback((e) => {
    e.stopPropagation();
    downloadImage(getImageUrl(item), `ai_${item.id}.jpg`);
  }, [item]);

  // 切换展开/收起
  const toggleExpanded = useCallback((e) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  }, [isExpanded]);

  return (
    <Card
      className={`history-card ${isMj ? 'midjourney-card' : ''} ${isFailed ? 'failed-card' : ''}`}
      cover={
        <div className="image-wrapper">
          {isProcessing ? (
            <div className="processing-overlay">
              <Spin size="large" />
              <div className="processing-text">
                {t('image.generating', '生成中...')}
              </div>
              {generationProgress && (
                <Progress
                  percent={parseInt(generationProgress) || 0}
                  showInfo={false}
                  strokeColor="#1890ff"
                />
              )}
            </div>
          ) : isFailed ? (
            <div className="failed-overlay">
              <CloseCircleOutlined style={{ fontSize: 48, color: '#ff4d4f' }} />
              <div className="failed-text">{t('image.generateFailed', '生成失败')}</div>
              {item.error_message && (
                <div className="error-message">{item.error_message}</div>
              )}
              <div className="failed-actions">
                <Popconfirm
                  title={t('image.confirmDeleteFailed', '确定删除这个失败的任务吗？')}
                  onConfirm={() => onDelete(item.id)}
                  okText={t('common.confirm', '确定')}
                  cancelText={t('common.cancel', '取消')}
                >
                  <Button
                    danger
                    icon={<DeleteOutlined />}
                    size="small"
                  >
                    {t('common.delete', '删除')}
                  </Button>
                </Popconfirm>
              </div>
            </div>
          ) : hasImage ? (
            <>
              <Image
                src={hasImage}
                alt={item.prompt}
                placeholder={<Spin />}
                preview={false}
                fallback="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMIAAADDCAYAAADQvc6UAAABRWlDQ1BJQ0MgUHJvZmlsZQAAKJFjYGASSSwoyGFhYGDIzSspCnJ3UoiIjFJgf8LAwSDCIMogwMCcmFxc4BgQ4ANUwgCjUcG3awyMIPqyLsis7PPOq3QdDFcvjV3jOD1boQVTPQrgSkktTgbSf4A4LbmgqISBgTEFyFYuLykAsTuAbJEioKOA7DkgdjqEvQHEToKwj4DVhAQ5A9k3gGyB5IxEoBmML4BsnSQk8XQkNtReEOBxcfXxUQg1Mjc0dyHgXNJBSWpFCYh2zi+oLMpMzyhRcASGUqqCZ16yno6CkYGRAQMDKMwhqj/fAIcloxgHQqxAjIHBEugw5sUIsSQpBobtQPdLciLEVJYzMPBHMDBsayhILEqEO4DxG0txmrERhM29nYGBddr//5/DGRjYNRkY/l7////39v///y4Dmn+LgeHANwDrkl1AuO+pmgAAADhlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAAqACAAQAAAABAAAAwqADAAQAAAABAAAAwwAAAAD9b/HnAAAHlklEQVR4Ae3dP3PTWBSGcbGzM6GCKqlIBRV0dHRJFarQ0eUT8LH4BnRU0NHR0UEFVdIlFRV7TzRksomPY8uykTk/zewQfKw/9znv4yvJynLv4uLiV2dBoDiBf4qP3/ARuCRABEFAoBEgghggQAQZQKAnYEaQBAQaASKIAQJEkAEEegJmBElAoBEgghggQAQZQKAnYEaQBAQaASKIAQJEkAEEegJmBElAoBEgghggQAQZQKAnYEaQBAQaASKIAQJEkAEEegJmBElAoBEgghggQAQZQKAnYEaQBAQaASKIAQJEkAEEegJmBElAoBEgghggQAQZQKAnYEaQBAQaASKIAQJEkAEEegJmBElAoBEgghggQAQZQKAnYEaQBAQaASKIAQJEkAEEegJmBElAoBEgghggQAQZQKAnYEaQBAQaASKIAQJEkAEEegJmBElAoBEgghgg0Aj8i0JO4OzsrPv69Wv+hi2qPHr0qNvf39+iI7duPc8RooHBgCEBCAKgC21DfDTSgBBgmAM8qIKk0HO0eXWr0h7bBJWwAgxhQZkKiwDVkQ5AD3aSqQSBQJgHNDV4AAQyj1ibKbHbCYB2bVnngJhCzwhQNUvosJCDAcDG5yV2VJP0ujsZvHzheD0IO4M7qP5akRW/2aSYF6Ek5CXhJbEsJ5d6CRABBQQZKUgz4sL4K1K9nMXG2ESJgLvBoRvzHC9VeywCAAAABJRU5ErkJggg=="
              />
              <div className="image-overlay">
                <Space>
                  <Tooltip title={t('image.viewLarge', '查看大图')}>
                    <Button
                      type="text"
                      icon={<EyeOutlined />}
                      onClick={(e) => {
                        e.stopPropagation();
                        onView(item);
                      }}
                    />
                  </Tooltip>
                  <Tooltip title={t('common.download', '下载')}>
                    <Button
                      type="text"
                      icon={<DownloadOutlined />}
                      onClick={handleDownload}
                    />
                  </Tooltip>
                  {isOwner && (
                    <>
                      <Tooltip title={item.is_favorite ? t('image.unfavorite', '取消收藏') : t('image.favorite', '收藏')}>
                        <Button
                          type="text"
                          icon={item.is_favorite ? <HeartFilled style={{ color: '#ff4d4f' }} /> : <HeartOutlined />}
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleFavorite(item);
                          }}
                          className={item.is_favorite ? 'favorited' : ''}
                        />
                      </Tooltip>
                      <Tooltip title={item.is_public ? t('image.setPrivate', '设为私密') : t('image.setPublic', '公开分享')}>
                        <Button
                          type="text"
                          icon={item.is_public ? <GlobalOutlined style={{ color: '#52c41a' }} /> : <LockOutlined />}
                          onClick={(e) => {
                            e.stopPropagation();
                            onTogglePublic(item);
                          }}
                        />
                      </Tooltip>
                      <Popconfirm
                        title={t('image.confirmDelete', '确定删除这张图片吗？')}
                        onConfirm={() => onDelete(item.id)}
                        okText={t('common.confirm', '确定')}
                        cancelText={t('common.cancel', '取消')}
                      >
                        <Tooltip title={t('common.delete', '删除')}>
                          <Button
                            type="text"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </Tooltip>
                      </Popconfirm>
                    </>
                  )}
                </Space>
              </div>
            </>
          ) : (
            <div className="processing-overlay">
              <Spin size="large" />
              <div className="processing-text">
                {t('common.loading', '加载中...')}
              </div>
            </div>
          )}
        </div>
      }
    >
      <Card.Meta
        title={
          <div className="card-meta-title">
            {item.model_name ? (
              <span className={`model-tag ${isMj ? 'midjourney' : ''}`}>
                {isMj && <ThunderboltOutlined />}
                {item.model_name}
              </span>
            ) : (
              <span className="model-tag" style={{ background: '#f0f0f0', color: '#999' }}>
                <WarningOutlined /> {t('image.modelDeleted', '模型已删除')}
              </span>
            )}
            <span className="size-tag">{item.size}</span>
            {isMj && item.generation_mode && (
              <Tag color="blue">{item.generation_mode}</Tag>
            )}
            {item.action_type && item.action_type !== 'IMAGINE' && (
              <Tag color="orange">{item.action_type}</Tag>
            )}
            {isFailed && (
              <Tag color="error">{t('status.failed', '失败')}</Tag>
            )}
          </div>
        }
        description={
          <div className="card-meta-description">
            {/* 修复：重新设计提示词区域布局 */}
            <div className="prompt-container">
              <div className={`prompt-text ${isExpanded ? 'expanded' : 'collapsed'}`}>
                {item.prompt}
              </div>
              <div className="prompt-actions">
                {isLongPrompt && (
                  <Button
                    type="link"
                    size="small"
                    icon={isExpanded ? <UpOutlined /> : <DownOutlined />}
                    onClick={toggleExpanded}
                    style={{ padding: '0 4px' }}
                  >
                    {isExpanded ? t('common.collapse', '收起') : t('common.expand', '展开')}
                  </Button>
                )}
                <Button
                  type="link"
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={handleCopyPrompt}
                  style={{ padding: '0 4px' }}
                >
                  {t('common.copy', '复制')}
                </Button>
              </div>
            </div>
            
            {isOwner && isMj && !isProcessing && !isFailed && hasImage && renderActions && renderActions(item)}
            
            <div className="meta-info">
              {isGallery && item.username && (
                <span style={{ marginRight: 8 }}>
                  <UserOutlined /> {item.username}
                </span>
              )}
              <span>{new Date(item.created_at).toLocaleString()}</span>
              {item.credits_consumed !== undefined && (
                <span>{t('image.creditsConsumed', '{{credits}} 积分', { credits: item.credits_consumed })}</span>
              )}
              {item.is_public && <Tag color="green">{t('status.public', '公开')}</Tag>}
              {item.is_favorite && isOwner && <Tag color="red">{t('status.favorited', '已收藏')}</Tag>}
              {isGallery && item.view_count !== undefined && (
                <span style={{ fontSize: 12, color: '#999' }}>
                  <EyeOutlined /> {item.view_count}
                </span>
              )}
            </div>
          </div>
        }
      />
    </Card>
  );
});

ImageCard.displayName = 'ImageCard';

export default ImageCard;
