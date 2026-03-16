/**
 * 社区论坛主页面
 * 
 * 单页面内部状态切换架构，通过 view 状态在不同视图间导航：
 * - home:       论坛首页（版块列表 + 热帖推荐）
 * - board:      版块帖子列表
 * - postDetail: 帖子详情（内容 + 回复）
 * - newPost:    发帖/编辑帖子
 * - myPosts:    我的帖子
 * - favorites:  我的收藏
 * 
 * iOS 毛玻璃风格，延续平台统一设计语言
 * 
 * @module pages/forum/Forum
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Spin, message } from 'antd';
import { useTranslation } from 'react-i18next';
import useForumStore from '../../stores/forumStore';
import useAuthStore from '../../stores/authStore';
import ForumHome from './components/ForumHome';
import BoardPostList from './components/BoardPostList';
import PostDetail from './components/PostDetail';
import PostEditor from './components/PostEditor';
import MyPostsView from './components/MyPostsView';
import FavoritesView from './components/FavoritesView';
import './Forum.less';

const Forum = () => {
  const { t } = useTranslation();
  const user = useAuthStore(state => state.user);

  /* 视图状态 */
  const [view, setView] = useState('home');
  const [viewParams, setViewParams] = useState({});
  const [viewHistory, setViewHistory] = useState([]);

  /* Store */
  const {
    boards, boardsLoading, fetchBoards,
    hotPosts, fetchHotPosts,
    fetchUnreadCount, unreadCount
  } = useForumStore();

  /* 初始化 */
  useEffect(() => {
    fetchBoards();
    fetchHotPosts(8);
    fetchUnreadCount();
  }, []);

  /**
   * 导航到指定视图（支持历史回退）
   */
  const navigate = useCallback((newView, params = {}) => {
    setViewHistory(prev => [...prev, { view, params: viewParams }]);
    setView(newView);
    setViewParams(params);
  }, [view, viewParams]);

  /**
   * 返回上一视图
   */
  const goBack = useCallback(() => {
    if (viewHistory.length > 0) {
      const prev = viewHistory[viewHistory.length - 1];
      setViewHistory(h => h.slice(0, -1));
      setView(prev.view);
      setViewParams(prev.params);
    } else {
      setView('home');
      setViewParams({});
    }
  }, [viewHistory]);

  /**
   * 渲染当前视图
   */
  const renderView = () => {
    switch (view) {
      case 'home':
        return (
          <ForumHome
            boards={boards}
            boardsLoading={boardsLoading}
            hotPosts={hotPosts}
            unreadCount={unreadCount}
            onBoardClick={(board) => navigate('board', { boardId: board.id, boardName: board.name })}
            onPostClick={(post) => navigate('postDetail', { postId: post.id })}
            onNewPost={() => navigate('newPost')}
            onMyPosts={() => navigate('myPosts')}
            onFavorites={() => navigate('favorites')}
            onNotifications={() => navigate('notifications')}
          />
        );

      case 'board':
        return (
          <BoardPostList
            boardId={viewParams.boardId}
            boardName={viewParams.boardName}
            user={user}
            onBack={goBack}
            onPostClick={(post) => navigate('postDetail', { postId: post.id })}
            onNewPost={() => navigate('newPost', { boardId: viewParams.boardId, boardName: viewParams.boardName })}
          />
        );

      case 'postDetail':
        return (
          <PostDetail
            postId={viewParams.postId}
            user={user}
            onBack={goBack}
            onEditPost={(post) => navigate('newPost', { editPost: post })}
          />
        );

      case 'newPost':
        return (
          <PostEditor
            boards={boards}
            defaultBoardId={viewParams.boardId}
            editPost={viewParams.editPost}
            onBack={goBack}
            onSuccess={(post) => {
              if (viewParams.editPost) {
                goBack();
              } else {
                /* 发帖成功后跳转到帖子详情 */
                setViewHistory([{ view: 'home', params: {} }]);
                setView('postDetail');
                setViewParams({ postId: post.id });
              }
              fetchBoards();
            }}
          />
        );

      case 'myPosts':
        return (
          <MyPostsView
            onBack={goBack}
            onPostClick={(post) => navigate('postDetail', { postId: post.id })}
          />
        );

      case 'favorites':
        return (
          <FavoritesView
            onBack={goBack}
            onPostClick={(post) => navigate('postDetail', { postId: post.id })}
          />
        );

      default:
        return null;
    }
  };

  return (
    <div className="forum-page">
      {renderView()}
    </div>
  );
};

export default Forum;
