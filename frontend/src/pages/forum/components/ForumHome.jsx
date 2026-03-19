/**
 * 论坛首页组件 v2.2
 * 
 * v2.2 - 版块卡片显示版主标识（后端返回is_moderator）
 * v2.1 - 锁定帖标题去掉删除线
 * v2.0 - 版块卡片Emoji图标+渐变背景
 * 
 * @module pages/forum/components/ForumHome
 */

import React from 'react';
import {
  Card, Row, Col, Typography, Space, Tag, Button, Empty, Spin, Badge, Tooltip
} from 'antd';
import {
  PlusOutlined, CommentOutlined,
  UserOutlined, BellOutlined,
  HeartOutlined, EyeOutlined, LikeOutlined,
  TeamOutlined, GlobalOutlined, LockOutlined,
  SafetyCertificateOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const { Text, Title, Paragraph } = Typography;

/* 版块图标映射 */
const BOARD_EMOJI_MAP = {
  'CommentOutlined': '💬',
  'CodeOutlined': '💻',
  'BookOutlined': '📚',
  'BugOutlined': '🐛',
  'QuestionCircleOutlined': '❓',
  'BulbOutlined': '💡',
  'RocketOutlined': '🚀',
  'TeamOutlined': '👥',
  'TrophyOutlined': '🏆',
  'HeartOutlined': '❤️'
};

const ForumHome = ({
  boards,
  boardsLoading,
  hotPosts,
  unreadCount,
  onBoardClick,
  onPostClick,
  onNewPost,
  onMyPosts,
  onFavorites,
  onNotifications
}) => {
  const { t } = useTranslation();

  /** 处理帖子点击 - 锁定帖不可进入 */
  const handlePostClick = (post) => {
    if (post.is_locked) return;
    onPostClick(post);
  };

  return (
    <div className="forum-home">
      {/* 顶部工具栏 */}
      <div className="forum-toolbar">
        <div className="toolbar-left">
          <Title level={4} style={{ margin: 0, color: '#1a1a2e' }}>
            💬 {t('forum.title')}
          </Title>
          <Text type="secondary">{t('forum.subtitle')}</Text>
        </div>
        <Space className="toolbar-actions" wrap>
          <Tooltip title={t('forum.notification.title')}>
            <Badge count={unreadCount} size="small" offset={[-2, 2]}>
              <Button
                icon={<BellOutlined />}
                onClick={onNotifications}
                shape="circle"
                size="middle"
              />
            </Badge>
          </Tooltip>
          <Button icon={<HeartOutlined />} onClick={onFavorites}>
            {t('forum.favorite.myFavorites')}
          </Button>
          <Button icon={<UserOutlined />} onClick={onMyPosts}>
            {t('forum.myPosts.title')}
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={onNewPost}>
            {t('forum.post.new')}
          </Button>
        </Space>
      </div>

      {/* 版块列表 */}
      <div className="forum-section">
        <div className="section-header">
          <Title level={5} style={{ margin: 0 }}>
            📋 {t('forum.board.all')}
          </Title>
        </div>

        {boardsLoading ? (
          <div className="loading-center"><Spin /></div>
        ) : boards.length === 0 ? (
          <Empty description={t('forum.board.empty')} />
        ) : (
          <Row gutter={[16, 16]}>
            {boards.map(board => {
              const emoji = BOARD_EMOJI_MAP[board.icon] || '📌';
              const color = board.color || '#1890ff';
              return (
                <Col xs={24} sm={12} md={8} lg={6} key={board.id}>
                  <Card
                    className="board-card"
                    hoverable
                    onClick={() => onBoardClick(board)}
                  >
                    <div className="board-color-bar" style={{ background: `linear-gradient(135deg, ${color}, ${color}99)` }} />
                    <div className="board-card-body">
                      <div className="board-card-header">
                        <div className="board-emoji" style={{ background: `${color}15` }}>
                          <span>{emoji}</span>
                        </div>
                        <div className="board-info">
                          <Text strong className="board-name">{board.name}</Text>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            <Tag
                              color={board.visibility === 'public' ? 'blue' : 'green'}
                              style={{ fontSize: 10, padding: '0 5px', lineHeight: '18px', borderRadius: 4 }}
                            >
                              {board.visibility === 'public' ? <GlobalOutlined /> : <TeamOutlined />}
                              {' '}{t(`forum.board.visibility.${board.visibility}`)}
                            </Tag>
                            {/* v2.2: 版主标识 — 后端返回is_moderator */}
                            {board.is_moderator && (
                              <Tag
                                color="purple"
                                style={{ fontSize: 10, padding: '0 5px', lineHeight: '18px', borderRadius: 4 }}
                              >
                                <SafetyCertificateOutlined /> 版主
                              </Tag>
                            )}
                          </div>
                        </div>
                      </div>
                      {board.description && (
                        <Paragraph className="board-desc" ellipsis={{ rows: 2 }} type="secondary">
                          {board.description}
                        </Paragraph>
                      )}
                      <div className="board-stats">
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          <CommentOutlined /> {board.post_count || 0} {t('forum.board.posts')}
                        </Text>
                        {board.last_post_at && (
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            {dayjs(board.last_post_at).fromNow()}
                          </Text>
                        )}
                      </div>
                    </div>
                  </Card>
                </Col>
              );
            })}
          </Row>
        )}
      </div>

      {/* 热帖推荐 */}
      {hotPosts.length > 0 && (
        <div className="forum-section">
          <div className="section-header">
            <Title level={5} style={{ margin: 0 }}>
              🔥 {t('forum.hotPosts.title')}
            </Title>
          </div>

          <div className="hot-posts-list">
            {hotPosts.map((post, index) => {
              const isLocked = post.is_locked === 1 || post.is_locked === true;
              return (
                <div
                  key={post.id}
                  className={`hot-post-item ${isLocked ? 'hot-post-locked' : ''}`}
                  onClick={() => handlePostClick(post)}
                  style={isLocked ? { cursor: 'not-allowed', opacity: 0.6 } : {}}
                >
                  <span className={`hot-rank rank-${index < 3 ? index + 1 : 'normal'}`}>
                    {index + 1}
                  </span>
                  <div className="hot-post-content">
                    <div className="hot-post-tags">
                      {post.is_pinned ? <Tag color="red" style={{ fontSize: 10 }}>{t('forum.post.pinned')}</Tag> : null}
                      {post.is_featured ? <Tag color="gold" style={{ fontSize: 10 }}>{t('forum.post.featured')}</Tag> : null}
                      {isLocked && <Tag color="default" icon={<LockOutlined />} style={{ fontSize: 10 }}>{t('forum.post.locked')}</Tag>}
                    </div>
                    <Text
                      strong
                      ellipsis={{ tooltip: isLocked ? `${post.title}（已锁定）` : post.title }}
                      className="hot-post-title"
                      style={isLocked ? { color: '#999' } : {}}
                    >
                      {post.title}
                    </Text>
                    <Space size="middle" className="hot-post-meta">
                      <Text type="secondary" style={{ fontSize: 12 }}>{post.author_name}</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}><EyeOutlined /> {post.view_count || 0}</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}><CommentOutlined /> {post.reply_count || 0}</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}><LikeOutlined /> {post.like_count || 0}</Text>
                      {post.board_name && <Tag style={{ fontSize: 10, padding: '0 4px' }}>{post.board_name}</Tag>}
                    </Space>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default ForumHome;
