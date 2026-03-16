/**
 * 帖子详情组件
 * 
 * 展示帖子内容、作者信息、互动按钮、回复列表
 * 版主操作面板（有权限时显示）
 * Markdown 内容渲染
 * 
 * @module pages/forum/components/PostDetail
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  Typography, Space, Tag, Button, Empty, Spin, Avatar,
  Divider, Input, Pagination, Popconfirm, Dropdown,
  Tooltip, Card, message
} from 'antd';
import {
  ArrowLeftOutlined, LikeOutlined, LikeFilled,
  StarOutlined, StarFilled, CommentOutlined,
  EyeOutlined, EditOutlined, DeleteOutlined,
  MoreOutlined, PushpinFilled, LockOutlined,
  EyeInvisibleOutlined, StopOutlined, TrophyOutlined,
  SendOutlined, ClockCircleOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import useForumStore from '../../../stores/forumStore';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

const { Text, Title, Paragraph } = Typography;
const { TextArea } = Input;

const PostDetail = ({ postId, user, onBack, onEditPost }) => {
  const { t } = useTranslation();
  const {
    currentPost, currentPostLoading,
    replies, repliesLoading, repliesPagination,
    fetchPostDetail, clearCurrentPost,
    fetchReplies, createReply, deletePost, deleteReply,
    togglePostLike, toggleReplyLike, toggleFavorite,
    modTogglePostStatus, modHideReply
  } = useForumStore();

  const [replyContent, setReplyContent] = useState('');
  const [replyToId, setReplyToId] = useState(null);
  const [replyToName, setReplyToName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  /* 加载帖子和回复 */
  useEffect(() => {
    if (postId) {
      fetchPostDetail(postId);
      fetchReplies(postId, { page: 1 });
    }
    return () => clearCurrentPost();
  }, [postId]);

  const post = currentPost;
  const isModerator = user?.role === 'super_admin' || user?.role === 'admin';
  const isAuthor = post?.user_id === user?.id;

  /* 发回复 */
  const handleSubmitReply = async () => {
    if (!replyContent.trim()) return message.warning('回复内容不能为空');
    setSubmitting(true);
    try {
      await createReply(postId, {
        content: replyContent.trim(),
        reply_to_id: replyToId
      });
      setReplyContent('');
      setReplyToId(null);
      setReplyToName('');
    } catch (e) { /* store已处理 */ }
    setSubmitting(false);
  };

  /* 回复翻页 */
  const handleReplyPage = (page) => {
    fetchReplies(postId, { page });
  };

  /* 版主操作 */
  const handleModAction = async (action) => {
    await modTogglePostStatus(postId, action);
  };

  /* 版主下拉菜单 */
  const modMenuItems = post ? [
    { key: 'pin', icon: <PushpinFilled />, label: post.is_pinned ? t('forum.moderator.unpin') : t('forum.moderator.pin') },
    { key: 'feature', icon: <TrophyOutlined />, label: post.is_featured ? t('forum.moderator.unfeature') : t('forum.moderator.feature') },
    { key: 'hide', icon: <EyeInvisibleOutlined />, label: post.is_hidden ? t('forum.moderator.unhide') : t('forum.moderator.hide') },
    { key: 'lock', icon: <LockOutlined />, label: post.is_locked ? t('forum.moderator.unlock') : t('forum.moderator.lock') },
    { key: 'disable-reply', icon: <StopOutlined />, label: post.is_reply_disabled ? t('forum.moderator.enableReply') : t('forum.moderator.disableReply') }
  ] : [];

  if (currentPostLoading || !post) {
    return <div className="loading-center" style={{ minHeight: 400 }}><Spin size="large" /></div>;
  }

  return (
    <div className="post-detail">
      {/* 头部导航 */}
      <div className="post-detail-header">
        <Button icon={<ArrowLeftOutlined />} type="text" onClick={onBack} />
        <Space>
          {(isAuthor || isModerator) && (
            <Button icon={<EditOutlined />} onClick={() => onEditPost(post)}>
              {t('forum.post.edit')}
            </Button>
          )}
          {(isAuthor || isModerator) && (
            <Popconfirm title={t('forum.post.deleteConfirm')} onConfirm={() => { deletePost(postId); onBack(); }}>
              <Button icon={<DeleteOutlined />} danger>{t('forum.post.delete')}</Button>
            </Popconfirm>
          )}
          {isModerator && (
            <Dropdown
              menu={{ items: modMenuItems, onClick: ({ key }) => handleModAction(key) }}
              trigger={['click']}
            >
              <Button icon={<MoreOutlined />}>{t('forum.moderator.actions')}</Button>
            </Dropdown>
          )}
        </Space>
      </div>

      {/* 帖子内容区 */}
      <Card className="post-content-card">
        {/* 标签 */}
        <Space size={4} wrap style={{ marginBottom: 8 }}>
          {post.is_pinned === 1 && <Tag color="red">{t('forum.post.pinned')}</Tag>}
          {post.is_featured === 1 && <Tag color="gold">{t('forum.post.featured')}</Tag>}
          {post.is_locked === 1 && <Tag icon={<LockOutlined />}>{t('forum.post.locked')}</Tag>}
          {post.board_name && <Tag>{post.board_name}</Tag>}
        </Space>

        {/* 标题 */}
        <Title level={3} style={{ marginBottom: 12 }}>{post.title}</Title>

        {/* 作者信息 */}
        <div className="post-author-row">
          <Space>
            <Avatar style={{ backgroundColor: '#1890ff' }}>
              {(post.author_name || '?')[0]?.toUpperCase()}
            </Avatar>
            <div>
              <Text strong>{post.author_name}</Text>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {dayjs(post.created_at).format('YYYY-MM-DD HH:mm')}
                {post.edit_count > 0 && (
                  <span style={{ marginLeft: 8, color: '#faad14' }}>
                    ({t('forum.post.edited')})
                  </span>
                )}
              </Text>
            </div>
          </Space>
        </div>

        {/* 正文（锁定时遮蔽） */}
        {post.is_locked && !post.content ? (
          <div className="locked-notice">
            <LockOutlined style={{ fontSize: 24, marginBottom: 8 }} />
            <Text type="secondary">{t('forum.post.lockedNotice')}</Text>
          </div>
        ) : (
          <div className="post-markdown-content">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {post.content || ''}
            </ReactMarkdown>
          </div>
        )}

        {/* 附件展示 */}
        {post.attachments && post.attachments.length > 0 && (
          <div className="post-attachments">
            {post.attachments.filter(a => a.file_type === 'image').map(att => (
              <img key={att.id} src={`/uploads/${att.file_path}`} alt={att.file_name} className="attachment-image" />
            ))}
            {post.attachments.filter(a => a.file_type === 'file').map(att => (
              <a key={att.id} href={`/uploads/${att.file_path}`} target="_blank" rel="noreferrer" className="attachment-file">
                📎 {att.file_name}
              </a>
            ))}
          </div>
        )}

        {/* 互动栏 */}
        <Divider style={{ margin: '16px 0 12px' }} />
        <div className="post-actions-bar">
          <Space size="large">
            <span className="action-btn" onClick={() => togglePostLike(postId)}>
              {post.is_liked ? <LikeFilled style={{ color: '#1890ff' }} /> : <LikeOutlined />}
              <span className="action-count">{post.like_count || 0}</span>
            </span>
            <span className="action-btn" onClick={() => toggleFavorite(postId)}>
              {post.is_favorited ? <StarFilled style={{ color: '#faad14' }} /> : <StarOutlined />}
              <span className="action-count">{post.favorite_count || 0}</span>
            </span>
            <span className="action-btn">
              <EyeOutlined />
              <span className="action-count">{post.view_count || 0}</span>
            </span>
            <span className="action-btn">
              <CommentOutlined />
              <span className="action-count">{post.reply_count || 0}</span>
            </span>
          </Space>
        </div>
      </Card>

      {/* 回复区 */}
      <div className="replies-section">
        <Title level={5} style={{ marginBottom: 16 }}>
          {t('forum.reply.title')} ({post.reply_count || 0})
        </Title>

        {/* 回复输入 */}
        {!post.is_reply_disabled ? (
          <div className="reply-input-area">
            {replyToName && (
              <Tag closable onClose={() => { setReplyToId(null); setReplyToName(''); }}>
                {t('forum.reply.replyTo')} @{replyToName}
              </Tag>
            )}
            <div className="reply-input-row">
              <TextArea
                value={replyContent}
                onChange={(e) => setReplyContent(e.target.value)}
                placeholder={t('forum.reply.placeholder')}
                autoSize={{ minRows: 2, maxRows: 6 }}
                maxLength={5000}
                showCount
              />
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={handleSubmitReply}
                loading={submitting}
                disabled={!replyContent.trim()}
              >
                {t('forum.reply.submit')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="reply-disabled-notice">
            <StopOutlined /> {t('forum.post.replyDisabled')}
          </div>
        )}

        {/* 回复列表 */}
        {repliesLoading ? (
          <div className="loading-center"><Spin /></div>
        ) : replies.length === 0 ? (
          <Empty description={t('forum.reply.empty')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <>
            {replies.map(reply => (
              <div key={reply.id} className={`reply-item ${reply.is_hidden ? 'reply-hidden' : ''}`}>
                <div className="reply-header">
                  <Space>
                    <Avatar size={28} style={{ backgroundColor: '#722ed1', fontSize: 12 }}>
                      {(reply.author_name || '?')[0]?.toUpperCase()}
                    </Avatar>
                    <Text strong style={{ fontSize: 13 }}>{reply.author_name}</Text>
                    <Text type="secondary" style={{ fontSize: 11 }}>#{reply.floor_number}{t('forum.reply.floor')}</Text>
                    {reply.reply_to_username && (
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        » @{reply.reply_to_username}
                      </Text>
                    )}
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {dayjs(reply.created_at).fromNow()}
                    </Text>
                    {reply.edit_count > 0 && (
                      <Tag color="orange" style={{ fontSize: 10 }}>{t('forum.reply.edited')}</Tag>
                    )}
                  </Space>
                  <Space size={4}>
                    <span className="action-btn-sm" onClick={() => toggleReplyLike(reply.id)}>
                      {reply.is_liked ? <LikeFilled style={{ color: '#1890ff' }} /> : <LikeOutlined />}
                      <span>{reply.like_count || 0}</span>
                    </span>
                    <span
                      className="action-btn-sm"
                      onClick={() => { setReplyToId(reply.id); setReplyToName(reply.author_name); }}
                    >
                      <CommentOutlined />
                    </span>
                    {(reply.user_id === user?.id || isModerator) && (
                      <Popconfirm title={t('forum.reply.deleteConfirm')} onConfirm={() => deleteReply(reply.id)}>
                        <span className="action-btn-sm"><DeleteOutlined /></span>
                      </Popconfirm>
                    )}
                    {isModerator && (
                      <Tooltip title={reply.is_hidden ? t('forum.moderator.unhideReply') : t('forum.moderator.hideReply')}>
                        <span className="action-btn-sm" onClick={() => modHideReply(reply.id)}>
                          <EyeInvisibleOutlined />
                        </span>
                      </Tooltip>
                    )}
                  </Space>
                </div>
                {reply.is_hidden ? (
                  <Text type="secondary" italic>{t('forum.reply.hidden')}</Text>
                ) : (
                  <div className="reply-markdown">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{reply.content}</ReactMarkdown>
                  </div>
                )}
              </div>
            ))}

            {repliesPagination.totalPages > 1 && (
              <div className="pagination-wrapper">
                <Pagination
                  current={repliesPagination.page}
                  total={repliesPagination.total}
                  pageSize={repliesPagination.limit}
                  onChange={handleReplyPage}
                  showSizeChanger={false}
                  size="small"
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default PostDetail;
