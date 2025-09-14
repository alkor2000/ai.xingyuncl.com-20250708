/**
 * 图像生成页面 - 重构版
 * 修复：图片查看器索引错位问题
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Layout, Button, Space, Tabs, Empty, Spin, Pagination, Modal, message } from 'antd';
import { 
  ReloadOutlined, 
  AppstoreOutlined, 
  UnorderedListOutlined,
  GlobalOutlined 
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

// Store
import useImageStore from '../../stores/imageStore';
import useAuthStore from '../../stores/authStore';

// Hooks
import { useImageGeneration } from './hooks/useImageGeneration';
import { useImageUpload } from './hooks/useImageUpload';
import { usePagination } from './hooks/usePagination';

// Components
import ModelSelector from './components/GenerationPanel/ModelSelector';
import PromptInput from './components/GenerationPanel/PromptInput';
import ImageCard from './components/ImageGallery/ImageCard';
import ImageViewer from '../../components/common/ImageViewer';

// Utils
import { TAB_KEYS, VIEW_MODES, ACTION_LABELS } from './utils/constants';
import { isMidjourneyModel } from './utils/imageHelpers';

// Styles
import './ImageGeneration.less';

const { Content, Sider } = Layout;
const { TabPane } = Tabs;

/**
 * 参数设置面板组件（简化版）
 */
const ParameterPanel = React.lazy(() => import('./components/GenerationPanel/ParameterSettings'));

/**
 * Midjourney操作按钮组件（懒加载）
 */
const MidjourneyActions = React.lazy(() => import('./components/ImageGallery/MidjourneyActions'));

const ImageGeneration = () => {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  
  // Store hooks
  const {
    generationHistory,
    historyPagination,
    publicGallery,
    galleryPagination,
    loading,
    processingTasks,
    getUserHistory,
    getPublicGallery,
    deleteGeneration,
    toggleFavorite,
    togglePublic,
    getUserStats,
    midjourneyAction,
    cleanupFailedTasks
  } = useImageStore();

  // 自定义hooks
  const generation = useImageGeneration();
  const upload = useImageUpload();
  const historyPaging = usePagination();
  const publicPaging = usePagination();
  
  // 本地状态
  const [viewMode, setViewMode] = useState(VIEW_MODES.GRID);
  const [activeTab, setActiveTab] = useState(TAB_KEYS.ALL);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerImages, setViewerImages] = useState([]);
  const [viewerInitialIndex, setViewerInitialIndex] = useState(0);

  // 初始化
  useEffect(() => {
    getUserHistory({ page: 1, limit: historyPaging.pageSize }).then(() => {
      cleanupFailedTasks();
    });
    getUserStats();
  }, []);

  // 处理生成
  const handleGenerate = useCallback(async () => {
    const result = await generation.handleGenerate(upload.referenceImages);
    if (result) {
      // 生成成功后的处理
      if (isMidjourneyModel(generation.selectedModel)) {
        upload.clearReferenceImages();
      }
      historyPaging.setCurrentPage(1);
      getUserHistory({ page: 1, limit: historyPaging.pageSize });
    }
  }, [generation, upload, historyPaging, getUserHistory]);

  // 处理Midjourney操作
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
      getUserHistory({ page: historyPaging.currentPage, limit: historyPaging.pageSize });
    }
  }, [generation.selectedModel, midjourneyAction, getUserHistory, historyPaging, t]);

  // 处理Tab切换
  const handleTabChange = useCallback((key) => {
    setActiveTab(key);
    
    if (key === TAB_KEYS.PUBLIC) {
      publicPaging.setCurrentPage(1);
      getPublicGallery({ page: 1, limit: publicPaging.pageSize });
    } else {
      historyPaging.setCurrentPage(1);
      const params = { page: 1, limit: historyPaging.pageSize };
      if (key === TAB_KEYS.FAVORITES) {
        params.is_favorite = true;
      }
      getUserHistory(params);
    }
  }, [historyPaging, publicPaging, getUserHistory, getPublicGallery]);

  // 处理分页变化
  const handlePageChange = useCallback((page, size) => {
    if (activeTab === TAB_KEYS.PUBLIC) {
      const params = publicPaging.handlePageChange(page, size);
      getPublicGallery(params);
    } else {
      const params = historyPaging.handlePageChange(page, size);
      if (activeTab === TAB_KEYS.FAVORITES) {
        params.is_favorite = true;
      }
      getUserHistory(params);
    }
  }, [activeTab, historyPaging, publicPaging, getUserHistory, getPublicGallery]);

  // 处理刷新
  const handleRefresh = useCallback(() => {
    if (activeTab === TAB_KEYS.PUBLIC) {
      getPublicGallery({ page: publicPaging.currentPage, limit: publicPaging.pageSize });
    } else {
      const params = { page: historyPaging.currentPage, limit: historyPaging.pageSize };
      if (activeTab === TAB_KEYS.FAVORITES) {
        params.is_favorite = true;
      }
      getUserHistory(params).then(() => {
        cleanupFailedTasks();
      });
    }
  }, [activeTab, historyPaging, publicPaging, getUserHistory, getPublicGallery, cleanupFailedTasks]);

  /**
   * 获取图片的最佳URL
   * 优先级：local_path (OSS) > image_url (原始) > thumbnail_path
   */
  const getBestImageUrl = (img) => {
    // local_path通常是OSS URL或本地路径
    if (img.local_path) {
      // 如果是OSS URL（以http开头），直接使用
      if (img.local_path.startsWith('http://') || img.local_path.startsWith('https://')) {
        return img.local_path;
      }
      // 如果是本地路径，需要加上域名前缀
      if (img.local_path.startsWith('/')) {
        return `https://ai.xingyuncl.com${img.local_path}`;
      }
    }
    
    // image_url是原始URL（火山方舟或Midjourney返回的）
    if (img.image_url) {
      return img.image_url;
    }
    
    // thumbnail_path作为最后备选
    if (img.thumbnail_path) {
      // 如果是OSS URL，直接使用
      if (img.thumbnail_path.startsWith('http://') || img.thumbnail_path.startsWith('https://')) {
        return img.thumbnail_path;
      }
      // 如果是本地路径，加上域名前缀
      if (img.thumbnail_path.startsWith('/')) {
        return `https://ai.xingyuncl.com${img.thumbnail_path}`;
      }
    }
    
    return '';
  };

  /**
   * 修复：处理查看大图
   * 关键修复：确保索引正确对应
   */
  const handleViewImage = (item) => {
    // 获取当前显示的数据
    const currentData = activeTab === TAB_KEYS.PUBLIC ? publicGallery : generationHistory;
    
    // 先构建完整的图片数据，并保留原始id
    const allImages = currentData.map(img => {
      const url = getBestImageUrl(img);
      if (!url) return null; // 标记无效图片
      
      return {
        id: img.id, // 保留原始id用于索引查找
        url: url,
        // 缩略图优先使用thumbnail_path
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
    
    // 过滤掉无效图片（url为null的）
    const validImages = allImages.filter(img => img !== null);
    
    if (validImages.length === 0) {
      message.error('图片加载失败');
      return;
    }
    
    // 重要修复：使用id查找正确的索引
    const correctIndex = validImages.findIndex(img => img.id === item.id);
    
    // 如果找不到对应的图片，使用第一张
    const finalIndex = correctIndex >= 0 ? correctIndex : 0;
    
    // 调试日志（生产环境可删除）
    console.log('图片查看调试:', {
      clickedItemId: item.id,
      totalImages: currentData.length,
      validImages: validImages.length,
      foundIndex: correctIndex,
      finalIndex: finalIndex
    });
    
    setViewerImages(validImages);
    setViewerInitialIndex(finalIndex);
    setViewerVisible(true);
  };

  // 获取当前显示的数据
  const getCurrentData = () => {
    return activeTab === TAB_KEYS.PUBLIC ? publicGallery : generationHistory;
  };

  // 获取当前分页信息
  const getCurrentPagination = useMemo(() => {
    if (activeTab === TAB_KEYS.PUBLIC) {
      return publicPaging.getPaginationConfig(galleryPagination.total);
    }
    return historyPaging.getPaginationConfig(historyPagination.total);
  }, [activeTab, publicPaging, historyPaging, galleryPagination.total, historyPagination.total]);

  // 处理删除并刷新
  const handleDelete = useCallback(async (id) => {
    const success = await deleteGeneration(id);
    if (success) {
      // 删除成功后刷新列表
      const params = { page: historyPaging.currentPage, limit: historyPaging.pageSize };
      if (activeTab === TAB_KEYS.FAVORITES) {
        params.is_favorite = true;
      }
      getUserHistory(params);
    }
  }, [deleteGeneration, getUserHistory, historyPaging, activeTab]);

  // 处理收藏切换
  const handleToggleFavorite = useCallback(async (item) => {
    const success = await toggleFavorite(item.id);
    if (success) {
      // 如果在收藏标签页，刷新列表
      if (activeTab === TAB_KEYS.FAVORITES) {
        getUserHistory({ 
          page: historyPaging.currentPage, 
          limit: historyPaging.pageSize,
          is_favorite: true 
        });
      }
    }
  }, [toggleFavorite, activeTab, getUserHistory, historyPaging]);

  // 处理公开切换
  const handleTogglePublic = useCallback(async (item) => {
    const success = await togglePublic(item.id);
    if (success) {
      // 如果在公开画廊标签页，刷新列表
      if (activeTab === TAB_KEYS.PUBLIC) {
        getPublicGallery({ 
          page: publicPaging.currentPage, 
          limit: publicPaging.pageSize 
        });
      }
    }
  }, [togglePublic, activeTab, getPublicGallery, publicPaging]);

  return (
    <Layout className="image-generation-page">
      {/* 左侧生成面板 */}
      <Sider width={380} className="generation-sider" theme="light">
        <div className="generation-container">
          {/* 模型选择 */}
          <ModelSelector
            models={generation.models}
            selectedModel={generation.selectedModel}
            onModelChange={generation.handleModelChange}
          />

          {/* 提示词输入 */}
          <PromptInput
            prompt={generation.prompt}
            negativePrompt={generation.negativePrompt}
            selectedModel={generation.selectedModel}
            onPromptChange={generation.setPrompt}
            onNegativePromptChange={generation.setNegativePrompt}
          />

          {/* 参数设置 - 懒加载 */}
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

      {/* 右侧历史记录 */}
      <Content className="history-content">
        <div className="history-header-wrapper">
          <div className="history-header">
            <Tabs activeKey={activeTab} onChange={handleTabChange}>
              <TabPane tab={t('image.myImages', '我的图片')} key={TAB_KEYS.ALL} />
              <TabPane tab={t('image.myFavorites', '我的收藏')} key={TAB_KEYS.FAVORITES} />
              <TabPane tab={<span><GlobalOutlined /> {t('image.publicGallery', '公开画廊')}</span>} key={TAB_KEYS.PUBLIC} />
            </Tabs>
            <Space>
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
                  activeTab === TAB_KEYS.PUBLIC 
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

      {/* 图片查看器 */}
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
