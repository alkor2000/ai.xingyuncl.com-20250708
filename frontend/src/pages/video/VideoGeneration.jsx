/**
 * 视频生成页面 - 支持首尾帧控制和模型名称显示
 *
 * v1.4 i18n补全:
 *   - 补全搜索框 placeholder（之前 key 缺失导致中英文都显示中文 fallback）
 *   - 清理零散硬编码中文：复制提示、生成成功提示、搜索结果条、Empty 文案、复制按钮 Tooltip
 *   - 搜索结果提示条改为纯文本（不再依赖 <strong> 加粗，避免 i18next 插值转义问题）
 *
 * v1.3 修复: 隐藏"尾帧图生视频"模式
 *   - 火山 doubao-seedance API 不支持单独 last_frame（"last frame image content cannot be mixed with first frame or reference image content"）
 *   - 实际可用模式: text_to_video / first_frame / first_last_frame
 *   - 前端从下拉选项移除 last_frame，配合 useEffect 兜底自动切换非法已选值
 *
 * v1.2 关键词搜索 + IME 保护 + 移动端响应式
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  Layout, Card, Input, Button, Space, Row, Col,
  Select, Switch, Tabs, Empty, Spin, Tag, message,
  Modal, Tooltip, Progress, Alert, Pagination, Popconfirm,
  Upload, Divider
} from 'antd';
import {
  VideoCameraOutlined, SendOutlined, ReloadOutlined,
  HeartOutlined, HeartFilled, DeleteOutlined, DownloadOutlined,
  EyeOutlined, GlobalOutlined, LockOutlined, ThunderboltOutlined,
  ClockCircleOutlined, FileImageOutlined, PlayCircleOutlined,
  PauseCircleOutlined, CheckCircleOutlined, CloseCircleOutlined,
  UploadOutlined, PlusOutlined, ExpandOutlined, PictureOutlined,
  RobotOutlined, CopyOutlined, SearchOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import useVideoStore from '../../stores/videoStore';
import useAuthStore from '../../stores/authStore';
import apiClient from '../../utils/api';
import './VideoGeneration.less';

const StudioLayout = React.lazy(() => import('./components/Studio/StudioLayout'));

/**
 * 两套布局并存：老师们用惯了左边那根参数栏，新版工作台是结果为主、输入在手边。
 *
 * **谁能看到新版，由服务端资格说了算**（GET /api/studio-pilot/capability?capability=video_studio）。
 * 下面这个值只是"有资格的人这台设备上次选了哪一套"的偏好——没资格时它一点作用都没有，
 * 改这个缺省字符串也开不了门。**图像的放行不等于视频的放行**，两个能力各问各的。
 */
const LAYOUT_KEY = 'video.layoutMode';
const readLayout = () => {
  try { return localStorage.getItem(LAYOUT_KEY) === 'classic' ? 'classic' : 'studio'; }
  catch { return 'studio'; }
};
const writeLayout = (mode) => { try { localStorage.setItem(LAYOUT_KEY, mode); } catch { /* 隐私模式下不记就是了 */ } };

const { Content, Sider } = Layout;
const { TextArea, Search } = Input;
const { TabPane } = Tabs;
const { Option } = Select;

const VideoGeneration = () => {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const {
    models, selectedModel, generating, generationProgress,
    generationHistory, historyPagination,
    publicGallery, galleryPagination,
    loading, userStats, processingTasks, taskSnapshots,
    keyword, setKeyword,
    getModels, selectModel, generateVideo,
    getUserHistory, getPublicGallery,
    deleteGeneration, toggleFavorite, togglePublic, getUserStats
  } = useVideoStore();

  const resolutionOptions = {
    '480p': { label: t('video.resolution480p'), width: 854, height: 480 },
    '720p': { label: t('video.resolution720p'), width: 1280, height: 720 },
    '1080p': { label: t('video.resolution1080p'), width: 1920, height: 1080 },
    '352x640': { label: t('video.resolution352x640'), width: 352, height: 640 },
    '640x352': { label: t('video.resolution640x352'), width: 640, height: 352 },
    '640x640': { label: t('video.resolution640x640'), width: 640, height: 640 }
  };

  const ratioOptions = [
    { label: t('video.ratio16_9'), value: '16:9' },
    { label: t('video.ratio4_3'), value: '4:3' },
    { label: t('video.ratio1_1'), value: '1:1' },
    { label: t('video.ratio3_4'), value: '3:4' },
    { label: t('video.ratio9_16'), value: '9:16' },
    { label: t('video.ratio21_9'), value: '21:9' }
  ];

  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [firstFrameImage, setFirstFrameImage] = useState('');
  const [firstFrameFile, setFirstFrameFile] = useState(null);
  const [lastFrameImage, setLastFrameImage] = useState('');
  const [lastFrameFile, setLastFrameFile] = useState(null);
  const [uploadingFirst, setUploadingFirst] = useState(false);
  const [uploadingLast, setUploadingLast] = useState(false);
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
  
  const [searchInput, setSearchInput] = useState(keyword || '');
  const isComposingRef = useRef(false);

  /* 这一页的新体验能不能用，只问服务端；问不到就当没有，留在经典视图 */
  const [pilot, setPilot] = useState({ available: false, message: null, checked: false });
  useEffect(() => {
    let alive = true;
    const fallback = setTimeout(() => {
      setPilot(prev => (prev.checked ? prev : { ...prev, available: false, checked: true }));
    }, 2000);
    apiClient.get('/studio-pilot/capability', { params: { capability: 'video_studio' } })
      .then(({ data }) => {
        if (!alive) return;
        const d = data?.data || {};
        setPilot({ available: d.available === true, message: d.message || null, checked: true });
      })
      .catch(() => { if (alive) setPilot({ available: false, message: null, checked: true }); })
      .finally(() => clearTimeout(fallback));
    return () => { alive = false; clearTimeout(fallback); };
  }, []);

  const [layoutMode, setLayoutMode] = useState(readLayout);
  const switchLayout = useCallback((mode) => { setLayoutMode(mode); writeLayout(mode); }, []);
  /* 窄屏只是摆得更紧，信息架构和桌面同一套 */
  const [compact, setCompact] = useState(() => window.innerWidth <= 1024);
  useEffect(() => {
    const onResize = () => setCompact(window.innerWidth <= 1024);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /**
   * 对话区只放"这一次打开以来做的"。
   *
   * 每一轮记提示词和这一轮真实拿到的 id；视频本身**由页面自己留一份**（turnItems），
   * 不去读图库那份切片——图库一切页签、一搜索、一翻页就换人，本轮结果不能跟着消失。
   * 状态靠下面那个 effect 从历史里按 id / task_id 认出来更新，认不出就保持原样。
   */
  const [turns, setTurns] = useState([]);
  const [turnItems, setTurnItems] = useState(() => new Map());


  const loadList = useCallback((tab, page, size, overrideKeyword) => {
    const k = overrideKeyword !== undefined ? overrideKeyword : keyword;
    const trimmed = (k || '').trim();
    
    const params = { page, limit: size };
    if (trimmed) {
      params.keyword = trimmed;
    }
    
    if (tab === 'public') {
      getPublicGallery(params);
    } else {
      if (tab === 'favorites') {
        params.is_favorite = true;
      }
      getUserHistory(params);
    }
  }, [keyword, getPublicGallery, getUserHistory]);

  useEffect(() => {
    getModels();
    getUserHistory({ page: 1, limit: pageSize });
    getUserStats();
  }, []);

  /**
   * v1.3 模型切换时，强制确保 generationMode 是合法的（不在隐藏列表中）
   * 隐藏的模式: last_frame（火山API不支持单独尾帧）
   */
  useEffect(() => {
    if (selectedModel) {
      setResolution(selectedModel.default_resolution || '720p');
      setDuration(selectedModel.default_duration || 5);
      setRatio(selectedModel.default_ratio || '16:9');
      
      /* v1.3 兜底: 如果当前 mode 是已隐藏的 last_frame，或模型不支持，强制回退到 text_to_video */
      if (generationMode === 'last_frame') {
        setGenerationMode('text_to_video');
      } else if (generationMode === 'first_frame' && !selectedModel.supports_first_frame) {
        setGenerationMode('text_to_video');
      } else if (generationMode === 'first_last_frame' && 
                 (!selectedModel.supports_first_frame || !selectedModel.supports_last_frame)) {
        setGenerationMode('text_to_video');
      }
    }
  }, [selectedModel]);

  const calculatePrice = () => {
    if (!selectedModel) return 0;
    const basePrice = selectedModel.base_price || 50;
    const priceConfig = selectedModel.price_config || {};
    const resolutionMultiplier = priceConfig.resolution_multiplier?.[resolution] || 1.0;
    const durationMultiplier = priceConfig.duration_multiplier?.[String(duration)] || 1.0;
    return Math.ceil(basePrice * resolutionMultiplier * durationMultiplier);
  };

  const handleModelChange = (modelId) => {
    const model = models.find(m => m.id === modelId);
    if (model) selectModel(model);
  };

  const handleFirstFrameUpload = async (info) => {
    const { file } = info;
    if (file.status === 'uploading') { setUploadingFirst(true); return; }
    if (file.status === 'done') {
      setUploadingFirst(false);
      if (file.response && file.response.success) {
        setFirstFrameImage(file.response.data.url);
        setFirstFrameFile(file);
        message.success(t('video.uploadSuccess', { type: t('video.firstFrame') }));
      } else {
        message.error(file.response?.message || t('video.uploadFailed', { type: t('video.firstFrame') }));
      }
    } else if (file.status === 'error') {
      setUploadingFirst(false);
      message.error(t('video.uploadFailed', { type: t('video.firstFrame') }));
    }
  };

  const handleLastFrameUpload = async (info) => {
    const { file } = info;
    if (file.status === 'uploading') { setUploadingLast(true); return; }
    if (file.status === 'done') {
      setUploadingLast(false);
      if (file.response && file.response.success) {
        setLastFrameImage(file.response.data.url);
        setLastFrameFile(file);
        message.success(t('video.uploadSuccess', { type: t('video.lastFrame') }));
      } else {
        message.error(file.response?.message || t('video.uploadFailed', { type: t('video.lastFrame') }));
      }
    } else if (file.status === 'error') {
      setUploadingLast(false);
      message.error(t('video.uploadFailed', { type: t('video.lastFrame') }));
    }
  };

  const customUploadRequest = async ({ file, onSuccess, onError }) => {
    const formData = new FormData();
    formData.append('image', file);
    try {
      const response = await apiClient.post('/video/upload-frame', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onSuccess(response.data, file);
    } catch (error) {
      // console 日志保留中文不影响界面
      console.error('上传失败:', error);
      onError(error);
    }
  };

  const beforeUpload = (file) => {
    const isImage = file.type.startsWith('image/');
    if (!isImage) { message.error(t('video.onlyImage')); return false; }
    const isLt10M = file.size / 1024 / 1024 < 10;
    if (!isLt10M) { message.error(t('video.imageSizeLimit')); return false; }
    return true;
  };

  const handleRemoveFirstImage = () => { setFirstFrameImage(''); setFirstFrameFile(null); };
  const handleRemoveLastImage = () => { setLastFrameImage(''); setLastFrameFile(null); };

  // v1.4 复制提示词：成功/失败提示走 i18n
  const handleCopyPrompt = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      message.success(t('video.promptCopied'));
    }).catch(() => {
      message.error(t('video.copyFailed'));
    });
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) { message.warning(t('video.pleaseInputPrompt')); return; }
    if (!selectedModel) { message.warning(t('video.pleaseSelectModel')); return; }
    if (!selectedModel.has_api_key) { message.error(t('video.modelNotConfigured')); return; }

    if (generationMode === 'first_frame' && !firstFrameImage) {
      message.warning(t('video.pleaseUploadFirstFrame')); return;
    }
    if (generationMode === 'last_frame' && !lastFrameImage) {
      message.warning(t('video.pleaseUploadLastFrame')); return;
    }
    if (generationMode === 'first_last_frame') {
      if (!firstFrameImage || !lastFrameImage) {
        message.warning(t('video.pleaseUploadBothFrames')); return;
      }
    }

    const price = calculatePrice();
    if (user.credits_stats && user.credits_stats.remaining < price) {
      message.error(t('video.insufficientCredits', { 
        required: price, current: user.credits_stats.remaining 
      }));
      return;
    }

    const params = {
      prompt: prompt.trim(),
      negative_prompt: negativePrompt.trim(),
      generation_mode: generationMode,
      resolution, duration, ratio,
      seed: seed === -1 ? undefined : seed,
      watermark, camera_fixed: cameraFixed
    };
    
    if (generationMode === 'first_frame' || generationMode === 'first_last_frame') {
      params.first_frame_image = firstFrameImage;
    }
    if (generationMode === 'last_frame' || generationMode === 'first_last_frame') {
      params.last_frame_image = lastFrameImage;
    }

    const promptOfTurn = prompt.trim();
    const result = await generateVideo(params);

    if (result) {
      /* 先按响应登记这一轮，再让图库自己去刷新；顺序反过来也不影响判定 */
      registerTurn(promptOfTurn, result);
      if (keyword || searchInput) {
        setKeyword('');
        setSearchInput('');
      }
      setCurrentPage(1);
      if (activeTab !== 'all') {
        setActiveTab('all');
      }
      // v1.4 生成成功提示走 i18n
      message.success(t('video.submitSuccess'));
    }
  };

  /**
   * 这一轮算哪一条，只认 /video/generate 的响应：generationId（必要时配 taskId）。
   * 视频天然是异步任务，提交时还没有片子，所以先挂一条"排队中"。
   * **绝不拿刷新后历史的前 N 条当本轮产出**——那在部分失败或刚提交时会把上一次的旧视频算进来。
   */
  const registerTurn = useCallback((promptOfTurn, result) => {
    const id = result?.generationId ?? result?.generation_id ?? result?.id ?? null;
    if (id === null || id === undefined) return;      // 没拿到真实 id 就不登记，也不猜
    const seed = {
      id, prompt: promptOfTurn, status: 'queued', progress: 0,
      task_id: result?.taskId ?? result?.task_id ?? null
    };
    setTurnItems(prev => { const next = new Map(prev); next.set(id, seed); return next; });
    setTurns(prev => [...prev, {
      key: `${Date.now()}-${id}`, prompt: promptOfTurn, at: Date.now(), ids: [id],
      taskId: seed.task_id
    }]);
  }, []);

  /**
   * 本轮状态从两处收：历史列表，和**与图库切片无关的任务快照**。
   *
   * 只靠历史是不够的：轮询只能 map 当前那份 generationHistory，用户一搜索或翻页，
   * 这一条就不在列表里了，完成时带回来的 local_path 会跟着丢，轮次永远停在排队中。
   * 快照由同一条轮询顺手写下（没有新增任何请求），所以搜索/翻页之后也能正常收尾。
   * 两边都只更新、不删除。
   */
  useEffect(() => {
    if (turnItems.size === 0) return;
    setTurnItems(prev => {
      let next = null;
      const put = (id, patch) => {
        const known = (next || prev).get(id);
        if (!known) return;
        if (known.status === patch.status && known.progress === patch.progress
          && known.local_path === patch.local_path && known.error_message === patch.error_message) return;
        next = next || new Map(prev);
        next.set(id, { ...known, ...patch, id });
      };
      for (const fresh of generationHistory) {
        const known = prev.get(fresh.id)
          || (fresh.task_id ? [...prev.values()].find(v => v.task_id && v.task_id === fresh.task_id) : null);
        if (known) put(known.id, fresh);
      }
      for (const snap of Object.values(taskSnapshots || {})) {
        const known = (snap.generationId !== undefined && prev.get(snap.generationId))
          || [...prev.values()].find(v => v.task_id && v.task_id === snap.taskId);
        if (known) put(known.id, snap);
      }
      return next || prev;
    });
  }, [generationHistory, taskSnapshots, turnItems]);

  /* 图库里删掉的，对话区也不再显示 */
  const forgetInTurns = useCallback((id) => {
    setTurnItems(prev => { if (!prev.has(id)) return prev; const next = new Map(prev); next.delete(id); return next; });
    setTurns(prev => prev
      .map(turn => (turn.ids.includes(id) ? { ...turn, ids: turn.ids.filter(x => x !== id) } : turn))
      .filter(turn => turn.ids.length > 0));
  }, []);

  const handleTabChange = (key) => {
    setActiveTab(key);
    setCurrentPage(1);
    loadList(key, 1, pageSize);
  };

  const handlePageChange = (page, size) => {
    setCurrentPage(page);
    setPageSize(size);
    loadList(activeTab, page, size);
  };

  const handleSearch = useCallback((value) => {
    if (isComposingRef.current) return;
    
    const newKeyword = (value || '').trim();
    setKeyword(newKeyword);
    setSearchInput(newKeyword);
    setCurrentPage(1);
    loadList(activeTab, 1, pageSize, newKeyword);
  }, [activeTab, pageSize, setKeyword, loadList]);

  const isVerticalVideo = (ratio) => {
    if (!ratio) return false;
    const ratioStr = ratio.toString();
    return ratioStr === '3:4' || ratioStr === '9:16' || ratioStr === '2:3';
  };

  const getVideoObjectFit = (item) => {
    if (isVerticalVideo(item.ratio)) return 'contain';
    return 'cover';
  };

  const handlePreviewVideo = (item) => setPreviewVideo(item);

  const handleVideoLoadedMetadata = (e) => {
    const video = e.target;
    const previewTime = Math.min(0.5, video.duration * 0.1);
    video.currentTime = previewTime;
  };

  const getProviderColor = (provider) => {
    const colorMap = {
      'volcano': 'volcano', 'kling': 'purple',
      'midjourney': 'geekblue', 'stable': 'green',
      'runway': 'cyan', 'pika': 'magenta',
      'sora': 'gold', 'sora2_goapi': 'gold'
    };
    return colorMap[provider] || 'default';
  };

  const renderVideoCard = (item, isGallery = false) => {
    const isOwner = !isGallery || item.user_id === user?.id;
    const isProcessing = item.status === 'submitted' || item.status === 'queued' || item.status === 'running';
    const isFailed = item.status === 'failed';
    const isSucceeded = item.status === 'succeeded';
    const videoKey = `video-${item.id}-${item.local_path || 'no-path'}-${item.status}`;
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
                <div className="processing-text">{t('video.processing')}</div>
                {item.progress > 0 && (<Progress percent={item.progress} showInfo={false} />)}
              </div>
            ) : isFailed ? (
              <div className="failed-overlay">
                <CloseCircleOutlined style={{ fontSize: 48, color: '#ff4d4f' }} />
                <div className="failed-text">{t('video.failed')}</div>
                {item.error_message && (<div className="error-message">{item.error_message}</div>)}
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
                    width: '100%', height: '200px',
                    objectFit: videoObjectFit, backgroundColor: '#000'
                  }}
                  onLoadedMetadata={handleVideoLoadedMetadata}
                />
                <Tooltip title={t('video.fullscreenPreview')}>
                  <Button
                    type="text"
                    icon={<ExpandOutlined />}
                    onClick={() => handlePreviewVideo(item)}
                    style={{
                      position: 'absolute', bottom: 45, right: 10,
                      background: 'rgba(0, 0, 0, 0.5)',
                      color: 'white', border: 'none'
                    }}
                  />
                </Tooltip>
              </div>
            ) : (
              <div className="no-video">
                <VideoCameraOutlined style={{ fontSize: 48, color: '#999' }} />
              </div>
            )}
            
            {isOwner && (
              <div className="video-actions">
                <Space direction="vertical" size="small">
                  {isSucceeded && item.local_path && (
                    <Tooltip title={t('video.download')} placement="left">
                      <Button
                        type="primary" shape="circle" size="small"
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
                  {(isSucceeded || isFailed) && (
                    <Tooltip title={item.is_favorite ? t('video.unfavorite') : t('video.favorite')} placement="left">
                      <Button
                        type="primary" shape="circle" size="small"
                        icon={item.is_favorite ? <HeartFilled /> : <HeartOutlined />}
                        danger={item.is_favorite}
                        onClick={(e) => { e.stopPropagation(); toggleFavorite(item.id); }}
                      />
                    </Tooltip>
                  )}
                  {isSucceeded && (
                    <Tooltip title={item.is_public ? t('video.setPrivate') : t('video.setPublic')} placement="left">
                      <Button
                        type="primary" shape="circle" size="small"
                        icon={item.is_public ? <GlobalOutlined /> : <LockOutlined />}
                        style={{ background: item.is_public ? '#52c41a' : undefined }}
                        onClick={(e) => { e.stopPropagation(); togglePublic(item.id); }}
                      />
                    </Tooltip>
                  )}
                  <Popconfirm
                    title={t('video.confirmDelete')}
                    onConfirm={async (e) => {
                      if (e) e.stopPropagation();
                      /* 删成功了才从本轮摘掉；后端拒了或抛了，这一轮照样留着 */
                      const removed = await deleteGeneration(item.id);
                      if (removed) forgetInTurns(item.id);
                    }}
                    onCancel={(e) => { if (e) e.stopPropagation(); }}
                    okText={t('common.confirm')}
                    cancelText={t('common.cancel')}
                    placement="left"
                  >
                    <Tooltip title={t('video.delete')} placement="left">
                      <Button danger shape="circle" size="small"
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
              {item.model_name && (
                <Tooltip title={`${t('video.generatedBy')}: ${item.model_name}`}>
                  <Tag icon={<RobotOutlined />} color={getProviderColor(item.provider)}
                    style={{ marginBottom: 4 }}>
                    {item.model_name}
                  </Tag>
                </Tooltip>
              )}
              <Tag color="blue">{item.resolution}</Tag>
              <Tag>{item.duration}{t('video.seconds')}</Tag>
              {item.ratio && <Tag color={isVertical ? 'purple' : 'cyan'}>{item.ratio}</Tag>}
              {isFailed && <Tag color="error">{t('video.status.failed')}</Tag>}
              {isProcessing && <Tag color="processing">{t('video.processingText')}</Tag>}
              {isSucceeded && <Tag color="success">{t('video.completed')}</Tag>}
            </div>
          }
          description={
            <div className="card-meta-description">
              <div className="prompt-text-container">
                <Tooltip title={item.prompt} placement="topLeft">
                  <span className="prompt-text-content">{item.prompt}</span>
                </Tooltip>
                <Tooltip title={t('video.copyPrompt')}>
                  <Button
                    type="text" size="small"
                    icon={<CopyOutlined />}
                    className="copy-button"
                    onClick={(e) => { e.stopPropagation(); handleCopyPrompt(item.prompt); }}
                  />
                </Tooltip>
              </div>
              <div className="meta-info">
                {isGallery && item.username && (<span>{item.username}</span>)}
                <span>{new Date(item.created_at).toLocaleString()}</span>
                {item.credits_consumed !== undefined && (
                  <span>{t('video.credits', { credits: item.credits_consumed })}</span>
                )}
              </div>
            </div>
          }
        />
      </Card>
    );
  };

  const getCurrentData = () => {
    if (activeTab === 'public') return publicGallery;
    return generationHistory;
  };

  const getCurrentPagination = () => {
    if (activeTab === 'public') return galleryPagination;
    return historyPagination;
  };

  const firstFrameUploadButton = (
    <div>
      {uploadingFirst ? <Spin /> : <PlusOutlined />}
      <div style={{ marginTop: 8 }}>
        {uploadingFirst ? t('video.uploading') : t('video.uploadFirst')}
      </div>
    </div>
  );
  
  const lastFrameUploadButton = (
    <div>
      {uploadingLast ? <Spin /> : <PlusOutlined />}
      <div style={{ marginTop: 8 }}>
        {uploadingLast ? t('video.uploading') : t('video.uploadLast')}
      </div>
    </div>
  );

  const getFilteredRatioOptions = () => {
    if (!selectedModel || !selectedModel.ratios_supported) return ratioOptions;
    return ratioOptions.filter(opt => selectedModel.ratios_supported.includes(opt.value));
  };

  const shouldShowAdvancedControls = () => {
    return selectedModel && selectedModel.provider !== 'sora2_goapi';
  };

  const isSearchActive = keyword && keyword.trim().length > 0;
  const currentTotal = activeTab === 'public' ? galleryPagination.total : historyPagination.total;

  /**
   * 参数区只写一份，经典视图的左栏和新版工作台的抽屉共用。
   *
   * 刻意**不搬到别的文件**：这些 JSX 依赖组件里的十几个 state 与处理函数，
   * 搬家最容易把外层作用域里的东西漏在原地（图像那边就是这么白屏的）。
   * 留在本组件里只是起个名字，闭包一个都不会丢。
   */
  const modeCard = (
          <Card title={t('video.generationMode')}>
            <Select value={generationMode} onChange={setGenerationMode} style={{ width: '100%' }}>
              <Option value="text_to_video" disabled={!selectedModel?.supports_text_to_video}>
                <Space><VideoCameraOutlined /><span>{t('video.modeTextToVideo')}</span></Space>
              </Option>
              <Option value="first_frame" disabled={!selectedModel?.supports_first_frame}>
                <Space><PictureOutlined /><span>{t('video.modeFirstFrame')}</span></Space>
              </Option>
              {/* v1.3 隐藏单独 last_frame 选项（火山 API: last frame image content cannot be mixed with first frame or reference image content） */}
              <Option value="first_last_frame" 
                disabled={!selectedModel?.supports_first_frame || !selectedModel?.supports_last_frame}>
                <Space><FileImageOutlined /><span>{t('video.modeFirstLastFrame')}</span></Space>
              </Option>
            </Select>
            {generationMode === 'first_frame' && (
              <Alert message={t('video.firstFrameDesc')} type="info" showIcon style={{ marginTop: 10 }}/>
            )}
            {generationMode === 'first_last_frame' && (
              <Alert message={t('video.firstLastFrameDesc')} type="info" showIcon style={{ marginTop: 10 }}/>
            )}
          </Card>
  );
  const frameUploaders = (
    <>
            {(generationMode === 'first_frame' || generationMode === 'first_last_frame') && (
              <div style={{ marginTop: 16 }}>
                <div style={{ marginBottom: 8, fontWeight: 500 }}>
                  <PictureOutlined /> {t('video.firstFrameImage')}
                </div>
                <Upload
                  name="image" listType="picture-card" className="frame-uploader"
                  showUploadList={false}
                  customRequest={customUploadRequest}
                  beforeUpload={beforeUpload}
                  onChange={handleFirstFrameUpload}
                >
                  {firstFrameImage ? (
                    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                      <img src={firstFrameImage} alt={t('video.firstFrame')} 
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
                      <Button type="text" danger icon={<DeleteOutlined />}
                        onClick={(e) => { e.stopPropagation(); handleRemoveFirstImage(); }}
                        style={{ position: 'absolute', top: 0, right: 0, background: 'rgba(255,255,255,0.8)' }}/>
                    </div>
                  ) : firstFrameUploadButton}
                </Upload>
              </div>
            )}
            
            {/* v1.3 尾帧上传仅在 first_last_frame 模式下显示（不再有单独 last_frame 模式） */}
            {generationMode === 'first_last_frame' && (
              <div style={{ marginTop: 16 }}>
                <div style={{ marginBottom: 8, fontWeight: 500 }}>
                  <PictureOutlined /> {t('video.lastFrameImage')}
                </div>
                <Upload
                  name="image" listType="picture-card" className="frame-uploader"
                  showUploadList={false}
                  customRequest={customUploadRequest}
                  beforeUpload={beforeUpload}
                  onChange={handleLastFrameUpload}
                >
                  {lastFrameImage ? (
                    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                      <img src={lastFrameImage} alt={t('video.lastFrame')}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
                      <Button type="text" danger icon={<DeleteOutlined />}
                        onClick={(e) => { e.stopPropagation(); handleRemoveLastImage(); }}
                        style={{ position: 'absolute', top: 0, right: 0, background: 'rgba(255,255,255,0.8)' }}/>
                    </div>
                  ) : lastFrameUploadButton}
                </Upload>
              </div>
            )}
            
            {(generationMode !== 'text_to_video') && (
              <div style={{ fontSize: 12, color: '#999', marginTop: 8 }}>
                {t('video.imageFormatTip')}
              </div>
            )}
    </>
  );
  const parameterCards = (
          <Card title={t('video.parameters')}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <div>
                <div className="param-label">{t('video.resolution')}</div>
                <Select value={resolution} onChange={setResolution} style={{ width: '100%' }}>
                  {selectedModel?.resolutions_supported?.map(res => (
                    <Option key={res} value={res}>
                      {resolutionOptions[res]?.label || res}
                    </Option>
                  ))}
                </Select>
              </div>
              <div>
                <div className="param-label">{t('video.duration')}</div>
                <Select value={duration} onChange={setDuration} style={{ width: '100%' }}>
                  {selectedModel?.durations_supported?.map(dur => (
                    <Option key={dur} value={dur}>{dur} {t('video.seconds')}</Option>
                  ))}
                </Select>
              </div>
              <div>
                <div className="param-label">{t('video.aspectRatio')}</div>
                <Select value={ratio} onChange={setRatio} style={{ width: '100%' }}>
                  {getFilteredRatioOptions().map(opt => (
                    <Option key={opt.value} value={opt.value}>{opt.label}</Option>
                  ))}
                </Select>
              </div>
              {shouldShowAdvancedControls() && (
                <Row gutter={16}>
                  <Col span={12}>
                    <Switch checked={watermark} onChange={setWatermark}
                      checkedChildren={t('video.withWatermark')}
                      unCheckedChildren={t('video.noWatermark')}/>
                  </Col>
                  <Col span={12}>
                    <Switch checked={cameraFixed} onChange={setCameraFixed}
                      checkedChildren={t('video.fixedCamera')}
                      unCheckedChildren={t('video.movingCamera')}/>
                  </Col>
                </Row>
              )}
            </Space>
          </Card>

  );
  /* 新版工作台抽屉里按顺序放：模式 → 首尾帧 → 参数 */
  const studioParameterPanel = (
    <>
      {modeCard}
      <div style={{ marginTop: 16 }}>{frameUploaders}</div>
      <div style={{ marginTop: 16 }}>{parameterCards}</div>
    </>
  );

  /* 两套视图共用同一份数据与处理函数：新版只是换个摆法 */
  const composerProps = {
    models, selectedModel, onModelChange: handleModelChange,
    prompt, onPromptChange: setPrompt, onGenerate: handleGenerate, generating,
    price: calculatePrice(), resolution, duration, ratio, generationMode,
    frameCount: (firstFrameImage ? 1 : 0) + (lastFrameImage ? 1 : 0),
    parameterPanel: studioParameterPanel
  };
  const galleryProps = {
    t, activeTab, onTabChange: handleTabChange, searchInput, onSearchInput: setSearchInput,
    onSearch: handleSearch, isComposingRef, loading, isSearchActive, keyword, currentTotal,
    items: getCurrentData(), currentPage, pageSize, total: getCurrentPagination().total,
    onPageChange: handlePageChange, renderCard: renderVideoCard
  };

  /* 有资格才谈偏好；没资格、没装配、查不到，都走经典视图 */
  const studioAllowed = pilot.available === true;
  if (!pilot.checked) {
    return <div className="loading-container"><Spin size="large" /></div>;
  }

  if (studioAllowed && layoutMode === 'studio') {
    return (
      <React.Suspense fallback={<div className="loading-container"><Spin size="large" /></div>}>
        <StudioLayout
          t={t} compact={compact} onExitStudio={() => switchLayout('classic')}
          composer={composerProps} galleryProps={galleryProps}
          turns={turns} turnItems={turnItems}
          onRerun={(text) => setPrompt(text)} onOpen={handlePreviewVideo}
        />
        <Modal
          title={previewVideo?.prompt || t('video.videoPreview')}
          open={!!previewVideo} onCancel={() => setPreviewVideo(null)} footer={null}
          width="90%" style={{ maxWidth: '1200px' }} centered
          bodyStyle={{ padding: 0, background: '#000', display: 'flex',
            justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}
        >
          {previewVideo && (
            <video src={previewVideo.local_path} controls autoPlay
              style={{ width: '100%', maxHeight: '80vh', objectFit: 'contain' }} />
          )}
        </Modal>
      </React.Suspense>
    );
  }

  return (
    <Layout className="video-generation-page">
      <Sider width={380} className="generation-sider" theme="light">
        <div className="generation-container">
          {/* 入口也要过同一个门：没资格的人看不到，也切不过去 */}
          {studioAllowed && (
            <Button size="small" type="text" className="studio-switch" onClick={() => switchLayout('studio')}
              data-testid="classic-to-studio">{t('video.studio.tryStudio')}</Button>
          )}
          <Card title={t('video.selectModel')} className="model-selection">
            <Select
              className="model-select"
              placeholder={t('video.selectModelPlaceholder')}
              value={selectedModel?.id}
              onChange={handleModelChange}
              style={{ width: '100%' }}
            >
              {models.map(model => (
                <Option key={model.id} value={model.id}>
                  <Space>
                    <VideoCameraOutlined />
                    <span>{model.display_name}</span>
                    {!model.has_api_key && (<Tag color="orange">{t('video.notConfigured')}</Tag>)}
                  </Space>
                </Option>
              ))}
            </Select>
            {selectedModel && (
              <div className="model-info">
                <p>{selectedModel.description}</p>
                <Space wrap>
                  {selectedModel.supports_text_to_video && <Tag color="green">{t('video.textToVideo')}</Tag>}
                  {selectedModel.supports_first_frame && <Tag color="blue">{t('video.firstFrameToVideo')}</Tag>}
                  {/* v1.3 隐藏单独尾帧标签（火山不支持单独 last_frame） */}
                  {selectedModel.supports_first_frame && selectedModel.supports_last_frame && 
                    <Tag color="purple">{t('video.firstLastFrameToVideo')}</Tag>}
                </Space>
              </div>
            )}
          </Card>

          {modeCard}

          <Card title={t('video.inputPrompt')}>
            <TextArea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t('video.promptPlaceholder')}
              rows={4}
              maxLength={selectedModel?.max_prompt_length || 500}
              showCount
            />
            
            {frameUploaders}
          </Card>

          {parameterCards}
          <div className="generate-button-section">
            <Button
              type="primary" size="large"
              icon={<SendOutlined />}
              onClick={handleGenerate}
              loading={generating}
              disabled={!selectedModel || !prompt.trim() || !selectedModel.has_api_key}
              block
            >
              {generating 
                ? t('video.generating') 
                : `${t('video.generate')} (${t('video.credits', { credits: calculatePrice() })})`}
            </Button>
          </div>
        </div>
      </Sider>

      <Content className="history-content">
        <div className="history-header">
          <Tabs activeKey={activeTab} onChange={handleTabChange} className="history-tabs">
            <TabPane tab={t('video.myVideos')} key="all" />
            <TabPane tab={t('video.myFavorites')} key="favorites" />
            <TabPane tab={t('video.publicGallery')} key="public" />
          </Tabs>
          <Search
            className="history-search"
            placeholder={t('video.searchPlaceholder')}
            allowClear
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onSearch={handleSearch}
            onCompositionStart={() => { isComposingRef.current = true; }}
            onCompositionEnd={() => { isComposingRef.current = false; }}
            enterButton={<SearchOutlined />}
            maxLength={100}
          />
        </div>

        {!loading && isSearchActive && (
          <div className="search-result-tip">
            {currentTotal > 0
              ? <span>{t('video.searchFound', { count: currentTotal, keyword })}</span>
              : <span>{t('video.searchNoMatch', { keyword })}</span>
            }
          </div>
        )}

        {!loading && getCurrentData().length > 0 && (
          <div className="history-pagination">
            <Pagination
              current={currentPage}
              pageSize={pageSize}
              total={getCurrentPagination().total}
              onChange={handlePageChange}
              onShowSizeChange={handlePageChange}
              showSizeChanger
              showTotal={(total) => t('video.total', { total })}
            />
          </div>
        )}

        <div className="history-grid">
          {loading ? (
            <div className="loading-container"><Spin size="large" /></div>
          ) : getCurrentData().length > 0 ? (
            getCurrentData().map(item => renderVideoCard(item, activeTab === 'public'))
          ) : (
            <Empty description={isSearchActive ? t('video.searchNoVideo', { keyword }) : t('video.noVideos')} />
          )}
        </div>
      </Content>

      <Modal
        title={previewVideo?.prompt || t('video.videoPreview')}
        visible={!!previewVideo}
        onCancel={() => setPreviewVideo(null)}
        footer={null}
        width="90%"
        style={{ maxWidth: '1200px' }}
        centered
        bodyStyle={{ 
          padding: 0, background: '#000',
          display: 'flex', justifyContent: 'center', alignItems: 'center',
          minHeight: '60vh'
        }}
      >
        {previewVideo && (
          <video
            src={previewVideo.local_path}
            controls autoPlay
            style={{ 
              width: '100%', maxHeight: '80vh',
              objectFit: isVerticalVideo(previewVideo.ratio) ? 'contain' : 'contain'
            }}
          />
        )}
      </Modal>
    </Layout>
  );
};

export default VideoGeneration;
