/**
 * 社区论坛主页面 v2.1
 * 
 * 修复：从帖子详情返回列表时自动刷新数据，确保状态变更(锁定/置顶等)即时生效
 * 
 * 单页面内部状态切换架构，通过 view 状态在不同视图间导航：
 * - home:       论坛首页（版块列表 + 热帖推荐）
 * - board:      版块帖子列表
 * - postDetail: 帖子详情（内容 + 回复）
 * - newPost:    发帖/编辑帖子
 * - myPosts:    我的帖子
 * - favorites:  我的收藏
 * 
 * @module pages/forum/Forum
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Spin } from 'antd';
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
    fetchUnreadCount, unreadCount,
    fetchBoardPosts, postsSort
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
   * 返回上一视图 — 自动刷新列表数据
   * 
   * v2.1 修复：返回时根据目标视图刷新对应数据
   * - 返回到 board 视图 → 刷新该版块帖子列表
   * - 返回到 home 视图 → 刷新版块列表和热帖
   */
  const goBack = useCallback(() => {
    if (viewHistory.length > 0) {
      const prev = viewHistory[viewHistory.length - 1];
      setViewHistory(h => h.slice(0, -1));
      setView(prev.view);
      setViewParams(prev.params);

      /* 根据返回目标刷新数据 */
      if (prev.view === 'board' && prev.params.boardId) {
        /* 延迟一帧确保视图切换完成后再刷新 */
        setTimeout(() => {
          fetchBoardPosts(prev.params.boardId, { page: 1, sort: postsSort });
        }, 50);
      } else if (prev.view === 'home') {
        setTimeout(() => {
          fetchBoards();
          fetchHotPosts(8);
        }, 50);
      }
    } else {
      setView('home');
      setViewParams({});
      /* 返回首页也刷新 */
      setTimeout(() => {
        fetchBoards();
        fetchHotPosts(8);
      }, 50);
    }
  }, [viewHistory, postsSort, fetchBoardPosts, fetchBoards, fetchHotPosts]);

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
