/**
 * Mermaid 图表预览组件
 *
 * ===== v2.1 国际化改造要点（务必理解，勿回退）=====
 *
 * 1. 错误状态由"存已翻译文本"改为存 { key, detail } 结构：
 *    - key    : i18n 键，渲染时才 t()，语言切换即时生效
 *    - detail : mermaid 抛出的原始报错（如 "Parse error on line 3"），
 *               属第三方技术诊断信息，按翻译边界原则不翻译，原样展示
 *
 * 2. doRender 的 useCallback 依赖数组刻意不含 t：
 *    若把 t 放进依赖，语言切换会导致 doRender 重建 → useEffect 重跑
 *    → 图表被销毁重建产生闪烁。因此 doRender 内部绝不调用 t()。
 *
 * ===== 功能说明（逻辑与 v2.0 完全一致，未做行为变更）=====
 * 1. 渲染失败自动重试（最多2次，每次重新 initialize 清理内部状态）
 * 2. 唯一ID防冲突（递增计数器而非时间戳）
 * 3. 临时容器清理（查找 mermaid 遗留在 body 上的隐藏节点）
 * 4. 渲染后 SVG 自适应居中
 * 5. 300ms 防抖
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Spin, Empty } from 'antd';
import { useTranslation } from 'react-i18next';
import mermaid from 'mermaid';

/* 全局渲染计数器，确保每次 render 的 DOM id 唯一（时间戳在快速连续渲染时可能重复） */
let globalRenderCount = 0;

/* 最大重试次数：mermaid 首次渲染偶发失败，重新 initialize 后通常可成功 */
const MAX_RETRY = 2;
/* 重试间隔 */
const RETRY_DELAY_MS = 200;
/* 代码变更后的防抖延迟 */
const RENDER_DEBOUNCE_MS = 300;

/**
 * 初始化 mermaid 配置
 * 提取为独立函数，渲染失败时可重新调用以清理其内部状态
 *
 * 注意：fontFamily 中的字体名（PingFang SC / Microsoft YaHei）是
 * 字体资源标识而非界面文案，不参与 i18n。
 */
const initMermaid = () => {
  mermaid.initialize({
    startOnLoad: false,
    theme: 'default',
    securityLevel: 'loose',
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
    /* 只输出 error 级别日志，避免控制台刷屏 */
    logLevel: 'error'
  });
};

const MermaidPreview = ({ code }) => {
  const { t } = useTranslation();
  const containerRef = useRef(null);
  const renderTimeoutRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [isEmpty, setIsEmpty] = useState(false);
  /**
   * 错误状态结构: { key: 'i18n键', detail: 'mermaid原始报错' }
   * 存 key 而非文本，用户切换语言时渲染层重新 t() 即可跟随
   */
  const [error, setError] = useState(null);

  /* 首次挂载时初始化 mermaid */
  useEffect(() => {
    initMermaid();
  }, []);

  /**
   * 清理 mermaid 遗留的临时 DOM 节点
   * mermaid.render 有时会在 body 上留下隐藏 div，不清理会持续累积
   */
  const cleanupMermaidDOM = useCallback(() => {
    try {
      const staleNodes = document.querySelectorAll('[id^="mermaid-"][style*="display: none"]');
      staleNodes.forEach(node => {
        try {
          if (node.parentNode) node.parentNode.removeChild(node);
        } catch (e) {
          /* 节点可能已被 mermaid 自行移除，忽略 */
        }
      });
      /* 清理 dmermaid 开头的 SVG（mermaid 内部测量用） */
      const staleSvgs = document.querySelectorAll('[id^="dmermaid-"]');
      staleSvgs.forEach(node => {
        try {
          if (node.parentNode) node.parentNode.removeChild(node);
        } catch (e) {
          /* 同上，忽略 */
        }
      });
    } catch (e) {
      console.warn('[MermaidPreview] DOM cleanup failed:', e);
    }
  }, []);

  /**
   * 核心渲染函数
   *
   * 重要：本函数内不得调用 t()，否则 useCallback 必须依赖 t，
   * 会导致语言切换时图表被重建闪烁。错误信息只落 key + detail。
   *
   * @param {string} mermaidCode - Mermaid 源码
   * @param {number} retryCount  - 当前重试次数
   */
  const doRender = useCallback(async (mermaidCode, retryCount = 0) => {
    if (!containerRef.current) return;

    try {
      /* 清理上一轮的遗留 DOM */
      cleanupMermaidDOM();
      containerRef.current.innerHTML = '';

      /* 生成唯一 id */
      globalRenderCount += 1;
      const id = `mm-${globalRenderCount}`;

      const { svg } = await mermaid.render(id, mermaidCode);

      /* render 后可能产生新的临时节点，再清一次 */
      cleanupMermaidDOM();

      if (containerRef.current) {
        containerRef.current.innerHTML = svg;

        /* 优化 SVG 显示：补 viewBox 并改为自适应宽度居中 */
        const svgEl = containerRef.current.querySelector('svg');
        if (svgEl) {
          const origW = svgEl.getAttribute('width');
          const origH = svgEl.getAttribute('height');

          /* 有固定宽高但无 viewBox 时补上，否则移除宽高后无法正确缩放 */
          if (origW && origH && !svgEl.getAttribute('viewBox')) {
            const w = parseFloat(origW) || 800;
            const h = parseFloat(origH) || 600;
            svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
          }

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
      setError(null);
    } catch (err) {
      console.error(`[MermaidPreview] render failed (attempt ${retryCount + 1}):`, err.message);

      /* 重试：重新 initialize 以清理 mermaid 内部脏状态 */
      if (retryCount < MAX_RETRY) {
        initMermaid();
        cleanupMermaidDOM();
        setTimeout(() => {
          doRender(mermaidCode, retryCount + 1);
        }, RETRY_DELAY_MS);
        return;
      }

      /* 重试耗尽：只存 key 与原始报错，文案在 JSX 中才求值 */
      setLoading(false);
      setError({
        key: 'mindmap.mermaidPreview.errorDefault',
        detail: err.message || ''
      });

      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    }
  }, [cleanupMermaidDOM]);

  /* 监听 code 变化，防抖后渲染 */
  useEffect(() => {
    if (renderTimeoutRef.current) {
      clearTimeout(renderTimeoutRef.current);
    }

    /* 空代码：直接进入空状态，不触发渲染 */
    if (!code || code.trim() === '') {
      setIsEmpty(true);
      setLoading(false);
      setError(null);
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
      return;
    }

    setIsEmpty(false);
    setLoading(true);
    setError(null);

    renderTimeoutRef.current = setTimeout(() => {
      doRender(code, 0);
    }, RENDER_DEBOUNCE_MS);

    return () => {
      if (renderTimeoutRef.current) {
        clearTimeout(renderTimeoutRef.current);
      }
    };
  }, [code, doRender]);

  /* 组件卸载时清理遗留 DOM */
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
          <Spin size="large" tip={t('mindmap.mermaidPreview.rendering')} />
        </div>
      )}

      {/* 空状态 */}
      {isEmpty && !loading && (
        <div className="mermaid-preview-overlay">
          <Empty description={t('mindmap.mermaidPreview.emptyHint')} />
        </div>
      )}

      {/* 错误状态 */}
      {error && !loading && (
        <div className="mermaid-preview-overlay">
          <div className="mermaid-error">
            {/* Emoji 属视觉符号，保留在 JSX 不进语言包 */}
            <div className="mermaid-error-icon">⚠️</div>
            <div className="mermaid-error-title">
              {t('mindmap.mermaidPreview.errorTitle')}
            </div>
            {/* detail 为 mermaid 原始报错（技术信息不翻译），缺失时回退到通用文案 */}
            <div className="mermaid-error-msg">
              {error.detail || t(error.key)}
            </div>
            <div className="mermaid-error-hint">
              {t('mindmap.mermaidPreview.errorHint')}
            </div>
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
