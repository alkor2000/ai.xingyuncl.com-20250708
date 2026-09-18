/**
 * 课程页面查看器（iOS风格版 + 精致全屏控制栏 v1.2.2）
 * 功能：显示和浏览课程的具体页面内容，支持查看教案
 * 优化：全屏控制栏更小巧、更透明、更高级（2025-10-31）
 */

import React, { useEffect, useState, useRef } from 'react';
import {
  Button,
  Progress,
  Tooltip,
  message,
  Dropdown,
  Drawer,
  Spin,
  Empty
} from 'antd';
import {
  ArrowLeftOutlined,
  EditOutlined,
  LeftOutlined,
  RightOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
  EllipsisOutlined,
  UnorderedListOutlined,
  AimOutlined,
  BookOutlined
} from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import useTeachingStore from '../../stores/teachingStore';
import useAuthStore from '../../stores/authStore';
import {
  IOSPageContainer,
  IOSNavBar,
  IOSButton,
  IOSEmpty,
  IOSLoading
} from '../../components/teaching/IOSLayout';
import '../../styles/ios-unified-theme.css';

const LessonViewer = () => {
  const { t } = useTranslation();
  const { id, pageNumber } = useParams();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const {
    currentLesson,
    currentModule,
    currentLessonLoading,
    fetchLesson,
    fetchModule,
    recordView,
    fetchTeachingPlan,
    teachingPlanLoading
  } = useTeachingStore();

  const [currentPage, setCurrentPage] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [viewStartTime, setViewStartTime] = useState(Date.now());
  const [pageViewTime, setPageViewTime] = useState(Date.now());
  const [showControls, setShowControls] = useState(false);
  
  const [teachingPlanDrawerVisible, setTeachingPlanDrawerVisible] = useState(false);
  const [currentTeachingPlan, setCurrentTeachingPlan] = useState('');
  const [planLoading, setPlanLoading] = useState(false);
  
  const iframeRef = useRef(null);
  const containerRef = useRef(null);
  const hideTimerRef = useRef(null);

  useEffect(() => {
    if (id) {
      loadLesson();
    }
  }, [id]);

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
      const lessonData = await fetchLesson(id);
      if (lessonData?.module_id) {
        await fetchModule(lessonData.module_id);
      }
      setViewStartTime(Date.now());
      setPageViewTime(Date.now());
    } catch (error) {
      message.error(t('teaching.loadFailed'));
    }
  };

  const hasEditPermission = () => {
    if (user?.role === 'super_admin') return true;
    if (currentLesson?.creator_id === user?.id) return true;
    if (currentModule?.user_permission === 'edit') return true;
    if (currentModule?.creator_id === user?.id) return true;
    return false;
  };

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
        case 'Escape':
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
                font-family: -apple-system, BlinkMacSystemFont, sans-serif;
                color: #999;
                background: #F2F2F7;
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

  const handleBack = () => {
    navigate(`/teaching/lessons/${id}`);
  };

  const handleEdit = () => {
    if (!hasEditPermission()) {
      message.error(t('teaching.noEditPermission'));
      return;
    }
    navigate(`/teaching/lessons/${id}/edit`);
  };

  const handlePageChange = (page) => {
    setCurrentPage(page);
    setPageViewTime(Date.now());
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

  const handleOpenTeachingPlan = async () => {
    console.log('📖 打开教案查看', { lessonId: id, currentPage });
    
    setTeachingPlanDrawerVisible(true);
    setPlanLoading(true);
    setCurrentTeachingPlan('');

    try {
      const plan = await fetchTeachingPlan(id, currentPage);
      
      console.log('✅ 教案加载结果', plan);
      
      if (plan && plan.content) {
        setCurrentTeachingPlan(plan.content);
      } else {
        setCurrentTeachingPlan('');
      }
    } catch (error) {
      console.error('❌ 加载教案失败:', error);
      setCurrentTeachingPlan('');
    } finally {
      setPlanLoading(false);
    }
  };

  const handleCloseTeachingPlan = () => {
    setTeachingPlanDrawerVisible(false);
  };

  const buildMoreMenuItems = () => {
    const items = [
      {
        key: 'page_list',
        label: t('teaching.pageList'),
        icon: <UnorderedListOutlined />,
        onClick: () => navigate(`/teaching/lessons/${id}`)
      }
    ];

    return { items };
  };

  if (currentLessonLoading || !currentLesson) {
    return (
      <IOSPageContainer>
        <IOSLoading text={t('common.loading')} />
      </IOSPageContainer>
    );
  }

  const pages = getPages();
  const totalPages = pages.length;
  const progress = totalPages > 0 ? Math.round((currentPage / totalPages) * 100) : 0;
  const canEdit = hasEditPermission();
  const currentPageData = pages[currentPage - 1];

  return (
    <div 
      ref={containerRef}
      className="lesson-viewer-page"
      style={{ 
        height: '100%',
        display: 'flex', 
        flexDirection: 'column',
        background: isFullscreen ? '#000' : '#F2F2F7',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      {!isFullscreen && (
        <>
          <IOSNavBar
            title={`${currentLesson.title} - ${t('teaching.pageInfo', { current: currentPage, total: totalPages })}`}
            onBack={handleBack}
            backText={t('teaching.backToPageList')}
            actions={
              <div className="lesson-viewer-actions" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 12px',
                  background: 'rgba(0, 122, 255, 0.08)',
                  borderRadius: 20
                }}>
                  <AimOutlined style={{ color: '#007AFF', fontSize: 14 }} />
                  <span style={{ fontSize: 13, color: '#007AFF', fontWeight: 500 }}>
                    {progress}%
                  </span>
                </div>

                <IOSButton 
                  variant="secondary" 
                  size="small" 
                  icon={<BookOutlined />} 
                  onClick={handleOpenTeachingPlan}
                >
                  {t('teaching.viewTeachingPlan')}
                </IOSButton>

                {canEdit && (
                  <IOSButton variant="secondary" size="small" icon={<EditOutlined />} onClick={handleEdit}>
                    {t('common.edit')}
                  </IOSButton>
                )}

                <IOSButton
                  variant="primary"
                  size="small"
                  icon={<FullscreenOutlined />}
                  onClick={toggleFullscreen}
                >
                  {t('teaching.fullscreen')}
                </IOSButton>
              </div>
            }
          />

          <div className="lesson-viewer-pagination" style={{
            background: 'white',
            padding: '12px 24px',
            borderBottom: '1px solid #E5E5EA',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 20
          }}>
            <IOSButton
              variant="secondary"
              icon={<LeftOutlined />}
              disabled={currentPage === 1}
              onClick={handlePrevPage}
            >
              {t('teaching.prevPage')}
            </IOSButton>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 16px',
              background: '#F2F2F7',
              borderRadius: 20,
              minWidth: 140,
              justifyContent: 'center'
            }}>
              <span style={{ 
                fontSize: 18, 
                fontWeight: 600,
                color: '#007AFF'
              }}>
                {currentPage < 10 ? `0${currentPage}` : currentPage}
              </span>
              <span style={{ color: '#999', fontSize: 14 }}>/</span>
              <span style={{ 
                fontSize: 14, 
                color: '#666'
              }}>
                {totalPages}
              </span>
            </div>

            <IOSButton
              variant="primary"
              icon={<RightOutlined />}
              iconPosition="right"
              disabled={currentPage === totalPages}
              onClick={handleNextPage}
            >
              {t('teaching.nextPage')}
            </IOSButton>
          </div>
        </>
      )}

      <div style={{ 
        flex: 1,
        background: '#fff',
        overflow: 'hidden',
        position: 'relative',
        margin: isFullscreen ? 0 : '0 24px 24px',
        borderRadius: isFullscreen ? 0 : 12,
        boxShadow: isFullscreen ? 'none' : '0 2px 8px rgba(0, 0, 0, 0.06)'
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
          <IOSEmpty
            text={t('teaching.noContent')}
            action={
              canEdit && (
                <IOSButton
                  variant="primary"
                  icon={<EditOutlined />}
                  onClick={handleEdit}
                  style={{ marginTop: 20 }}
                >
                  {t('teaching.editContent')}
                </IOSButton>
              )
            }
          />
        )}
      </div>

      {/* 全屏模式控制条 - 精致版 */}
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
              bottom: 24,
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(0, 0, 0, 0.6)',
              backdropFilter: 'blur(20px) saturate(180%)',
              WebkitBackdropFilter: 'blur(20px) saturate(180%)',
              borderRadius: 24,
              padding: '8px 20px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              transition: 'opacity 0.3s ease',
              opacity: showControls ? 1 : 0,
              pointerEvents: showControls ? 'auto' : 'none',
              zIndex: 999,
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), 0 2px 8px rgba(0, 0, 0, 0.2)',
              border: '1px solid rgba(255, 255, 255, 0.1)'
            }}
          >
            <Tooltip title={t('teaching.prevPage')} placement="top">
              <Button
                type="text"
                icon={<LeftOutlined style={{ fontSize: 14 }} />}
                disabled={currentPage === 1}
                onClick={handlePrevPage}
                style={{
                  color: 'white',
                  borderRadius: '50%',
                  width: 32,
                  height: 32,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: currentPage === 1 ? 0.3 : 1,
                  background: 'rgba(255, 255, 255, 0.1)',
                  transition: 'all 0.2s',
                  padding: 0
                }}
                onMouseEnter={(e) => {
                  if (currentPage > 1) {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
                    e.currentTarget.style.transform = 'scale(1.1)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                  e.currentTarget.style.transform = 'scale(1)';
                }}
              />
            </Tooltip>

            <div style={{ 
              color: 'white', 
              fontSize: 15,
              fontWeight: 600,
              minWidth: 90,
              textAlign: 'center',
              userSelect: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              justifyContent: 'center'
            }}>
              <span style={{ fontSize: 18, color: '#007AFF' }}>{currentPage}</span>
              <span style={{ opacity: 0.5, fontSize: 13 }}>/</span>
              <span style={{ fontSize: 13, opacity: 0.8 }}>{totalPages}</span>
            </div>

            <Tooltip title={t('teaching.nextPage')} placement="top">
              <Button
                type="text"
                icon={<RightOutlined style={{ fontSize: 14 }} />}
                disabled={currentPage === totalPages}
                onClick={handleNextPage}
                style={{
                  color: 'white',
                  borderRadius: '50%',
                  width: 32,
                  height: 32,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: currentPage === totalPages ? 0.3 : 1,
                  background: 'rgba(255, 255, 255, 0.1)',
                  transition: 'all 0.2s',
                  padding: 0
                }}
                onMouseEnter={(e) => {
                  if (currentPage < totalPages) {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
                    e.currentTarget.style.transform = 'scale(1.1)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                  e.currentTarget.style.transform = 'scale(1)';
                }}
              />
            </Tooltip>

            <div style={{ 
              width: 1, 
              height: 20,
              background: 'rgba(255, 255, 255, 0.15)'
            }} />

            <Tooltip title={`${t('teaching.progress')}: ${progress}%`} placement="top">
              <div style={{ 
                width: 100,
                height: 3,
                background: 'rgba(255, 255, 255, 0.2)',
                borderRadius: 2,
                overflow: 'hidden'
              }}>
                <div style={{
                  width: `${progress}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #007AFF, #5856D6)',
                  borderRadius: 2,
                  transition: 'width 0.3s'
                }} />
              </div>
            </Tooltip>

            <Tooltip title={t('teaching.viewTeachingPlan')} placement="top">
              <Button
                type="text"
                icon={<BookOutlined style={{ fontSize: 14 }} />}
                onClick={handleOpenTeachingPlan}
                style={{
                  color: 'white',
                  borderRadius: '50%',
                  width: 32,
                  height: 32,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(255, 255, 255, 0.1)',
                  transition: 'all 0.2s',
                  padding: 0
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
                  e.currentTarget.style.transform = 'scale(1.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                  e.currentTarget.style.transform = 'scale(1)';
                }}
              />
            </Tooltip>

            <Tooltip title={t('teaching.pageList')} placement="top">
              <Button
                type="text"
                icon={<UnorderedListOutlined style={{ fontSize: 14 }} />}
                onClick={handleBack}
                style={{
                  color: 'white',
                  borderRadius: '50%',
                  width: 32,
                  height: 32,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(255, 255, 255, 0.1)',
                  transition: 'all 0.2s',
                  padding: 0
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
                  e.currentTarget.style.transform = 'scale(1.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                  e.currentTarget.style.transform = 'scale(1)';
                }}
              />
            </Tooltip>

            {canEdit && (
              <Tooltip title={t('common.edit')} placement="top">
                <Button
                  type="text"
                  icon={<EditOutlined style={{ fontSize: 14 }} />}
                  onClick={handleEdit}
                  style={{
                    color: 'white',
                    borderRadius: '50%',
                    width: 32,
                    height: 32,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(255, 255, 255, 0.1)',
                    transition: 'all 0.2s',
                    padding: 0
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
                    e.currentTarget.style.transform = 'scale(1.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                    e.currentTarget.style.transform = 'scale(1)';
                  }}
                />
              </Tooltip>
            )}

            <Tooltip title={t('teaching.exitFullscreen')} placement="top">
              <Button
                type="text"
                icon={<FullscreenExitOutlined style={{ fontSize: 14 }} />}
                onClick={toggleFullscreen}
                style={{
                  color: 'white',
                  borderRadius: '50%',
                  width: 32,
                  height: 32,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(255, 255, 255, 0.1)',
                  transition: 'all 0.2s',
                  padding: 0
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
                  e.currentTarget.style.transform = 'scale(1.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                  e.currentTarget.style.transform = 'scale(1)';
                }}
              />
            </Tooltip>

            <Dropdown 
              menu={buildMoreMenuItems()} 
              trigger={['click']}
              placement="topRight"
            >
              <Button
                type="text"
                icon={<EllipsisOutlined style={{ fontSize: 14 }} />}
                style={{
                  color: 'white',
                  borderRadius: '50%',
                  width: 32,
                  height: 32,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(255, 255, 255, 0.1)',
                  transition: 'all 0.2s',
                  padding: 0
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
                  e.currentTarget.style.transform = 'scale(1.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                  e.currentTarget.style.transform = 'scale(1)';
                }}
              />
            </Dropdown>
          </div>
        </>
      )}

      <Drawer
        title={
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: 12,
            fontSize: 18,
            fontWeight: 600,
            color: '#1a1a1a'
          }}>
            <BookOutlined style={{ color: '#FF9500', fontSize: 20 }} />
            <span>{t('teaching.teachingPlan')} - {currentPageData?.title || `${t('teaching.page')} ${currentPage}`}</span>
          </div>
        }
        placement="right"
        width={800}
        onClose={handleCloseTeachingPlan}
        open={teachingPlanDrawerVisible}
        getContainer={false}
        style={{ position: 'absolute', zIndex: 10000 }}
        styles={{
          header: {
            background: '#F2F2F7',
            borderBottom: '1px solid #E5E5EA',
            padding: '20px 24px'
          },
          body: {
            padding: 0,
            background: '#fff'
          }
        }}
      >
        <Spin spinning={planLoading} tip={t('teaching.loadingTeachingPlan')}>
          <div style={{ 
            minHeight: 'calc(100vh - 120px)',
            padding: '24px'
          }}>
            {currentTeachingPlan ? (
              <div 
                className="teaching-plan-content"
                style={{
                  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
                  fontSize: 14,
                  lineHeight: 1.6,
                  color: '#1a1a1a'
                }}
                dangerouslySetInnerHTML={{ __html: currentTeachingPlan }}
              />
            ) : (
              !planLoading && (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    <div style={{ marginTop: 20 }}>
                      <div style={{ fontSize: 16, color: '#666', marginBottom: 8 }}>
                        {t('teaching.noTeachingPlan')}
                      </div>
                      {canEdit && (
                        <div style={{ fontSize: 14, color: '#999' }}>
                          {t('teaching.pleaseAddTeachingPlanInEditor')}
                        </div>
                      )}
                    </div>
                  }
                  style={{ marginTop: 60 }}
                >
                  {canEdit && (
                    <Button
                      type="primary"
                      icon={<EditOutlined />}
                      onClick={() => {
                        handleCloseTeachingPlan();
                        handleEdit();
                      }}
                      style={{
                        marginTop: 16,
                        borderRadius: 8,
                        height: 40,
                        background: 'linear-gradient(135deg, #007AFF, #5856D6)',
                        border: 'none'
                      }}
                    >
                      {t('teaching.goToEdit')}
                    </Button>
                  )}
                </Empty>
              )
            )}
          </div>
        </Spin>
      </Drawer>
    </div>
  );
};

export default LessonViewer;
