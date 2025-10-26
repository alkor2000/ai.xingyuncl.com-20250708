/**
 * 课程页面查看器（支持指定页码）
 * 修改：支持通过 URL 参数 pageNumber 指定初始页面
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
  AimOutlined,
  UnorderedListOutlined
} from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import useTeachingStore from '../../stores/teachingStore';
import useAuthStore from '../../stores/authStore';

const LessonViewer = () => {
  const { t } = useTranslation();
  const { id, pageNumber } = useParams(); // 新增：获取 pageNumber 参数
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

  // 新增：URL pageNumber 变化时更新当前页
  useEffect(() => {
    if (pageNumber) {
      const page = parseInt(pageNumber);
      if (!isNaN(page) && page > 0) {
        setCurrentPage(page);
        setPageViewTime(Date.now());
      }
    }
  }, [pageNumber]);

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
    
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
    }
    
    hideTimerRef.current = setTimeout(() => {
      setShowControls(false);
    }, 3000);
  };

  const handleMouseMoveOnControls = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
    }
    
    hideTimerRef.current = setTimeout(() => {
      setShowControls(false);
    }, 3000);
  };

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, []);

  // 全屏模式快捷键
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

  // 返回课程页面列表
  const handleBack = () => {
    navigate(`/teaching/lessons/${id}`);
  };

  const handleEdit = () => {
    navigate(`/teaching/lessons/${id}/edit`);
  };

  const handlePageChange = (page) => {
    setCurrentPage(page);
    setPageViewTime(Date.now());
    // 更新 URL（可选）
    navigate(`/teaching/lessons/${id}/pages/${page}`, { replace: true });
  };

  const handlePrevPage = () => {
    if (currentPage > 1) {
      handlePageChange(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    const pages = getPages();
    if (currentPage < pages.length) {
      handlePageChange(currentPage + 1);
    }
  };

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

  useEffect(() => {
    const handleFullscreenChange = () => {
      const fullscreen = !!document.fullscreenElement;
      setIsFullscreen(fullscreen);
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

  const moreMenuItems = {
    items: [
      {
        key: 'page_list',
        label: t('teaching.pageList'),
        icon: <UnorderedListOutlined />,
        onClick: () => navigate(`/teaching/lessons/${id}`)
      },
      {
        key: 'settings',
        label: t('common.settings'),
        icon: <SettingOutlined />,
        onClick: () => message.info('设置功能开发中')
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
          <Button 
            icon={<ArrowLeftOutlined />} 
            onClick={handleBack}
            size="large"
          >
            {t('teaching.backToPageList')}
          </Button>

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

          <Space size="middle">
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

            <Button icon={<EditOutlined />} onClick={handleEdit}>
              {t('common.edit')}
            </Button>

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

      {isFullscreen && (
        <>
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

            <Tooltip title={t('teaching.pageList')} placement="top">
              <Button
                type="text"
                icon={<UnorderedListOutlined />}
                onClick={handleBack}
                style={{
                  color: 'white',
                  borderRadius: 20
                }}
              />
            </Tooltip>

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
