/**
 * SVG 预览组件 v2.0
 * 
 * 核心改进：
 * 1. 简单SVG直接innerHTML插入（不用DOMPurify过度清理导致内容丢失）
 * 2. 复杂SVG（含style/foreignObject）使用iframe沙箱安全渲染
 * 3. SVG尺寸自动修复：补全viewBox/width/height确保正确缩放
 * 4. 错误边界：解析失败显示友好提示而非空白
 * 5. 渲染后自动居中显示
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Empty } from 'antd';

const SvgPreview = ({ code, onError }) => {
  const containerRef = useRef(null);
  const renderTimeoutRef = useRef(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [isEmpty, setIsEmpty] = useState(false);

  /**
   * 检测SVG是否包含需要iframe渲染的复杂内容
   * - foreignObject: 嵌入HTML内容
   * - style标签: CSS样式可能影响外部DOM
   * - script标签: 安全考虑必须隔离
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
   * 从SVG代码解析尺寸信息
   * 优先从viewBox获取，其次从width/height属性
   */
  const extractDimensions = useCallback((svgCode) => {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgCode, 'image/svg+xml');
      const svg = doc.querySelector('svg');
      if (!svg) return { width: 800, height: 600 };

      let width = 800, height = 600;

      /* 优先从viewBox获取 */
      if (svg.hasAttribute('viewBox')) {
        const parts = svg.getAttribute('viewBox').split(/[\s,]+/).map(Number);
        if (parts.length >= 4) {
          width = parts[2] || 800;
          height = parts[3] || 600;
        }
      }

      /* width/height属性覆盖 */
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
      return { width: 800, height: 600 };
    }
  }, []);

  /**
   * 修复SVG元素的尺寸属性
   * 确保同时有viewBox和width/height，渲染引擎才能正确缩放
   */
  const fixSvgDimensions = useCallback((svgEl) => {
    if (!svgEl) return;

    const hasViewBox = svgEl.hasAttribute('viewBox');
    const hasWidth = svgEl.hasAttribute('width');
    const hasHeight = svgEl.hasAttribute('height');

    if (hasViewBox && (!hasWidth || !hasHeight)) {
      /* 有viewBox没有宽高 → 从viewBox提取 */
      const parts = svgEl.getAttribute('viewBox').split(/[\s,]+/).map(Number);
      if (parts.length >= 4) {
        if (!hasWidth) svgEl.setAttribute('width', parts[2]);
        if (!hasHeight) svgEl.setAttribute('height', parts[3]);
      }
    } else if (!hasViewBox && hasWidth && hasHeight) {
      /* 有宽高没有viewBox → 生成viewBox */
      const w = parseFloat(svgEl.getAttribute('width')) || 800;
      const h = parseFloat(svgEl.getAttribute('height')) || 600;
      svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
    } else if (!hasViewBox && !hasWidth && !hasHeight) {
      /* 都没有 → 设置默认值 */
      svgEl.setAttribute('width', '800');
      svgEl.setAttribute('height', '600');
      svgEl.setAttribute('viewBox', '0 0 800 600');
    }
  }, []);

  /**
   * 直接渲染简单SVG
   * 不使用DOMPurify（它会过度清理导致某些合法SVG属性丢失）
   * 改用DOMParser验证SVG是否合法
   */
  const renderSimpleSvg = useCallback((svgCode) => {
    if (!containerRef.current) return;

    /* 用DOMParser验证SVG是否合法 */
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgCode, 'image/svg+xml');
    const parserError = doc.querySelector('parsererror');

    if (parserError) {
      throw new Error('SVG语法错误: ' + (parserError.textContent || '').substring(0, 100));
    }

    /* 直接插入SVG */
    containerRef.current.innerHTML = svgCode;

    /* 修复尺寸并设置自适应样式 */
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
   * 使用iframe安全渲染复杂SVG
   * 空sandbox确保最大安全性，CSS样式仍然可以工作
   */
  const renderWithIframe = useCallback((svgCode) => {
    if (!containerRef.current) return;

    const { width, height } = extractDimensions(svgCode);

    /* 构建完整HTML文档包裹SVG */
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
    /* 空sandbox：最大安全性，CSS仍可工作 */
    iframe.sandbox = '';
    iframe.title = 'SVG Preview';
    iframe.className = 'svg-preview-iframe';
    iframe.style.cssText = `
      width: ${Math.min(Math.max(width + 40, 400), 1200)}px;
      height: ${Math.min(Math.max(height + 40, 300), 900)}px;
      max-width: 100%;
      border: none;
      background: #fff;
      border-radius: 8px;
      display: block;
      margin: 0 auto;
    `;

    iframe.onload = () => URL.revokeObjectURL(blobUrl);
    iframe.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      setErrorMsg('SVG 加载失败');
    };

    containerRef.current.appendChild(iframe);
  }, [extractDimensions]);

  /* 监听code变化，防抖后渲染 */
  useEffect(() => {
    if (renderTimeoutRef.current) {
      clearTimeout(renderTimeoutRef.current);
    }

    /* 空代码处理 */
    if (!code || code.trim() === '') {
      setIsEmpty(true);
      setErrorMsg(null);
      if (containerRef.current) containerRef.current.innerHTML = '';
      return;
    }

    setIsEmpty(false);
    setErrorMsg(null);

    /* 300ms防抖 */
    renderTimeoutRef.current = setTimeout(() => {
      try {
        if (isComplexSvg(code)) {
          renderWithIframe(code);
        } else {
          renderSimpleSvg(code);
        }
      } catch (err) {
        console.error('[SvgPreview] 渲染失败:', err);
        setErrorMsg(err.message || '渲染失败');
        if (containerRef.current) containerRef.current.innerHTML = '';
        if (onError) onError(err);
      }
    }, 300);

    return () => {
      if (renderTimeoutRef.current) {
        clearTimeout(renderTimeoutRef.current);
      }
    };
  }, [code, onError, isComplexSvg, renderSimpleSvg, renderWithIframe]);

  return (
    <div className="svg-preview-container">
      {/* 空状态 */}
      {isEmpty && (
        <div className="svg-preview-overlay">
          <Empty description="请输入 SVG 代码" />
        </div>
      )}

      {/* 错误状态 */}
      {errorMsg && (
        <div className="svg-preview-overlay">
          <div className="svg-preview-error">
            <div className="svg-preview-error-icon">⚠️</div>
            <div className="svg-preview-error-title">SVG 渲染失败</div>
            <div className="svg-preview-error-msg">{errorMsg}</div>
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
