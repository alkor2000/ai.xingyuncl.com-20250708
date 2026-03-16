/**
 * 论坛首页组件
 * 
 * 展示版块列表和热帖推荐
 * 顶部工具栏：发帖按钮、我的帖子、收藏、通知
 * 
 * @module pages/forum/components/ForumHome
 */

import React from 'react';
import {
  Card, Row, Col, Typography, Space, Tag, Button, Empty, Spin, Badge, Tooltip, Divider
} from 'antd';
import {
  PlusOutlined, FireOutlined, CommentOutlined,
  UserOutlined, StarOutlined, BellOutlined,
  HeartOutlined, EyeOutlined, LikeOutlined,
  TeamOutlined, GlobalOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const { Text, Title, Paragraph } = Typography;

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

  return (
    <div className="forum-home">
      {/* 顶部工具栏 */}
      <div className="forum-toolbar">
        <div className="toolbar-left">
          <Title level={4} style={{ margin: 0 }}>
            <CommentOutlined style={{ marginRight: 8 }} />
            {t('forum.title')}
          </Title>
          <Text type="secondary">{t('forum.subtitle')}</Text>
        </div>
        <Space className="toolbar-actions">
          <Tooltip title={t('forum.notification.title')}>
            <Badge count={unreadCount} size="small">
              <Button
                icon={<BellOutlined />}
                onClick={onNotifications}
                shape="circle"
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
            {t('forum.board.all')}
          </Title>
        </div>

        {boardsLoading ? (
          <div className="loading-center"><Spin /></div>
        ) : boards.length === 0 ? (
          <Empty description={t('forum.board.empty')} />
        ) : (
          <Row gutter={[12, 12]}>
            {boards.map(board => (
              <Col xs={24} sm={12} md={8} lg={6} key={board.id}>
                <Card
                  className="board-card"
                  hoverable
                  onClick={() => onBoardClick(board)}
                  style={{ borderLeft: `3px solid ${board.color || '#1890ff'}` }}
                >
                  <div className="board-card-header">
                    <div
                      className="board-icon"
                      style={{ backgroundColor: `${board.color || '#1890ff'}20`, color: board.color || '#1890ff' }}
                    >
                      <CommentOutlined />
                    </div>
                    <div className="board-info">
                      <Text strong className="board-name">{board.name}</Text>
                      <Tag
                        color={board.visibility === 'public' ? 'blue' : 'green'}
                        style={{ fontSize: 10, padding: '0 4px', lineHeight: '16px' }}
                      >
                        {board.visibility === 'public' ? <GlobalOutlined /> : <TeamOutlined />}
                        {' '}
                        {t(`forum.board.visibility.${board.visibility}`)}
                      </Tag>
                    </div>
                  </div>
                  {board.description && (
                    <Paragraph
                      className="board-desc"
                      ellipsis={{ rows: 2 }}
                      type="secondary"
                    >
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
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </div>

      {/* 热帖推荐 */}
      {hotPosts.length > 0 && (
        <div className="forum-section">
          <div className="section-header">
            <Title level={5} style={{ margin: 0 }}>
              <FireOutlined style={{ color: '#ff4d4f', marginRight: 6 }} />
              {t('forum.hotPosts.title')}
            </Title>
          </div>

          <div className="hot-posts-list">
            {hotPosts.map((post, index) => (
              <div
                key={post.id}
                className="hot-post-item"
                onClick={() => onPostClick(post)}
              >
                <span className={`hot-rank rank-${index < 3 ? index + 1 : 'normal'}`}>
                  {index + 1}
                </span>
                <div className="hot-post-content">
                  <Text strong ellipsis={{ tooltip: post.title }} className="hot-post-title">
                    {post.is_pinned ? <Tag color="red" style={{ fontSize: 10, marginRight: 4 }}>{t('forum.post.pinned')}</Tag> : null}
                    {post.is_featured ? <Tag color="gold" style={{ fontSize: 10, marginRight: 4 }}>{t('forum.post.featured')}</Tag> : null}
                    {post.title}
                  </Text>
                  <Space size="middle" className="hot-post-meta">
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {post.author_name}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      <EyeOutlined /> {post.view_count || 0}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      <CommentOutlined /> {post.reply_count || 0}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      <LikeOutlined /> {post.like_count || 0}
                    </Text>
                    {post.board_name && (
                      <Tag style={{ fontSize: 10, padding: '0 4px' }}>{post.board_name}</Tag>
                    )}
                  </Space>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ForumHome;
