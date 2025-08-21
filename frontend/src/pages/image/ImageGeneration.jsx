/**
 * 图像生成页面 - 支持Midjourney
 */

import React, { useEffect, useState } from 'react';
import {
  Layout,
  Card,
  Input,
  Button,
  Space,
  Row,
  Col,
  Slider,
  InputNumber,
  Switch,
  Tabs,
  Empty,
  Spin,
  Image,
  Tooltip,
  Tag,
  message,
  Badge,
  Modal,
  Popconfirm,
  Segmented,
  Collapse,
  Alert,
  Select,
  Progress,
  Radio
} from 'antd';
import {
  PictureOutlined,
  SendOutlined,
  ReloadOutlined,
  HeartOutlined,
  HeartFilled,
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  CopyOutlined,
  GlobalOutlined,
  LockOutlined,
  FireOutlined,
  ThunderboltOutlined,
  AppstoreOutlined,
  UnorderedListOutlined,
  SettingOutlined,
  CaretRightOutlined,
  UserOutlined,
  WarningOutlined,
  RocketOutlined,
  ClockCircleOutlined,
  ZoomInOutlined,
  ExperimentOutlined,
  SyncOutlined,
  CloseCircleOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import useImageStore from '../../stores/imageStore';
import useAuthStore from '../../stores/authStore';
import ImageViewer from '../../components/common/ImageViewer';
import './ImageGeneration.less';

const { Content, Sider } = Layout;
const { TextArea } = Input;
const { TabPane } = Tabs;
const { Panel } = Collapse;
const { Option } = Select;

// 预设尺寸 - 根据模型类型动态调整
const presetSizes = {
  default: [
    { label: '正方形 1:1', value: '1024x1024', ratio: '1:1' },
    { label: '竖屏 3:4', value: '864x1152', ratio: '3:4' },
    { label: '横屏 4:3', value: '1152x864', ratio: '4:3' },
    { label: '宽屏 16:9', value: '1280x720', ratio: '16:9' },
    { label: '竖屏 9:16', value: '720x1280', ratio: '9:16' },
    { label: '竖屏 2:3', value: '832x1248', ratio: '2:3' },
    { label: '横屏 3:2', value: '1248x832', ratio: '3:2' },
    { label: '超宽 21:9', value: '1512x648', ratio: '21:9' }
  ],
  midjourney: [
    { label: '正方形 1:1', value: '1:1', ratio: '1:1' },
    { label: '横屏 4:3', value: '4:3', ratio: '4:3' },
    { label: '竖屏 3:4', value: '3:4', ratio: '3:4' },
    { label: '宽屏 16:9', value: '16:9', ratio: '16:9' },
    { label: '竖屏 9:16', value: '9:16', ratio: '9:16' }
  ]
};

// 生成数量选项
const quantityOptions = [
  { label: '1张', value: 1 },
  { label: '2张', value: 2 },
  { label: '3张', value: 3 },
  { label: '4张', value: 4 }
];

// Midjourney模式选项
const midjourneyModes = [
  { label: '快速模式', value: 'fast', icon: <RocketOutlined />, description: '最快生成，消耗较多积分' },
  { label: '极速模式', value: 'turbo', icon: <ThunderboltOutlined />, description: '超快生成，消耗最多积分' },
  { label: '放松模式', value: 'relax', icon: <ClockCircleOutlined />, description: '慢速生成，消耗较少积分' }
];

const ImageGeneration = () => {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const {
    models,
    selectedModel,
    generating,
    generationProgress,
    generationHistory,
    historyPagination,
    publicGallery,
    galleryPagination,
    loading,
    userStats,
    processingTasks,
    getModels,
    selectModel,
    generateImage,
    generateImages,
    getUserHistory,
    getPublicGallery,
    deleteGeneration,
    toggleFavorite,
    togglePublic,
    getUserStats,
    isMidjourneyModel,
    midjourneyAction,
    cleanupFailedTasks
  } = useImageStore();

  // 生成参数状态
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [selectedSize, setSelectedSize] = useState('1024x1024');
  const [seed, setSeed] = useState(-1);
  const [guidanceScale, setGuidanceScale] = useState(2.5);
  const [watermark, setWatermark] = useState(true);
  const [quantity, setQuantity] = useState(1);
  const [viewMode, setViewMode] = useState('grid');
  const [activeTab, setActiveTab] = useState('all');
  const [batchResults, setBatchResults] = useState(null);
  
  // Midjourney专用状态
  const [mjMode, setMjMode] = useState('fast');
  const [showMjActions, setShowMjActions] = useState(false);
  const [selectedMjImage, setSelectedMjImage] = useState(null);
  
  // ImageViewer 状态
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerImages, setViewerImages] = useState([]);
  const [viewerInitialIndex, setViewerInitialIndex] = useState(0);

  // 初始化
  useEffect(() => {
    getModels();
    getUserHistory().then(() => {
      // 获取历史记录后，清理失败任务的处理状态
      cleanupFailedTasks();
    });
    getUserStats();
  }, []);
  
  // 当选择的模型改变时，调整相关参数
  useEffect(() => {
    if (selectedModel) {
      if (isMidjourneyModel(selectedModel)) {
        setSelectedSize('1:1'); // Midjourney使用比例而非像素
        setQuantity(1); // Midjourney固定一次生成4张
      } else {
        setSelectedSize('1024x1024');
      }
    }
  }, [selectedModel, isMidjourneyModel]);

  // 计算总价格
  const getTotalPrice = () => {
    if (!selectedModel) return 0;
    
    if (isMidjourneyModel(selectedModel)) {
      // Midjourney按4张计算（一个网格）
      const gridSize = selectedModel.api_config?.grid_size || 4;
      return (selectedModel.price_per_image || 0) * gridSize;
    } else {
      // 普通模型按数量计算
      return (selectedModel.price_per_image || 0) * quantity;
    }
  };

  // 处理模型选择
  const handleModelChange = (modelId) => {
    const model = models.find(m => m.id === modelId);
    if (model) {
      selectModel(model);
    }
  };

  // 处理生成
  const handleGenerate = async () => {
    if (!prompt.trim()) {
      message.warning('请输入提示词');
      return;
    }

    if (!selectedModel) {
      message.warning('请选择模型');
      return;
    }

    // 检查积分是否充足
    const totalPrice = getTotalPrice();
    if (user.credits_stats && user.credits_stats.remaining < totalPrice) {
      message.error(`积分不足！需要 ${totalPrice} 积分，当前余额 ${user.credits_stats.remaining} 积分`);
      return;
    }

    setBatchResults(null);

    const params = {
      prompt: prompt.trim(),
      negative_prompt: negativePrompt.trim(),
      size: selectedSize,
      seed: seed === -1 ? undefined : seed,
      guidance_scale: guidanceScale,
      watermark,
      quantity
    };
    
    // 如果是Midjourney，添加模式参数
    if (isMidjourneyModel(selectedModel)) {
      params.mode = mjMode;
      params.quantity = 1; // Midjourney强制为1
    }

    const result = await generateImages(params);

    if (result) {
      // 对于Midjourney，不清空输入（可能需要继续调整）
      if (!isMidjourneyModel(selectedModel)) {
        // 普通模型：显示结果并清空
        if (quantity > 1 && result.results) {
          setBatchResults(result);
          
          if (result.succeeded === result.requested) {
            message.success(`成功生成 ${result.succeeded} 张图片，消耗 ${result.creditsConsumed} 积分`);
          } else if (result.succeeded > 0) {
            message.warning(`部分成功：生成了 ${result.succeeded}/${result.requested} 张图片，消耗 ${result.creditsConsumed} 积分`);
          }
        }
        
        // 清空输入
        setPrompt('');
        setNegativePrompt('');
        setSeed(-1);
      }
    }
  };
  
  // 处理Midjourney操作（U/V/Reroll）
  const handleMidjourneyAction = async (generationId, action, index) => {
    const actionLabels = {
      UPSCALE: `放大第${index}张`,
      VARIATION: `变体第${index}张`,
      REROLL: '重新生成'
    };
    
    const confirm = await new Promise((resolve) => {
      Modal.confirm({
        title: '确认操作',
        content: `确定要${actionLabels[action]}吗？此操作将消耗 ${selectedModel.price_per_image} 积分`,
        okText: '确定',
        cancelText: '取消',
        onOk: () => resolve(true),
        onCancel: () => resolve(false)
      });
    });
    
    if (confirm) {
      await midjourneyAction(generationId, action, index);
    }
  };

  // 处理Tab切换
  const handleTabChange = (key) => {
    setActiveTab(key);
    
    if (key === 'public') {
      getPublicGallery({ page: 1, limit: 20 });
    } else {
      const params = { page: 1, limit: 20 };
      if (key === 'favorites') {
        params.is_favorite = true;
      }
      getUserHistory(params);
    }
  };

  // 复制提示词
  const copyPrompt = (text) => {
    navigator.clipboard.writeText(text);
    message.success('提示词已复制');
  };

  // 下载图片
  const downloadImage = (url, filename) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || 'image.jpg';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // 处理公开/私有切换
  const handleTogglePublic = async (item) => {
    const success = await togglePublic(item.id);
    if (success) {
      if (item.is_public) {
        message.success('已设为私密');
      } else {
        message.success('已公开分享');
      }
      
      if (activeTab === 'public') {
        getPublicGallery();
      }
    }
  };

  // 处理收藏切换
  const handleToggleFavorite = async (item) => {
    const success = await toggleFavorite(item.id);
    if (success) {
      if (item.is_favorite) {
        message.success('已取消收藏');
      } else {
        message.success('已添加收藏');
      }
    }
  };
  
  // 处理查看大图
  const handleViewImage = (item) => {
    // 获取当前数据列表
    const currentData = getCurrentData();
    
    // 找到点击图片在列表中的索引
    const index = currentData.findIndex(img => img.id === item.id);
    
    // 准备图片数据
    const images = currentData.map(img => ({
      url: img.local_path || img.image_url,
      thumbnail_path: img.thumbnail_path,
      title: img.prompt,
      prompt: img.prompt,
      negative_prompt: img.negative_prompt,
      size: img.size,
      generation_mode: img.generation_mode,
      guidance_scale: img.guidance_scale,
      seed: img.seed,
      username: img.username,
      gridLayout: img.grid_layout // Midjourney 四宫格标记
    }));
    
    setViewerImages(images);
    setViewerInitialIndex(index >= 0 ? index : 0);
    setViewerVisible(true);
  };
  
  // 渲染Midjourney操作按钮
  const renderMidjourneyActions = (item) => {
    // 修复：检查条件
    // 1. 必须有按钮数据
    // 2. 必须有网格布局
    // 3. 不能是UPSCALE的结果（UPSCALE后是单张图片，不应该有U/V按钮）
    if (!item.buttons || !item.grid_layout || item.action_type === 'UPSCALE') {
      return null;
    }
    
    const buttons = typeof item.buttons === 'string' ? JSON.parse(item.buttons) : item.buttons;
    
    // 只有在action_type是IMAGINE或VARIATION时才显示标准按钮
    // 这些是4张网格图，可以进行U/V操作
    if (item.action_type === 'IMAGINE' || item.action_type === 'VARIATION' || item.action_type === 'REROLL') {
      return (
        <div className="midjourney-actions">
          <div className="action-group">
            <span className="action-label">放大：</span>
            {[1, 2, 3, 4].map(i => (
              <Button
                key={`u${i}`}
                size="small"
                icon={<ZoomInOutlined />}
                onClick={() => handleMidjourneyAction(item.id, 'UPSCALE', i)}
              >
                U{i}
              </Button>
            ))}
          </div>
          <div className="action-group">
            <span className="action-label">变体：</span>
            {[1, 2, 3, 4].map(i => (
              <Button
                key={`v${i}`}
                size="small"
                icon={<ExperimentOutlined />}
                onClick={() => handleMidjourneyAction(item.id, 'VARIATION', i)}
              >
                V{i}
              </Button>
            ))}
          </div>
          <Button
            size="small"
            icon={<SyncOutlined />}
            onClick={() => handleMidjourneyAction(item.id, 'REROLL')}
          >
            重新生成
          </Button>
        </div>
      );
    }
    
    // 其他类型（如UPSCALE后的单张图）不显示按钮
    return null;
  };

  // 渲染历史图片卡片（支持Midjourney）
  const renderImageCard = (item, isGallery = false) => {
    const isOwner = !isGallery || item.user_id === user?.id;
    const isMj = item.provider === 'midjourney';
    
    // 关键修复：先检查任务是否已经失败或成功（终态）
    const isCompleted = item.status === 'success' || item.status === 'failed' || 
                       item.task_status === 'SUCCESS' || item.task_status === 'FAILURE';
    
    const isFailed = item.status === 'failed' || item.task_status === 'FAILURE';
    
    // 只有在非终态且在处理列表中才算处理中
    const isProcessing = !isCompleted && (
      (item.task_status === 'SUBMITTED' || item.task_status === 'IN_PROGRESS') || 
      (item.task_id && processingTasks && processingTasks[item.task_id])
    );
    
    // 判断图片是否已经准备好
    const hasImage = item.local_path || item.thumbnail_path || item.image_url;
    
    return (
      <Card
        key={item.id}
        className={`history-card ${isMj ? 'midjourney-card' : ''} ${isFailed ? 'failed-card' : ''}`}
        cover={
          <div className="image-wrapper">
            {isProcessing ? (
              // 处理中状态
              <div className="processing-overlay">
                <Spin size="large" />
                <div className="processing-text">
                  生成中...
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
              // 失败状态 - 显示错误信息和删除按钮
              <div className="failed-overlay">
                <CloseCircleOutlined style={{ fontSize: 48, color: '#ff4d4f' }} />
                <div className="failed-text">生成失败</div>
                {item.error_message && (
                  <div className="error-message">{item.error_message}</div>
                )}
                <div className="failed-actions">
                  <Popconfirm
                    title="确定删除这个失败的任务吗？"
                    onConfirm={() => deleteGeneration(item.id)}
                    okText="确定"
                    cancelText="取消"
                  >
                    <Button
                      danger
                      icon={<DeleteOutlined />}
                      size="small"
                    >
                      删除
                    </Button>
                  </Popconfirm>
                </div>
              </div>
            ) : hasImage ? (
              // 成功状态 - 显示图片
              <>
                <Image
                  src={item.local_path || item.thumbnail_path || item.image_url}
                  alt={item.prompt}
                  placeholder={<Spin />}
                  preview={false}
                  fallback="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMIAAADDCAYAAADQvc6UAAABRWlDQ1BJQ0MgUHJvZmlsZQAAKJFjYGASSSwoyGFhYGDIzSspCnJ3UoiIjFJgf8LAwSDCIMogwMCcmFxc4BgQ4ANUwgCjUcG3awyMIPqyLsis7PPOq3QdDFcvjV3jOD1boQVTPQrgSkktTgbSf4A4LbmgqISBgTEFyFYuLykAsTuAbJEioKOA7DkgdjqEvQHEToKwj4DVhAQ5A9k3gGyB5IxEoBmML4BsnSQk8XQkNtReEOBxcfXxUQg1Mjc0dyHgXNJBSWpFCYh2zi+oLMpMzyhRcASGUqqCZ16yno6CkYGRAQMDKMwhqj/fAIcloxgHQqxAjIHBEugw5sUIsSQpBobtQPdLciLEVJYzMPBHMDBsayhILEqEO4DxG0txmrERhM29nYGBddr//5/DGRjYNRkY/l7////39v///y4Dmn+LgeHANwDrkl1AuO+pmgAAADhlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAAqACAAQAAAABAAAAwqADAAQAAAABAAAAwwAAAAD9b/HnAAAHlklEQVR4Ae3dP3PTWBSGcbGzM6GCKqlIBRV0dHRJFarQ0eUT8LH4BnRU0NHR0UEFVdIlFRV7TzRksomPY8uykTk/zewQfKw/9znv4yvJynLv4uLiV2dBoDiBf4qP3/ARuCRABEFAoBEgghggQAQZQKAnYEaQBAQaASKIAQJEkAEEegJmBElAoBEgghggQAQZQKAnYEaQBAQaASKIAQJEkAEEegJmBElAoBEgghggQAQZQKAnYEaQBAQaASKIAQJEkAEEegJmBElAoBEgghggQAQZQKAnYEaQBAQaASKIAQJEkAEEegJmBElAoBEgghggQAQZQKAnYEaQBAQaASKIAQJEkAEEegJmBElAoBEgghggQAQZQKAnYEaQBAQaASKIAQJEkAEEegJmBElAoBEgghggQAQZQKAnYEaQBAQaASKIAQJEkAEEegJmBElAoBEgghggQAQZQKAnYEaQBAQaASKIAQJEkAEEegJmBElAoBEgghggQAQZQKAnYEaQBAQaASKIAQJEkAEEegJmBElAoBEgghggQAQZQKAnYEaQBAQaASKIAQJEkAEEegJmBElAoBEgghggQAQZQKAnYEaQBAQaASKIAQJEkAEEegJmBElAoBEgghggQAQZQKAnYEaQBAQaASKIAQJEkAEEegJmBElAoBEgghggQAQZQKAnYEaQBAQaASKIAQJEkAEEegJmBElAoBEgghgg0Aj8i0JO4OzsrPv69Wv+hi2qPHr0qNvf39+iI7duPc8RooHBgCEBCAKgC21DfDTSgBBgmAM8qIKk0HO0eXWr0h7bBJWwAgxhQZkKiwDVkQ5AD3aSqQSBQJgHNDV4AAQyj1ibKbHbCYB2bVnngJhCzwhQNUvosJCDAcDG5yV2VJP0ujsZvHzheD0IO4M7qP5akRW/2aSYF6Ek5CXhJbEsJ5d6CRABBQQZKUgz4sL4K1K9nMXG2ESJgLvBoRvzHC9VeywCAAAABJRU5ErkJggg=="
                />
                <div className="image-overlay">
                  <Space>
                    <Tooltip title="查看大图">
                      <Button
                        type="text"
                        icon={<EyeOutlined />}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleViewImage(item);
                        }}
                      />
                    </Tooltip>
                    <Tooltip title="下载">
                      <Button
                        type="text"
                        icon={<DownloadOutlined />}
                        onClick={(e) => {
                          e.stopPropagation();
                          downloadImage(item.local_path || item.image_url, `ai_${item.id}.jpg`);
                        }}
                      />
                    </Tooltip>
                    {isOwner && (
                      <>
                        <Tooltip title={item.is_favorite ? '取消收藏' : '收藏'}>
                          <Button
                            type="text"
                            icon={item.is_favorite ? <HeartFilled style={{ color: '#ff4d4f' }} /> : <HeartOutlined />}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleFavorite(item);
                            }}
                            className={item.is_favorite ? 'favorited' : ''}
                          />
                        </Tooltip>
                        <Tooltip title={item.is_public ? '设为私密' : '公开分享'}>
                          <Button
                            type="text"
                            icon={item.is_public ? <GlobalOutlined style={{ color: '#52c41a' }} /> : <LockOutlined />}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleTogglePublic(item);
                            }}
                          />
                        </Tooltip>
                        <Popconfirm
                          title="确定删除这张图片吗？"
                          onConfirm={() => deleteGeneration(item.id)}
                          okText="确定"
                          cancelText="取消"
                        >
                          <Tooltip title="删除">
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
              // 未知状态 - 可能是数据不完整
              <div className="processing-overlay">
                <Spin size="large" />
                <div className="processing-text">
                  加载中...
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
                  <WarningOutlined /> 模型已删除
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
                <Tag color="error">失败</Tag>
              )}
            </div>
          }
          description={
            <div className="card-meta-description">
              <div className="prompt-text">
                {item.prompt}
                <Button
                  type="link"
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    copyPrompt(item.prompt);
                  }}
                >
                  复制
                </Button>
              </div>
              {/* Midjourney操作按钮 - 只在成功状态下显示 */}
              {isOwner && isMj && !isProcessing && !isFailed && hasImage && renderMidjourneyActions(item)}
              <div className="meta-info">
                {isGallery && item.username && (
                  <span style={{ marginRight: 8 }}>
                    <UserOutlined /> {item.username}
                  </span>
                )}
                <span>{new Date(item.created_at).toLocaleString()}</span>
                {item.credits_consumed !== undefined && (
                  <span>{item.credits_consumed} 积分</span>
                )}
                {item.is_public && <Tag color="green">公开</Tag>}
                {item.is_favorite && isOwner && <Tag color="red">已收藏</Tag>}
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
  };

  // 获取当前显示的数据
  const getCurrentData = () => {
    if (activeTab === 'public') {
      return publicGallery;
    }
    return generationHistory;
  };

  // 处理刷新
  const handleRefresh = () => {
    if (activeTab === 'public') {
      getPublicGallery();
    } else {
      const params = {};
      if (activeTab === 'favorites') {
        params.is_favorite = true;
      }
      getUserHistory(params).then(() => {
        // 刷新后清理失败任务
        cleanupFailedTasks();
      });
    }
  };
  
  // 获取当前可用的尺寸选项
  const getCurrentSizes = () => {
    if (selectedModel && isMidjourneyModel(selectedModel)) {
      return presetSizes.midjourney;
    }
    return presetSizes.default;
  };

  return (
    <Layout className="image-generation-page">
      {/* 左侧生成区域 */}
      <Sider width={380} className="generation-sider" theme="light">
        <div className="generation-container">
          {/* 模型选择 */}
          <div className="model-selection-compact">
            <div className="section-title">选择模型</div>
            <Select
              className="model-select"
              placeholder="请选择生成模型"
              value={selectedModel?.id}
              onChange={handleModelChange}
              style={{ width: '100%' }}
            >
              {models.map(model => {
                const isMj = isMidjourneyModel(model);
                return (
                  <Option key={model.id} value={model.id}>
                    <Space>
                      {isMj ? (
                        <ThunderboltOutlined style={{ color: '#722ed1' }} />
                      ) : (
                        <FireOutlined style={{ color: '#ff6b6b' }} />
                      )}
                      <span>{model.display_name}</span>
                      <Tag color={isMj ? 'purple' : 'blue'} style={{ marginLeft: 'auto' }}>
                        {isMj ? `${model.price_per_image * 4} 积分/组` : `${model.price_per_image} 积分`}
                      </Tag>
                    </Space>
                  </Option>
                );
              })}
            </Select>
            {selectedModel && (
              <div className="model-description">
                <Space>
                  <Tag color={isMidjourneyModel(selectedModel) ? 'purple' : 'volcano'}>
                    {selectedModel.provider}
                  </Tag>
                  {isMidjourneyModel(selectedModel) && (
                    <Tag color="cyan">异步生成</Tag>
                  )}
                  <span style={{ fontSize: '11px', color: '#8c8c8c' }}>
                    {selectedModel.description}
                  </span>
                </Space>
              </div>
            )}
          </div>

          <Card title="输入提示词" className="prompt-input">
            <TextArea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={
                isMidjourneyModel(selectedModel) 
                  ? "描述你想生成的图片内容，支持参数如 --v 6 --ar 16:9..."
                  : "描述你想生成的图片内容..."
              }
              rows={3}
              maxLength={isMidjourneyModel(selectedModel) ? 4000 : 1000}
              showCount
            />
            {!isMidjourneyModel(selectedModel) && (
              <div className="negative-prompt">
                <div className="label">负面提示词（可选）</div>
                <TextArea
                  value={negativePrompt}
                  onChange={(e) => setNegativePrompt(e.target.value)}
                  placeholder="描述你不想在图片中出现的内容..."
                  rows={2}
                  maxLength={500}
                />
              </div>
            )}
          </Card>

          <Card title="参数设置" className="parameters">
            {/* Midjourney模式选择 */}
            {selectedModel && isMidjourneyModel(selectedModel) && (
              <div className="param-item">
                <div className="param-label">
                  生成模式
                  <Tooltip title="不同模式的生成速度和积分消耗不同">
                    <span className="info-icon"> ❓</span>
                  </Tooltip>
                </div>
                <Radio.Group
                  value={mjMode}
                  onChange={(e) => setMjMode(e.target.value)}
                  style={{ width: '100%' }}
                >
                  {midjourneyModes.map(mode => (
                    <Radio.Button key={mode.value} value={mode.value} style={{ width: '33.33%', textAlign: 'center' }}>
                      <div>
                        {mode.icon}
                        <div style={{ fontSize: 12 }}>{mode.label}</div>
                      </div>
                    </Radio.Button>
                  ))}
                </Radio.Group>
                <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 8 }}>
                  {midjourneyModes.find(m => m.value === mjMode)?.description}
                </div>
              </div>
            )}
            
            {/* 生成数量 - Midjourney不显示 */}
            {selectedModel && !isMidjourneyModel(selectedModel) && (
              <div className="param-item">
                <div className="param-label">
                  生成数量
                  <Tooltip title="一次生成多张图片，每张使用不同的随机种子">
                    <span className="info-icon"> ❓</span>
                  </Tooltip>
                </div>
                <Segmented
                  options={quantityOptions}
                  value={quantity}
                  onChange={setQuantity}
                  block
                />
                {quantity > 1 && (
                  <div style={{ marginTop: 8 }}>
                    <Alert
                      message={`批量生成将消耗 ${getTotalPrice()} 积分`}
                      type="info"
                      showIcon={false}
                      banner
                    />
                  </div>
                )}
              </div>
            )}

            {/* 图片尺寸 */}
            <div className="param-item">
              <div className="param-label">
                {isMidjourneyModel(selectedModel) ? '图片比例' : '图片尺寸'}
              </div>
              <div className="size-grid">
                {getCurrentSizes().map(size => (
                  <Button
                    key={size.value}
                    className={selectedSize === size.value ? 'selected' : ''}
                    onClick={() => setSelectedSize(size.value)}
                  >
                    {size.ratio}
                  </Button>
                ))}
              </div>
              <div className="size-display">{selectedSize}</div>
            </div>

            {/* Midjourney提示 */}
            {selectedModel && isMidjourneyModel(selectedModel) && (
              <Alert
                message="Midjourney每次生成4张图片（2×2网格）"
                description="生成后可以选择放大(U)、生成变体(V)或重新生成"
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
                onClick={handleGenerate}
                loading={generating}
                disabled={!selectedModel || !prompt.trim()}
                block
              >
                {generating ? (
                  '生成中...'
                ) : (
                  <Space>
                    <span>生成图片</span>
                    <Tag color="blue">{getTotalPrice()} 积分</Tag>
                  </Space>
                )}
              </Button>
            </div>

            {/* 高级选项 - Midjourney不需要 */}
            {selectedModel && !isMidjourneyModel(selectedModel) && (
              <Collapse
                ghost
                expandIcon={({ isActive }) => <CaretRightOutlined rotate={isActive ? 90 : 0} />}
                className="advanced-options"
              >
                <Panel 
                  header={
                    <Space>
                      <SettingOutlined />
                      <span>高级选项</span>
                    </Space>
                  } 
                  key="1"
                >
                  <div className="param-item">
                    <div className="param-label">
                      引导系数
                      <Tooltip title="控制生成图像与提示词的相关程度，值越大越相关">
                        <span className="info-icon"> ❓</span>
                      </Tooltip>
                    </div>
                    <Row gutter={16}>
                      <Col span={16}>
                        <Slider
                          min={1}
                          max={10}
                          step={0.5}
                          value={guidanceScale}
                          onChange={setGuidanceScale}
                        />
                      </Col>
                      <Col span={8}>
                        <InputNumber
                          min={1}
                          max={10}
                          step={0.5}
                          value={guidanceScale}
                          onChange={setGuidanceScale}
                          style={{ width: '100%' }}
                        />
                      </Col>
                    </Row>
                  </div>

                  <div className="param-item">
                    <div className="param-label">
                      随机种子
                      <Tooltip title="使用相同的种子值可以生成相似的图片，-1为随机">
                        <span className="info-icon"> ❓</span>
                      </Tooltip>
                    </div>
                    <InputNumber
                      min={-1}
                      max={2147483647}
                      value={seed}
                      onChange={setSeed}
                      style={{ width: '100%' }}
                      placeholder="-1 为随机"
                    />
                  </div>

                  <div className="param-item">
                    <Row justify="space-between" align="middle">
                      <Col>添加水印</Col>
                      <Col>
                        <Switch checked={watermark} onChange={setWatermark} />
                      </Col>
                    </Row>
                  </div>
                </Panel>
              </Collapse>
            )}
          </Card>
        </div>
      </Sider>

      {/* 右侧历史记录 */}
      <Content className="history-content">
        <div className="history-header">
          <Tabs activeKey={activeTab} onChange={handleTabChange}>
            <TabPane tab="我的图片" key="all" />
            <TabPane tab="我的收藏" key="favorites" />
            <TabPane tab={<span><GlobalOutlined /> 公开画廊</span>} key="public" />
          </Tabs>
          <Space>
            <Button
              icon={viewMode === 'grid' ? <AppstoreOutlined /> : <UnorderedListOutlined />}
              onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
            />
            <Button
              icon={<ReloadOutlined />}
              onClick={handleRefresh}
            >
              刷新
            </Button>
          </Space>
        </div>

        <div className={`history-grid ${viewMode}`}>
          {loading ? (
            <div className="loading-container">
              <Spin size="large" />
            </div>
          ) : getCurrentData().length > 0 ? (
            getCurrentData().map(item => renderImageCard(item, activeTab === 'public'))
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                activeTab === 'public' 
                  ? '暂无公开的图片' 
                  : activeTab === 'favorites'
                  ? '暂无收藏的图片'
                  : '暂无生成记录'
              }
            />
          )}
        </div>
      </Content>

      {/* 使用新的 ImageViewer 组件 */}
      <ImageViewer
        visible={viewerVisible}
        images={viewerImages}
        initialIndex={viewerInitialIndex}
        onClose={() => setViewerVisible(false)}
        showDownload={true}
        showThumbnails={viewerImages.length > 1}
      />
    </Layout>
  );
};

export default ImageGeneration;
