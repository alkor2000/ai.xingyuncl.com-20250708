/**
 * 我的帖子视图组件
 * 
 * @module pages/forum/components/MyPostsView
 */

import React, { useEffect } from 'react';
import { Typography, Button, Empty, Spin, Space, Tag, Pagination } from 'antd';
import { ArrowLeftOutlined, EyeOutlined, CommentOutlined, LikeOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import useForumStore from '../../../stores/forumStore';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

const { Text, Title } = Typography;

const MyPostsView = ({ onBack, onPostClick }) => {
  const { t } = useTranslation();
  const { myPosts, myPostsLoading, myPostsPagination, fetchMyPosts } = useForumStore();

  useEffect(() => { fetchMyPosts({ page: 1 }); }, []);

  return (
    <div className="my-posts-view">
      <div className="view-header">
        <Button icon={<ArrowLeftOutlined />} type="text" onClick={onBack} />
        <Title level={4} style={{ margin: 0 }}>{t('forum.myPosts.title')}</Title>
      </div>
      <div className="post-list-container">
        {myPostsLoading ? (
          <div className="loading-center"><Spin /></div>
        ) : myPosts.length === 0 ? (
          <Empty description={t('forum.myPosts.empty')} />
        ) : (
          <>
            {myPosts.map(post => (
              <div key={post.id} className="post-list-item" onClick={() => onPostClick(post)}>
                <div className="post-item-content">
                  <Text strong className="post-item-title">{post.title}</Text>
                  <Space size="middle" style={{ marginTop: 6 }}>
                    {post.board_name && <Tag style={{ fontSize: 10 }}>{post.board_name}</Tag>}
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
            {myPostsPagination.totalPages > 1 && (
              <div className="pagination-wrapper">
                <Pagination
                  current={myPostsPagination.page}
                  total={myPostsPagination.total}
                  pageSize={myPostsPagination.limit}
                  onChange={(page) => fetchMyPosts({ page })}
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

export default MyPostsView;
