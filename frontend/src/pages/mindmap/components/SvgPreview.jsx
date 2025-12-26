/**
 * SVG 预览组件
 * 支持 SVG 代码的实时预览和安全渲染
 * 
 * v1.1 修复SVG尺寸问题 - 2025-12-26
 * v1.2 支持foreignObject和HTML内容 - 2025-12-26
 * v1.3 使用iframe安全渲染复杂SVG - 2025-12-26
 * v1.4 修复iframe sandbox问题 - 2025-12-26
 * v1.5 修复sandbox安全警告 - 2025-12-26
 *   - 移除allow-scripts（CSS/SVG不需要JS执行）
 *   - 移除allow-same-origin避免沙箱逃逸风险
 *   - 这样可以完整支持CSS样式，同时保证安全性
 */
import React, { useEffect, useRef, useState } from 'react';
import DOMPurify from 'dompurify';

const SvgPreview = ({ code, onError }) => {
  const containerRef = useRef(null);
  const [error, setError] = useState(null);
  const [useIframe, setUseIframe] = useState(false);
  const renderTimeoutRef = useRef(null);

  /**
   * 检测SVG是否包含需要特殊处理的复杂内容
   */
  const isComplexSvg = (svgCode) => {
    if (!svgCode) return false;
    const lowerCode = svgCode.toLowerCase();
    return (
      lowerCode.includes('<foreignobject') ||
      lowerCode.includes('<style') ||
      lowerCode.includes('xmlns:xhtml') ||
      lowerCode.includes('xhtml:')
    );
  };

  /**
   * 从SVG代码中提取尺寸信息
   */
  const extractSvgDimensions = (svgCode) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgCode, 'image/svg+xml');
    const svg = doc.querySelector('svg');
    
    if (!svg) return { width: 800, height: 600 };
    
    let width = 800, height = 600;
    
    if (svg.hasAttribute('width')) {
      width = parseFloat(svg.getAttribute('width')) || 800;
    }
    if (svg.hasAttribute('height')) {
      height = parseFloat(svg.getAttribute('height')) || 600;
    }
    
    if (svg.hasAttribute('viewBox')) {
      const viewBox = svg.getAttribute('viewBox');
      const parts = viewBox.split(/[\s,]+/).map(Number);
      if (parts.length >= 4) {
        if (!svg.hasAttribute('width')) width = parts[2] || width;
        if (!svg.hasAttribute('height')) height = parts[3] || height;
      }
    }
    
    return { width, height };
  };

  useEffect(() => {
    if (!code) {
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
      setUseIframe(false);
      return;
    }

    if (renderTimeoutRef.current) {
      clearTimeout(renderTimeoutRef.current);
    }

    renderTimeoutRef.current = setTimeout(() => {
      try {
        setError(null);
        
        const needsIframe = isComplexSvg(code);
        setUseIframe(needsIframe);
        
        if (needsIframe) {
          console.log('[SvgPreview] 检测到复杂SVG，使用iframe渲染');
          renderWithIframe(code);
        } else {
          console.log('[SvgPreview] 简单SVG，使用直接渲染');
          renderSimpleSvg(code);
        }
      } catch (err) {
        console.error('SVG 渲染失败:', err);
        setError(err.message || '渲染失败');
        showError(err.message || '渲染失败');
        
        if (onError) {
          onError(err);
        }
      }
    }, 300);

    return () => {
      if (renderTimeoutRef.current) {
        clearTimeout(renderTimeoutRef.current);
      }
    };
  }, [code, onError]);

  /**
   * 使用iframe安全渲染复杂SVG
   * v1.5 移除allow-scripts和allow-same-origin
   * - CSS <style> 标签不需要JS执行权限
   * - SVG动画(SMIL)是声明性的，也不需要JS
   * - 这样既安全又能完整渲染CSS样式
   */
  const renderWithIframe = (svgCode) => {
    if (!containerRef.current) return;
    
    const { width, height } = extractSvgDimensions(svgCode);
    
    // 创建完整的HTML文档包裹SVG
    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { 
      width: ${width}px;
      min-height: ${height}px;
      background: #fff;
      overflow: visible;
    }
    svg {
      display: block;
      width: ${width}px;
      height: ${height}px;
    }
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
    // v1.5 不使用allow-scripts和allow-same-origin
    // CSS样式和SVG动画(SMIL)不需要JS执行权限
    // 空sandbox提供最大安全性，同时CSS仍然可以工作
    iframe.sandbox = '';
    iframe.style.cssText = `
      width: ${Math.max(width + 40, 800)}px;
      height: ${Math.max(height + 40, 600)}px;
      max-width: 100%;
      border: none;
      background: #fff;
      border-radius: 8px;
    `;
    iframe.title = 'SVG Preview';
    
    iframe.onload = () => {
      URL.revokeObjectURL(blobUrl);
      console.log(`[SvgPreview] iframe渲染完成，尺寸: ${width}x${height}`);
    };
    
    iframe.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      showError('SVG 加载失败');
    };
    
    containerRef.current.appendChild(iframe);
  };

  /**
   * 直接渲染简单SVG
   */
  const renderSimpleSvg = (svgCode) => {
    if (!containerRef.current) return;
    
    const cleanSvg = DOMPurify.sanitize(svgCode, {
      USE_PROFILES: { svg: true, svgFilters: true },
      ADD_TAGS: ['use'],
      ADD_ATTR: ['xlink:href', 'xmlns:xlink']
    });

    const parser = new DOMParser();
    const doc = parser.parseFromString(cleanSvg, 'image/svg+xml');
    const parserError = doc.querySelector('parsererror');

    if (parserError) {
      throw new Error('无效的 SVG 代码');
    }

    containerRef.current.innerHTML = cleanSvg;

    const svgElement = containerRef.current.querySelector('svg');
    if (svgElement) {
      fixSvgDimensions(svgElement);
      svgElement.style.maxWidth = '100%';
      svgElement.style.height = 'auto';
      svgElement.style.display = 'block';
    }
  };

  /**
   * 修复SVG尺寸问题
   */
  const fixSvgDimensions = (svgElement) => {
    const hasViewBox = svgElement.hasAttribute('viewBox');
    const hasWidth = svgElement.hasAttribute('width');
    const hasHeight = svgElement.hasAttribute('height');

    if (hasViewBox && (!hasWidth || !hasHeight)) {
      const viewBox = svgElement.getAttribute('viewBox');
      const viewBoxParts = viewBox.split(/[\s,]+/).map(Number);
      
      if (viewBoxParts.length >= 4) {
        const [, , vbWidth, vbHeight] = viewBoxParts;
        
        if (!hasWidth) svgElement.setAttribute('width', vbWidth);
        if (!hasHeight) svgElement.setAttribute('height', vbHeight);
        
        console.log(`[SvgPreview] 从viewBox提取尺寸: ${vbWidth}x${vbHeight}`);
      }
    }

    if (!hasViewBox && hasWidth && hasHeight) {
      const width = svgElement.getAttribute('width');
      const height = svgElement.getAttribute('height');
      const numWidth = parseFloat(width);
      const numHeight = parseFloat(height);
      svgElement.setAttribute('viewBox', `0 0 ${numWidth} ${numHeight}`);
      console.log(`[SvgPreview] 从width/height生成viewBox: 0 0 ${numWidth} ${numHeight}`);
    }

    if (!hasViewBox && !hasWidth && !hasHeight) {
      svgElement.setAttribute('width', '800');
      svgElement.setAttribute('height', '600');
      svgElement.setAttribute('viewBox', '0 0 800 600');
      console.log('[SvgPreview] 设置默认尺寸: 800x600');
    }
  };

  /**
   * 显示错误信息
   */
  const showError = (errorMessage) => {
    if (!containerRef.current) return;
    
    containerRef.current.innerHTML = `
      <div style="
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        min-height: 400px;
        flex-direction: column;
        color: #ff4d4f;
      ">
        <div style="font-size: 48px; margin-bottom: 16px;">⚠️</div>
        <div style="font-size: 16px; margin-bottom: 8px;">SVG 渲染失败</div>
        <div style="font-size: 14px; color: #999;">${errorMessage}</div>
      </div>
    `;
  };

  return (
    <div 
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        overflow: 'auto',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '20px',
        backgroundColor: '#fff',
        borderRadius: '8px'
      }}
    />
  );
};

export default SvgPreview;
