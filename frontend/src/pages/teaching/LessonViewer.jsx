/**
 * 课程查看器组件（最终优化版）
 * 优化：
 * 1. 底部控制条字体加粗
 * 2. 恢复全屏模式快捷键（F键、左右键）
 * 3. 修复翻译键（common.edit）
 */

import React, { useEffect, useState, useRef } from 'react';
import {
  Button,
  Space,
  Empty,
  Spin,
  Progress,
  Tooltip,
  message,
  Divider,
  Dropdown
} from 'antd';
import {
  ArrowLeftOutlined,
  EditOutlined,
  LeftOutlined,
  RightOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
  EllipsisOutlined,
  SettingOutlined,
  BookOutlined,
  FileTextOutlined,
  AimOutlined
} from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import useTeachingStore from '../../stores/teachingStore';
import useAuthStore from '../../stores/authStore';

const LessonViewer = () => {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const {
    currentLesson,
    currentLessonLoading,
    fetchLesson,
    recordView
  } = useTeachingStore();

  const [currentPage, setCurrentPage] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [viewStartTime, setViewStartTime] = useState(Date.now());
  const [pageViewTime, setPageViewTime] = useState(Date.now());
  const [showControls, setShowControls] = useState(false);
  const iframeRef = useRef(null);
  const containerRef = useRef(null);
  const hideTimerRef = useRef(null);

  // 加载课程数据
  useEffect(() => {
    if (id) {
      loadLesson();
    }
  }, [id]);

  const loadLesson = async () => {
    try {
      await fetchLesson(id);
      setViewStartTime(Date.now());
      setPageViewTime(Date.now());
    } catch (error) {
      message.error(t('teaching.loadFailed'));
    }
  };

  // 记录页面浏览
  useEffect(() => {
    if (!currentLesson) return;

    const recordPageView = () => {
      const duration = Math.floor((Date.now() - pageViewTime) / 1000);
      const totalPages = getPages().length;
      const isCompleted = currentPage === totalPages;

      recordView({
        module_id: currentLesson.module_id,
        lesson_id: currentLesson.id,
        page_number: currentPage,
        duration,
        is_completed: isCompleted
      });
    };

    return () => {
      recordPageView();
    };
  }, [currentPage, currentLesson]);

  // 鼠标进入触发区域显示控制条
  const handleMouseEnterTrigger = () => {
    if (!isFullscreen) return;
    
    setShowControls(true);
    
    // 清除之前的计时器
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
    }
    
    // 3秒后隐藏
    hideTimerRef.current = setTimeout(() => {
      setShowControls(false);
    }, 3000);
  };

  // 鼠标在控制条上移动，重置隐藏计时器
  const handleMouseMoveOnControls = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
    }
    
    hideTimerRef.current = setTimeout(() => {
      setShowControls(false);
    }, 3000);
  };

  // 清理计时器
  useEffect(() => {
    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, []);

  // 全屏模式快捷键支持
  useEffect(() => {
    if (!isFullscreen) return;

    const handleKeyPress = (e) => {
      switch(e.key) {
        case 'ArrowLeft':
          handlePrevPage();
          break;
        case 'ArrowRight':
          handleNextPage();
          break;
        case 'f':
        case 'F':
          toggleFullscreen();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [isFullscreen, currentPage]);

  // 获取页面列表
  const getPages = () => {
    if (!currentLesson?.content) return [];
    
    try {
      const content = typeof currentLesson.content === 'string'
        ? JSON.parse(currentLesson.content)
        : currentLesson.content;
      
      return content.pages || [];
    } catch (error) {
      console.error('解析课程内容失败:', error);
      return [];
    }
  };

  // 获取当前页面内容
  const getCurrentPageContent = () => {
    const pages = getPages();
    if (pages.length === 0) {
      return `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8">
            <style>
              body {
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                margin: 0;
                font-family: system-ui;
                color: #999;
              }
            </style>
          </head>
          <body>
            <div>${t('teaching.noContent')}</div>
          </body>
        </html>
      `;
    }

    const page = pages[currentPage - 1];
    return page?.html || page?.content || '';
  };

  // 返回模块详情
  const handleBack = () => {
    if (currentLesson?.module_id) {
      navigate(`/teaching/modules/${currentLesson.module_id}`);
    } else {
      navigate('/teaching');
    }
  };

  // 编辑课程
  const handleEdit = () => {
    navigate(`/teaching/lessons/${id}/edit`);
  };

  // 切换页面
  const handlePageChange = (page) => {
    setCurrentPage(page);
    setPageViewTime(Date.now());
  };

  // 上一页
  const handlePrevPage = () => {
    if (currentPage > 1) {
      handlePageChange(currentPage - 1);
    }
  };

  // 下一页
  const handleNextPage = () => {
    const pages = getPages();
    if (currentPage < pages.length) {
      handlePageChange(currentPage + 1);
    }
  };

  // 全屏切换
  const toggleFullscreen = () => {
    if (!isFullscreen) {
      const elem = containerRef.current;
      if (elem?.requestFullscreen) {
        elem.requestFullscreen();
      } else if (elem?.webkitRequestFullscreen) {
        elem.webkitRequestFullscreen();
      }
      setIsFullscreen(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
      setIsFullscreen(false);
    }
  };

  // 监听全屏变化
  useEffect(() => {
    const handleFullscreenChange = () => {
      const fullscreen = !!document.fullscreenElement;
      setIsFullscreen(fullscreen);
      // 退出全屏时重置控制条状态
      if (!fullscreen) {
        setShowControls(false);
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  // 更多菜单
  const moreMenuItems = {
    items: [
      {
        key: 'settings',
        label: t('common.settings'),
        icon: <SettingOutlined />,
        onClick: () => message.info('设置功能开发中')
      },
      {
        key: 'teaching_plan',
        label: t('teaching.teachingPlan'),
        icon: <BookOutlined />,
        onClick: () => message.info('教案功能开发中')
      },
      {
        key: 'homework',
        label: t('teaching.homework'),
        icon: <FileTextOutlined />,
        onClick: () => message.info('作业功能开发中')
      }
    ]
  };

  if (currentLessonLoading || !currentLesson) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh' 
      }}>
        <Spin size="large" tip={t('common.loading')} />
      </div>
    );
  }

  const pages = getPages();
  const totalPages = pages.length;
  const progress = totalPages > 0 ? Math.round((currentPage / totalPages) * 100) : 0;

  return (
    <div 
      ref={containerRef}
      style={{ 
        height: '100vh', 
        display: 'flex', 
        flexDirection: 'column',
        background: isFullscreen ? '#000' : '#f0f2f5',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      {/* 非全屏模式：顶部操作栏（优化布局） */}
      {!isFullscreen && (
        <div style={{
          background: 'white',
          padding: '12px 24px',
          borderBottom: '1px solid #e8e8e8',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          {/* 左侧：返回按钮 */}
          <Button 
            icon={<ArrowLeftOutlined />} 
            onClick={handleBack}
            size="large"
          >
            {t('common.back')}
          </Button>

          {/* 中间：翻页控制 */}
          <Space size="middle">
            <Button
              icon={<LeftOutlined />}
              disabled={currentPage === 1}
              onClick={handlePrevPage}
            >
              {t('teaching.prevPage')}
            </Button>

            <span style={{ 
              fontSize: 14, 
              color: '#666',
              fontWeight: 500,
              minWidth: 120,
              textAlign: 'center'
            }}>
              {t('teaching.pageInfo', { current: currentPage, total: totalPages })}
            </span>

            <Button
              icon={<RightOutlined />}
              disabled={currentPage === totalPages}
              onClick={handleNextPage}
              type="primary"
            >
              {t('teaching.nextPage')}
            </Button>
          </Space>

          {/* 右侧：功能按钮 */}
          <Space size="middle">
            {/* 进度 */}
            <Tooltip title={`${t('teaching.progress')}: ${progress}%`}>
              <div style={{ 
                display: 'flex', 
                alignItems: 'center',
                gap: 8,
                cursor: 'default'
              }}>
                <AimOutlined style={{ color: '#52c41a', fontSize: 16 }} />
                <Progress
                  type="circle"
                  percent={progress}
                  width={40}
                  strokeColor="#52c41a"
                  format={(percent) => `${percent}%`}
                />
              </div>
            </Tooltip>

            {/* 编辑 */}
            <Button icon={<EditOutlined />} onClick={handleEdit}>
              {t('common.edit')}
            </Button>

            {/* 全屏（加大显眼） */}
            <Tooltip title={t('teaching.fullscreen')}>
              <Button
                type="primary"
                size="large"
                icon={<FullscreenOutlined style={{ fontSize: 18 }} />}
                onClick={toggleFullscreen}
                style={{
                  height: 44,
                  paddingLeft: 20,
                  paddingRight: 20
                }}
              >
                {t('teaching.fullscreen')}
              </Button>
            </Tooltip>
          </Space>
        </div>
      )}

      {/* 全屏内容区域 */}
      <div style={{ 
        flex: 1,
        background: '#fff',
        overflow: 'hidden',
        position: 'relative'
      }}>
        {totalPages > 0 ? (
          <iframe
            ref={iframeRef}
            srcDoc={getCurrentPageContent()}
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              display: 'block'
            }}
            sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"
            title={`Page ${currentPage}`}
          />
        ) : (
          <Empty
            description={t('teaching.noContent')}
            style={{ 
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)'
            }}
          />
        )}
      </div>

      {/* 全屏模式：底部透明触发区域 + 控制条 */}
      {isFullscreen && (
        <>
          {/* 底部透明触发区域（200px高度） */}
          <div
            onMouseEnter={handleMouseEnterTrigger}
            style={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              height: 200,
              pointerEvents: 'auto',
              zIndex: 998
            }}
          />

          {/* 底部控制条（更透明：0.25，字体加粗） */}
          <div
            onMouseMove={handleMouseMoveOnControls}
            style={{
              position: 'fixed',
              bottom: 30,
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(0, 0, 0, 0.25)',
              backdropFilter: 'blur(10px)',
              borderRadius: 40,
              padding: '8px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              transition: 'opacity 0.3s ease',
              opacity: showControls ? 1 : 0,
              pointerEvents: showControls ? 'auto' : 'none',
              zIndex: 999,
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
            }}
          >
            {/* 上一页 */}
            <Tooltip title={t('teaching.prevPage')} placement="top">
              <Button
                type="text"
                icon={<LeftOutlined />}
                disabled={currentPage === 1}
                onClick={handlePrevPage}
                style={{
                  color: 'white',
                  borderRadius: 20,
                  opacity: currentPage === 1 ? 0.3 : 1
                }}
              />
            </Tooltip>

            {/* 页码显示（加粗字体） */}
            <span style={{ 
              color: 'white', 
              fontSize: 13,
              fontWeight: 'bold',
              minWidth: 80,
              textAlign: 'center',
              userSelect: 'none'
            }}>
              {currentPage} / {totalPages}
            </span>

            {/* 下一页 */}
            <Tooltip title={t('teaching.nextPage')} placement="top">
              <Button
                type="text"
                icon={<RightOutlined />}
                disabled={currentPage === totalPages}
                onClick={handleNextPage}
                style={{
                  color: 'white',
                  borderRadius: 20,
                  opacity: currentPage === totalPages ? 0.3 : 1
                }}
              />
            </Tooltip>

            <Divider type="vertical" style={{ 
              background: 'rgba(255, 255, 255, 0.2)', 
              height: 20,
              margin: '0 4px'
            }} />

            {/* 进度 */}
            <Tooltip title={`${t('teaching.progress')}: ${progress}%`} placement="top">
              <div style={{ cursor: 'default' }}>
                <Progress
                  type="circle"
                  percent={progress}
                  width={32}
                  strokeWidth={8}
                  strokeColor="#52c41a"
                  trailColor="rgba(255, 255, 255, 0.2)"
                  format={(percent) => (
                    <span style={{ color: 'white', fontSize: 11, fontWeight: 'bold' }}>{percent}%</span>
                  )}
                />
              </div>
            </Tooltip>

            {/* 编辑 */}
            <Tooltip title={t('common.edit')} placement="top">
              <Button
                type="text"
                icon={<EditOutlined />}
                onClick={handleEdit}
                style={{
                  color: 'white',
                  borderRadius: 20
                }}
              />
            </Tooltip>

            {/* 返回 */}
            <Tooltip title={t('common.back')} placement="top">
              <Button
                type="text"
                icon={<ArrowLeftOutlined />}
                onClick={handleBack}
                style={{
                  color: 'white',
                  borderRadius: 20
                }}
              />
            </Tooltip>

            {/* 退出全屏 */}
            <Tooltip title={t('teaching.exitFullscreen')} placement="top">
              <Button
                type="text"
                icon={<FullscreenExitOutlined />}
                onClick={toggleFullscreen}
                style={{
                  color: 'white',
                  borderRadius: 20
                }}
              />
            </Tooltip>

            {/* 更多菜单 */}
            <Dropdown 
              menu={moreMenuItems} 
              trigger={['click']}
              placement="topRight"
            >
              <Button
                type="text"
                icon={<EllipsisOutlined />}
                style={{
                  color: 'white',
                  borderRadius: 20
                }}
              />
            </Dropdown>
          </div>
        </>
      )}
    </div>
  );
};

export default LessonViewer;
