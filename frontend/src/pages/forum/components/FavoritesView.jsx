/**
 * 我的收藏视图组件
 * 
 * @module pages/forum/components/FavoritesView
 */

import React, { useEffect } from 'react';
import { Typography, Button, Empty, Spin, Space, Tag, Pagination } from 'antd';
import { ArrowLeftOutlined, EyeOutlined, CommentOutlined, LikeOutlined, ClockCircleOutlined, HeartFilled } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import useForumStore from '../../../stores/forumStore';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

const { Text, Title } = Typography;

const FavoritesView = ({ onBack, onPostClick }) => {
  const { t } = useTranslation();
  const { favorites, favoritesLoading, favoritesPagination, fetchFavorites } = useForumStore();

  useEffect(() => { fetchFavorites({ page: 1 }); }, []);

  return (
    <div className="favorites-view">
      <div className="view-header">
        <Button icon={<ArrowLeftOutlined />} type="text" onClick={onBack} />
        <Title level={4} style={{ margin: 0 }}>
          <HeartFilled style={{ color: '#ff4d4f', marginRight: 6 }} />
          {t('forum.favorite.myFavorites')}
        </Title>
      </div>
      <div className="post-list-container">
        {favoritesLoading ? (
          <div className="loading-center"><Spin /></div>
        ) : favorites.length === 0 ? (
          <Empty description={t('forum.favorite.empty')} />
        ) : (
          <>
            {favorites.map(post => (
              <div key={post.id} className="post-list-item" onClick={() => onPostClick(post)}>
                <div className="post-item-content">
                  <Text strong className="post-item-title">{post.title}</Text>
                  <Space size="middle" style={{ marginTop: 6 }}>
                    {post.board_name && <Tag style={{ fontSize: 10 }}>{post.board_name}</Tag>}
                    <Text type="secondary" style={{ fontSize: 12 }}>{post.author_name}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      <ClockCircleOutlined style={{ marginRight: 2 }} />{dayjs(post.created_at).fromNow()}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}><EyeOutlined /> {post.view_count || 0}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}><CommentOutlined /> {post.reply_count || 0}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}><LikeOutlined /> {post.like_count || 0}</Text>
                  </Space>
                </div>
              </div>
            ))}
            {favoritesPagination.totalPages > 1 && (
              <div className="pagination-wrapper">
                <Pagination
                  current={favoritesPagination.page}
                  total={favoritesPagination.total}
                  pageSize={favoritesPagination.limit}
                  onChange={(page) => fetchFavorites({ page })}
                  showSizeChanger={false}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default FavoritesView;
