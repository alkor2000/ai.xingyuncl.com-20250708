/**
 * 课程资料展示组件（视觉优化版）
 * 功能：在课程详情页展示资料列表，支持查看和下载
 * 优化：改进视觉设计，提升用户体验
 */

import React from 'react';
import { 
  Button, 
  Empty,
  message,
  Tooltip,
  Tag
} from 'antd';
import {
  LinkOutlined,
  CopyOutlined,
  ExportOutlined,
  FileTextOutlined,
  CloudOutlined,
  FilePdfOutlined,
  FileWordOutlined,
  FileZipOutlined,
  FileImageOutlined,
  FileUnknownOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { IOSCard } from './IOSLayout';

const MaterialsDisplay = ({ materials = [] }) => {
  const { t } = useTranslation();

  // 复制链接
  const handleCopyLink = (url, e) => {
    e.stopPropagation();
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url);
      message.success(t('teaching.linkCopied'));
    } else {
      // 降级方案
      const textArea = document.createElement('textarea');
      textArea.value = url;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      message.success(t('teaching.linkCopied'));
    }
  };

  // 打开链接
  const handleOpenLink = (url) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  // 根据文件类型获取图标
  const getFileIcon = (url, title = '') => {
    const urlLower = url.toLowerCase();
    const titleLower = title.toLowerCase();
    
    if (urlLower.includes('.pdf') || titleLower.includes('pdf')) {
      return <FilePdfOutlined style={{ fontSize: 24, color: '#FF4D4F' }} />;
    } else if (urlLower.includes('.doc') || urlLower.includes('.docx') || titleLower.includes('word')) {
      return <FileWordOutlined style={{ fontSize: 24, color: '#1890FF' }} />;
    } else if (urlLower.includes('.zip') || urlLower.includes('.rar') || titleLower.includes('压缩')) {
      return <FileZipOutlined style={{ fontSize: 24, color: '#722ED1' }} />;
    } else if (urlLower.includes('.jpg') || urlLower.includes('.png') || urlLower.includes('.gif')) {
      return <FileImageOutlined style={{ fontSize: 24, color: '#52C41A' }} />;
    } else if (urlLower.includes('http')) {
      return <LinkOutlined style={{ fontSize: 24, color: '#007AFF' }} />;
    } else {
      return <FileTextOutlined style={{ fontSize: 24, color: '#007AFF' }} />;
    }
  };

  // 格式化URL显示
  const formatUrl = (url) => {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname + (urlObj.pathname.length > 20 
        ? urlObj.pathname.substring(0, 20) + '...' 
        : urlObj.pathname);
    } catch {
      return url.length > 40 ? url.substring(0, 40) + '...' : url;
    }
  };

  // 确保materials是数组
  const validMaterials = Array.isArray(materials) ? materials.filter(m => m && m.title && m.url) : [];

  if (validMaterials.length === 0) {
    return null;
  }

  return (
    <IOSCard 
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <CloudOutlined style={{ fontSize: 20, color: '#007AFF' }} />
          <span style={{ fontSize: 18, fontWeight: 600 }}>{t('teaching.courseMaterials')}</span>
          <Tag color="blue" style={{ marginLeft: 'auto' }}>
            {validMaterials.length} {t('teaching.materials')}
          </Tag>
        </div>
      }
      style={{ marginBottom: 24 }}
    >
      <div style={{ 
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 16
      }}>
        {validMaterials.map((material, index) => (
          <div
            key={index}
            style={{
              padding: 16,
              background: 'white',
              border: '1px solid #E8E8E8',
              borderRadius: 12,
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              cursor: 'pointer',
              position: 'relative',
              overflow: 'hidden'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-4px)';
              e.currentTarget.style.boxShadow = '0 8px 24px rgba(0, 122, 255, 0.12)';
              e.currentTarget.style.borderColor = '#40A9FF';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = 'none';
              e.currentTarget.style.borderColor = '#E8E8E8';
            }}
            onClick={() => handleOpenLink(material.url)}
          >
            {/* 装饰线条 */}
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 3,
              background: 'linear-gradient(90deg, #007AFF 0%, #5856D6 100%)'
            }} />

            {/* 内容区域 */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              {/* 文件图标 */}
              <div style={{
                width: 48,
                height: 48,
                borderRadius: 10,
                background: 'linear-gradient(135deg, #F0F9FF 0%, #E6F4FF 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                {getFileIcon(material.url, material.title)}
              </div>

              {/* 文本内容 */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ 
                  fontSize: 15, 
                  fontWeight: 600, 
                  color: '#262626',
                  marginBottom: 6,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}>
                  {material.title}
                </div>
                
                {material.description && (
                  <div style={{ 
                    fontSize: 13, 
                    color: '#8C8C8C',
                    marginBottom: 8,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    lineHeight: '1.4'
                  }}>
                    {material.description}
                  </div>
                )}
                
                <div style={{ 
                  fontSize: 12, 
                  color: '#1890FF',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4
                }}>
                  <LinkOutlined style={{ fontSize: 11 }} />
                  {formatUrl(material.url)}
                </div>
              </div>
            </div>

            {/* 操作按钮 */}
            <div style={{ 
              display: 'flex',
              gap: 4,
              marginTop: 12,
              paddingTop: 12,
              borderTop: '1px solid #F0F0F0'
            }}>
              <Tooltip title={t('teaching.copyLink')}>
                <Button
                  size="small"
                  type="text"
                  icon={<CopyOutlined />}
                  onClick={(e) => handleCopyLink(material.url, e)}
                  style={{
                    fontSize: 12,
                    color: '#8C8C8C',
                    flex: 1
                  }}
                >
                  {t('common.copy')}
                </Button>
              </Tooltip>
              <Tooltip title={t('teaching.openLink')}>
                <Button
                  size="small"
                  type="primary"
                  icon={<ExportOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenLink(material.url);
                  }}
                  style={{
                    fontSize: 12,
                    flex: 1
                  }}
                >
                  {t('common.open')}
                </Button>
              </Tooltip>
            </div>
          </div>
        ))}
      </div>
    </IOSCard>
  );
};

export default MaterialsDisplay;
