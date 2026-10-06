import React from 'react';
import { Empty, Input, Pagination, Spin, Tabs } from 'antd';
import { SearchOutlined } from '@ant-design/icons';

const { TabPane } = Tabs;
const { Search } = Input;
const SEARCH_MAX_LENGTH = 100;

/**
 * 「我的视频 / 收藏 / 公开画廊」这一块。
 *
 * 卡片本身仍由页面渲染（renderCard 传进来），不在这里复制一遍——
 * 视频卡里有播放器、进度、失败原因、收藏公开删除一大堆，抄第二份迟早走散。
 * 这里只管选页签、搜索、翻页和摆格子；数据与回调全部由页面给。
 */
export default function GallerySection({
  className = '', t, activeTab, onTabChange, searchInput, onSearchInput, onSearch, isComposingRef,
  loading, isSearchActive, keyword, currentTotal, items, currentPage, pageSize, total,
  onPageChange, renderCard
}) {
  return (
    <div className={`history-content ${className}`}>
      <div className="history-header">
        <Tabs activeKey={activeTab} onChange={onTabChange} className="history-tabs">
          <TabPane tab={t('video.myVideos')} key="all" />
          <TabPane tab={t('video.myFavorites')} key="favorites" />
          <TabPane tab={t('video.publicGallery')} key="public" />
        </Tabs>
        <Search
          className="history-search"
          placeholder={t('video.searchPlaceholder')}
          allowClear
          value={searchInput}
          onChange={(e) => onSearchInput(e.target.value)}
          onSearch={onSearch}
          onCompositionStart={() => { isComposingRef.current = true; }}
          onCompositionEnd={() => { isComposingRef.current = false; }}
          enterButton={<SearchOutlined />}
          maxLength={SEARCH_MAX_LENGTH}
        />
      </div>

      {!loading && isSearchActive && (
        <div className="search-result-tip">
          {currentTotal > 0
            ? <span>{t('video.searchFound', { count: currentTotal, keyword })}</span>
            : <span>{t('video.searchNoMatch', { keyword })}</span>}
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="history-pagination">
          <Pagination
            current={currentPage} pageSize={pageSize} total={total}
            onChange={onPageChange} onShowSizeChange={onPageChange}
            showSizeChanger size="small"
            showTotal={(n) => t('video.total', { total: n })}
          />
        </div>
      )}

      <div className="history-grid">
        {loading ? (
          <div className="loading-container"><Spin size="large" /></div>
        ) : items.length > 0 ? (
          items.map(item => renderCard(item, activeTab === 'public'))
        ) : (
          <Empty description={isSearchActive ? t('video.searchNoVideo', { keyword }) : t('video.noVideos')} />
        )}
      </div>
    </div>
  );
}
