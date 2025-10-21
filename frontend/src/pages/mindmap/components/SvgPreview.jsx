/**
 * SVG 预览组件
 * 支持 SVG 代码的实时预览和安全渲染
 */

import React, { useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import DOMPurify from 'dompurify';

const SvgPreview = ({ code, onError }) => {
  const containerRef = useRef(null);
  const [error, setError] = useState(null);
  const renderTimeoutRef = useRef(null);

  useEffect(() => {
    if (!code || !containerRef.current) {
      return;
    }

    // 清除之前的渲染超时
    if (renderTimeoutRef.current) {
      clearTimeout(renderTimeoutRef.current);
    }

    // 防抖渲染（500ms）
    renderTimeoutRef.current = setTimeout(() => {
      try {
        setError(null);

        // 使用 DOMPurify 清理 SVG 代码，防止 XSS 攻击
        const cleanSvg = DOMPurify.sanitize(code, {
          USE_PROFILES: { svg: true, svgFilters: true },
          ADD_TAGS: ['use'],
          ADD_ATTR: ['xlink:href', 'xmlns:xlink']
        });

        // 验证是否是有效的 SVG
        const parser = new DOMParser();
        const doc = parser.parseFromString(cleanSvg, 'image/svg+xml');
        const parserError = doc.querySelector('parsererror');

        if (parserError) {
          throw new Error('无效的 SVG 代码');
        }

        // 渲染 SVG
        containerRef.current.innerHTML = cleanSvg;

        // 确保 SVG 响应式
        const svgElement = containerRef.current.querySelector('svg');
        if (svgElement) {
          if (!svgElement.hasAttribute('viewBox') && 
              svgElement.hasAttribute('width') && 
              svgElement.hasAttribute('height')) {
            const width = svgElement.getAttribute('width');
            const height = svgElement.getAttribute('height');
            svgElement.setAttribute('viewBox', `0 0 ${width} ${height}`);
          }
          svgElement.style.maxWidth = '100%';
          svgElement.style.height = 'auto';
        }

      } catch (err) {
        console.error('SVG 渲染失败:', err);
        setError(err.message || '渲染失败');
        
        if (onError) {
          onError(err);
        }

        // 显示错误提示
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
            <div style="font-size: 14px; color: #999;">${err.message}</div>
          </div>
        `;
      }
    }, 500);

    return () => {
      if (renderTimeoutRef.current) {
        clearTimeout(renderTimeoutRef.current);
      }
    };
  }, [code, onError]);

  return (
    <div 
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        overflow: 'auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        backgroundColor: '#fff'
      }}
    />
  );
};

export default SvgPreview;
