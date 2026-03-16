/**
 * 思维导图工具 v2.0 - 全面优化版
 * 
 * 核心改进：
 * 1. 渲染稳定性 - MermaidPreview/SvgPreview组件独立处理渲染+重试
 * 2. 预览区适配 - Mermaid/SVG缩放改为居中模式，Markdown使用markmap内置缩放
 * 3. 视觉升级 - 头部工具栏简化，导出按钮带文字，积分信息精简
 * 4. 导出优化 - PNG/PDF导出时内联计算样式确保文字不丢失
 * 
 * 历史版本：
 * v1.0 初版三模式支持
 * v1.1 修复PDF导出+布局30%/70%
 * v1.2 修复SVG模式d3-zoom报错
 * v2.0 渲染稳定性+预览适配+视觉全面升级
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Button, Input, Space, message, Tabs, Tooltip, Typography, Dropdown
} from 'antd';
import {
  SaveOutlined, ZoomInOutlined, ZoomOutOutlined,
  ReloadOutlined, ExpandOutlined, ExportOutlined,
  FileTextOutlined, FileImageOutlined, FilePdfOutlined,
  DownOutlined
} from '@ant-design/icons';
import { Transformer } from 'markmap-lib';
import { Markmap } from 'markmap-view';
import './Mindmap.less';
import MermaidPreview from './components/MermaidPreview';
import SvgPreview from './components/SvgPreview';
import { MARKDOWN_TEMPLATE, MERMAID_TEMPLATE, SVG_TEMPLATE } from './constants/templates';
import apiClient from '../../utils/api';
import useAuthStore from '../../stores/authStore';

const { Text } = Typography;

/* iOS系统配色方案 */
const IOS_COLORS = [
  '#007AFF', '#34C759', '#FF9500', '#AF52DE', '#5856D6', '#00C7BE'
];

const Mindmap = () => {
  /* ========== 状态 ========== */
  const [contentType, setContentType] = useState('markdown');
  const [content, setContent] = useState(MARKDOWN_TEMPLATE);
  const [title, setTitle] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [creditsConfig, setCreditsConfig] = useState(null);
  const [zoomLevel, setZoomLevel] = useState(1);

  /* refs */
  const svgRef = useRef(null);
  const markmapRef = useRef(null);
  const previewRef = useRef(null);
  const user = useAuthStore(state => state.user);

  /* ========== 初始化 ========== */
  useEffect(() => {
    loadCreditsConfig();
  }, []);

  const loadCreditsConfig = async () => {
    try {
      const response = await apiClient.get('/mindmap/credits-config');
      if (response.data.success) {
        setCreditsConfig(response.data.data);
      }
    } catch (error) {
      console.error('加载积分配置失败:', error);
    }
  };

  /* ========== Tab切换 ========== */
  const handleTabChange = (key) => {
    setContentType(key);
    setZoomLevel(1);
    if (key === 'markdown') setContent(MARKDOWN_TEMPLATE);
    else if (key === 'mermaid') setContent(MERMAID_TEMPLATE);
    else if (key === 'svg') setContent(SVG_TEMPLATE);
  };

  /* ========== Markdown渲染 ========== */
  const renderMarkdownPreview = useCallback(() => {
    if (!svgRef.current || !content || contentType !== 'markdown') return;

    try {
      const transformer = new Transformer();
      const { root } = transformer.transform(content);
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

      /* 延迟fit + 设置连线颜色 */
      setTimeout(() => {
        try {
          mm.fit();
          /* 美化连线颜色 */
          const svg = svgRef.current;
          if (svg) {
            const allPaths = svg.querySelectorAll('path');
            allPaths.forEach((path, index) => {
              if (path.getAttribute('fill') === 'none' || !path.getAttribute('fill')) {
                const lineColor = IOS_COLORS[index % IOS_COLORS.length];
                path.style.stroke = lineColor;
                path.style.strokeWidth = '1.5px';
                path.style.opacity = '0.75';
                path.style.strokeLinecap = 'round';
                path.style.strokeLinejoin = 'round';
                path.style.fill = 'none';
              }
            });
          }
        } catch (e) {
          console.warn('markmap fit/样式设置失败:', e);
        }
      }, 300);
    } catch (error) {
      console.error('Markmap 渲染失败:', error);
      message.error('思维导图渲染失败');
    }
  }, [content, contentType]);

  useEffect(() => {
    if (contentType === 'markdown') {
      renderMarkdownPreview();
    }
  }, [renderMarkdownPreview]);

  /* ========== 缩放控制 ========== */
  const handleZoom = (type) => {
    if (contentType === 'markdown') {
      /* Markdown使用markmap内置缩放 */
      if (!markmapRef.current) return;
      try {
        if (type === 'in') markmapRef.current.rescale(1.25);
        else if (type === 'out') markmapRef.current.rescale(0.8);
        else if (type === 'fit') markmapRef.current.fit();
      } catch (error) {
        console.error('Markdown缩放失败:', error);
      }
    } else {
      /* Mermaid/SVG使用CSS transform缩放 */
      setZoomLevel(prev => {
        if (type === 'in') return Math.min(prev * 1.2, 3);
        if (type === 'out') return Math.max(prev / 1.2, 0.2);
        if (type === 'fit') return 1;
        return prev;
      });
    }
  };

  /* 展开所有节点（仅Markdown模式） */
  const handleExpandAll = () => {
    if (contentType !== 'markdown' || !markmapRef.current) return;
    try {
      const mm = markmapRef.current;
      const expandNode = (node) => {
        if (node.payload) node.payload.fold = 0;
        if (node.children) node.children.forEach(child => expandNode(child));
      };
      if (mm.state?.data) {
        expandNode(mm.state.data);
        mm.setData(mm.state.data);
        mm.fit();
      }
    } catch (error) {
      console.error('展开失败:', error);
    }
  };

  /* ========== 保存 ========== */
  const handleSave = async () => {
    if (!title.trim()) return message.warning('请输入标题');
    if (!content.trim()) return message.warning('请输入内容');

    const required = creditsConfig?.save_credits || 0;
    if (required > 0) {
      const current = user ? (user.credits_quota - user.used_credits) : 0;
      if (current < required) return message.error(`积分不足，需要 ${required} 积分`);
    }

    setIsSaving(true);
    try {
      const response = await apiClient.post('/mindmap', {
        title: title.trim(), content: content.trim(), content_type: contentType
      });
      if (response.data.success) {
        message.success(response.data.message || '保存成功');
        await useAuthStore.getState().getCurrentUser();
      }
    } catch (error) {
      message.error(error.response?.data?.message || '保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  /* ========== 导出 ========== */
  const handleExport = async (format) => {
    if (!content.trim()) return message.warning('请先创建内容');

    const creditsMap = {
      svg: creditsConfig?.export_svg_credits || 0,
      png: creditsConfig?.export_png_credits || 0,
      pdf: creditsConfig?.export_pdf_credits || 0,
      markdown: creditsConfig?.export_markdown_credits || 0
    };

    const required = creditsMap[format];
    if (required > 0) {
      const current = user ? (user.credits_quota - user.used_credits) : 0;
      if (current < required) return message.error(`积分不足，需要 ${required} 积分`);
    }

    setIsExporting(true);
    try {
      if (format === 'svg') await exportSVG();
      else if (format === 'png') await exportPNG();
      else if (format === 'pdf') await exportPDF();
      else if (format === 'markdown') await exportMarkdown();

      await apiClient.post('/mindmap/export-log', { type: format });
      await useAuthStore.getState().getCurrentUser();
      message.success('导出成功');
    } catch (error) {
      console.error('导出错误:', error);
      message.error(error.message || '导出失败');
    } finally {
      setIsExporting(false);
    }
  };

  /* 获取当前SVG元素 */
  const getSVGElement = () => {
    if (contentType === 'markdown') return svgRef.current;
    if (contentType === 'mermaid') return previewRef.current?.querySelector('svg');
    if (contentType === 'svg') {
      const div = document.createElement('div');
      div.innerHTML = content;
      return div.querySelector('svg');
    }
    return null;
  };

  /* 克隆SVG并内联样式（导出用） */
  const cloneAndPrepare = (svg) => {
    const cloned = svg.cloneNode(true);
    const bbox = svg.getBBox ? svg.getBBox() : { x: 0, y: 0, width: 800, height: 600 };
    const w = Math.max(bbox.width + bbox.x + 100, svg.clientWidth || 800);
    const h = Math.max(bbox.height + bbox.y + 100, svg.clientHeight || 600);

    cloned.setAttribute('width', w);
    cloned.setAttribute('height', h);
    if (!cloned.getAttribute('viewBox')) {
      cloned.setAttribute('viewBox', `${bbox.x - 50} ${bbox.y - 50} ${w} ${h}`);
    }

    /* 白色背景 */
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('x', bbox.x - 50);
    bg.setAttribute('y', bbox.y - 50);
    bg.setAttribute('width', w);
    bg.setAttribute('height', h);
    bg.setAttribute('fill', 'white');
    cloned.insertBefore(bg, cloned.firstChild);

    /* 内联计算样式（确保文字等不丢失） */
    cloned.querySelectorAll('*').forEach(el => {
      try {
        const cs = window.getComputedStyle(el);
        ['fill', 'stroke', 'stroke-width', 'font-family', 'font-size', 'font-weight', 'opacity', 'color'].forEach(prop => {
          const val = cs.getPropertyValue(prop);
          if (val && val !== 'none' && val !== '') el.style[prop] = val;
        });
        /* 确保text元素有fill颜色 */
        if ((el.tagName === 'text' || el.tagName === 'tspan') && !el.getAttribute('fill') && !el.style.fill) {
          el.setAttribute('fill', '#1C1C1E');
        }
      } catch (e) { /* 跳过 */ }
    });

    return { cloned, width: w, height: h };
  };

  /* SVG转base64 Image的Promise */
  const svgToImage = (svgEl, width, height, scale = 2) => {
    return new Promise((resolve, reject) => {
      const data = new XMLSerializer().serializeToString(svgEl);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = width * scale;
      canvas.height = height * scale;

      const img = new Image();
      img.onload = () => {
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas);
      };
      img.onerror = () => reject(new Error('图片渲染失败'));
      const svgBase64 = btoa(unescape(encodeURIComponent(data)));
      img.src = 'data:image/svg+xml;base64,' + svgBase64;
    });
  };

  const exportSVG = async () => {
    const svg = getSVGElement();
    if (!svg) throw new Error('未找到 SVG 元素');
    const data = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([data], { type: 'image/svg+xml' });
    downloadBlob(blob, `${title || 'mindmap'}.svg`);
  };

  const exportPNG = async () => {
    const svg = getSVGElement();
    if (!svg) throw new Error('未找到 SVG 元素');
    const { cloned, width, height } = cloneAndPrepare(svg);
    const canvas = await svgToImage(cloned, width, height);
    canvas.toBlob(blob => downloadBlob(blob, `${title || 'mindmap'}.png`), 'image/png');
  };

  const exportPDF = async () => {
    const svg = getSVGElement();
    if (!svg) throw new Error('未找到 SVG 元素');
    const { jsPDF } = await import('jspdf');
    const { cloned, width, height } = cloneAndPrepare(svg);
    const canvas = await svgToImage(cloned, width, height);

    const imgData = canvas.toDataURL('image/png', 1.0);
    const isLandscape = width > height;
    const pdf = new jsPDF({
      orientation: isLandscape ? 'landscape' : 'portrait',
      unit: 'pt', format: 'a4'
    });

    const pw = pdf.internal.pageSize.getWidth();
    const ph = pdf.internal.pageSize.getHeight();
    const margin = 40;
    const scale = Math.min((pw - margin * 2) / width, (ph - margin * 2) / height, 1);
    const fw = width * scale;
    const fh = height * scale;

    pdf.addImage(imgData, 'PNG', (pw - fw) / 2, (ph - fh) / 2, fw, fh);
    pdf.save(`${title || 'mindmap'}.pdf`);
  };

  const exportMarkdown = async () => {
    const blob = new Blob([content], { type: 'text/markdown' });
    downloadBlob(blob, `${title || 'mindmap'}.md`);
  };

  /* 通用下载辅助 */
  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  /* ========== 导出下拉菜单 ========== */
  const exportMenuItems = [
    { key: 'svg', label: `SVG ${creditsConfig?.export_svg_credits > 0 ? `(${creditsConfig.export_svg_credits}分)` : ''}`, icon: <FileImageOutlined /> },
    { key: 'png', label: `PNG ${creditsConfig?.export_png_credits > 0 ? `(${creditsConfig.export_png_credits}分)` : ''}`, icon: <FileImageOutlined /> },
    { key: 'pdf', label: `PDF ${creditsConfig?.export_pdf_credits > 0 ? `(${creditsConfig.export_pdf_credits}分)` : ''}`, icon: <FilePdfOutlined /> },
    { key: 'markdown', label: `Markdown ${creditsConfig?.export_markdown_credits > 0 ? `(${creditsConfig.export_markdown_credits}分)` : ''}`, icon: <FileTextOutlined /> }
  ];

  /* ========== 预览渲染 ========== */
  const renderPreviewContent = () => {
    if (contentType === 'markdown') {
      return (
        <div className="mindmap-svg-wrapper" ref={previewRef}>
          <svg ref={svgRef}></svg>
        </div>
      );
    }

    /* Mermaid/SVG：使用CSS transform居中缩放 */
    return (
      <div className="mindmap-transform-wrapper" ref={previewRef}>
        <div
          className="mindmap-transform-content"
          style={{
            transform: `scale(${zoomLevel})`,
            transformOrigin: 'center top'
          }}
        >
          {contentType === 'mermaid' ? (
            <MermaidPreview code={content} />
          ) : (
            <SvgPreview code={content} />
          )}
        </div>
      </div>
    );
  };

  /* ========== 积分信息 ========== */
  const currentCredits = user ? (user.credits_quota - user.used_credits) : 0;

  /* ========== 页面渲染 ========== */
  return (
    <div className="mindmap-page">
      {/* 顶部工具栏 */}
      <div className="mindmap-header">
        <div className="mindmap-header-left">
          <Input
            placeholder="输入标题"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mindmap-title-input"
          />
        </div>
        <div className="mindmap-header-right">
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={handleSave}
            loading={isSaving}
            className="mindmap-save-btn"
          >
            保存
          </Button>
          <Dropdown
            menu={{ items: exportMenuItems, onClick: ({ key }) => handleExport(key) }}
            trigger={['click']}
          >
            <Button icon={<ExportOutlined />} loading={isExporting}>
              导出 <DownOutlined />
            </Button>
          </Dropdown>
          {creditsConfig && (
            <Text type="secondary" className="mindmap-credits-info">
              余额: {currentCredits}分
              {creditsConfig.save_credits > 0 && ` (保存: ${creditsConfig.save_credits}分)`}
            </Text>
          )}
        </div>
      </div>

      {/* Tab切换 */}
      <div className="mindmap-tabs">
        <Tabs activeKey={contentType} onChange={handleTabChange} items={[
          { key: 'markdown', label: '思维导图 (Markdown)', icon: <FileTextOutlined /> },
          { key: 'mermaid', label: '流程图 (Mermaid)', icon: <FileImageOutlined /> },
          { key: 'svg', label: '矢量图 (SVG)', icon: <FileImageOutlined /> }
        ]} />
      </div>

      {/* 主体 */}
      <div className="mindmap-body">
        {/* 左侧编辑器 */}
        <div className="mindmap-editor">
          <div className="mindmap-editor-header">
            <Text strong>代码编辑器</Text>
          </div>
          <div className="mindmap-editor-content">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              spellCheck={false}
              placeholder={`请输入 ${contentType === 'markdown' ? 'Markdown' : contentType === 'mermaid' ? 'Mermaid' : 'SVG'} 代码...`}
            />
          </div>
        </div>

        {/* 右侧预览 */}
        <div className="mindmap-preview">
          <div className="mindmap-preview-header">
            <Text strong>实时预览</Text>
            <div className="mindmap-preview-tools">
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
              {contentType === 'markdown' && (
                <Tooltip title="展开所有">
                  <button className="tool-btn" onClick={handleExpandAll}>
                    <ExpandOutlined />
                  </button>
                </Tooltip>
              )}
              {contentType !== 'markdown' && (
                <span className="zoom-percent">{Math.round(zoomLevel * 100)}%</span>
              )}
            </div>
          </div>
          <div className="mindmap-preview-canvas">
            {renderPreviewContent()}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Mindmap;
