/**
 * 版块帖子列表组件
 * 
 * 展示某个版块的帖子列表，支持排序切换和分页
 * 帖子卡片展示：标题、作者、统计、标签、附件预览
 * 
 * @module pages/forum/components/BoardPostList
 */

import React, { useEffect, useState } from 'react';
import {
  Typography, Space, Tag, Button, Empty, Spin, Segmented,
  Pagination, Card, Tooltip, Avatar
} from 'antd';
import {
  ArrowLeftOutlined, PlusOutlined,
  EyeOutlined, CommentOutlined, LikeOutlined,
  PushpinFilled, StarFilled, LockOutlined,
  ClockCircleOutlined, FireOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import useForumStore from '../../../stores/forumStore';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

const { Text, Title } = Typography;

const BoardPostList = ({
  boardId,
  boardName,
  user,
  onBack,
  onPostClick,
  onNewPost
}) => {
  const { t } = useTranslation();
  const {
    posts, postsLoading, postsPagination, postsSort,
    fetchBoardPosts, setPostsSort
  } = useForumStore();

  /* 初始加载 */
  useEffect(() => {
    if (boardId) {
      fetchBoardPosts(boardId, { page: 1, sort: postsSort });
    }
  }, [boardId]);

  /* 排序切换 */
  const handleSortChange = (sort) => {
    setPostsSort(sort);
    fetchBoardPosts(boardId, { page: 1, sort });
  };

  /* 分页 */
  const handlePageChange = (page) => {
    fetchBoardPosts(boardId, { page, sort: postsSort });
  };

  /* 渲染帖子卡片 */
  const renderPostItem = (post) => {
    const hasImages = post.attachments?.some(a => a.file_type === 'image');

    return (
      <div
        key={post.id}
        className="post-list-item"
        onClick={() => onPostClick(post)}
      >
        {/* 左侧内容 */}
        <div className="post-item-content">
          {/* 标签行 */}
          <div className="post-tags">
            {post.is_pinned === 1 && <Tag color="red">{t('forum.post.pinned')}</Tag>}
            {post.is_featured === 1 && <Tag color="gold">{t('forum.post.featured')}</Tag>}
            {post.is_locked === 1 && <Tag color="default" icon={<LockOutlined />}>{t('forum.post.locked')}</Tag>}
            {post.is_hidden === 1 && <Tag color="orange">{t('forum.post.hidden')}</Tag>}
          </div>

          {/* 标题 */}
          <Text strong className="post-item-title">{post.title}</Text>

          {/* 元信息 */}
          <div className="post-item-meta">
            <Space size="middle" wrap>
              <Text type="secondary" style={{ fontSize: 12 }}>
                <Avatar size={18} style={{ marginRight: 4, backgroundColor: '#1890ff', fontSize: 10 }}>
                  {(post.author_name || '?')[0]?.toUpperCase()}
                </Avatar>
                {post.author_name}
              </Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                <ClockCircleOutlined style={{ marginRight: 2 }} />
                {dayjs(post.created_at).fromNow()}
              </Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                <EyeOutlined style={{ marginRight: 2 }} />{post.view_count || 0}
              </Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                <CommentOutlined style={{ marginRight: 2 }} />{post.reply_count || 0}
              </Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                <LikeOutlined style={{ marginRight: 2 }} />{post.like_count || 0}
              </Text>
            </Space>
          </div>
        </div>

        {/* 右侧图片预览 */}
        {hasImages && (
          <div className="post-item-preview">
            <img
              src={`/uploads/${post.attachments.find(a => a.file_type === 'image').file_path}`}
              alt="preview"
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="board-post-list">
      {/* 头部 */}
      <div className="board-header">
        <div className="header-left">
          <Button icon={<ArrowLeftOutlined />} type="text" onClick={onBack} />
          <Title level={4} style={{ margin: 0 }}>{boardName}</Title>
        </div>
        <Space>
          <Segmented
            size="small"
            options={[
              { label: t('forum.post.sort.active'), value: 'active' },
              { label: t('forum.post.sort.latest'), value: 'latest' },
              { label: t('forum.post.sort.hot'), value: 'hot' }
            ]}
            value={postsSort}
            onChange={handleSortChange}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={onNewPost}>
            {t('forum.post.new')}
          </Button>
        </Space>
      </div>

      {/* 帖子列表 */}
      <div className="post-list-container">
        {postsLoading ? (
          <div className="loading-center"><Spin /></div>
        ) : posts.length === 0 ? (
          <Empty description={t('forum.post.empty')}>
            <Button type="primary" onClick={onNewPost}>{t('forum.post.new')}</Button>
          </Empty>
        ) : (
          <>
            {posts.map(renderPostItem)}
            {postsPagination.totalPages > 1 && (
              <div className="pagination-wrapper">
                <Pagination
                  current={postsPagination.page}
                  total={postsPagination.total}
                  pageSize={postsPagination.limit}
                  onChange={handlePageChange}
                  showSizeChanger={false}
                  showTotal={(total) => `共 ${total} 篇帖子`}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default BoardPostList;
