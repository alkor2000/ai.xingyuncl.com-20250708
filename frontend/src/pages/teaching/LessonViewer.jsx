/**
 * 课程查看器组件
 * 用于查看课程的多页面内容，支持分页浏览和进度记录
 */

import React, { useEffect, useState, useRef } from 'react';
import {
  Card,
  Button,
  Space,
  Breadcrumb,
  Descriptions,
  Tag,
  Empty,
  Spin,
  Pagination,
  Progress,
  Modal,
  Tooltip,
  message
} from 'antd';
import {
  ArrowLeftOutlined,
  EditOutlined,
  LeftOutlined,
  RightOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
  BookOutlined,
  EyeOutlined,
  ClockCircleOutlined
} from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import useTeachingStore from '../../stores/teachingStore';
import useAuthStore from '../../stores/authStore';
import moment from 'moment';

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
  const iframeRef = useRef(null);

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

    // 页面切换或离开时记录
    return () => {
      recordPageView();
    };
  }, [currentPage, currentLesson]);

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
      const elem = iframeRef.current?.parentElement;
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
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  // 键盘快捷键
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.key === 'ArrowLeft') {
        handlePrevPage();
      } else if (e.key === 'ArrowRight') {
        handleNextPage();
      } else if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen();
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [currentPage]);

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

  // 内容类型颜色
  const contentTypeColors = {
    course: 'blue',
    experiment: 'cyan',
    exercise: 'geekblue',
    reference: 'purple',
    teaching_plan: 'orange',
    answer: 'red',
    guide: 'magenta',
    assessment: 'volcano'
  };

  return (
    <div style={{ 
      height: '100vh', 
      display: 'flex', 
      flexDirection: 'column',
      background: '#f0f2f5'
    }}>
      {/* 顶部导航栏 */}
      <div style={{
        background: 'white',
        padding: '16px 24px',
        borderBottom: '1px solid #e8e8e8',
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {/* 左侧信息 */}
          <div style={{ flex: 1 }}>
            <Breadcrumb style={{ marginBottom: 12 }}>
              <Breadcrumb.Item>
                <a onClick={handleBack}>{currentLesson.module_name || t('teaching.teaching')}</a>
              </Breadcrumb.Item>
              <Breadcrumb.Item>{currentLesson.title}</Breadcrumb.Item>
            </Breadcrumb>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <BookOutlined style={{ fontSize: 20, color: '#1890ff' }} />
              <h3 style={{ margin: 0, fontSize: 18 }}>{currentLesson.title}</h3>
              <Tag color={contentTypeColors[currentLesson.content_type]}>
                {t(`teaching.contentTypes.${currentLesson.content_type}`)}
              </Tag>
              <Tag icon={<EyeOutlined />}>{currentLesson.view_count || 0}</Tag>
            </div>
          </div>

          {/* 右侧操作 */}
          <Space size="middle">
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: '#999' }}>{t('teaching.progress')}</div>
              <Progress
                type="circle"
                percent={progress}
                width={50}
                strokeColor="#52c41a"
              />
            </div>

            <Button icon={<EditOutlined />} onClick={handleEdit}>
              {t('common.edit')}
            </Button>

            <Button icon={<ArrowLeftOutlined />} onClick={handleBack}>
              {t('common.back')}
            </Button>
          </Space>
        </div>
      </div>

      {/* 内容区域 */}
      <div style={{ 
        flex: 1, 
        padding: 24, 
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
        <Card
          style={{ 
            flex: 1, 
            display: 'flex', 
            flexDirection: 'column',
            overflow: 'hidden'
          }}
          bodyStyle={{ 
            flex: 1, 
            padding: 0, 
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          {/* 页面导航 */}
          <div style={{
            padding: '12px 24px',
            borderBottom: '1px solid #e8e8e8',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: '#fafafa'
          }}>
            <Space>
              <Button
                icon={<LeftOutlined />}
                disabled={currentPage === 1}
                onClick={handlePrevPage}
              >
                {t('teaching.prevPage')}
              </Button>

              <span style={{ margin: '0 16px', color: '#666' }}>
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

            <Space>
              <span style={{ fontSize: 12, color: '#999' }}>
                <ClockCircleOutlined /> {t('teaching.viewTime')}: {moment(viewStartTime).fromNow(true)}
              </span>

              <Tooltip title={isFullscreen ? t('teaching.exitFullscreen') : t('teaching.fullscreen')}>
                <Button
                  icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                  onClick={toggleFullscreen}
                />
              </Tooltip>
            </Space>
          </div>

          {/* 内容iframe */}
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
                style={{ marginTop: 100 }}
              />
            )}
          </div>

          {/* 底部分页器 */}
          {totalPages > 1 && (
            <div style={{
              padding: '16px 24px',
              borderTop: '1px solid #e8e8e8',
              background: '#fafafa',
              display: 'flex',
              justifyContent: 'center'
            }}>
              <Pagination
                current={currentPage}
                total={totalPages}
                pageSize={1}
                onChange={handlePageChange}
                showSizeChanger={false}
                showTotal={(total) => t('teaching.totalPages', { total })}
              />
            </div>
          )}
        </Card>
      </div>

      {/* 快捷键提示 */}
      <div style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        background: 'rgba(0, 0, 0, 0.75)',
        color: 'white',
        padding: '8px 12px',
        borderRadius: 4,
        fontSize: 12,
        zIndex: 1000,
        opacity: 0.6,
        transition: 'opacity 0.3s'
      }}>
        <div>← → {t('teaching.switchPage')}</div>
        <div>F {t('teaching.toggleFullscreen')}</div>
      </div>
    </div>
  );
};

export default LessonViewer;
