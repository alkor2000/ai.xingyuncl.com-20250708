/**
 * 视频生成页面 - 支持首尾帧控制和模型名称显示
 */

import React, { useEffect, useState, useRef } from 'react';
import {
  Layout,
  Card,
  Input,
  Button,
  Space,
  Row,
  Col,
  Select,
  Switch,
  Tabs,
  Empty,
  Spin,
  Tag,
  message,
  Modal,
  Tooltip,
  Progress,
  Alert,
  Pagination,
  Popconfirm,
  Upload,
  Divider
} from 'antd';
import {
  VideoCameraOutlined,
  SendOutlined,
  ReloadOutlined,
  HeartOutlined,
  HeartFilled,
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  GlobalOutlined,
  LockOutlined,
  ThunderboltOutlined,
  ClockCircleOutlined,
  FileImageOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  UploadOutlined,
  PlusOutlined,
  ExpandOutlined,
  PictureOutlined,
  RobotOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import useVideoStore from '../../stores/videoStore';
import useAuthStore from '../../stores/authStore';
import apiClient from '../../utils/api';
import './VideoGeneration.less';

const { Content, Sider } = Layout;
const { TextArea } = Input;
const { TabPane } = Tabs;
const { Option } = Select;

// 预设分辨率
const resolutionOptions = {
  '480p': { label: '480P (标清)', width: 854, height: 480 },
  '720p': { label: '720P (高清)', width: 1280, height: 720 },
  '1080p': { label: '1080P (全高清)', width: 1920, height: 1080 }
};

// 预设宽高比
const ratioOptions = [
  { label: '16:9 (横屏)', value: '16:9' },
  { label: '4:3 (传统)', value: '4:3' },
  { label: '1:1 (正方形)', value: '1:1' },
  { label: '3:4 (竖屏)', value: '3:4' },
  { label: '9:16 (手机竖屏)', value: '9:16' },
  { label: '21:9 (影院)', value: '21:9' }
];

const VideoGeneration = () => {
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
    generateVideo,
    getUserHistory,
    getPublicGallery,
    deleteGeneration,
    toggleFavorite,
    togglePublic,
    getUserStats
  } = useVideoStore();

  // 生成参数状态
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [firstFrameImage, setFirstFrameImage] = useState('');
  const [firstFrameFile, setFirstFrameFile] = useState(null);
  const [lastFrameImage, setLastFrameImage] = useState(''); // 新增：尾帧图片
  const [lastFrameFile, setLastFrameFile] = useState(null); // 新增：尾帧文件
  const [uploadingFirst, setUploadingFirst] = useState(false);
  const [uploadingLast, setUploadingLast] = useState(false); // 新增：尾帧上传状态
  const [generationMode, setGenerationMode] = useState('text_to_video');
  const [resolution, setResolution] = useState('720p');
  const [duration, setDuration] = useState(5);
  const [ratio, setRatio] = useState('16:9');
  const [seed, setSeed] = useState(-1);
  const [watermark, setWatermark] = useState(false);
  const [cameraFixed, setCameraFixed] = useState(false);
  const [activeTab, setActiveTab] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [previewVideo, setPreviewVideo] = useState(null);

  // 初始化
  useEffect(() => {
    getModels();
    getUserHistory({ page: 1, limit: pageSize });
    getUserStats();
  }, []);

  // 当选择的模型改变时，调整相关参数
  useEffect(() => {
    if (selectedModel) {
      // 设置默认值
      setResolution(selectedModel.default_resolution || '720p');
      setDuration(selectedModel.default_duration || 5);
      setRatio(selectedModel.default_ratio || '16:9');
      
      // 如果模型不支持当前模式，切换到支持的模式
      if (generationMode === 'first_frame' && !selectedModel.supports_first_frame) {
        setGenerationMode('text_to_video');
      } else if (generationMode === 'last_frame' && !selectedModel.supports_last_frame) {
        setGenerationMode('text_to_video');
      } else if (generationMode === 'first_last_frame' && 
                 (!selectedModel.supports_first_frame || !selectedModel.supports_last_frame)) {
        setGenerationMode('text_to_video');
      }
    }
  }, [selectedModel]);

  // 计算价格
  const calculatePrice = () => {
    if (!selectedModel) return 0;
    
    const basePrice = selectedModel.base_price || 50;
    const priceConfig = selectedModel.price_config || {};
    
    // 获取分辨率系数
    const resolutionMultiplier = priceConfig.resolution_multiplier?.[resolution] || 1.0;
    
    // 获取时长系数
    const durationMultiplier = priceConfig.duration_multiplier?.[String(duration)] || 1.0;
    
    return Math.ceil(basePrice * resolutionMultiplier * durationMultiplier);
  };

  // 处理模型选择
  const handleModelChange = (modelId) => {
    const model = models.find(m => m.id === modelId);
    if (model) {
      selectModel(model);
    }
  };

  // 处理首帧图片上传
  const handleFirstFrameUpload = async (info) => {
    const { file } = info;
    
    if (file.status === 'uploading') {
      setUploadingFirst(true);
      return;
    }
    
    if (file.status === 'done') {
      setUploadingFirst(false);
      if (file.response && file.response.success) {
        setFirstFrameImage(file.response.data.url);
        setFirstFrameFile(file);
        message.success('首帧图片上传成功');
      } else {
        message.error(file.response?.message || '上传失败');
      }
    } else if (file.status === 'error') {
      setUploadingFirst(false);
      message.error('首帧图片上传失败');
    }
  };

  // 处理尾帧图片上传
  const handleLastFrameUpload = async (info) => {
    const { file } = info;
    
    if (file.status === 'uploading') {
      setUploadingLast(true);
      return;
    }
    
    if (file.status === 'done') {
      setUploadingLast(false);
      if (file.response && file.response.success) {
        setLastFrameImage(file.response.data.url);
        setLastFrameFile(file);
        message.success('尾帧图片上传成功');
      } else {
        message.error(file.response?.message || '上传失败');
      }
    } else if (file.status === 'error') {
      setUploadingLast(false);
      message.error('尾帧图片上传失败');
    }
  };

  // 自定义上传请求
  const customUploadRequest = async ({ file, onSuccess, onError }) => {
    const formData = new FormData();
    formData.append('image', file);
    
    try {
      const response = await apiClient.post('/video/upload-frame', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      
      onSuccess(response.data, file);
    } catch (error) {
      console.error('上传失败:', error);
      onError(error);
    }
  };

  // 上传前的验证
  const beforeUpload = (file) => {
    const isImage = file.type.startsWith('image/');
    if (!isImage) {
      message.error('只能上传图片文件！');
      return false;
    }
    
    const isLt10M = file.size / 1024 / 1024 < 10;
    if (!isLt10M) {
      message.error('图片大小不能超过 10MB！');
      return false;
    }
    
    return true;
  };

  // 移除首帧图片
  const handleRemoveFirstImage = () => {
    setFirstFrameImage('');
    setFirstFrameFile(null);
  };

  // 移除尾帧图片
  const handleRemoveLastImage = () => {
    setLastFrameImage('');
    setLastFrameFile(null);
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

    if (!selectedModel.has_api_key) {
      message.error('该模型尚未配置API密钥，请联系管理员');
      return;
    }

    // 根据生成模式检查图片是否上传
    if (generationMode === 'first_frame' && !firstFrameImage) {
      message.warning('请上传首帧图片');
      return;
    }
    
    if (generationMode === 'last_frame' && !lastFrameImage) {
      message.warning('请上传尾帧图片');
      return;
    }
    
    if (generationMode === 'first_last_frame') {
      if (!firstFrameImage || !lastFrameImage) {
        message.warning('请上传首帧和尾帧图片');
        return;
      }
    }

    // 检查积分是否充足
    const price = calculatePrice();
    if (user.credits_stats && user.credits_stats.remaining < price) {
      message.error(`积分不足！需要 ${price} 积分，当前余额 ${user.credits_stats.remaining} 积分`);
      return;
    }

    // 构建参数对象
    const params = {
      prompt: prompt.trim(),
      negative_prompt: negativePrompt.trim(),
      generation_mode: generationMode,
      resolution,
      duration,
      ratio,
      seed: seed === -1 ? undefined : seed,
      watermark,
      camera_fixed: cameraFixed
    };
    
    // 根据模式添加图片参数
    if (generationMode === 'first_frame' || generationMode === 'first_last_frame') {
      params.first_frame_image = firstFrameImage;
    }
    
    if (generationMode === 'last_frame' || generationMode === 'first_last_frame') {
      params.last_frame_image = lastFrameImage;
    }

    const result = await generateVideo(params);

    if (result) {
      // 清空输入
      setPrompt('');
      setNegativePrompt('');
      setFirstFrameImage('');
      setFirstFrameFile(null);
      setLastFrameImage('');
      setLastFrameFile(null);
      setSeed(-1);
      
      // 重置到第一页查看最新的视频
      setCurrentPage(1);
    }
  };

  // 处理Tab切换
  const handleTabChange = (key) => {
    setActiveTab(key);
    setCurrentPage(1);
    
    if (key === 'public') {
      getPublicGallery({ page: 1, limit: pageSize });
    } else {
      const params = { page: 1, limit: pageSize };
      if (key === 'favorites') {
        params.is_favorite = true;
      }
      getUserHistory(params);
    }
  };

  // 处理分页变化
  const handlePageChange = (page, size) => {
    setCurrentPage(page);
    setPageSize(size);
    
    if (activeTab === 'public') {
      getPublicGallery({ page, limit: size });
    } else {
      const params = { page, limit: size };
      if (activeTab === 'favorites') {
        params.is_favorite = true;
      }
      getUserHistory(params);
    }
  };

  // 判断视频是否为竖版
  const isVerticalVideo = (ratio) => {
    if (!ratio) return false;
    const ratioStr = ratio.toString();
    // 竖版视频：3:4, 9:16 等
    return ratioStr === '3:4' || ratioStr === '9:16' || ratioStr === '2:3';
  };

  // 获取视频的object-fit样式
  const getVideoObjectFit = (item) => {
    // 如果是竖版视频，使用contain以显示完整内容
    if (isVerticalVideo(item.ratio)) {
      return 'contain';
    }
    // 横版视频使用cover
    return 'cover';
  };

  // 预览视频模态框
  const handlePreviewVideo = (item) => {
    setPreviewVideo(item);
  };

  // 处理视频加载完成，设置预览时间点
  const handleVideoLoadedMetadata = (e) => {
    const video = e.target;
    // 设置预览时间为0.5秒或视频长度的10%（取较小值）
    const previewTime = Math.min(0.5, video.duration * 0.1);
    video.currentTime = previewTime;
  };

  // 获取模型提供商的标签颜色
  const getProviderColor = (provider) => {
    const colorMap = {
      'volcano': 'volcano',  // 火山引擎 - 橙红色
      'kling': 'purple',     // 可灵 - 紫色
      'midjourney': 'geekblue', // Midjourney - 蓝色
      'stable': 'green',     // Stable Diffusion - 绿色
      'runway': 'cyan',      // Runway - 青色
      'pika': 'magenta',     // Pika - 洋红色
      'sora': 'gold'         // Sora - 金色
    };
    return colorMap[provider] || 'default';
  };

  // 渲染视频卡片
  const renderVideoCard = (item, isGallery = false) => {
    const isOwner = !isGallery || item.user_id === user?.id;
    const isProcessing = item.status === 'submitted' || item.status === 'queued' || item.status === 'running';
    const isFailed = item.status === 'failed';
    const isSucceeded = item.status === 'succeeded';
    
    // 生成唯一的video key，确保URL变化时重新创建元素
    const videoKey = `video-${item.id}-${item.local_path || 'no-path'}-${item.status}`;
    
    // 判断是否为竖版视频
    const isVertical = isVerticalVideo(item.ratio);
    const videoObjectFit = getVideoObjectFit(item);
    
    return (
      <Card
        key={item.id}
        className={`video-card ${isProcessing ? 'processing' : ''} ${isFailed ? 'failed' : ''} ${isVertical ? 'vertical' : ''}`}
        cover={
          <div className="video-wrapper">
            {isProcessing ? (
              <div className="processing-overlay">
                <Spin size="large" />
                <div className="processing-text">生成中...</div>
                {item.progress > 0 && (
                  <Progress percent={item.progress} showInfo={false} />
                )}
              </div>
            ) : isFailed ? (
              <div className="failed-overlay">
                <CloseCircleOutlined style={{ fontSize: 48, color: '#ff4d4f' }} />
                <div className="failed-text">生成失败</div>
                {item.error_message && (
                  <div className="error-message">{item.error_message}</div>
                )}
              </div>
            ) : isSucceeded && item.local_path ? (
              <div className="video-player" key={videoKey}>
                <video
                  key={videoKey}
                  src={item.local_path}
                  poster={item.thumbnail_path}
                  controls
                  preload="metadata"
                  style={{ 
                    width: '100%', 
                    height: '200px', 
                    objectFit: videoObjectFit,
                    backgroundColor: '#000'
                  }}
                  onLoadedMetadata={handleVideoLoadedMetadata}
                  onLoadedData={() => {
                    console.log(`视频已加载: ${item.id}, 比例: ${item.ratio}, object-fit: ${videoObjectFit}`);
                  }}
                  onError={(e) => {
                    console.error(`视频加载失败: ${item.id}`, e);
                  }}
                />
                {/* 添加全屏预览按钮 */}
                <Tooltip title="大屏预览">
                  <Button
                    type="text"
                    icon={<ExpandOutlined />}
                    onClick={() => handlePreviewVideo(item)}
                    style={{
                      position: 'absolute',
                      bottom: 45,
                      right: 10,
                      background: 'rgba(0, 0, 0, 0.5)',
                      color: 'white',
                      border: 'none'
                    }}
                  />
                </Tooltip>
              </div>
            ) : (
              <div className="no-video">
                <VideoCameraOutlined style={{ fontSize: 48, color: '#999' }} />
              </div>
            )}
            
            {/* 操作按钮 */}
            {isOwner && (
              <div className="video-actions">
                <Space direction="vertical" size="small">
                  {isSucceeded && item.local_path && (
                    <Tooltip title="下载" placement="left">
                      <Button
                        type="primary"
                        shape="circle"
                        size="small"
                        icon={<DownloadOutlined />}
                        onClick={(e) => {
                          e.stopPropagation();
                          const link = document.createElement('a');
                          link.href = item.local_path;
                          link.download = `video_${item.id}.mp4`;
                          link.click();
                        }}
                      />
                    </Tooltip>
                  )}
                  
                  {/* 收藏按钮 */}
                  {(isSucceeded || isFailed) && (
                    <Tooltip title={item.is_favorite ? '取消收藏' : '收藏'} placement="left">
                      <Button
                        type="primary"
                        shape="circle"
                        size="small"
                        icon={item.is_favorite ? <HeartFilled /> : <HeartOutlined />}
                        danger={item.is_favorite}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavorite(item.id);
                        }}
                      />
                    </Tooltip>
                  )}
                  
                  {/* 公开/私密按钮 */}
                  {isSucceeded && (
                    <Tooltip title={item.is_public ? '设为私密' : '公开分享'} placement="left">
                      <Button
                        type="primary"
                        shape="circle"
                        size="small"
                        icon={item.is_public ? <GlobalOutlined /> : <LockOutlined />}
                        style={{ background: item.is_public ? '#52c41a' : undefined }}
                        onClick={(e) => {
                          e.stopPropagation();
                          togglePublic(item.id);
                        }}
                      />
                    </Tooltip>
                  )}
                  
                  {/* 删除按钮 */}
                  <Popconfirm
                    title="确定删除这个视频吗？"
                    onConfirm={(e) => {
                      if (e) e.stopPropagation();
                      deleteGeneration(item.id);
                    }}
                    onCancel={(e) => {
                      if (e) e.stopPropagation();
                    }}
                    okText="确定"
                    cancelText="取消"
                    placement="left"
                  >
                    <Tooltip title="删除" placement="left">
                      <Button
                        danger
                        shape="circle"
                        size="small"
                        icon={<DeleteOutlined />}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </Tooltip>
                  </Popconfirm>
                </Space>
              </div>
            )}
          </div>
        }
      >
        <Card.Meta
          title={
            <div className="card-meta-title">
              {/* 添加模型名称标签 */}
              {item.model_name && (
                <Tooltip title={`生成模型: ${item.model_name}`}>
                  <Tag 
                    icon={<RobotOutlined />} 
                    color={getProviderColor(item.provider)}
                    style={{ marginBottom: 4 }}
                  >
                    {item.model_name}
                  </Tag>
                </Tooltip>
              )}
              <Tag color="blue">{item.resolution}</Tag>
              <Tag>{item.duration}秒</Tag>
              {item.ratio && <Tag color={isVertical ? 'purple' : 'cyan'}>{item.ratio}</Tag>}
              {isFailed && <Tag color="error">失败</Tag>}
              {isProcessing && <Tag color="processing">处理中</Tag>}
              {isSucceeded && <Tag color="success">已完成</Tag>}
            </div>
          }
          description={
            <div className="card-meta-description">
              <div className="prompt-text">{item.prompt}</div>
              <div className="meta-info">
                {isGallery && item.username && (
                  <span>{item.username}</span>
                )}
                <span>{new Date(item.created_at).toLocaleString()}</span>
                {item.credits_consumed !== undefined && (
                  <span>{item.credits_consumed} 积分</span>
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

  // 获取当前分页信息
  const getCurrentPagination = () => {
    if (activeTab === 'public') {
      return galleryPagination;
    }
    return historyPagination;
  };

  // 首帧上传按钮内容
  const firstFrameUploadButton = (
    <div>
      {uploadingFirst ? <Spin /> : <PlusOutlined />}
      <div style={{ marginTop: 8 }}>
        {uploadingFirst ? '上传中...' : '上传首帧'}
      </div>
    </div>
  );
  
  // 尾帧上传按钮内容
  const lastFrameUploadButton = (
    <div>
      {uploadingLast ? <Spin /> : <PlusOutlined />}
      <div style={{ marginTop: 8 }}>
        {uploadingLast ? '上传中...' : '上传尾帧'}
      </div>
    </div>
  );

  return (
    <Layout className="video-generation-page">
      {/* 左侧生成区域 */}
      <Sider width={380} className="generation-sider" theme="light">
        <div className="generation-container">
          {/* 模型选择 */}
          <Card title="选择模型" className="model-selection">
            <Select
              className="model-select"
              placeholder="请选择视频生成模型"
              value={selectedModel?.id}
              onChange={handleModelChange}
              style={{ width: '100%' }}
            >
              {models.map(model => (
                <Option key={model.id} value={model.id}>
                  <Space>
                    <VideoCameraOutlined />
                    <span>{model.display_name}</span>
                    {!model.has_api_key && (
                      <Tag color="orange">未配置</Tag>
                    )}
                  </Space>
                </Option>
              ))}
            </Select>
            {selectedModel && (
              <div className="model-info">
                <p>{selectedModel.description}</p>
                <Space wrap>
                  {selectedModel.supports_text_to_video && <Tag color="green">文生视频</Tag>}
                  {selectedModel.supports_first_frame && <Tag color="blue">首帧图生</Tag>}
                  {selectedModel.supports_last_frame && <Tag color="orange">尾帧图生</Tag>}
                  {selectedModel.supports_first_frame && selectedModel.supports_last_frame && 
                    <Tag color="purple">首尾帧图生</Tag>}
                </Space>
              </div>
            )}
          </Card>

          {/* 生成模式 */}
          <Card title="生成模式">
            <Select
              value={generationMode}
              onChange={setGenerationMode}
              style={{ width: '100%' }}
            >
              <Option value="text_to_video" disabled={!selectedModel?.supports_text_to_video}>
                <Space>
                  <VideoCameraOutlined />
                  <span>文字生成视频</span>
                </Space>
              </Option>
              <Option value="first_frame" disabled={!selectedModel?.supports_first_frame}>
                <Space>
                  <PictureOutlined />
                  <span>首帧图生成视频</span>
                </Space>
              </Option>
              <Option value="last_frame" disabled={!selectedModel?.supports_last_frame}>
                <Space>
                  <PictureOutlined />
                  <span>尾帧图生成视频</span>
                </Space>
              </Option>
              <Option value="first_last_frame" 
                disabled={!selectedModel?.supports_first_frame || !selectedModel?.supports_last_frame}>
                <Space>
                  <FileImageOutlined />
                  <span>首尾帧图生成视频</span>
                </Space>
              </Option>
            </Select>
            
            {/* 模式说明 */}
            {generationMode === 'first_frame' && (
              <Alert 
                message="首帧图生成：提供视频的第一帧图片，AI会根据图片和提示词生成后续内容"
                type="info" 
                showIcon 
                style={{ marginTop: 10 }}
              />
            )}
            {generationMode === 'last_frame' && (
              <Alert 
                message="尾帧图生成：提供视频的最后一帧图片，AI会生成到达该画面的过程"
                type="info" 
                showIcon 
                style={{ marginTop: 10 }}
              />
            )}
            {generationMode === 'first_last_frame' && (
              <Alert 
                message="首尾帧图生成：提供首尾两帧图片，AI会生成从首帧到尾帧的过渡视频"
                type="info" 
                showIcon 
                style={{ marginTop: 10 }}
              />
            )}
          </Card>

          {/* 输入提示词 */}
          <Card title="输入提示词">
            <TextArea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="描述你想生成的视频内容..."
              rows={4}
              maxLength={selectedModel?.max_prompt_length || 500}
              showCount
            />
            
            {/* 首帧图片上传 */}
            {(generationMode === 'first_frame' || generationMode === 'first_last_frame') && (
              <div style={{ marginTop: 16 }}>
                <div style={{ marginBottom: 8, fontWeight: 500 }}>
                  <PictureOutlined /> 首帧图片
                </div>
                <Upload
                  name="image"
                  listType="picture-card"
                  className="frame-uploader"
                  showUploadList={false}
                  customRequest={customUploadRequest}
                  beforeUpload={beforeUpload}
                  onChange={handleFirstFrameUpload}
                >
                  {firstFrameImage ? (
                    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                      <img 
                        src={firstFrameImage} 
                        alt="首帧图片" 
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                      <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveFirstImage();
                        }}
                        style={{
                          position: 'absolute',
                          top: 0,
                          right: 0,
                          background: 'rgba(255, 255, 255, 0.8)'
                        }}
                      />
                    </div>
                  ) : (
                    firstFrameUploadButton
                  )}
                </Upload>
              </div>
            )}
            
            {/* 尾帧图片上传 */}
            {(generationMode === 'last_frame' || generationMode === 'first_last_frame') && (
              <div style={{ marginTop: 16 }}>
                <div style={{ marginBottom: 8, fontWeight: 500 }}>
                  <PictureOutlined /> 尾帧图片
                </div>
                <Upload
                  name="image"
                  listType="picture-card"
                  className="frame-uploader"
                  showUploadList={false}
                  customRequest={customUploadRequest}
                  beforeUpload={beforeUpload}
                  onChange={handleLastFrameUpload}
                >
                  {lastFrameImage ? (
                    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                      <img 
                        src={lastFrameImage} 
                        alt="尾帧图片" 
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                      <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveLastImage();
                        }}
                        style={{
                          position: 'absolute',
                          top: 0,
                          right: 0,
                          background: 'rgba(255, 255, 255, 0.8)'
                        }}
                      />
                    </div>
                  ) : (
                    lastFrameUploadButton
                  )}
                </Upload>
              </div>
            )}
            
            {/* 图片格式说明 */}
            {(generationMode !== 'text_to_video') && (
              <div style={{ fontSize: 12, color: '#999', marginTop: 8 }}>
                支持 JPG、PNG、WEBP 格式，最大 10MB
              </div>
            )}
          </Card>

          {/* 参数设置 */}
          <Card title="参数设置">
            <Space direction="vertical" style={{ width: '100%' }}>
              <div>
                <div className="param-label">分辨率</div>
                <Select
                  value={resolution}
                  onChange={setResolution}
                  style={{ width: '100%' }}
                >
                  {selectedModel?.resolutions_supported?.map(res => (
                    <Option key={res} value={res}>
                      {resolutionOptions[res]?.label || res}
                    </Option>
                  ))}
                </Select>
              </div>

              <div>
                <div className="param-label">时长</div>
                <Select
                  value={duration}
                  onChange={setDuration}
                  style={{ width: '100%' }}
                >
                  {selectedModel?.durations_supported?.map(dur => (
                    <Option key={dur} value={dur}>
                      {dur} 秒
                    </Option>
                  ))}
                </Select>
              </div>

              <div>
                <div className="param-label">宽高比</div>
                <Select
                  value={ratio}
                  onChange={setRatio}
                  style={{ width: '100%' }}
                >
                  {ratioOptions.map(opt => (
                    <Option key={opt.value} value={opt.value}>
                      {opt.label}
                    </Option>
                  ))}
                </Select>
              </div>

              <Row gutter={16}>
                <Col span={12}>
                  <Switch
                    checked={watermark}
                    onChange={setWatermark}
                    checkedChildren="有水印"
                    unCheckedChildren="无水印"
                  />
                </Col>
                <Col span={12}>
                  <Switch
                    checked={cameraFixed}
                    onChange={setCameraFixed}
                    checkedChildren="固定镜头"
                    unCheckedChildren="运动镜头"
                  />
                </Col>
              </Row>
            </Space>
          </Card>

          {/* 生成按钮 */}
          <div className="generate-button-section">
            <Button
              type="primary"
              size="large"
              icon={<SendOutlined />}
              onClick={handleGenerate}
              loading={generating}
              disabled={!selectedModel || !prompt.trim() || !selectedModel.has_api_key}
              block
            >
              {generating ? '生成中...' : `生成视频 (${calculatePrice()} 积分)`}
            </Button>
          </div>
        </div>
      </Sider>

      {/* 右侧历史记录 */}
      <Content className="history-content">
        <div className="history-header">
          <Tabs activeKey={activeTab} onChange={handleTabChange}>
            <TabPane tab="我的视频" key="all" />
            <TabPane tab="我的收藏" key="favorites" />
            <TabPane tab="公开画廊" key="public" />
          </Tabs>
        </div>

        {/* 分页 */}
        {!loading && getCurrentData().length > 0 && (
          <div className="history-pagination">
            <Pagination
              current={currentPage}
              pageSize={pageSize}
              total={getCurrentPagination().total}
              onChange={handlePageChange}
              onShowSizeChange={handlePageChange}
              showSizeChanger
              showTotal={(total) => `共 ${total} 个视频`}
            />
          </div>
        )}

        <div className="history-grid">
          {loading ? (
            <div className="loading-container">
              <Spin size="large" />
            </div>
          ) : getCurrentData().length > 0 ? (
            getCurrentData().map(item => renderVideoCard(item, activeTab === 'public'))
          ) : (
            <Empty description="暂无视频" />
          )}
        </div>
      </Content>

      {/* 视频预览模态框 */}
      <Modal
        title={previewVideo?.prompt || '视频预览'}
        visible={!!previewVideo}
        onCancel={() => setPreviewVideo(null)}
        footer={null}
        width="90%"
        style={{ maxWidth: '1200px' }}
        centered
        bodyStyle={{ 
          padding: 0, 
          background: '#000',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '60vh'
        }}
      >
        {previewVideo && (
          <video
            src={previewVideo.local_path}
            controls
            autoPlay
            style={{ 
              width: '100%',
              maxHeight: '80vh',
              objectFit: isVerticalVideo(previewVideo.ratio) ? 'contain' : 'contain'
            }}
          />
        )}
      </Modal>
    </Layout>
  );
};

export default VideoGeneration;
