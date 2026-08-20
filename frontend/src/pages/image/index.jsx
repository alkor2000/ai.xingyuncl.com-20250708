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
 * 【待决策的技术债】该常量理想实现应为 window.location.origin
 * （参考 MindmapShare 分享链接的做法），以支持更换域名或多域名部署。
 * 因涉及线上图片访问路径，属业务行为变更，未经确认不擅自修改。
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
const IMAGE_HOST = 'https://ai.xingyuncl.com';

/* 搜索关键词最大长度，与后端 normalizeKeyword 的截断长度保持一致 */
const SEARCH_MAX_LENGTH = 100;

const ParameterPanel = React.lazy(() => import('./components/GenerationPanel/ParameterSettings'));
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
      getUserHistory({ page: 1, limit: historyPaging.pageSize });
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

  return (
    <Layout className="image-generation-page">
      <Sider width={380} className="generation-sider" theme="light">
        <div className="generation-container">
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

      <Content className="history-content">
        <div className="history-header-wrapper">
          <div className="history-header">
            <Tabs activeKey={activeTab} onChange={handleTabChange} className="history-tabs">
              <TabPane tab={t('image.myImages')} key={TAB_KEYS.ALL} />
              <TabPane tab={t('image.myFavorites')} key={TAB_KEYS.FAVORITES} />
              <TabPane
                tab={<span><GlobalOutlined /> {t('image.publicGallery')}</span>}
                key={TAB_KEYS.PUBLIC}
              />
            </Tabs>
            <Space className="history-actions" wrap>
              {/* 搜索框：IME 保护 + 提示词/模型名模糊搜索 */}
              <Search
                className="history-search"
                placeholder={t('image.searchPlaceholder')}
                allowClear
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onSearch={handleSearch}
                onCompositionStart={() => { isComposingRef.current = true; }}
                onCompositionEnd={() => { isComposingRef.current = false; }}
                enterButton={<SearchOutlined />}
                maxLength={SEARCH_MAX_LENGTH}
              />
              <Button
                icon={viewMode === VIEW_MODES.GRID ? <AppstoreOutlined /> : <UnorderedListOutlined />}
                onClick={() => setViewMode(
                  viewMode === VIEW_MODES.GRID ? VIEW_MODES.LIST : VIEW_MODES.GRID
                )}
              />
              <Button
                icon={<ReloadOutlined />}
                onClick={handleRefresh}
              >
                {t('common.refresh')}
              </Button>
            </Space>
          </div>

          {/* 搜索结果计数提示：整句插值，不用 <strong> 包裹以避免插值转义问题 */}
          {!loading && isSearchActive && (
            <div className="search-result-tip">
              {currentTotal > 0
                ? <span>{t('image.searchFound', { count: currentTotal, keyword })}</span>
                : <span>{t('image.searchNoMatch', { keyword })}</span>
              }
            </div>
          )}

          {!loading && getCurrentData().length > 0 && (
            <div className="history-pagination">
              <Pagination
                {...getCurrentPagination}
                onChange={handlePageChange}
                onShowSizeChange={handlePageChange}
                size="small"
              />
            </div>
          )}
        </div>

        <div className="history-grid-container">
          <div className={`history-grid ${viewMode}`}>
            {loading ? (
              <div className="loading-container">
                <Spin size="large" />
              </div>
            ) : getCurrentData().length > 0 ? (
              getCurrentData().map(item => (
                <ImageCard
                  key={item.id}
                  item={item}
                  isGallery={activeTab === TAB_KEYS.PUBLIC}
                  isOwner={activeTab !== TAB_KEYS.PUBLIC || item.user_id === user?.id}
                  processingTasks={processingTasks}
                  generationProgress={generation.generationProgress}
                  onView={handleViewImage}
                  onToggleFavorite={handleToggleFavorite}
                  onTogglePublic={handleTogglePublic}
                  onDelete={handleDelete}
                  renderActions={(actionItem) => (
                    <React.Suspense fallback={null}>
                      <MidjourneyActions
                        item={actionItem}
                        onAction={handleMidjourneyAction}
                      />
                    </React.Suspense>
                  )}
                />
              ))
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  isSearchActive
                    ? t('image.searchNoImage', { keyword })
                    : activeTab === TAB_KEYS.PUBLIC
                      ? t('image.noPublicImages')
                      : activeTab === TAB_KEYS.FAVORITES
                        ? t('image.noFavorites')
                        : t('image.noHistory')
                }
              />
            )}
          </div>
        </div>
      </Content>

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
