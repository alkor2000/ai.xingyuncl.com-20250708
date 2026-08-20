/**
 * SVG 预览组件
 *
 * ===== v2.1 国际化改造要点（务必理解，勿回退）=====
 *
 * 1. 错误状态由"存已翻译文本"改为存 { key, detail } 结构，
 *    渲染时才 t()，用户在错误态切换语言可即时生效。
 *
 * 2. 内部渲染函数（renderSimpleSvg / renderWithIframe）不得调用 t()：
 *    它们被 useCallback 包裹并进入 useEffect 依赖链，
 *    一旦依赖 t，语言切换就会触发 SVG 重新渲染（iframe 会白闪一次）。
 *    因此抛错时改为在 Error 对象上挂 i18nKey / i18nDetail 字段，
 *    由 catch 侧转成 { key, detail } 存入 state。
 *
 * 3. DOMParser 抛出的解析错误文本属技术诊断信息，按翻译边界原则不翻译，
 *    作为 detail 插入 errorSyntax 句式中展示。
 *
 * ===== 功能说明（逻辑与 v2.0 完全一致，未做行为变更）=====
 * 1. 简单 SVG 直接 innerHTML 插入（不用 DOMPurify，避免合法属性被过度清理）
 * 2. 复杂 SVG（含 style/foreignObject/script）用 iframe 空 sandbox 隔离渲染
 * 3. 自动补全 viewBox/width/height 确保缩放正确
 * 4. 解析失败显示友好提示而非空白
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Empty } from 'antd';
import { useTranslation } from 'react-i18next';

/* 代码变更后的防抖延迟 */
const RENDER_DEBOUNCE_MS = 300;
/* DOMParser 报错文本截断长度，避免超长内容撑破布局 */
const PARSER_ERROR_MAX_LEN = 100;
/* iframe 尺寸约束（外边距 40px，宽 400~1200，高 300~900） */
const IFRAME_PADDING = 40;
const IFRAME_MIN_WIDTH = 400;
const IFRAME_MAX_WIDTH = 1200;
const IFRAME_MIN_HEIGHT = 300;
const IFRAME_MAX_HEIGHT = 900;
/* SVG 缺失尺寸信息时的默认画布大小 */
const DEFAULT_SVG_WIDTH = 800;
const DEFAULT_SVG_HEIGHT = 600;

const SvgPreview = ({ code, onError }) => {
  const { t } = useTranslation();
  const containerRef = useRef(null);
  const renderTimeoutRef = useRef(null);
  /**
   * 错误状态结构: { key: 'i18n键', detail: '原始报错(可选)' }
   * 存 key 而非文本，语言切换时渲染层重新 t() 即可跟随
   */
  const [error, setError] = useState(null);
  const [isEmpty, setIsEmpty] = useState(false);

  /**
   * 检测 SVG 是否包含需要 iframe 隔离渲染的复杂内容
   * - foreignObject : 嵌入 HTML，直接插入会受宿主 CSS 影响
   * - style 标签    : CSS 会泄漏影响外部 DOM
   * - script 标签   : 安全考虑必须隔离
   */
  const isComplexSvg = useCallback((svgCode) => {
    if (!svgCode) return false;
    const lower = svgCode.toLowerCase();
    return (
      lower.includes('<foreignobject') ||
      lower.includes('<style') ||
      lower.includes('<script') ||
      lower.includes('xmlns:xhtml')
    );
  }, []);

  /**
   * 从 SVG 代码解析尺寸信息
   * 优先 viewBox，其次 width/height 属性
   */
  const extractDimensions = useCallback((svgCode) => {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgCode, 'image/svg+xml');
      const svg = doc.querySelector('svg');
      if (!svg) return { width: DEFAULT_SVG_WIDTH, height: DEFAULT_SVG_HEIGHT };

      let width = DEFAULT_SVG_WIDTH;
      let height = DEFAULT_SVG_HEIGHT;

      if (svg.hasAttribute('viewBox')) {
        const parts = svg.getAttribute('viewBox').split(/[\s,]+/).map(Number);
        if (parts.length >= 4) {
          width = parts[2] || DEFAULT_SVG_WIDTH;
          height = parts[3] || DEFAULT_SVG_HEIGHT;
        }
      }

      /* 显式 width/height 优先级高于 viewBox 推导值 */
      if (svg.hasAttribute('width')) {
        const w = parseFloat(svg.getAttribute('width'));
        if (w > 0) width = w;
      }
      if (svg.hasAttribute('height')) {
        const h = parseFloat(svg.getAttribute('height'));
        if (h > 0) height = h;
      }

      return { width, height };
    } catch (e) {
      /* 解析失败用默认尺寸，不阻断后续渲染尝试 */
      return { width: DEFAULT_SVG_WIDTH, height: DEFAULT_SVG_HEIGHT };
    }
  }, []);

  /**
   * 修复 SVG 元素的尺寸属性
   * 必须同时具备 viewBox 与 width/height，渲染引擎才能正确缩放
   */
  const fixSvgDimensions = useCallback((svgEl) => {
    if (!svgEl) return;

    const hasViewBox = svgEl.hasAttribute('viewBox');
    const hasWidth = svgEl.hasAttribute('width');
    const hasHeight = svgEl.hasAttribute('height');

    if (hasViewBox && (!hasWidth || !hasHeight)) {
      /* 有 viewBox 缺宽高：从 viewBox 提取 */
      const parts = svgEl.getAttribute('viewBox').split(/[\s,]+/).map(Number);
      if (parts.length >= 4) {
        if (!hasWidth) svgEl.setAttribute('width', parts[2]);
        if (!hasHeight) svgEl.setAttribute('height', parts[3]);
      }
    } else if (!hasViewBox && hasWidth && hasHeight) {
      /* 有宽高缺 viewBox：反向生成 */
      const w = parseFloat(svgEl.getAttribute('width')) || DEFAULT_SVG_WIDTH;
      const h = parseFloat(svgEl.getAttribute('height')) || DEFAULT_SVG_HEIGHT;
      svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
    } else if (!hasViewBox && !hasWidth && !hasHeight) {
      /* 全缺：套用默认画布 */
      svgEl.setAttribute('width', String(DEFAULT_SVG_WIDTH));
      svgEl.setAttribute('height', String(DEFAULT_SVG_HEIGHT));
      svgEl.setAttribute('viewBox', `0 0 ${DEFAULT_SVG_WIDTH} ${DEFAULT_SVG_HEIGHT}`);
    }
  }, []);

  /**
   * 直接渲染简单 SVG
   *
   * 不使用 DOMPurify：它会清理掉部分合法 SVG 属性导致图形失真，
   * 改用 DOMParser 验证语法合法性。
   *
   * 注意：本函数不调用 t()，抛错时把 i18n 键挂在 Error 对象上，
   * 由调用方 catch 后转换，以保证 useCallback 不依赖 t。
   */
  const renderSimpleSvg = useCallback((svgCode) => {
    if (!containerRef.current) return;

    const parser = new DOMParser();
    const doc = parser.parseFromString(svgCode, 'image/svg+xml');
    const parserError = doc.querySelector('parsererror');

    if (parserError) {
      const err = new Error('SVG parse error');
      /* 挂载 i18n 元信息，由 catch 侧转成 { key, detail } */
      err.i18nKey = 'mindmap.svgPreview.errorSyntax';
      err.i18nDetail = (parserError.textContent || '').substring(0, PARSER_ERROR_MAX_LEN);
      throw err;
    }

    containerRef.current.innerHTML = svgCode;

    /* 修复尺寸并设置自适应居中样式 */
    const svgEl = containerRef.current.querySelector('svg');
    if (svgEl) {
      fixSvgDimensions(svgEl);
      svgEl.style.maxWidth = '100%';
      svgEl.style.height = 'auto';
      svgEl.style.display = 'block';
      svgEl.style.margin = '0 auto';
    }
  }, [fixSvgDimensions]);

  /**
   * 用 iframe 安全渲染复杂 SVG
   * 空 sandbox 提供最强隔离，CSS 仍可正常工作（仅禁用脚本与同源访问）
   *
   * 注意：本函数不调用 t()，加载失败时只落 key。
   */
  const renderWithIframe = useCallback((svgCode) => {
    if (!containerRef.current) return;

    const { width, height } = extractDimensions(svgCode);

    /* 构建完整 HTML 文档包裹 SVG，内联样式保证居中与白底 */
    const htmlContent = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { background: #fff; display: flex; justify-content: center; align-items: flex-start; padding: 16px; }
  svg { display: block; max-width: 100%; height: auto; }
</style>
</head>
<body>
${svgCode}
</body>
</html>`;

    const blob = new Blob([htmlContent], { type: 'text/html' });
    const blobUrl = URL.createObjectURL(blob);

    containerRef.current.innerHTML = '';

    const iframe = document.createElement('iframe');
    iframe.src = blobUrl;
    /* 空 sandbox：禁用脚本与同源访问，CSS 渲染不受影响 */
    iframe.sandbox = '';
    iframe.title = 'SVG Preview';
    iframe.className = 'svg-preview-iframe';
    iframe.style.cssText = `
      width: ${Math.min(Math.max(width + IFRAME_PADDING, IFRAME_MIN_WIDTH), IFRAME_MAX_WIDTH)}px;
      height: ${Math.min(Math.max(height + IFRAME_PADDING, IFRAME_MIN_HEIGHT), IFRAME_MAX_HEIGHT)}px;
      max-width: 100%;
      border: none;
      background: #fff;
      border-radius: 8px;
      display: block;
      margin: 0 auto;
    `;

    /* 加载完成立即释放 blob URL，避免内存泄漏 */
    iframe.onload = () => URL.revokeObjectURL(blobUrl);
    iframe.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      setError({ key: 'mindmap.svgPreview.errorLoad' });
    };

    containerRef.current.appendChild(iframe);
  }, [extractDimensions]);

  /* 监听 code 变化，防抖后渲染 */
  useEffect(() => {
    if (renderTimeoutRef.current) {
      clearTimeout(renderTimeoutRef.current);
    }

    /* 空代码：进入空状态 */
    if (!code || code.trim() === '') {
      setIsEmpty(true);
      setError(null);
      if (containerRef.current) containerRef.current.innerHTML = '';
      return;
    }

    setIsEmpty(false);
    setError(null);

    renderTimeoutRef.current = setTimeout(() => {
      try {
        if (isComplexSvg(code)) {
          renderWithIframe(code);
        } else {
          renderSimpleSvg(code);
        }
      } catch (err) {
        console.error('[SvgPreview] render failed:', err);
        /* 优先用 Error 上挂载的 i18n 元信息，其次回退通用错误键 */
        setError({
          key: err.i18nKey || 'mindmap.svgPreview.errorDefault',
          detail: err.i18nDetail || err.message || ''
        });
        if (containerRef.current) containerRef.current.innerHTML = '';
        if (onError) onError(err);
      }
    }, RENDER_DEBOUNCE_MS);

    return () => {
      if (renderTimeoutRef.current) {
        clearTimeout(renderTimeoutRef.current);
      }
    };
  }, [code, onError, isComplexSvg, renderSimpleSvg, renderWithIframe]);

  /**
   * 组装错误正文
   * errorSyntax 需要把原始解析报错插入句式，其余情况直接展示 detail 或通用文案
   */
  const renderErrorMessage = () => {
    if (!error) return null;
    if (error.key === 'mindmap.svgPreview.errorSyntax') {
      /* 整句插值：中英语序不同，不可用 JSX 拼接冒号 */
      return t(error.key, { detail: error.detail });
    }
    return error.detail || t(error.key);
  };

  return (
    <div className="svg-preview-container">
      {/* 空状态 */}
      {isEmpty && (
        <div className="svg-preview-overlay">
          <Empty description={t('mindmap.svgPreview.emptyHint')} />
        </div>
      )}

      {/* 错误状态 */}
      {error && (
        <div className="svg-preview-overlay">
          <div className="svg-preview-error">
            {/* Emoji 属视觉符号，保留在 JSX 不进语言包 */}
            <div className="svg-preview-error-icon">⚠️</div>
            <div className="svg-preview-error-title">
              {t('mindmap.svgPreview.errorTitle')}
            </div>
            <div className="svg-preview-error-msg">
              {renderErrorMessage()}
            </div>
          </div>
        </div>
      )}

      {/* 渲染内容区 */}
      <div
        ref={containerRef}
        className="svg-preview-content"
      />
    </div>
  );
};

export default SvgPreview;
