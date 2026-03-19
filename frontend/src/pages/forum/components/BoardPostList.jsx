/**
 * 版块帖子列表组件 v2.3
 * 
 * v2.3 - 版主管理按钮：从store读取isBoardModerator，每个帖子右侧显示"管理"按钮
 * v2.1 - 锁定帖标题去掉删除线
 * v2.0 - 锁定帖可见标题但不可点击进入
 * 
 * @module pages/forum/components/BoardPostList
 */

import React, { useEffect } from 'react';
import {
  Typography, Space, Tag, Button, Empty, Spin, Segmented,
  Pagination, Avatar, message, Dropdown
} from 'antd';
import {
  ArrowLeftOutlined, PlusOutlined,
  EyeOutlined, CommentOutlined, LikeOutlined,
  LockOutlined, ClockCircleOutlined, SettingOutlined,
  PushpinFilled, TrophyOutlined, EyeInvisibleOutlined,
  StopOutlined, SafetyCertificateOutlined
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
    isBoardModerator,
    fetchBoardPosts, setPostsSort,
    modTogglePostStatus
  } = useForumStore();

  useEffect(() => {
    if (boardId) fetchBoardPosts(boardId, { page: 1, sort: postsSort });
  }, [boardId]);

  const handleSortChange = (sort) => {
    setPostsSort(sort);
    fetchBoardPosts(boardId, { page: 1, sort });
  };

  const handlePageChange = (page) => {
    fetchBoardPosts(boardId, { page, sort: postsSort });
  };

  /** 点击帖子 - 锁定帖不可进入 */
  const handlePostClick = (post) => {
    const isLocked = post.is_locked === 1 || post.is_locked === true;
    if (isLocked) {
      message.info(t('forum.post.lockedNotice'));
      return;
    }
    onPostClick(post);
  };

  /**
   * v2.3: 版主快捷操作 — 在帖子列表中直接管理
   */
  const handleModAction = async (postId, action, e) => {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    try {
      await modTogglePostStatus(postId, action);
      /* 操作成功后刷新列表 */
      await fetchBoardPosts(boardId, { page: postsPagination.page, sort: postsSort });
    } catch (err) { /* store已处理 */ }
  };

  /** 构建版主操作菜单 */
  const getModMenuItems = (post) => [
    { key: 'pin', icon: <PushpinFilled />, label: post.is_pinned ? t('forum.moderator.unpin') : t('forum.moderator.pin') },
    { key: 'feature', icon: <TrophyOutlined />, label: post.is_featured ? t('forum.moderator.unfeature') : t('forum.moderator.feature') },
    { key: 'hide', icon: <EyeInvisibleOutlined />, label: post.is_hidden ? t('forum.moderator.unhide') : t('forum.moderator.hide') },
    { key: 'lock', icon: <LockOutlined />, label: post.is_locked ? t('forum.moderator.unlock') : t('forum.moderator.lock') },
    { key: 'disable-reply', icon: <StopOutlined />, label: post.is_reply_disabled ? t('forum.moderator.enableReply') : t('forum.moderator.disableReply') }
  ];

  const renderPostItem = (post) => {
    const hasImages = post.attachments?.some(a => a.file_type === 'image');
    const isLocked = post.is_locked === 1 || post.is_locked === true;
    const isPinned = post.is_pinned === 1 || post.is_pinned === true;
    const isFeatured = post.is_featured === 1 || post.is_featured === true;
    const isHidden = post.is_hidden === 1 || post.is_hidden === true;

    return (
      <div
        key={post.id}
        className={`post-list-item ${isLocked ? 'post-locked' : ''}`}
        onClick={() => handlePostClick(post)}
        style={isLocked ? { cursor: 'not-allowed' } : {}}
      >
        <div className="post-item-content">
          {/* 标签行 */}
          <div className="post-tags">
            {isPinned && <Tag color="red">{t('forum.post.pinned')}</Tag>}
            {isFeatured && <Tag color="gold">{t('forum.post.featured')}</Tag>}
            {isLocked && <Tag color="default" icon={<LockOutlined />}>{t('forum.post.locked')}</Tag>}
            {isHidden && <Tag color="orange">{t('forum.post.hidden')}</Tag>}
          </div>

          {/* 标题 */}
          <Text
            strong
            className="post-item-title"
            style={isLocked ? { color: '#999' } : {}}
          >
            {isLocked && <LockOutlined style={{ marginRight: 6, color: '#bbb' }} />}
            {post.title}
          </Text>

          {/* 锁定提示 */}
          {isLocked && (
            <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
              {t('forum.post.lockedNotice')}
            </Text>
          )}

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
              <Text type="secondary" style={{ fontSize: 12 }}><EyeOutlined style={{ marginRight: 2 }} />{post.view_count || 0}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}><CommentOutlined style={{ marginRight: 2 }} />{post.reply_count || 0}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}><LikeOutlined style={{ marginRight: 2 }} />{post.like_count || 0}</Text>
            </Space>
          </div>
        </div>

        {/* 右侧区域 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {/* 图片预览（锁定帖不显示） */}
          {hasImages && !isLocked && (
            <div className="post-item-preview">
              <img src={`/uploads/${post.attachments.find(a => a.file_type === 'image').file_path}`} alt="preview" />
            </div>
          )}

          {/* v2.3: 版主管理按钮 — 显眼的"管理"文字按钮 */}
          {isBoardModerator && (
            <Dropdown
              menu={{
                items: getModMenuItems(post),
                onClick: ({ key, domEvent }) => handleModAction(post.id, key, domEvent)
              }}
              trigger={['click']}
              placement="bottomRight"
            >
              <Button
                type="default"
                size="small"
                icon={<SettingOutlined />}
                onClick={(e) => { e.stopPropagation(); }}
                style={{ borderColor: '#722ed1', color: '#722ed1' }}
              >
                管理
              </Button>
            </Dropdown>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="board-post-list">
      <div className="board-header">
        <div className="header-left">
          <Button icon={<ArrowLeftOutlined />} type="text" onClick={onBack} />
          <Title level={4} style={{ margin: 0 }}>{boardName}</Title>
          {/* v2.3: 版主身份标识 */}
          {isBoardModerator && (
            <Tag color="purple" style={{ marginLeft: 8, fontSize: 11 }}>
              <SafetyCertificateOutlined /> 版主
            </Tag>
          )}
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
          <Button type="primary" icon={<PlusOutlined />} onClick={onNewPost}>{t('forum.post.new')}</Button>
        </Space>
      </div>

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
