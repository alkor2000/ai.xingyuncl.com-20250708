/**
 * 图像生成页面 - 重构版
 *
 * v1.2 关键词搜索优化
 *   - IME 输入法保护（中文输入回车不触发搜索）
 *   - 生成后清空搜索框（避免不一致）
 *   - 搜索结果计数提示
 *   - 移动端响应式
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
  
  // v1.1 搜索框本地输入值
  const [searchInput, setSearchInput] = useState(keyword || '');
  
  // v1.2 IME 输入法保护：跟踪中文输入法的拼写态
  // ref 而非 state，因为不需要触发渲染
  const isComposingRef = useRef(false);

  /**
   * v1.2 工具方法：根据当前Tab、分页、关键词构建查询参数
   * @param {object} extra 额外参数（如page/limit）
   * @param {string} [overrideKeyword] 显式传入关键词覆盖store值（用于setState时序问题）
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

  /**
   * 根据Tab和当前关键词刷新对应列表
   */
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

  // 初始化
  useEffect(() => {
    getUserHistory({ page: 1, limit: historyPaging.pageSize }).then(() => {
      cleanupFailedTasks();
    });
    getUserStats();
  }, []);

  // 处理生成（v1.2: 生成成功后清空搜索框，回到无过滤的"我的图片"）
  const handleGenerate = useCallback(async () => {
    const result = await generation.handleGenerate(upload.referenceImages);
    if (result) {
      if (isMidjourneyModel(generation.selectedModel)) {
        upload.clearReferenceImages();
      }
      
      // v1.2 生成成功后清空搜索框，避免新生成的图被过滤
      if (keyword || searchInput) {
        setKeyword('');
        setSearchInput('');
      }
      
      historyPaging.setCurrentPage(1);
      // 切回"我的图片"Tab无关键词查询，让用户看到新生成的
      if (activeTab !== TAB_KEYS.ALL) {
        setActiveTab(TAB_KEYS.ALL);
      }
      getUserHistory({ page: 1, limit: historyPaging.pageSize });
    }
  }, [generation, upload, historyPaging, getUserHistory, keyword, searchInput, setKeyword, activeTab]);

  // Midjourney操作
  const handleMidjourneyAction = useCallback(async (generationId, action, index) => {
    const actionLabel = typeof ACTION_LABELS[action] === 'function' 
      ? ACTION_LABELS[action](index) 
      : ACTION_LABELS[action];
    
    const confirm = await new Promise((resolve) => {
      Modal.confirm({
        title: t('image.confirmAction', '确认操作'),
        content: t('image.confirmActionDesc', '确定要{{action}}吗？此操作将消耗 {{credits}} 积分', {
          action: actionLabel,
          credits: generation.selectedModel.price_per_image
        }),
        okText: t('common.confirm', '确定'),
        cancelText: t('common.cancel', '取消'),
        onOk: () => resolve(true),
        onCancel: () => resolve(false)
      });
    });
    
    if (confirm) {
      await midjourneyAction(generationId, action, index);
      reloadCurrentTab(activeTab, historyPaging.currentPage);
    }
  }, [generation.selectedModel, midjourneyAction, reloadCurrentTab, historyPaging, t, activeTab]);

  // Tab切换
  const handleTabChange = useCallback((key) => {
    setActiveTab(key);
    if (key === TAB_KEYS.PUBLIC) {
      publicPaging.setCurrentPage(1);
    } else {
      historyPaging.setCurrentPage(1);
    }
    reloadCurrentTab(key, 1);
  }, [historyPaging, publicPaging, reloadCurrentTab]);

  // 分页变化
  const handlePageChange = useCallback((page, size) => {
    if (activeTab === TAB_KEYS.PUBLIC) {
      publicPaging.handlePageChange(page, size);
    } else {
      historyPaging.handlePageChange(page, size);
    }
    reloadCurrentTab(activeTab, page, size);
  }, [activeTab, historyPaging, publicPaging, reloadCurrentTab]);

  // 刷新
  const handleRefresh = useCallback(() => {
    const currentPage = activeTab === TAB_KEYS.PUBLIC ? publicPaging.currentPage : historyPaging.currentPage;
    reloadCurrentTab(activeTab, currentPage);
    if (activeTab !== TAB_KEYS.PUBLIC) {
      setTimeout(() => cleanupFailedTasks(), 100);
    }
  }, [activeTab, historyPaging.currentPage, publicPaging.currentPage, reloadCurrentTab, cleanupFailedTasks]);

  /**
   * v1.2 处理搜索：IME 保护 + 重置到第1页 + 重新查询
   */
  const handleSearch = useCallback((value) => {
    // IME 输入法保护：正在拼写中文则忽略此次回车
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

    // 使用新关键词查询（避免setState异步延迟）
    reloadCurrentTab(activeTab, 1, null, newKeyword);
  }, [activeTab, setKeyword, publicPaging, historyPaging, reloadCurrentTab]);

  const getBestImageUrl = (img) => {
    if (img.local_path) {
      if (img.local_path.startsWith('http://') || img.local_path.startsWith('https://')) {
        return img.local_path;
      }
      if (img.local_path.startsWith('/')) {
        return `https://ai.xingyuncl.com${img.local_path}`;
      }
    }
    if (img.image_url) return img.image_url;
    if (img.thumbnail_path) {
      if (img.thumbnail_path.startsWith('http://') || img.thumbnail_path.startsWith('https://')) {
        return img.thumbnail_path;
      }
      if (img.thumbnail_path.startsWith('/')) {
        return `https://ai.xingyuncl.com${img.thumbnail_path}`;
      }
    }
    return '';
  };

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
          : (img.thumbnail_path ? `https://ai.xingyuncl.com${img.thumbnail_path}` : url),
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
      message.error('图片加载失败');
      return;
    }
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

  // v1.2 当前总数（用于搜索结果计数提示）
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
      if (activeTab === TAB_KEYS.FAVORITES) {
        reloadCurrentTab(activeTab, historyPaging.currentPage);
      }
    }
  }, [toggleFavorite, activeTab, reloadCurrentTab, historyPaging]);

  const handleTogglePublic = useCallback(async (item) => {
    const success = await togglePublic(item.id);
    if (success) {
      if (activeTab === TAB_KEYS.PUBLIC) {
        reloadCurrentTab(activeTab, publicPaging.currentPage);
      }
    }
  }, [togglePublic, activeTab, reloadCurrentTab, publicPaging]);

  // v1.2 是否处于搜索激活状态（用于显示计数提示和空状态文案）
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
              <TabPane tab={t('image.myImages', '我的图片')} key={TAB_KEYS.ALL} />
              <TabPane tab={t('image.myFavorites', '我的收藏')} key={TAB_KEYS.FAVORITES} />
              <TabPane tab={<span><GlobalOutlined /> {t('image.publicGallery', '公开画廊')}</span>} key={TAB_KEYS.PUBLIC} />
            </Tabs>
            <Space className="history-actions" wrap>
              {/* v1.2 搜索框：IME 保护 + 提示词/模型名模糊搜索 */}
              <Search
                className="history-search"
                placeholder={t('image.searchPlaceholder', '搜索提示词或模型名...')}
                allowClear
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onSearch={handleSearch}
                onCompositionStart={() => { isComposingRef.current = true; }}
                onCompositionEnd={() => { isComposingRef.current = false; }}
                enterButton={<SearchOutlined />}
                maxLength={100}
              />
              <Button
                icon={viewMode === VIEW_MODES.GRID ? <AppstoreOutlined /> : <UnorderedListOutlined />}
                onClick={() => setViewMode(viewMode === VIEW_MODES.GRID ? VIEW_MODES.LIST : VIEW_MODES.GRID)}
              />
              <Button
                icon={<ReloadOutlined />}
                onClick={handleRefresh}
              >
                {t('common.refresh', '刷新')}
              </Button>
            </Space>
          </div>
          
          {/* v1.2 搜索结果计数提示 */}
          {!loading && isSearchActive && (
            <div className="search-result-tip">
              {currentTotal > 0
                ? <span>找到 <strong>{currentTotal}</strong> 条匹配 "<strong>{keyword}</strong>" 的结果</span>
                : <span>没有匹配 "<strong>{keyword}</strong>" 的结果</span>
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
                  renderActions={(item) => (
                    <React.Suspense fallback={null}>
                      <MidjourneyActions
                        item={item}
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
                    ? `没有匹配 "${keyword}" 的图片`
                    : activeTab === TAB_KEYS.PUBLIC 
                      ? t('image.noPublicImages', '暂无公开的图片')
                      : activeTab === TAB_KEYS.FAVORITES
                      ? t('image.noFavorites', '暂无收藏的图片')
                      : t('image.noHistory', '暂无生成记录')
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
