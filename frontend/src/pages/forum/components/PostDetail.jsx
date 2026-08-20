/**
 * 帖子详情组件 v2.4
 *
 * v2.4 - 国际化修复：
 *        1) 8 处硬编码中文接入 i18n（返回按钮、空回复告警、附件删除确认框的
 *           title/okText/cancelText）；
 *        2) 修复 dayjs 相对时间语言错误【重要】：
 *           原代码模块顶层只有 dayjs.extend(relativeTime)，从未设置 locale，
 *           而 dayjs 默认 locale 为 'en'，导致回复列表的 fromNow() 在中文环境
 *           下也输出 "2 hours ago"。且 dayjs.locale() 是全局状态，本组件的
 *           实际显示语言会取决于"此前哪个组件恰好设置过全局 locale"
 *           （例如 Agent 的 ApiAccessDrawer），形成跨模块隐式耦合。
 *           此处改用【实例级 locale】dayjs(x).locale(l).fromNow()：
 *           既不产生全局副作用，也不受其他组件的全局设置影响。
 *        3) 楼层号原为 `#{floor}` + t('forum.reply.floor') 分段拼接，
 *           中文得到"#1楼"、英文得到"#1F"（不地道）。改为整句插值
 *           forum.reply.floorLabel（中"#{{floor}}楼" / 英"#{{floor}}"）。
 *           旧的 forum.reply.floor 键予以保留，避免影响其他潜在引用。
 *
 * v2.3 - 版主权限：使用后端返回的is_moderator字段判断，指定版主也能看到管理操作
 *      - 返回按钮：从小箭头改为"← 返回论坛"文字按钮
 * v2.2 - 帖子附件支持作者/版主删除
 *
 * @module pages/forum/components/PostDetail
 */

import React, { useEffect, useState } from 'react';
import {
  Typography, Space, Tag, Button, Empty, Spin, Avatar,
  Divider, Input, Pagination, Popconfirm, Dropdown,
  Tooltip, Card, message, Image
} from 'antd';
import {
  ArrowLeftOutlined, LikeOutlined, LikeFilled,
  StarOutlined, StarFilled, CommentOutlined,
  EyeOutlined, EditOutlined, DeleteOutlined,
  MoreOutlined, PushpinFilled, LockOutlined,
  EyeInvisibleOutlined, StopOutlined, TrophyOutlined,
  SendOutlined, CloseCircleFilled
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import useForumStore from '../../../stores/forumStore';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
// 必须显式引入中文 locale 才能在实例上调用 .locale('zh-cn')，
// 仅 import dayjs 时只注册了默认的 'en'
import 'dayjs/locale/zh-cn';

// extend 为一次性插件注册，属幂等操作，可安全放在模块顶层；
// 与之相对，dayjs.locale() 是全局可变状态，绝不可在模块顶层设置
dayjs.extend(relativeTime);

const { Text, Title } = Typography;
const { TextArea } = Input;

/** 回复内容最大长度，与后端 forum_replies.content 校验保持一致 */
const REPLY_MAX_LENGTH = 5000;

/** 文件大小换算基数：字节 → KB */
const BYTES_PER_KB = 1024;

/** 图片附件预览宽度（px） */
const ATTACHMENT_IMAGE_WIDTH = 200;

/**
 * 把 i18n 语言标识映射为 dayjs 的 locale 名
 * 站点语言为 'zh-CN'，dayjs 对应的 locale 名是 'zh-cn'（小写且横线形式不同），
 * 因此不能直接把 i18n.language 传给 dayjs。
 * 用 startsWith('zh') 而非全等，可兼容 zh-TW / zh-Hans 等未来变体。
 */
const toDayjsLocale = (lang) => {
  return lang && lang.toLowerCase().startsWith('zh') ? 'zh-cn' : 'en';
};

const PostDetail = ({ postId, user, onBack, onEditPost }) => {
  // i18n 一并取出：dayjs 实例级 locale 需要当前语言
  const { t, i18n } = useTranslation();
  const {
    currentPost, currentPostLoading,
    replies, repliesLoading, repliesPagination,
    fetchPostDetail, clearCurrentPost,
    fetchReplies, createReply, deletePost, deleteReply,
    togglePostLike, toggleReplyLike, toggleFavorite,
    modTogglePostStatus, modHideReply,
    deleteAttachment
  } = useForumStore();

  const [replyContent, setReplyContent] = useState('');
  const [replyToId, setReplyToId] = useState(null);
  const [replyToName, setReplyToName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  /* v2.2 本地跟踪已删除的附件ID */
  const [deletedAttIds, setDeletedAttIds] = useState(new Set());
  const [deletingAttId, setDeletingAttId] = useState(null);

  // 当前生效的 dayjs locale，随语言切换重算（渲染期求值，无需缓存）
  const dayjsLocale = toDayjsLocale(i18n.language);

  useEffect(() => {
    if (postId) {
      fetchPostDetail(postId);
      fetchReplies(postId, { page: 1 });
      setDeletedAttIds(new Set());
    }
    return () => clearCurrentPost();
    // 依赖只含 postId：本 effect 只负责拉取数据、不产生界面文案，
    // 若把 t 加入依赖，语言切换会重复请求帖子与回复并重置附件删除记录
  }, [postId]);

  const post = currentPost;

  /**
   * v2.3: 版主权限判断 — 使用后端返回的 is_moderator 字段
   * 后端 ForumModeratorService.checkModeratorPermission 会检查：
   * 1. super_admin → 全局版主
   * 2. admin(组管理员) → 本组group版块自动版主
   * 3. forum_moderators表 → 指定版主
   * 前端不再仅靠role判断，指定版主也能看到管理操作
   */
  const isModerator = post?.is_moderator === true || post?.is_moderator === 1;
  const isAuthor = post?.user_id === user?.id;
  /** 是否可以管理附件（作者或版主） */
  const canManageAttachments = isAuthor || isModerator;

  const handleSubmitReply = async () => {
    // 提交按钮已有 disabled 保护，此处为防御性校验（例如未来改为回车提交）
    if (!replyContent.trim()) {
      message.warning(t('forum.reply.emptyWarning'));
      return;
    }
    setSubmitting(true);
    try {
      await createReply(postId, { content: replyContent.trim(), reply_to_id: replyToId });
      setReplyContent('');
      setReplyToId(null);
      setReplyToName('');
    } catch (e) { /* store已处理错误提示 */ }
    setSubmitting(false);
  };

  const handleReplyPage = (page) => fetchReplies(postId, { page });
  const handleModAction = async (action) => await modTogglePostStatus(postId, action);

  /**
   * v2.2 删除帖子附件
   */
  const handleDeleteAttachment = async (attId) => {
    setDeletingAttId(attId);
    try {
      await deleteAttachment(attId);
      setDeletedAttIds(prev => new Set([...prev, attId]));
    } catch (e) { /* store已处理错误提示 */ }
    setDeletingAttId(null);
  };

  /**
   * 版主操作菜单
   * 在渲染期构建而非 useMemo：内部含 t()，若用 useMemo 缓存则必须把 t
   * 加入依赖，否则语言切换后菜单文案不刷新。此处仅 5 项，重建成本可忽略。
   */
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

  /* 过滤掉已删除的附件 */
  const allAttachments = (post.attachments || []).filter(a => !deletedAttIds.has(a.id));
  const imageAttachments = allAttachments.filter(a => a.file_type === 'image');
  const fileAttachments = allAttachments.filter(a => a.file_type === 'file');

  return (
    <div className="post-detail">
      {/* 头部导航 - v2.3: 返回按钮改为"返回论坛"文字 */}
      <div className="post-detail-header">
        <Button
          icon={<ArrowLeftOutlined />}
          type="text"
          onClick={onBack}
          style={{ fontSize: 15, padding: '4px 12px' }}
        >
          {t('forum.backToForum')}
        </Button>
        <Space>
          {(isAuthor || isModerator) && (
            <Button icon={<EditOutlined />} onClick={() => onEditPost(post)}>{t('forum.post.edit')}</Button>
          )}
          {(isAuthor || isModerator) && (
            <Popconfirm title={t('forum.post.deleteConfirm')} onConfirm={() => { deletePost(postId); onBack(); }}>
              <Button icon={<DeleteOutlined />} danger>{t('forum.post.delete')}</Button>
            </Popconfirm>
          )}
          {/* v2.3: 版主操作菜单 — 使用后端is_moderator判断 */}
          {isModerator && (
            <Dropdown menu={{ items: modMenuItems, onClick: ({ key }) => handleModAction(key) }} trigger={['click']}>
              <Button icon={<MoreOutlined />}>{t('forum.moderator.actions')}</Button>
            </Dropdown>
          )}
        </Space>
      </div>

      {/* 帖子内容区 */}
      <Card className="post-content-card">
        {/* 标签 */}
        <Space size={4} wrap style={{ marginBottom: 12 }}>
          {post.is_pinned === 1 && <Tag color="red">{t('forum.post.pinned')}</Tag>}
          {post.is_featured === 1 && <Tag color="gold">{t('forum.post.featured')}</Tag>}
          {post.is_locked === 1 && <Tag icon={<LockOutlined />}>{t('forum.post.locked')}</Tag>}
          {/* 版块名为后台录入的业务数据，不翻译 */}
          {post.board_name && <Tag color="blue">{post.board_name}</Tag>}
        </Space>

        {/* 标题 - 用户发布的业务内容，不翻译 */}
        <Title level={2} style={{ marginBottom: 16, lineHeight: 1.3 }}>{post.title}</Title>

        {/* 作者信息 */}
        <div className="post-author-row">
          <Space align="center">
            <Avatar size={42} style={{ backgroundColor: '#1890ff', fontSize: 18 }}>
              {/* '?' 为无名用户的占位符号，非文案 */}
              {(post.author_name || '?')[0]?.toUpperCase()}
            </Avatar>
            <div>
              <Text strong style={{ fontSize: 15 }}>{post.author_name}</Text>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {/* 纯数字日期格式，中英通用无需本地化 */}
                {dayjs(post.created_at).format('YYYY-MM-DD HH:mm')}
                {post.edit_count > 0 && (
                  <Tag color="orange" style={{ marginLeft: 8, fontSize: 10 }}>{t('forum.post.edited')}</Tag>
                )}
              </Text>
            </div>
          </Space>
        </div>

        {/* 正文 - Markdown排版渲染 */}
        {post.is_locked && !post.content ? (
          <div className="locked-notice">
            <LockOutlined style={{ fontSize: 32, marginBottom: 12, color: '#bbb' }} />
            <Text type="secondary" style={{ fontSize: 15 }}>{t('forum.post.lockedNotice')}</Text>
          </div>
        ) : (
          <div className="post-markdown-content">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{post.content || ''}</ReactMarkdown>
          </div>
        )}

        {/* 图片附件 */}
        {imageAttachments.length > 0 && (
          <div className="post-attachments-images">
            <Image.PreviewGroup>
              {imageAttachments.map(att => (
                <div key={att.id} className="attachment-image-wrapper">
                  <Image
                    src={`/uploads/${att.file_path}`}
                    alt={att.file_name}
                    width={ATTACHMENT_IMAGE_WIDTH}
                    style={{ borderRadius: 8, objectFit: 'cover', cursor: 'pointer' }}
                    placeholder={<div style={{ width: ATTACHMENT_IMAGE_WIDTH, height: 150, background: '#f5f5f5', borderRadius: 8 }} />}
                  />
                  {canManageAttachments && (
                    <Popconfirm
                      title={t('forum.attachment.deleteImageConfirm')}
                      onConfirm={(e) => { e?.stopPropagation(); handleDeleteAttachment(att.id); }}
                      okText={t('forum.attachment.deleteOk')}
                      cancelText={t('forum.attachment.deleteCancel')}
                      okButtonProps={{ danger: true }}
                    >
                      <span
                        className="attachment-delete-btn"
                        onClick={(e) => e.stopPropagation()}
                        style={deletingAttId === att.id ? { opacity: 0.5 } : {}}
                      >
                        <CloseCircleFilled />
                      </span>
                    </Popconfirm>
                  )}
                </div>
              ))}
            </Image.PreviewGroup>
          </div>
        )}

        {/* 文件附件 */}
        {fileAttachments.length > 0 && (
          <div className="post-attachments-files">
            {fileAttachments.map(att => (
              <div key={att.id} className="attachment-file-wrapper">
                <a href={`/uploads/${att.file_path}`} target="_blank" rel="noreferrer" className="attachment-file">
                  {/* 📎 为视觉符号、KB 为技术单位、文件名为业务数据，三者均不翻译 */}
                  📎 {att.file_name} <Text type="secondary" style={{ fontSize: 11 }}>({Math.round((att.file_size || 0) / BYTES_PER_KB)}KB)</Text>
                </a>
                {canManageAttachments && (
                  <Popconfirm
                    title={t('forum.attachment.deleteFileConfirm')}
                    onConfirm={() => handleDeleteAttachment(att.id)}
                    okText={t('forum.attachment.deleteOk')}
                    cancelText={t('forum.attachment.deleteCancel')}
                    okButtonProps={{ danger: true }}
                  >
                    <CloseCircleFilled
                      className="file-delete-btn"
                      style={deletingAttId === att.id ? { opacity: 0.5 } : {}}
                    />
                  </Popconfirm>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 互动栏 */}
        <Divider style={{ margin: '20px 0 14px' }} />
        <div className="post-actions-bar">
          <Space size="large">
            <span className="action-btn" onClick={() => togglePostLike(postId)}>
              {post.is_liked ? <LikeFilled style={{ color: '#1890ff', fontSize: 18 }} /> : <LikeOutlined style={{ fontSize: 18 }} />}
              <span className="action-count">{post.like_count || 0}</span>
            </span>
            <span className="action-btn" onClick={() => toggleFavorite(postId)}>
              {post.is_favorited ? <StarFilled style={{ color: '#faad14', fontSize: 18 }} /> : <StarOutlined style={{ fontSize: 18 }} />}
              <span className="action-count">{post.favorite_count || 0}</span>
            </span>
            <span className="action-btn">
              <EyeOutlined style={{ fontSize: 18 }} />
              <span className="action-count">{post.view_count || 0}</span>
            </span>
            <span className="action-btn">
              <CommentOutlined style={{ fontSize: 18 }} />
              <span className="action-count">{post.reply_count || 0}</span>
            </span>
          </Space>
        </div>
      </Card>

      {/* 回复区 */}
      <div className="replies-section">
        <Title level={5} style={{ marginBottom: 16 }}>
          {/* 💬 为视觉符号，保留在 JSX 不进语言包 */}
          💬 {t('forum.reply.title')} ({post.reply_count || 0})
        </Title>

        {!post.is_reply_disabled ? (
          <div className="reply-input-area">
            {replyToName && (
              <Tag closable onClose={() => { setReplyToId(null); setReplyToName(''); }} style={{ marginBottom: 8 }}>
                {/* @ 为技术标识、用户名为业务数据，仅前缀走 i18n */}
                {t('forum.reply.replyTo')} @{replyToName}
              </Tag>
            )}
            <div className="reply-input-row">
              <TextArea
                value={replyContent}
                onChange={(e) => setReplyContent(e.target.value)}
                placeholder={t('forum.reply.placeholder')}
                autoSize={{ minRows: 2, maxRows: 6 }}
                maxLength={REPLY_MAX_LENGTH}
                showCount
              />
              <Button type="primary" icon={<SendOutlined />} onClick={handleSubmitReply} loading={submitting} disabled={!replyContent.trim()}>
                {t('forum.reply.submit')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="reply-disabled-notice"><StopOutlined /> {t('forum.post.replyDisabled')}</div>
        )}

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
                    <Avatar size={30} style={{ backgroundColor: '#722ed1', fontSize: 13 }}>
                      {(reply.author_name || '?')[0]?.toUpperCase()}
                    </Avatar>
                    <Text strong style={{ fontSize: 14 }}>{reply.author_name}</Text>
                    {/* 楼层号整句插值：中文"#1楼"、英文"#1"，语序与后缀差异交由语言包处理 */}
                    <Tag color="processing" style={{ fontSize: 10, borderRadius: 10 }}>
                      {t('forum.reply.floorLabel', { floor: reply.floor_number })}
                    </Tag>
                    {reply.reply_to_username && <Text type="secondary" style={{ fontSize: 12 }}>» @{reply.reply_to_username}</Text>}
                    {/* 相对时间：用实例级 locale，不调用全局 dayjs.locale() 以免污染其他模块 */}
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {dayjs(reply.created_at).locale(dayjsLocale).fromNow()}
                    </Text>
                    {reply.edit_count > 0 && <Tag color="orange" style={{ fontSize: 10 }}>{t('forum.reply.edited')}</Tag>}
                  </Space>
                  <Space size={4}>
                    <span className="action-btn-sm" onClick={() => toggleReplyLike(reply.id)}>
                      {reply.is_liked ? <LikeFilled style={{ color: '#1890ff' }} /> : <LikeOutlined />}
                      <span>{reply.like_count || 0}</span>
                    </span>
                    <span className="action-btn-sm" onClick={() => { setReplyToId(reply.id); setReplyToName(reply.author_name); }}>
                      <CommentOutlined />
                    </span>
                    {(reply.user_id === user?.id || isModerator) && (
                      <Popconfirm title={t('forum.reply.deleteConfirm')} onConfirm={() => deleteReply(reply.id)}>
                        <span className="action-btn-sm"><DeleteOutlined /></span>
                      </Popconfirm>
                    )}
                    {isModerator && (
                      <Tooltip title={reply.is_hidden ? t('forum.moderator.unhideReply') : t('forum.moderator.hideReply')}>
                        <span className="action-btn-sm" onClick={() => modHideReply(reply.id)}><EyeInvisibleOutlined /></span>
                      </Tooltip>
                    )}
                  </Space>
                </div>
                {reply.is_hidden ? (
                  <Text type="secondary" italic style={{ paddingLeft: 38 }}>{t('forum.reply.hidden')}</Text>
                ) : (
                  <div className="reply-markdown">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{reply.content}</ReactMarkdown>
                  </div>
                )}
              </div>
            ))}
            {repliesPagination.totalPages > 1 && (
              <div className="pagination-wrapper">
                <Pagination current={repliesPagination.page} total={repliesPagination.total} pageSize={repliesPagination.limit} onChange={handleReplyPage} showSizeChanger={false} size="small" />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default PostDetail;
