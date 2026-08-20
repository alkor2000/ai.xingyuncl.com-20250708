/**
 * 图片卡片组件
 *
 * ===== v1.2 国际化改造要点 =====
 *
 * 1. 修正两个错误的 i18n 键路径（本次发现的真实缺陷）：
 *      原写法                实际存在的键
 *      image.setPublic   ->  image.action.setPublic
 *      image.setPrivate  ->  image.action.setPrivate
 *    原键在中英两侧都不存在，i18next 找不到键时返回第二参数（中文兜底），
 *    所以中文界面看起来正常，切英文后这两个 Tooltip 仍是中文。
 *
 * 2. 移除全部 25 处 t() 的中文兜底第二参数。
 *    兜底参数会让"键不存在"这类缺陷在中文环境下完全隐形，
 *    因此规约要求 t() 一律不传兜底，键必须真实存在于语言包。
 *
 * 3. 时间格式化补上 locale：
 *    原 new Date(...).toLocaleString() 未传参数，会用浏览器默认区域设置，
 *    英文环境下仍可能输出中文格式的日期。现改为传入 i18n.language。
 *
 * 4. 不翻译的内容（遵循翻译边界原则）：
 *    - item.model_name / item.prompt / item.username：用户或后台的业务数据
 *    - item.size / item.generation_mode / item.action_type：技术参数与枚举值
 *
 * ===== v1.2 附带的死代码清理 =====
 *
 * 移除 const isCompleted = isTaskCompleted(item)：该变量声明后从未被使用，
 * 连带移除已无用的 isTaskCompleted 导入（卡片的三种展示态由
 * isProcessing / isFailed / hasImage 决定，不需要"已完成"这个中间量）。
 *
 * ===== 原有功能说明（逻辑未变更）=====
 * 修复长提示词导致复制按钮消失的问题：提示词与操作按钮拆为上下两层，
 * 超过 100 字符时出现展开/收起按钮，复制按钮始终可见。
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
  isTaskFailed,
  isTaskProcessing,
  downloadImage,
  copyToClipboard
} from '../../utils/imageHelpers';

/* 提示词超过该字符数时显示展开/收起按钮 */
const LONG_PROMPT_THRESHOLD = 100;

/**
 * 图片加载失败时的占位图（Antd Image 的 fallback）
 * 提取为模块级常量，避免这段超长 base64 混在 JSX 里影响可读性。
 * 纯二进制资源，与语言无关。
 */
const IMAGE_FALLBACK_BASE64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMIAAADDCAYAAADQvc6UAAABRWlDQ1BJQ0MgUHJvZmlsZQAAKJFjYGASSSwoyGFhYGDIzSspCnJ3UoiIjFJgf8LAwSDCIMogwMCcmFxc4BgQ4ANUwgCjUcG3awyMIPqyLsis7PPOq3QdDFcvjV3jOD1boQVTPQrgSkktTgbSf4A4LbmgqISBgTEFyFYuLykAsTuAbJEioKOA7DkgdjqEvQHEToKwj4DVhAQ5A9k3gGyB5IxEoBmML4BsnSQk8XQkNtReEOBxcfXxUQg1Mjc0dyHgXNJBSWpFCYh2zi+oLMpMzyhRcASGUqqCZ16yno6CkYGRAQMDKMwhqj/fAIcloxgHQqxAjIHBEugw5sUIsSQpBobtQPdLciLEVJYzMPBHMDBsayhILEqEO4DxG0txmrERhM29nYGBddr//5/DGRjYNRkY/l7////39v///y4Dmn+LgeHANwDrkl1AuO+pmgAAADhlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAAqACAAQAAAABAAAAwqADAAQAAAABAAAAwwAAAAD9b/HnAAAHlklEQVR4Ae3dP3PTWBSGcbGzM6GCKqlIBRV0dHRJFarQ0eUT8LH4BnRU0NHR0UEFVdIlFRV7TzRksomPY8uykTk/zewQfKw/9znv4yvJynLv4uLiV2dBoDiBf4qP3/ARuCRABEFAoBEgghggQAQZQKAnYEaQBAQaASKIAQJEkAEEegJmBElAoBEgghggQAQZQKAnYEaQBAQaASKIAQJEkAEEegJmBElAoBEgghggQAQZQKAnYEaQBAQaASKIAQJEkAEEegJmBElAoBEgghggQAQZQKAnYEaQBAQaASKIAQJEkAEEegJmBElAoBEgghggQAQZQKAnYEaQBAQaASKIAQJEkAEEegJmBElAoBEgghggQAQZQKAnYEaQBAQaASKIAQJEkAEEegJmBElAoBEgghggQAQZQKAnYEaQBAQaASKIAQJEkAEEegJmBElAoBEgghgg0Aj8i0JO4OzsrPv69Wv+hi2qPHr0qNvf39+iI7duPc8RooHBgCEBCAKgC21DfDTSgBBgmAM8qIKk0HO0eXWr0h7bBJWwAgxhQZkKiwDVkQ5AD3aSqQSBQJgHNDV4AAQyj1ibKbHbCYB2bVnngJhCzwhQNUvosJCDAcDG5yV2VJP0ujsZvHzheD0IO4M7qP5akRW/2aSYF6Ek5CXhJbEsJ5d6CRABBQQZKUgz4sL4K1K9nMXG2ESJgLvBoRvzHC9VeywCAAAABJRU5ErkJggg==';

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
  /* i18n 实例用于取当前语言，供时间格式化使用 */
  const { t, i18n } = useTranslation();
  /* 长提示词的展开/收起状态 */
  const [isExpanded, setIsExpanded] = useState(false);

  const isMj = item.provider === 'midjourney';
  const isFailed = isTaskFailed(item);
  const isProcessing = isTaskProcessing(item, processingTasks);
  const hasImage = getImageUrl(item);

  /* 提示词是否过长，决定是否显示展开按钮 */
  const isLongPrompt = item.prompt && item.prompt.length > LONG_PROMPT_THRESHOLD;

  /* 复制提示词（stopPropagation 防止冒泡触发卡片点击） */
  const handleCopyPrompt = useCallback((e) => {
    e.stopPropagation();
    copyToClipboard(item.prompt);
  }, [item.prompt]);

  /* 下载图片，文件名用 ID 保证唯一，不含中文 */
  const handleDownload = useCallback((e) => {
    e.stopPropagation();
    downloadImage(getImageUrl(item), `ai_${item.id}.jpg`);
  }, [item]);

  /* 切换展开/收起 */
  const toggleExpanded = useCallback((e) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  }, [isExpanded]);

  /**
   * 创建时间格式化
   * 必须传 i18n.language，否则英文环境仍按浏览器默认（常为中文）格式输出
   */
  const formattedCreatedAt = item.created_at
    ? new Date(item.created_at).toLocaleString(i18n.language)
    : '';

  return (
    <Card
      className={`history-card ${isMj ? 'midjourney-card' : ''} ${isFailed ? 'failed-card' : ''}`}
      cover={
        <div className="image-wrapper">
          {isProcessing ? (
            /* ===== 生成中 ===== */
            <div className="processing-overlay">
              <Spin size="large" />
              <div className="processing-text">
                {t('image.generating')}
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
            /* ===== 生成失败 ===== */
            <div className="failed-overlay">
              <CloseCircleOutlined style={{ fontSize: 48, color: '#ff4d4f' }} />
              <div className="failed-text">{t('image.generateFailed')}</div>
              {/* 上游 API 返回的错误原文，属技术信息不翻译 */}
              {item.error_message && (
                <div className="error-message">{item.error_message}</div>
              )}
              <div className="failed-actions">
                <Popconfirm
                  title={t('image.confirmDeleteFailed')}
                  onConfirm={() => onDelete(item.id)}
                  okText={t('common.confirm')}
                  cancelText={t('common.cancel')}
                >
                  <Button
                    danger
                    icon={<DeleteOutlined />}
                    size="small"
                  >
                    {t('common.delete')}
                  </Button>
                </Popconfirm>
              </div>
            </div>
          ) : hasImage ? (
            /* ===== 正常展示图片 + 悬浮操作条 ===== */
            <>
              <Image
                src={hasImage}
                /* alt 用提示词，属业务数据不翻译 */
                alt={item.prompt}
                placeholder={<Spin />}
                preview={false}
                fallback={IMAGE_FALLBACK_BASE64}
              />
              <div className="image-overlay">
                <Space>
                  <Tooltip title={t('image.viewLarge')}>
                    <Button
                      type="text"
                      icon={<EyeOutlined />}
                      onClick={(e) => {
                        e.stopPropagation();
                        onView(item);
                      }}
                    />
                  </Tooltip>
                  <Tooltip title={t('common.download')}>
                    <Button
                      type="text"
                      icon={<DownloadOutlined />}
                      onClick={handleDownload}
                    />
                  </Tooltip>
                  {isOwner && (
                    <>
                      <Tooltip
                        title={item.is_favorite
                          ? t('image.unfavorite')
                          : t('image.favorite')}
                      >
                        <Button
                          type="text"
                          icon={item.is_favorite
                            ? <HeartFilled style={{ color: '#ff4d4f' }} />
                            : <HeartOutlined />}
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleFavorite(item);
                          }}
                          className={item.is_favorite ? 'favorited' : ''}
                        />
                      </Tooltip>
                      {/* 键路径已修正为 image.action.*（原写 image.setPrivate/setPublic 不存在） */}
                      <Tooltip
                        title={item.is_public
                          ? t('image.action.setPrivate')
                          : t('image.action.setPublic')}
                      >
                        <Button
                          type="text"
                          icon={item.is_public
                            ? <GlobalOutlined style={{ color: '#52c41a' }} />
                            : <LockOutlined />}
                          onClick={(e) => {
                            e.stopPropagation();
                            onTogglePublic(item);
                          }}
                        />
                      </Tooltip>
                      <Popconfirm
                        title={t('image.confirmDelete')}
                        onConfirm={() => onDelete(item.id)}
                        okText={t('common.confirm')}
                        cancelText={t('common.cancel')}
                      >
                        <Tooltip title={t('common.delete')}>
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
            /* ===== 无图片地址（通常是异步任务已提交但图片未回传） ===== */
            <div className="processing-overlay">
              <Spin size="large" />
              <div className="processing-text">
                {t('common.loading')}
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
                {/* 模型名为后台录入的业务数据，不翻译 */}
                {item.model_name}
              </span>
            ) : (
              <span className="model-tag" style={{ background: '#f0f0f0', color: '#999' }}>
                <WarningOutlined /> {t('image.modelDeleted')}
              </span>
            )}
            {/* 尺寸为技术参数（如 1024x1024），不翻译 */}
            <span className="size-tag">{item.size}</span>
            {isMj && item.generation_mode && (
              <Tag color="blue">{item.generation_mode}</Tag>
            )}
            {/* action_type 为 Midjourney 枚举值（UPSCALE/VARIATION 等），不翻译 */}
            {item.action_type && item.action_type !== 'IMAGINE' && (
              <Tag color="orange">{item.action_type}</Tag>
            )}
            {isFailed && (
              <Tag color="error">{t('status.failed')}</Tag>
            )}
          </div>
        }
        description={
          <div className="card-meta-description">
            {/* 提示词区：文本与操作按钮分层，保证长提示词下复制按钮仍可见 */}
            <div className="prompt-container">
              <div className={`prompt-text ${isExpanded ? 'expanded' : 'collapsed'}`}>
                {/* 提示词为用户输入的业务数据，不翻译 */}
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
                    {isExpanded ? t('common.collapse') : t('common.expand')}
                  </Button>
                )}
                <Button
                  type="link"
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={handleCopyPrompt}
                  style={{ padding: '0 4px' }}
                >
                  {t('common.copy')}
                </Button>
              </div>
            </div>

            {/* Midjourney 的 U/V/Reroll 操作条，由父组件注入 */}
            {isOwner && isMj && !isProcessing && !isFailed && hasImage
              && renderActions && renderActions(item)}

            <div className="meta-info">
              {isGallery && item.username && (
                <span style={{ marginRight: 8 }}>
                  {/* 用户名为业务数据，不翻译 */}
                  <UserOutlined /> {item.username}
                </span>
              )}
              <span>{formattedCreatedAt}</span>
              {item.credits_consumed !== undefined && (
                <span>{t('image.creditsConsumed', { credits: item.credits_consumed })}</span>
              )}
              {item.is_public && <Tag color="green">{t('status.public')}</Tag>}
              {item.is_favorite && isOwner && <Tag color="red">{t('status.favorited')}</Tag>}
              {isGallery && item.view_count !== undefined && (
                /* 浏览数为纯数值 */
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
