import React from 'react';
import { Button, Empty, Pagination, Space, Spin, Tabs, Input } from 'antd';
import {
  AppstoreOutlined, GlobalOutlined, ReloadOutlined, SearchOutlined, UnorderedListOutlined
} from '@ant-design/icons';
import ImageCard from '../ImageGallery/ImageCard';
import { TAB_KEYS, VIEW_MODES } from '../../utils/constants';

const { TabPane } = Tabs;
const { Search } = Input;
const SEARCH_MAX_LENGTH = 100;

/**
 * 「我的图片 / 收藏 / 公开画廊」这一块。
 *
 * 它是从原页面原样搬出来的，不是重写：经典视图和新版工作台共用同一份，
 * 免得以后每改一次筛选或分页都要在两个地方各改一遍（两套 UI 最容易就是这么走散的）。
 */
export default function GallerySection({
  className = '', t, user, activeTab, handleTabChange, searchInput, setSearchInput, handleSearch,
  isComposingRef, viewMode, setViewMode, handleRefresh, loading, isSearchActive, currentTotal, keyword,
  getCurrentData, getCurrentPagination, handlePageChange, processingTasks, generationProgress,
  handleViewImage, handleToggleFavorite, handleTogglePublic, handleDelete, renderActions
}) {
  return (
  <div className={`history-content ${className}`}>
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
                  renderActions={renderActions}
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
  </div>
  );
}
