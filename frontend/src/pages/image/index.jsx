/**
 * 图像生成页面
 *
 * ===== v1.4 国际化收尾 =====
 *
 * 1. 移除全部 19 处 t() 的中文兜底第二参数。
 *    该页面的键此前经核对全部真实存在，兜底参数虽未造成显示错误，
 *    但会掩盖将来键被误删/改名的问题，因此按规约统一剥离。
 *
 * 2. 不翻译的内容：图片提示词、模型名、用户名等业务数据。
 *
 * ===== v1.4 附带的技术债收敛（行为零变化）=====
 *
 * 原代码在 getBestImageUrl 与 handleViewImage 中共出现 3 次硬编码域名
 * 'https://ai.xingyuncl.com'。现提取为模块级常量 IMAGE_HOST，
 * 取值完全不变、行为完全一致，仅把 3 个改动点收敛为 1 个。
 *
 * 2026-09-14：IMAGE_HOST 取 window.location.origin（与 MindmapShare 分享链接一致），
 * 因为同一份代码同时部署在 ai.xingyuncl.com 与 ai.pkuailab.com；相对路径补全到访问者所在站点。
 *
 * ===== 已知遗留（本次不动）=====
 * Tabs 的 TabPane 子组件写法在 Antd v5 已废弃（建议改 items 属性），
 * 改造会影响 Tab 结构与样式，需单独验证，故本次保留。
 *
 * ===== 原有功能说明（逻辑未变更）=====
 * - IME 输入法保护：中文拼写态下回车不触发搜索
 * - 生成成功后清空搜索框并切回"我的图片"，避免新图被过滤掉看不见
 * - 搜索结果计数提示
 */

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Layout, Button, Space, Tabs, Empty, Spin, Pagination, Modal, message, Input } from 'antd';
import {
  ReloadOutlined,
  AppstoreOutlined,
  UnorderedListOutlined,
  GlobalOutlined,
  SearchOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

import useImageStore from '../../stores/imageStore';
import useAuthStore from '../../stores/authStore';

import { useImageGeneration } from './hooks/useImageGeneration';
import { useImageUpload } from './hooks/useImageUpload';
import { usePagination } from './hooks/usePagination';

import ModelSelector from './components/GenerationPanel/ModelSelector';
import PromptInput from './components/GenerationPanel/PromptInput';
import ImageCard from './components/ImageGallery/ImageCard';
import ImageViewer from '../../components/common/ImageViewer';

import { TAB_KEYS, VIEW_MODES, ACTION_LABELS } from './utils/constants';
import { isMidjourneyModel } from './utils/imageHelpers';

import './ImageGeneration.less';

const { Content, Sider } = Layout;
const { TabPane } = Tabs;
const { Search } = Input;

/**
 * 图片资源域名前缀
 * 用于把后端返回的相对路径（如 /uploads/xxx.png）补全为可访问的绝对地址。
 *
 * 【技术债】此处为硬编码，更换域名或多域名部署时需要改代码。
 * 理想实现是 window.location.origin，但属业务行为变更，待确认后再调整。
 * 当前提取为单一常量，是为了让将来的修改只需动这一行。
 */
// 2026-09-14 起取当前站点 origin：同一份代码同时部署在 ai.xingyuncl.com 与 ai.pkuailab.com，相对路径补全到访问者所在站点
const IMAGE_HOST = window.location.origin;

/* 搜索关键词最大长度，与后端 normalizeKeyword 的截断长度保持一致 */
const SEARCH_MAX_LENGTH = 100;

const ParameterPanel = React.lazy(() => import('./components/GenerationPanel/ParameterSettings'));
const StudioLayout = React.lazy(() => import('./components/Studio/StudioLayout'));
import GallerySection from './components/Studio/GallerySection';

/**
 * 两套布局并存的唯一理由：老师们已经用惯了左边那根参数栏。
 * 新来的默认进「工作台」（结果为主、输入在手边），想回去随时切，偏好只记在这台设备上。
 */
const LAYOUT_KEY = 'image.layoutMode';
const readLayout = () => {
  try { return localStorage.getItem(LAYOUT_KEY) === 'classic' ? 'classic' : 'studio'; }
  catch { return 'studio'; }
};
const writeLayout = (mode) => { try { localStorage.setItem(LAYOUT_KEY, mode); } catch { /* 隐私模式下不记就是了 */ } };
const MidjourneyActions = React.lazy(() => import('./components/ImageGallery/MidjourneyActions'));

const ImageGeneration = () => {
  const { t } = useTranslation();
  const { user } = useAuthStore();

  const {
    generationHistory,
    historyPagination,
    publicGallery,
    galleryPagination,
    loading,
    processingTasks,
    keyword,
    setKeyword,
    getUserHistory,
    getPublicGallery,
    deleteGeneration,
    toggleFavorite,
    togglePublic,
    getUserStats,
    midjourneyAction,
    cleanupFailedTasks
  } = useImageStore();

  const generation = useImageGeneration();
  const upload = useImageUpload();
  const historyPaging = usePagination();
  const publicPaging = usePagination();

  /**
   * 对话区只放"这一次打开以来生成的"。
   * 这里只记每一轮的提示词和产出的 id，图本身仍然回查历史里的实时条目——
   * Midjourney 那种先排队后出图的，状态会自己跟着更新，不需要另存一份可能过期的副本。
   */
  const [turns, setTurns] = useState([]);

  const [layoutMode, setLayoutMode] = useState(readLayout);
  /* 窄屏只是"摆得更紧"，信息架构和桌面是同一套 */
  const [compact, setCompact] = useState(() => window.innerWidth <= 1024);
  useEffect(() => {
    const onResize = () => setCompact(window.innerWidth <= 1024);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const switchLayout = useCallback((mode) => { setLayoutMode(mode); writeLayout(mode); }, []);

  const [viewMode, setViewMode] = useState(VIEW_MODES.GRID);
  const [activeTab, setActiveTab] = useState(TAB_KEYS.ALL);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerImages, setViewerImages] = useState([]);
  const [viewerInitialIndex, setViewerInitialIndex] = useState(0);

  /* 搜索框本地输入值（与 store 的 keyword 分离，避免每次输入都触发查询） */
  const [searchInput, setSearchInput] = useState(keyword || '');

  /**
   * IME 输入法保护：跟踪中文输入法的拼写态
   * 用 ref 而非 state，因为该值仅用于事件判断，不需要触发渲染
   */
  const isComposingRef = useRef(false);

  /**
   * 根据当前 Tab、分页、关键词组装查询参数
   * @param {object} extra 额外参数（如 page/limit）
   * @param {string} [overrideKeyword] 显式覆盖关键词，用于 setState 异步未生效的场景
   */
  const buildQueryParams = useCallback((extra = {}, overrideKeyword) => {
    const params = { ...extra };
    const kw = (overrideKeyword !== undefined ? overrideKeyword : keyword) || '';
    const trimmed = kw.trim();
    if (trimmed) {
      params.keyword = trimmed;
    }
    return params;
  }, [keyword]);

  /* 按 Tab 分发到对应的列表接口并刷新 */
  const reloadCurrentTab = useCallback((tab, page = 1, limit = null, overrideKeyword) => {
    if (tab === TAB_KEYS.PUBLIC) {
      const size = limit || publicPaging.pageSize;
      const params = buildQueryParams({ page, limit: size }, overrideKeyword);
      getPublicGallery(params);
    } else {
      const size = limit || historyPaging.pageSize;
      const params = buildQueryParams({ page, limit: size }, overrideKeyword);
      if (tab === TAB_KEYS.FAVORITES) {
        params.is_favorite = true;
      }
      getUserHistory(params);
    }
  }, [buildQueryParams, getPublicGallery, getUserHistory, publicPaging.pageSize, historyPaging.pageSize]);

  /* 初始化：加载历史 + 清理残留的失败任务状态 + 拉取统计 */
  useEffect(() => {
    getUserHistory({ page: 1, limit: historyPaging.pageSize }).then(() => {
      cleanupFailedTasks();
    });
    getUserStats();
  }, []);

  /**
   * 生成图片
   * 成功后清空搜索框并切回"我的图片"，否则新生成的图会被关键词过滤掉，
   * 用户会误以为生成失败。
   */
  const handleGenerate = useCallback(async () => {
    const promptOfTurn = generation.prompt.trim();
    const result = await generation.handleGenerate(upload.referenceImages);
    if (result) {
      if (isMidjourneyModel(generation.selectedModel)) {
        upload.clearReferenceImages();
      }

      if (keyword || searchInput) {
        setKeyword('');
        setSearchInput('');
      }

      historyPaging.setCurrentPage(1);
      if (activeTab !== TAB_KEYS.ALL) {
        setActiveTab(TAB_KEYS.ALL);
      }
      const refreshed = await getUserHistory({ page: 1, limit: historyPaging.pageSize });
      /* 刚刷出来的最前面那几条就是这一轮的产出（Midjourney 一次一条，内含四宫格） */
      const expected = isMidjourneyModel(generation.selectedModel) ? 1 : (generation.quantity || 1);
      const ids = (refreshed?.data || []).slice(0, expected).map(item => item.id);
      if (ids.length > 0) {
        setTurns(prev => [...prev, { key: `${Date.now()}`, prompt: promptOfTurn, at: Date.now(), ids }]);
      }
    }
  }, [generation, upload, historyPaging, getUserHistory, keyword, searchInput, setKeyword, activeTab]);

  /**
   * 生成 Midjourney 操作的确认文案
   *
   * ACTION_LABELS[action] 返回 { type, index } 或返回该结构的函数：
   *   - UPSCALE / VARIATION 是函数 (index) => ({ type, index })
   *   - REROLL 是对象 { type: 'reroll' }
   * 再按 type 映射到语言包：
   *   upscaleIndex   -> image.action.upscaleIndex   放大第N张 / Upscale #N
   *   variationIndex -> image.action.variationIndex 变体第N张 / Variation #N
   *   reroll         -> image.action.reroll         重新生成 / Reroll
   */
  const buildActionLabel = useCallback((action, index) => {
    const def = ACTION_LABELS[action];
    const resolved = typeof def === 'function' ? def(index) : def;
    if (!resolved || !resolved.type) {
      return '';
    }
    if (resolved.type === 'reroll') {
      return t('image.action.reroll');
    }
    if (resolved.type === 'upscaleIndex') {
      return t('image.action.upscaleIndex', { index: resolved.index });
    }
    if (resolved.type === 'variationIndex') {
      return t('image.action.variationIndex', { index: resolved.index });
    }
    return '';
  }, [t]);

  /* Midjourney 二次操作（U/V/Reroll），需用户确认扣费 */
  const handleMidjourneyAction = useCallback(async (generationId, action, index) => {
    const actionLabel = buildActionLabel(action, index);

    const confirm = await new Promise((resolve) => {
      Modal.confirm({
        title: t('image.confirmAction'),
        /* 整句插值：操作名与积分数嵌入译文，中英语序不同不可分段拼接 */
        content: t('image.confirmActionDesc', {
          action: actionLabel,
          credits: generation.selectedModel.price_per_image
        }),
        okText: t('common.confirm'),
        cancelText: t('common.cancel'),
        onOk: () => resolve(true),
        onCancel: () => resolve(false)
      });
    });

    if (confirm) {
      await midjourneyAction(generationId, action, index);
      reloadCurrentTab(activeTab, historyPaging.currentPage);
    }
  }, [generation.selectedModel, midjourneyAction, reloadCurrentTab, historyPaging, t, activeTab, buildActionLabel]);

  /* 切换 Tab：重置到第 1 页并重新查询 */
  const handleTabChange = useCallback((key) => {
    setActiveTab(key);
    if (key === TAB_KEYS.PUBLIC) {
      publicPaging.setCurrentPage(1);
    } else {
      historyPaging.setCurrentPage(1);
    }
    reloadCurrentTab(key, 1);
  }, [historyPaging, publicPaging, reloadCurrentTab]);

  /* 分页变化 */
  const handlePageChange = useCallback((page, size) => {
    if (activeTab === TAB_KEYS.PUBLIC) {
      publicPaging.handlePageChange(page, size);
    } else {
      historyPaging.handlePageChange(page, size);
    }
    reloadCurrentTab(activeTab, page, size);
  }, [activeTab, historyPaging, publicPaging, reloadCurrentTab]);

  /* 手动刷新当前页 */
  const handleRefresh = useCallback(() => {
    const currentPage = activeTab === TAB_KEYS.PUBLIC
      ? publicPaging.currentPage
      : historyPaging.currentPage;
    reloadCurrentTab(activeTab, currentPage);
    if (activeTab !== TAB_KEYS.PUBLIC) {
      /* 延迟清理，等列表数据落地后再比对状态 */
      setTimeout(() => cleanupFailedTasks(), 100);
    }
  }, [activeTab, historyPaging.currentPage, publicPaging.currentPage, reloadCurrentTab, cleanupFailedTasks]);

  /* 执行搜索：IME 保护 + 回到第 1 页 + 用新关键词立即查询 */
  const handleSearch = useCallback((value) => {
    /* 正在拼写中文时的回车属于确认候选词，不应触发搜索 */
    if (isComposingRef.current) {
      return;
    }

    const newKeyword = (value || '').trim();
    setKeyword(newKeyword);
    setSearchInput(newKeyword);

    if (activeTab === TAB_KEYS.PUBLIC) {
      publicPaging.setCurrentPage(1);
    } else {
      historyPaging.setCurrentPage(1);
    }

    /* 传 newKeyword 而不依赖 store，规避 setState 异步延迟 */
    reloadCurrentTab(activeTab, 1, null, newKeyword);
  }, [activeTab, setKeyword, publicPaging, historyPaging, reloadCurrentTab]);

  /**
   * 按优先级取可用的图片地址：local_path > image_url > thumbnail_path
   * 相对路径需用 IMAGE_HOST 补全为绝对地址
   */
  const getBestImageUrl = (img) => {
    if (img.local_path) {
      if (img.local_path.startsWith('http://') || img.local_path.startsWith('https://')) {
        return img.local_path;
      }
      if (img.local_path.startsWith('/')) {
        return `${IMAGE_HOST}${img.local_path}`;
      }
    }
    if (img.image_url) return img.image_url;
    if (img.thumbnail_path) {
      if (img.thumbnail_path.startsWith('http://') || img.thumbnail_path.startsWith('https://')) {
        return img.thumbnail_path;
      }
      if (img.thumbnail_path.startsWith('/')) {
        return `${IMAGE_HOST}${img.thumbnail_path}`;
      }
    }
    return '';
  };

  /**
   * 打开大图查看器
   * 把当前列表整体转成查看器所需结构，便于左右切换浏览
   */
  const handleViewImage = (item) => {
    const currentData = activeTab === TAB_KEYS.PUBLIC ? publicGallery : generationHistory;
    const allImages = currentData.map(img => {
      const url = getBestImageUrl(img);
      if (!url) return null;
      return {
        id: img.id,
        url: url,
        thumbnail_path: img.thumbnail_path?.startsWith('http')
          ? img.thumbnail_path
          : (img.thumbnail_path ? `${IMAGE_HOST}${img.thumbnail_path}` : url),
        title: img.prompt,
        prompt: img.prompt,
        negative_prompt: img.negative_prompt,
        size: img.size,
        generation_mode: img.generation_mode,
        guidance_scale: img.guidance_scale,
        seed: img.seed,
        username: img.username,
        gridLayout: img.grid_layout
      };
    });
    const validImages = allImages.filter(img => img !== null);
    if (validImages.length === 0) {
      message.error(t('image.error.loadFailed'));
      return;
    }
    /* 按 id 精确定位当前图片的下标，避免过滤后索引错位 */
    const correctIndex = validImages.findIndex(img => img.id === item.id);
    const finalIndex = correctIndex >= 0 ? correctIndex : 0;
    setViewerImages(validImages);
    setViewerInitialIndex(finalIndex);
    setViewerVisible(true);
  };

  const getCurrentData = () => {
    return activeTab === TAB_KEYS.PUBLIC ? publicGallery : generationHistory;
  };

  const getCurrentPagination = useMemo(() => {
    if (activeTab === TAB_KEYS.PUBLIC) {
      return publicPaging.getPaginationConfig(galleryPagination.total);
    }
    return historyPaging.getPaginationConfig(historyPagination.total);
  }, [activeTab, publicPaging, historyPaging, galleryPagination.total, historyPagination.total]);

  /* 当前 Tab 的总数，用于搜索结果计数提示 */
  const currentTotal = useMemo(() => {
    return activeTab === TAB_KEYS.PUBLIC ? galleryPagination.total : historyPagination.total;
  }, [activeTab, galleryPagination.total, historyPagination.total]);

  const handleDelete = useCallback(async (id) => {
    const success = await deleteGeneration(id);
    if (success) {
      reloadCurrentTab(activeTab, historyPaging.currentPage);
    }
  }, [deleteGeneration, reloadCurrentTab, historyPaging, activeTab]);

  const handleToggleFavorite = useCallback(async (item) => {
    const success = await toggleFavorite(item.id);
    if (success) {
      /* 收藏 Tab 下取消收藏会导致该项应从列表移除，需重新拉取 */
      if (activeTab === TAB_KEYS.FAVORITES) {
        reloadCurrentTab(activeTab, historyPaging.currentPage);
      }
    }
  }, [toggleFavorite, activeTab, reloadCurrentTab, historyPaging]);

  const handleTogglePublic = useCallback(async (item) => {
    const success = await togglePublic(item.id);
    if (success) {
      /* 公开画廊下取消公开同理需重新拉取 */
      if (activeTab === TAB_KEYS.PUBLIC) {
        reloadCurrentTab(activeTab, publicPaging.currentPage);
      }
    }
  }, [togglePublic, activeTab, reloadCurrentTab, publicPaging]);

  /* 是否处于搜索态，决定计数提示与空状态文案 */
  const isSearchActive = keyword && keyword.trim().length > 0;

  /* 画廊那一块两套布局共用同一份实现，这里只负责把它需要的东西凑齐 */
  const galleryProps = {
    t, user, activeTab, handleTabChange, searchInput, setSearchInput, handleSearch, isComposingRef,
    viewMode, setViewMode, handleRefresh, loading, isSearchActive, currentTotal, keyword,
    getCurrentData, getCurrentPagination, handlePageChange, processingTasks,
    generationProgress: generation.generationProgress,
    handleViewImage, handleToggleFavorite, handleTogglePublic, handleDelete
  };
  const renderActions = (actionItem) => (
    <React.Suspense fallback={null}>
      <MidjourneyActions item={actionItem} onAction={handleMidjourneyAction} />
    </React.Suspense>
  );
  const parameterPanel = (
    <React.Suspense fallback={<Spin />}>
      <ParameterPanel
        selectedModel={generation.selectedModel}
        selectedSize={generation.selectedSize}
        seed={generation.seed}
        guidanceScale={generation.guidanceScale}
        watermark={generation.watermark}
        quantity={generation.quantity}
        referenceImages={upload.referenceImages}
        onSizeChange={generation.setSelectedSize}
        onSeedChange={generation.setSeed}
        onGuidanceScaleChange={generation.setGuidanceScale}
        onWatermarkChange={generation.setWatermark}
        onQuantityChange={generation.setQuantity}
        onReferenceUpload={upload.handleReferenceUpload}
        onRemoveReference={upload.handleRemoveReference}
        onGenerate={handleGenerate}
        generating={generation.generating}
        getTotalPrice={generation.getTotalPrice}
      />
    </React.Suspense>
  );

  if (layoutMode === 'studio') {
    return (
      <React.Suspense fallback={<div className="loading-container"><Spin size="large" /></div>}>
        <StudioLayout
          t={t} compact={compact} onExitStudio={() => switchLayout('classic')}
          generation={generation} upload={upload} parameterPanel={parameterPanel}
          galleryProps={galleryProps} handleGenerate={handleGenerate} renderActions={renderActions}
          handleViewImage={handleViewImage} turns={turns}
        />
        <ImageViewer
          visible={viewerVisible} images={viewerImages} initialIndex={viewerInitialIndex}
          onClose={() => setViewerVisible(false)} showDownload showThumbnails={viewerImages.length > 1}
        />
      </React.Suspense>
    );
  }

  return (
    <Layout className="image-generation-page">
      <Sider width={380} className="generation-sider" theme="light">
        <div className="generation-container">
          <Button size="small" type="text" className="studio-switch" onClick={() => switchLayout('studio')}
            data-testid="classic-to-studio">{t('image.studio.tryStudio')}</Button>
          <ModelSelector
            models={generation.models}
            selectedModel={generation.selectedModel}
            onModelChange={generation.handleModelChange}
          />
          <PromptInput
            prompt={generation.prompt}
            negativePrompt={generation.negativePrompt}
            selectedModel={generation.selectedModel}
            onPromptChange={generation.setPrompt}
            onNegativePromptChange={generation.setNegativePrompt}
          />
          <React.Suspense fallback={<Spin />}>
            <ParameterPanel
              selectedModel={generation.selectedModel}
              selectedSize={generation.selectedSize}
              seed={generation.seed}
              guidanceScale={generation.guidanceScale}
              watermark={generation.watermark}
              quantity={generation.quantity}
              referenceImages={upload.referenceImages}
              onSizeChange={generation.setSelectedSize}
              onSeedChange={generation.setSeed}
              onGuidanceScaleChange={generation.setGuidanceScale}
              onWatermarkChange={generation.setWatermark}
              onQuantityChange={generation.setQuantity}
              onReferenceUpload={upload.handleReferenceUpload}
              onRemoveReference={upload.handleRemoveReference}
              onGenerate={handleGenerate}
              generating={generation.generating}
              getTotalPrice={generation.getTotalPrice}
            />
          </React.Suspense>
        </div>
      </Sider>

      <GallerySection {...galleryProps} renderActions={renderActions} />


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
