/**
 * 课程详情页面（极简专业版）
 * 功能：显示课程包含的所有页面，用户可以选择要查看的页面
 * 设计：极简风格，去除冗余信息，突出核心内容
 */

import React, { useEffect, useState } from 'react';
import {
  Button,
  Empty,
  Spin
} from 'antd';
import {
  ArrowLeftOutlined,
  RightOutlined,
  FileTextOutlined,
  EditOutlined
} from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import useTeachingStore from '../../stores/teachingStore';

const LessonDetail = () => {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();

  const {
    currentLesson,
    currentLessonLoading,
    fetchLesson
  } = useTeachingStore();

  const [viewedPages, setViewedPages] = useState(new Set());

  useEffect(() => {
    if (id) {
      loadLesson();
      
      const saved = localStorage.getItem(`lesson_${id}_viewed_pages`);
      if (saved) {
        try {
          setViewedPages(new Set(JSON.parse(saved)));
        } catch (e) {
          console.error('解析已查看页面失败:', e);
        }
      }
    }
  }, [id]);

  const loadLesson = async () => {
    try {
      await fetchLesson(id);
    } catch (error) {
      console.error('加载课程失败:', error);
    }
  };

  const handleBack = () => {
    if (currentLesson?.module_id) {
      navigate(`/teaching/modules/${currentLesson.module_id}`);
    } else {
      navigate('/teaching');
    }
  };

  const handleEdit = () => {
    navigate(`/teaching/lessons/${id}/edit`);
  };

  const handleViewPage = (pageNumber) => {
    const newViewed = new Set(viewedPages);
    newViewed.add(pageNumber);
    setViewedPages(newViewed);
    localStorage.setItem(`lesson_${id}_viewed_pages`, JSON.stringify([...newViewed]));
    
    navigate(`/teaching/lessons/${id}/pages/${pageNumber}`);
  };

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

  if (currentLessonLoading || !currentLesson) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        background: '#0f2847'
      }}>
        <Spin size="large" tip={t('common.loading')} />
      </div>
    );
  }

  const pages = getPages();
  const totalPages = pages.length;

  return (
    <div style={{ 
      minHeight: '100vh',
      background: '#0f2847',
      padding: '16px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    }}>
      {/* 顶部导航栏 - 超紧凑版 */}
      <div style={{
        background: 'rgba(255, 255, 255, 0.08)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        borderRadius: '12px',
        padding: '6px 16px',
        marginBottom: '16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        height: '48px'
      }}>
        <Button
          type="text"
          icon={<ArrowLeftOutlined style={{ fontSize: 14 }} />}
          onClick={handleBack}
          style={{
            color: 'white',
            fontWeight: 500,
            fontSize: 13,
            height: 32,
            padding: '0 12px',
            border: 'none'
          }}
        >
          {t('common.back')}
        </Button>
        
        <div style={{ 
          flex: 1,
          color: 'rgba(255, 255, 255, 0.7)',
          fontSize: 13,
          textAlign: 'center',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8
        }}>
          <span>{t('teaching.teaching')}</span>
          <span>/</span>
          <span>{t('teaching.module')}</span>
          <span>/</span>
          <span style={{ color: 'white' }}>{currentLesson.title}</span>
        </div>

        <Button
          type="text"
          icon={<EditOutlined style={{ fontSize: 13 }} />}
          onClick={handleEdit}
          style={{
            color: 'white',
            fontSize: 13,
            height: 32,
            padding: '0 12px',
            border: 'none'
          }}
        >
          {t('common.edit')}
        </Button>
      </div>

      {/* 课程信息卡片 - 极简版（居中） */}
      <div style={{
        background: 'white',
        borderRadius: '16px',
        padding: '24px',
        marginBottom: '16px',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
        textAlign: 'center'
      }}>
        <h1 style={{ 
          margin: 0,
          fontSize: 24,
          fontWeight: 600,
          color: '#1a1a1a',
          marginBottom: 8
        }}>
          {currentLesson.title}
        </h1>
        
        {currentLesson.description && (
          <p style={{ 
            color: '#666',
            fontSize: 14,
            lineHeight: 1.6,
            margin: 0
          }}>
            {currentLesson.description}
          </p>
        )}
      </div>

      {/* 页面列表 */}
      <div style={{
        background: 'white',
        borderRadius: '16px',
        padding: '20px',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 16,
          paddingBottom: 12,
          borderBottom: '1px solid #f0f0f0'
        }}>
          <FileTextOutlined style={{ fontSize: 16, color: '#1890ff' }} />
          <h2 style={{ 
            margin: 0,
            fontSize: 16,
            fontWeight: 600,
            color: '#1a1a1a'
          }}>
            {t('teaching.pageList')}
          </h2>
          <span style={{ 
            fontSize: 13,
            color: '#999',
            marginLeft: 'auto'
          }}>
            ({totalPages} {t('teaching.pages')})
          </span>
        </div>

        {totalPages === 0 ? (
          <Empty 
            description={
              <span style={{ color: '#999', fontSize: 13 }}>
                {t('teaching.noPages')}
              </span>
            }
            style={{ marginTop: 40, marginBottom: 40 }}
          >
            <Button 
              type="primary"
              icon={<EditOutlined />}
              onClick={handleEdit}
              style={{
                height: 40,
                borderRadius: '8px',
                fontSize: 14,
                fontWeight: 500,
                padding: '0 24px'
              }}
            >
              {t('teaching.editContent')}
            </Button>
          </Empty>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pages.map((page, index) => {
              const pageNumber = index + 1;
              const isViewed = viewedPages.has(pageNumber);
              
              return (
                <div
                  key={pageNumber}
                  onClick={() => handleViewPage(pageNumber)}
                  style={{
                    background: isViewed ? '#f0f7ff' : '#fafafa',
                    borderRadius: '10px',
                    padding: '14px 16px',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    border: `1px solid ${isViewed ? '#d6e4ff' : '#f0f0f0'}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateX(2px)';
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.08)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateX(0)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  {/* 序号 */}
                  <div style={{
                    width: 44,
                    height: 44,
                    borderRadius: '8px',
                    background: isViewed ? '#1890ff' : '#d9d9d9',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 16,
                    fontWeight: 600,
                    color: 'white',
                    flexShrink: 0
                  }}>
                    {pageNumber < 10 ? `0${pageNumber}` : pageNumber}
                  </div>

                  {/* 页面标题 */}
                  <div style={{ 
                    flex: 1,
                    minWidth: 0
                  }}>
                    <div style={{
                      fontSize: 15,
                      fontWeight: 500,
                      color: '#1a1a1a',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                      {page.title || `${t('teaching.page')} ${pageNumber}`}
                    </div>
                  </div>

                  {/* 进入按钮 */}
                  <Button
                    type="link"
                    icon={<RightOutlined />}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleViewPage(pageNumber);
                    }}
                    style={{
                      color: '#1890ff',
                      fontSize: 13,
                      fontWeight: 500,
                      padding: '0 8px',
                      height: 32
                    }}
                  >
                    {t('teaching.enterPage')}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default LessonDetail;
