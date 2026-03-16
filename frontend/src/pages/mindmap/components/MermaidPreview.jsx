/**
 * Mermaid 图表预览组件 v2.0
 * 
 * 核心改进：
 * 1. 渲染失败自动重试（最多2次，每次重新initialize）
 * 2. 唯一ID防冲突（使用递增计数器而非时间戳）
 * 3. 临时容器清理更安全（查找所有遗留节点）
 * 4. 渲染后SVG自适应居中显示
 * 5. 防抖延迟从500ms降到300ms提升响应速度
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Spin, Empty } from 'antd';
import mermaid from 'mermaid';

/* 全局渲染计数器，确保每次render的ID唯一 */
let globalRenderCount = 0;

/**
 * 初始化mermaid配置
 * 提取为独立函数，渲染失败时可重新调用
 */
const initMermaid = () => {
  mermaid.initialize({
    startOnLoad: false,
    theme: 'default',
    securityLevel: 'loose',
    /* 中文字体优先 */
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
    flowchart: {
      useMaxWidth: false,
      htmlLabels: true,
      curve: 'basis',
      padding: 15,
      nodeSpacing: 50,
      rankSpacing: 50
    },
    sequence: {
      useMaxWidth: false,
      wrap: true,
      width: 150
    },
    gantt: {
      useMaxWidth: false,
      fontSize: 12
    },
    /* 只输出error级别日志，避免控制台刷屏 */
    logLevel: 'error'
  });
};

const MermaidPreview = ({ code }) => {
  const containerRef = useRef(null);
  const renderTimeoutRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [isEmpty, setIsEmpty] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  /* 首次挂载时初始化mermaid */
  useEffect(() => {
    initMermaid();
  }, []);

  /**
   * 清理所有mermaid遗留的临时DOM节点
   * mermaid.render有时会在body上遗留隐藏div
   */
  const cleanupMermaidDOM = useCallback(() => {
    try {
      const staleNodes = document.querySelectorAll('[id^="mermaid-"][style*="display: none"]');
      staleNodes.forEach(node => {
        try {
          if (node.parentNode) node.parentNode.removeChild(node);
        } catch (e) { /* 忽略 */ }
      });
      /* 清理dmermaid开头的SVG（mermaid内部生成） */
      const staleSvgs = document.querySelectorAll('[id^="dmermaid-"]');
      staleSvgs.forEach(node => {
        try {
          if (node.parentNode) node.parentNode.removeChild(node);
        } catch (e) { /* 忽略 */ }
      });
    } catch (e) {
      console.warn('[MermaidPreview] DOM清理失败:', e);
    }
  }, []);

  /**
   * 核心渲染函数
   * @param {string} mermaidCode - Mermaid代码
   * @param {number} retryCount - 当前重试次数
   */
  const doRender = useCallback(async (mermaidCode, retryCount = 0) => {
    if (!containerRef.current) return;

    try {
      /* 清理之前的遗留DOM */
      cleanupMermaidDOM();

      /* 清空容器 */
      containerRef.current.innerHTML = '';

      /* 生成唯一ID */
      globalRenderCount += 1;
      const id = `mm-${globalRenderCount}`;

      /* 渲染图表 */
      const { svg } = await mermaid.render(id, mermaidCode);

      /* 再次清理（render后可能产生新的临时节点） */
      cleanupMermaidDOM();

      /* 插入SVG到容器 */
      if (containerRef.current) {
        containerRef.current.innerHTML = svg;

        /* 优化SVG显示：自适应居中 */
        const svgEl = containerRef.current.querySelector('svg');
        if (svgEl) {
          /* 保存原始尺寸用于viewBox */
          const origW = svgEl.getAttribute('width');
          const origH = svgEl.getAttribute('height');

          /* 设置viewBox确保缩放正确 */
          if (origW && origH && !svgEl.getAttribute('viewBox')) {
            const w = parseFloat(origW) || 800;
            const h = parseFloat(origH) || 600;
            svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
          }

          /* 移除固定尺寸，改为自适应 */
          svgEl.removeAttribute('width');
          svgEl.removeAttribute('height');
          svgEl.style.width = '100%';
          svgEl.style.height = 'auto';
          svgEl.style.maxWidth = '100%';
          svgEl.style.display = 'block';
          svgEl.style.margin = '0 auto';
        }
      }

      setLoading(false);
      setErrorMsg(null);
    } catch (err) {
      console.error(`[MermaidPreview] 渲染失败 (尝试${retryCount + 1}):`, err.message);

      /* 重试机制：最多重试2次 */
      if (retryCount < 2) {
        console.log(`[MermaidPreview] 将在200ms后重试...`);
        /* 重新初始化mermaid清理内部状态 */
        initMermaid();
        cleanupMermaidDOM();
        /* 延迟重试 */
        setTimeout(() => {
          doRender(mermaidCode, retryCount + 1);
        }, 200);
        return;
      }

      /* 重试耗尽，显示错误 */
      setLoading(false);
      setErrorMsg(err.message || '渲染失败');

      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    }
  }, [cleanupMermaidDOM]);

  /* 监听code变化，防抖后渲染 */
  useEffect(() => {
    if (renderTimeoutRef.current) {
      clearTimeout(renderTimeoutRef.current);
    }

    /* 空代码处理 */
    if (!code || code.trim() === '') {
      setIsEmpty(true);
      setLoading(false);
      setErrorMsg(null);
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
      return;
    }

    setIsEmpty(false);
    setLoading(true);
    setErrorMsg(null);

    /* 300ms防抖 */
    renderTimeoutRef.current = setTimeout(() => {
      doRender(code, 0);
    }, 300);

    return () => {
      if (renderTimeoutRef.current) {
        clearTimeout(renderTimeoutRef.current);
      }
    };
  }, [code, doRender]);

  /* 组件卸载时清理 */
  useEffect(() => {
    return () => {
      cleanupMermaidDOM();
    };
  }, [cleanupMermaidDOM]);

  return (
    <div className="mermaid-preview-container">
      {/* 加载状态 */}
      {loading && (
        <div className="mermaid-preview-overlay">
          <Spin size="large" tip="渲染图表中..." />
        </div>
      )}

      {/* 空状态 */}
      {isEmpty && !loading && (
        <div className="mermaid-preview-overlay">
          <Empty description="请输入 Mermaid 代码" />
        </div>
      )}

      {/* 错误状态 */}
      {errorMsg && !loading && (
        <div className="mermaid-preview-overlay">
          <div className="mermaid-error">
            <div className="mermaid-error-icon">⚠️</div>
            <div className="mermaid-error-title">Mermaid 渲染失败</div>
            <div className="mermaid-error-msg">{errorMsg}</div>
            <div className="mermaid-error-hint">请检查 Mermaid 语法是否正确</div>
          </div>
        </div>
      )}

      {/* 实际内容容器 */}
      <div
        ref={containerRef}
        className="mermaid-preview-content"
        style={{ opacity: loading ? 0 : 1 }}
      />
    </div>
  );
};

export default MermaidPreview;
