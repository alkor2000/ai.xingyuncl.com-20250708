/**
 * 思维导图公开分享页面 - 只读视图 v2.0
 *
 * 路由: /mindmap/share/:id/:token
 * 无需登录，通过 HMAC token 验证访问权限
 *
 * v2.0 改进:
 * 1. 顶部加平台 Logo banner（从 systemConfigStore 读取站点名/Logo）
 * 2. 加载阶段也显示平台标识，避免空白
 * 3. 错误页和加载页统一品牌
 * 4. Mermaid/SVG 模式新增缩放控制
 * 5. 底部加"在此平台创建你自己的导图"引流位
 */
import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Spin, Button, Tooltip } from 'antd';
import {
  ShareAltOutlined, CloseCircleOutlined, HomeOutlined,
  ZoomInOutlined, ZoomOutOutlined, ReloadOutlined, ExpandOutlined,
  LoginOutlined
} from '@ant-design/icons';
import { Transformer } from 'markmap-lib';
import { Markmap } from 'markmap-view';
import MermaidPreview from './components/MermaidPreview';
import SvgPreview from './components/SvgPreview';
import apiClient from '../../utils/api';
import useSystemConfigStore from '../../stores/systemConfigStore';
import './Mindmap.less';

/* iOS 配色 */
const IOS_COLORS = [
  '#007AFF', '#34C759', '#FF9500', '#AF52DE', '#5856D6', '#00C7BE'
];

/**
 * 公用平台 Logo Banner 组件
 * 加载/错误/正常三种状态共用
 */
const PlatformBanner = ({ title, subtitle, showLoginEntry = true }) => {
  const { getSiteName, getSiteLogo, getSiteDescription } = useSystemConfigStore();
  const siteName = getSiteName ? getSiteName() : 'AI 平台';
  const siteLogo = getSiteLogo ? getSiteLogo() : '';
  const siteDesc = getSiteDescription ? getSiteDescription() : '';

  return (
    <div className="mindmap-share-banner">
      <div className="mindmap-share-banner-left">
        {siteLogo ? (
          <img src={siteLogo} alt={siteName} className="mindmap-share-banner-logo" />
        ) : (
          <div className="mindmap-share-banner-logo-text">AI</div>
        )}
        <div className="mindmap-share-banner-text">
          <div className="mindmap-share-banner-site">{siteName}</div>
          {subtitle && <div className="mindmap-share-banner-subtitle">{subtitle}</div>}
        </div>
      </div>
      {title && (
        <div className="mindmap-share-banner-center">
          <ShareAltOutlined style={{ marginRight: 8 }} />
          <span className="mindmap-share-banner-title">{title}</span>
          <span className="mindmap-share-readonly-tag">只读分享</span>
        </div>
      )}
      {showLoginEntry && (
        <div className="mindmap-share-banner-right">
          <Tooltip title="登录后可创建自己的导图">
            <Link to="/login">
              <Button type="primary" size="small" icon={<LoginOutlined />}>
                登录 / 注册
              </Button>
            </Link>
          </Tooltip>
        </div>
      )}
    </div>
  );
};

const MindmapShare = () => {
  const { id, token } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  /* Mermaid/SVG 缩放 */
  const [zoomLevel, setZoomLevel] = useState(1);

  const svgRef = useRef(null);
  const markmapRef = useRef(null);
  const { initSystemConfig, initialized } = useSystemConfigStore();

  /* 初始化系统配置（公开访问也需要拿站点 logo / name） */
  useEffect(() => {
    if (!initialized && initSystemConfig) {
      /* 公开访问的页面，systemConfig 走 /public/system-config */
      initSystemConfig().catch(() => { /* 兜底，不影响主流程 */ });
    }
  }, [initialized, initSystemConfig]);

  /* 加载分享内容 */
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await apiClient.get(`/mindmap/share/${id}/${token}`);
        if (cancelled) return;
        if (response.data.success) {
          setData(response.data.data);
        } else {
          setError(response.data.message || '加载失败');
        }
      } catch (err) {
        if (cancelled) return;
        const status = err.response?.status;
        if (status === 403) {
          setError('链接无效或已过期');
        } else if (status === 404) {
          setError('思维导图不存在或已被删除');
        } else {
          setError(err.response?.data?.message || '加载失败，请稍后重试');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [id, token]);

  /* Markdown 模式渲染 markmap */
  useEffect(() => {
    if (!data || data.content_type !== 'markdown' || !svgRef.current) return;

    try {
      const transformer = new Transformer();
      const { root } = transformer.transform(data.content);
      svgRef.current.innerHTML = '';

      const options = {
        color: (node) => IOS_COLORS[node.depth % IOS_COLORS.length],
        duration: 500,
        nodeMinHeight: 20,
        paddingX: 12,
        spacingVertical: 15,
        spacingHorizontal: 100,
        autoFit: true,
        initialExpandLevel: -1,
        zoom: true,
        pan: true
      };

      const mm = Markmap.create(svgRef.current, options, root);
      markmapRef.current = mm;

      setTimeout(() => {
        try {
          mm.fit();
          const svg = svgRef.current;
          if (svg) {
            const allPaths = svg.querySelectorAll('path');
            allPaths.forEach((path, index) => {
              if (path.getAttribute('fill') === 'none' || !path.getAttribute('fill')) {
                const lineColor = IOS_COLORS[index % IOS_COLORS.length];
                path.style.stroke = lineColor;
                path.style.strokeWidth = '1.5px';
                path.style.opacity = '0.75';
                path.style.fill = 'none';
              }
            });
          }
        } catch (e) {
          console.warn('markmap fit失败:', e);
        }
      }, 300);
    } catch (err) {
      console.error('Markmap渲染失败:', err);
      setError('思维导图渲染失败');
    }
  }, [data]);

  /* 缩放控制 */
  const handleZoom = (type) => {
    if (data?.content_type === 'markdown') {
      if (!markmapRef.current) return;
      try {
        if (type === 'in') markmapRef.current.rescale(1.25);
        else if (type === 'out') markmapRef.current.rescale(0.8);
        else if (type === 'fit') markmapRef.current.fit();
      } catch (e) { /* 忽略 */ }
    } else {
      setZoomLevel(prev => {
        if (type === 'in') return Math.min(prev * 1.2, 3);
        if (type === 'out') return Math.max(prev / 1.2, 0.2);
        if (type === 'fit') return 1;
        return prev;
      });
    }
  };

  /* 加载中 */
  if (loading) {
    return (
      <div className="mindmap-share-page">
        <PlatformBanner subtitle="思维导图分享" />
        <div className="mindmap-share-loading">
          <Spin size="large" />
          <div style={{ marginTop: 16, color: '#8E8E93' }}>正在加载思维导图...</div>
        </div>
      </div>
    );
  }

  /* 错误状态 */
  if (error) {
    return (
      <div className="mindmap-share-page">
        <PlatformBanner subtitle="思维导图分享" />
        <div className="mindmap-share-error">
          <CloseCircleOutlined className="mindmap-share-error-icon" />
          <div className="mindmap-share-error-title">无法打开此链接</div>
          <div className="mindmap-share-error-msg">{error}</div>
          <Button
            type="primary"
            icon={<HomeOutlined />}
            onClick={() => { window.location.href = '/'; }}
          >
            返回首页
          </Button>
        </div>
      </div>
    );
  }

  /* 正常渲染 */
  const renderContent = () => {
    if (data.content_type === 'markdown') {
      return (
        <div className="mindmap-svg-wrapper">
          <svg ref={svgRef}></svg>
        </div>
      );
    }
    /* Mermaid/SVG: 用 transform 缩放 */
    return (
      <div className="mindmap-transform-wrapper">
        <div
          className="mindmap-transform-content"
          style={{
            transform: `scale(${zoomLevel})`,
            transformOrigin: 'center top'
          }}
        >
          {data.content_type === 'mermaid'
            ? <MermaidPreview code={data.content} />
            : <SvgPreview code={data.content} />}
        </div>
      </div>
    );
  };

  return (
    <div className="mindmap-share-page">
      <PlatformBanner title={data.title} subtitle="思维导图分享" />

      {/* 缩放工具栏 */}
      <div className="mindmap-share-toolbar">
        <div className="mindmap-share-toolbar-left">
          {data.updated_at && (
            <span className="mindmap-share-time">
              更新于 {new Date(data.updated_at).toLocaleString()}
            </span>
          )}
        </div>
        <div className="mindmap-share-toolbar-right">
          <Tooltip title="放大">
            <button className="tool-btn" onClick={() => handleZoom('in')}>
              <ZoomInOutlined />
            </button>
          </Tooltip>
          <Tooltip title="缩小">
            <button className="tool-btn" onClick={() => handleZoom('out')}>
              <ZoomOutOutlined />
            </button>
          </Tooltip>
          <Tooltip title="自适应">
            <button className="tool-btn" onClick={() => handleZoom('fit')}>
              <ReloadOutlined />
            </button>
          </Tooltip>
          {data.content_type !== 'markdown' && (
            <span className="zoom-percent">{Math.round(zoomLevel * 100)}%</span>
          )}
        </div>
      </div>

      <div className="mindmap-share-canvas">
        {renderContent()}
      </div>
    </div>
  );
};

export default MindmapShare;
