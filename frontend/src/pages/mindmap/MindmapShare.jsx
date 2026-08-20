/**
 * 思维导图公开分享页面 - 只读视图
 *
 * 路由: /mindmap/share/:id/:token
 * 无需登录，通过 HMAC token 验证访问权限
 *
 * ===== v2.1 国际化改造要点（务必理解，勿回退）=====
 *
 * 1. 错误状态不再直接存"已翻译的文本"，改为存 { key, detail } 结构。
 *    原因：若 setError('链接无效或已过期')，用户停在错误页切换语言时，
 *    state 里的旧语言字符串不会重新求值，界面仍显示切换前的语言。
 *    现在渲染时才调 t(error.key)，语言切换可即时生效。
 *
 * 2. 后端返回的 message 多为中文（服务端不做 i18n），
 *    因此不把它当作主提示直接展示给英文用户，而是：
 *    主提示走 t(key) 保证语言正确，后端原文作为 detail 以小字附加，
 *    既不丢失排障信息，也不出现"英文界面弹中文句子"。
 *
 * 3. 时间格式化必须把 i18n.language 传给 toLocaleString，
 *    否则英文环境下日期仍按中文习惯排布（原代码未传任何 locale）。
 *
 * 4. PlatformBanner 内部同样要 useTranslation：
 *    它是本文件内的子组件，不会自动继承父组件的 t。
 *
 * ===== 功能说明（逻辑与 v2.0 完全一致，未做行为变更）=====
 * - 顶部平台 Logo banner（从 systemConfigStore 读站点名/Logo）
 * - 加载 / 错误 / 正常三种状态统一品牌展示
 * - Markdown 走 markmap 渲染，Mermaid/SVG 走 transform scale 缩放
 */
import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Spin, Button, Tooltip } from 'antd';
import {
  ShareAltOutlined, CloseCircleOutlined, HomeOutlined,
  ZoomInOutlined, ZoomOutOutlined, ReloadOutlined,
  LoginOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { Transformer } from 'markmap-lib';
import { Markmap } from 'markmap-view';
import MermaidPreview from './components/MermaidPreview';
import SvgPreview from './components/SvgPreview';
import apiClient from '../../utils/api';
import useSystemConfigStore from '../../stores/systemConfigStore';
import './Mindmap.less';

/* iOS 风格连线配色（纯视觉常量，与语言无关，无需 i18n） */
const IOS_COLORS = [
  '#007AFF', '#34C759', '#FF9500', '#AF52DE', '#5856D6', '#00C7BE'
];

/* markmap 渲染完成后执行连线美化的延迟（等待入场动画结束再取 DOM） */
const MARKMAP_DECORATE_DELAY_MS = 300;

/**
 * 平台 Logo Banner 子组件
 * 加载 / 错误 / 正常三种状态共用，保证任何情况下都有品牌标识
 *
 * 注意：本组件必须自己调 useTranslation，
 * 因为它虽定义在同一文件内，但仍是独立组件，不共享父组件作用域的 t。
 */
const PlatformBanner = ({ title, subtitle, showLoginEntry = true }) => {
  const { t } = useTranslation();
  const { getSiteName, getSiteLogo } = useSystemConfigStore();

  /* 站点名称属后台录入的业务数据，不翻译；仅"取不到时的兜底名"需要 i18n */
  const siteName = (getSiteName && getSiteName()) || t('mindmap.sharePage.defaultSiteName');
  const siteLogo = getSiteLogo ? getSiteLogo() : '';

  return (
    <div className="mindmap-share-banner">
      <div className="mindmap-share-banner-left">
        {siteLogo ? (
          <img src={siteLogo} alt={siteName} className="mindmap-share-banner-logo" />
        ) : (
          /* 无 Logo 时用固定的 AI 文字占位，属品牌符号不翻译 */
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
          {/* 导图标题为用户录入的业务数据，原样展示不翻译 */}
          <span className="mindmap-share-banner-title">{title}</span>
          <span className="mindmap-share-readonly-tag">
            {t('mindmap.sharePage.readonly')}
          </span>
        </div>
      )}

      {showLoginEntry && (
        <div className="mindmap-share-banner-right">
          <Tooltip title={t('mindmap.sharePage.loginTooltip')}>
            <Link to="/login">
              <Button type="primary" size="small" icon={<LoginOutlined />}>
                {t('mindmap.sharePage.loginRegister')}
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
  /* i18n 实例用于取当前语言，供 toLocaleString 使用 */
  const { t, i18n } = useTranslation();

  const [loading, setLoading] = useState(true);
  /**
   * 错误状态结构: { key: 'i18n键', detail: '后端或异常原文(可选)' }
   * 不存已翻译文本，语言切换后渲染时重新 t() 即可跟随
   */
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  /* Mermaid/SVG 缩放倍率（markmap 走自身 rescale，不用这个 state） */
  const [zoomLevel, setZoomLevel] = useState(1);

  const svgRef = useRef(null);
  const markmapRef = useRef(null);
  const { initSystemConfig, initialized } = useSystemConfigStore();

  /* 初始化系统配置：公开访问页也需要站点 Logo / 名称，走 /public/system-config */
  useEffect(() => {
    if (!initialized && initSystemConfig) {
      initSystemConfig().catch(() => {
        /* 拿不到站点配置不影响导图展示，静默兜底 */
      });
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
          /* 业务失败：主提示用 i18n，后端原文放 detail 便于排障 */
          setError({
            key: 'mindmap.sharePage.errorLoad',
            detail: response.data.message || ''
          });
        }
      } catch (err) {
        if (cancelled) return;

        const status = err.response?.status;
        if (status === 403) {
          /* token 校验失败或已失效，语义明确无需附加 detail */
          setError({ key: 'mindmap.sharePage.errorInvalidToken' });
        } else if (status === 404) {
          setError({ key: 'mindmap.sharePage.errorNotFound' });
        } else {
          setError({
            key: 'mindmap.sharePage.errorLoadRetry',
            detail: err.response?.data?.message || ''
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    /* cancelled 防止组件卸载后 setState 引发内存泄漏警告 */
    return () => { cancelled = true; };
  }, [id, token]);

  /**
   * Markdown 模式渲染 markmap
   *
   * 依赖数组只放 data：不能把 t 放进来，
   * 否则语言切换会触发整棵思维导图重建并重置用户的缩放/平移位置。
   * 渲染失败时只记 key，文案在 JSX 里才求值。
   */
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

      /* 等入场动画结束后再 fit 并美化连线颜色 */
      setTimeout(() => {
        try {
          mm.fit();
          const svg = svgRef.current;
          if (svg) {
            const allPaths = svg.querySelectorAll('path');
            allPaths.forEach((path, index) => {
              /* 只处理连线（无填充的 path），节点矩形不动 */
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
          console.warn('[MindmapShare] markmap fit failed:', e);
        }
      }, MARKMAP_DECORATE_DELAY_MS);
    } catch (err) {
      console.error('[MindmapShare] markmap render failed:', err);
      setError({ key: 'mindmap.sharePage.errorRender' });
    }
  }, [data]);

  /* 缩放控制：markdown 用 markmap 原生 API，其余模式用 CSS transform */
  const handleZoom = (type) => {
    if (data?.content_type === 'markdown') {
      if (!markmapRef.current) return;
      try {
        if (type === 'in') markmapRef.current.rescale(1.25);
        else if (type === 'out') markmapRef.current.rescale(0.8);
        else if (type === 'fit') markmapRef.current.fit();
      } catch (e) {
        /* markmap 内部状态异常时忽略，不影响页面 */
      }
    } else {
      setZoomLevel(prev => {
        if (type === 'in') return Math.min(prev * 1.2, 3);
        if (type === 'out') return Math.max(prev / 1.2, 0.2);
        if (type === 'fit') return 1;
        return prev;
      });
    }
  };

  /* ============ 加载中 ============ */
  if (loading) {
    return (
      <div className="mindmap-share-page">
        <PlatformBanner subtitle={t('mindmap.sharePage.subtitle')} />
        <div className="mindmap-share-loading">
          <Spin size="large" />
          <div style={{ marginTop: 16, color: '#8E8E93' }}>
            {t('mindmap.sharePage.loading')}
          </div>
        </div>
      </div>
    );
  }

  /* ============ 错误状态 ============ */
  if (error) {
    return (
      <div className="mindmap-share-page">
        <PlatformBanner subtitle={t('mindmap.sharePage.subtitle')} />
        <div className="mindmap-share-error">
          <CloseCircleOutlined className="mindmap-share-error-icon" />
          <div className="mindmap-share-error-title">
            {t('mindmap.sharePage.errorTitle')}
          </div>
          {/* 主提示走 i18n，保证语言正确 */}
          <div className="mindmap-share-error-msg">{t(error.key)}</div>
          {/* 后端原文（通常为中文）仅作排障小字附加，不替代主提示 */}
          {error.detail && (
            <div className="mindmap-share-error-detail">{error.detail}</div>
          )}
          <Button
            type="primary"
            icon={<HomeOutlined />}
            onClick={() => { window.location.href = '/'; }}
          >
            {t('mindmap.sharePage.backHome')}
          </Button>
        </div>
      </div>
    );
  }

  /* ============ 正常渲染 ============ */
  const renderContent = () => {
    if (data.content_type === 'markdown') {
      return (
        <div className="mindmap-svg-wrapper">
          <svg ref={svgRef}></svg>
        </div>
      );
    }
    /* Mermaid / SVG：外层用 transform 缩放，内部组件自行处理渲染与错误提示 */
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

  /**
   * 更新时间文案
   * 必须把 i18n.language 传给 toLocaleString，
   * 否则英文环境仍按浏览器默认（常为中文）格式输出年月日
   */
  const renderUpdatedAt = () => {
    if (!data.updated_at) return null;
    const timeText = new Date(data.updated_at).toLocaleString(i18n.language);
    /* 整句插值：中英语序不同，禁止用 JSX 拼接前缀 + 时间 */
    return (
      <span className="mindmap-share-time">
        {t('mindmap.sharePage.updatedAt', { time: timeText })}
      </span>
    );
  };

  return (
    <div className="mindmap-share-page">
      <PlatformBanner
        title={data.title}
        subtitle={t('mindmap.sharePage.subtitle')}
      />

      {/* 顶部工具栏：更新时间 + 缩放按钮组 */}
      <div className="mindmap-share-toolbar">
        <div className="mindmap-share-toolbar-left">
          {renderUpdatedAt()}
        </div>
        <div className="mindmap-share-toolbar-right">
          {/* 缩放三按钮复用主编辑页已有的 mindmap.zoom.* 键，避免重复定义 */}
          <Tooltip title={t('mindmap.zoom.in')}>
            <button className="tool-btn" onClick={() => handleZoom('in')}>
              <ZoomInOutlined />
            </button>
          </Tooltip>
          <Tooltip title={t('mindmap.zoom.out')}>
            <button className="tool-btn" onClick={() => handleZoom('out')}>
              <ZoomOutOutlined />
            </button>
          </Tooltip>
          <Tooltip title={t('mindmap.zoom.fit')}>
            <button className="tool-btn" onClick={() => handleZoom('fit')}>
              <ReloadOutlined />
            </button>
          </Tooltip>
          {/* 百分比数字属纯数值，无需 i18n */}
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
