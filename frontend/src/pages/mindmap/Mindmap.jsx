/**
 * 思维导图工具 - iOS 科技风优化版
 * 
 * v1.1 修复PDF导出和布局优化 - 2025-12-26
 * v1.2 修复SVG模式下d3-zoom报错 - 2025-12-26
 *   - SVG模式不使用d3-zoom，使用CSS transform缩放
 *   - 修复zoom-BEuyXPeo.js报错问题
 */
import React, { useState, useRef, useEffect } from 'react';
import { 
  Button, 
  Input, 
  Space, 
  message, 
  Tabs, 
  Tooltip,
  Typography
} from 'antd';
import { 
  SaveOutlined, 
  ZoomInOutlined, 
  ZoomOutOutlined,
  ReloadOutlined,
  ExpandOutlined,
  FileTextOutlined,
  FileImageOutlined,
  FilePdfOutlined
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

const Mindmap = () => {
  const [contentType, setContentType] = useState('markdown');
  const [content, setContent] = useState(MARKDOWN_TEMPLATE);
  const [title, setTitle] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [creditsConfig, setCreditsConfig] = useState(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  
  const svgRef = useRef(null);
  const markmapRef = useRef(null);
  const previewRef = useRef(null);
  const user = useAuthStore(state => state.user);

  // iOS 系统配色方案
  const iosColors = [
    '#007AFF', // SF Blue
    '#34C759', // SF Green
    '#FF9500', // SF Orange
    '#AF52DE', // SF Purple
    '#5856D6', // SF Indigo
    '#00C7BE'  // SF Teal
  ];

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

  // v1.2 切换tab时重置缩放级别
  const handleTabChange = (key) => {
    setContentType(key);
    // 根据不同类型设置初始缩放
    setZoomLevel(key === 'markdown' ? 1 : 0.8);
    
    if (key === 'markdown') {
      setContent(MARKDOWN_TEMPLATE);
    } else if (key === 'mermaid') {
      setContent(MERMAID_TEMPLATE);
    } else if (key === 'svg') {
      setContent(SVG_TEMPLATE);
    }
  };

  const renderMarkdownPreview = () => {
    if (!svgRef.current || !content) return;

    try {
      const transformer = new Transformer();
      const { root } = transformer.transform(content);
      svgRef.current.innerHTML = '';

      const options = {
        color: (node) => {
          return iosColors[node.depth % iosColors.length];
        },
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
        mm.fit();
        
        // 主动设置连线颜色
        const svg = svgRef.current;
        if (svg) {
          const nodeGroups = svg.querySelectorAll('g[data-depth]');
          const depthMap = new Map();
          
          nodeGroups.forEach(group => {
            const depth = parseInt(group.getAttribute('data-depth') || '0');
            const paths = group.querySelectorAll('path');
            paths.forEach(path => {
              depthMap.set(path, depth);
            });
          });

          const allPaths = svg.querySelectorAll('path');
          allPaths.forEach((path, index) => {
            if (path.getAttribute('fill') === 'none' || !path.getAttribute('fill')) {
              const depth = depthMap.get(path) || (index % iosColors.length);
              const lineColor = iosColors[depth % iosColors.length];
              
              path.style.stroke = lineColor;
              path.style.strokeWidth = '1.5px';
              path.style.opacity = '0.75';
              path.style.strokeLinecap = 'round';
              path.style.strokeLinejoin = 'round';
              path.style.fill = 'none';
              
              path.setAttribute('class', 'markmap-link');
            }
          });
        }
      }, 300);
    } catch (error) {
      console.error('Markmap 渲染失败:', error);
      message.error('思维导图渲染失败');
    }
  };

  useEffect(() => {
    if (contentType === 'markdown') {
      renderMarkdownPreview();
    }
  }, [content, contentType]);

  /**
   * v1.2 重构缩放逻辑
   * - Markdown模式：使用markmap的rescale方法
   * - Mermaid/SVG模式：使用CSS transform（不调用d3-zoom）
   */
  const handleZoom = (type) => {
    if (contentType === 'markdown') {
      // Markdown使用markmap内置缩放
      if (!markmapRef.current) return;
      try {
        if (type === 'in') markmapRef.current.rescale(1.25);
        else if (type === 'out') markmapRef.current.rescale(0.8);
        else if (type === 'fit') markmapRef.current.fit();
      } catch (error) {
        console.error('Markdown缩放失败:', error);
      }
    } else {
      // v1.2 Mermaid和SVG使用CSS transform缩放（避免d3-zoom错误）
      setZoomLevel(prev => {
        if (type === 'in') return Math.min(prev * 1.2, 3);
        if (type === 'out') return Math.max(prev / 1.2, 0.2);
        if (type === 'fit') return 0.8;
        return prev;
      });
    }
  };

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

  const handleSave = async () => {
    if (!title.trim()) return message.warning('请输入标题');
    if (!content.trim()) return message.warning('请输入内容');

    if (creditsConfig?.save_credits > 0) {
      if (!user || (user.credits_quota - user.used_credits) < creditsConfig.save_credits) {
        return message.error(`积分不足，需要 ${creditsConfig.save_credits} 积分`);
      }
    }

    setIsSaving(true);
    try {
      const response = await apiClient.post('/mindmap', {
        title: title.trim(),
        content: content.trim(),
        content_type: contentType
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

  const handleExport = async (format) => {
    if (!content.trim()) return message.warning('请先创建内容');

    const creditsMap = {
      svg: creditsConfig?.export_svg_credits || 0,
      png: creditsConfig?.export_png_credits || 0,
      pdf: creditsConfig?.export_pdf_credits || 0,
      markdown: creditsConfig?.export_markdown_credits || 0
    };

    const required = creditsMap[format];
    if (required > 0 && (!user || (user.credits_quota - user.used_credits) < required)) {
      return message.error(`积分不足，需要 ${required} 积分`);
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
      console.error('导出错误详情:', error);
      message.error(error.message || error.response?.data?.message || '导出失败');
    } finally {
      setIsExporting(false);
    }
  };

  const getSVGElement = () => {
    if (contentType === 'markdown') return svgRef.current;
    else if (contentType === 'mermaid') return previewRef.current?.querySelector('svg');
    else if (contentType === 'svg') {
      // v1.2 SVG模式：从content直接解析
      const div = document.createElement('div');
      div.innerHTML = content;
      return div.querySelector('svg');
    }
    return null;
  };

  const exportSVG = async () => {
    const svg = getSVGElement();
    if (!svg) throw new Error('未找到 SVG 元素');
    const data = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([data], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${title || 'mindmap'}.svg`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportPNG = async () => {
    const svg = getSVGElement();
    if (!svg) throw new Error('未找到 SVG 元素');
    
    const clonedSvg = svg.cloneNode(true);
    const bbox = svg.getBBox ? svg.getBBox() : { x: 0, y: 0, width: 800, height: 600 };
    const svgWidth = Math.max(bbox.width + bbox.x + 100, svg.clientWidth || 800);
    const svgHeight = Math.max(bbox.height + bbox.y + 100, svg.clientHeight || 600);
    
    clonedSvg.setAttribute('width', svgWidth);
    clonedSvg.setAttribute('height', svgHeight);
    if (!clonedSvg.getAttribute('viewBox')) {
      clonedSvg.setAttribute('viewBox', `${bbox.x - 50} ${bbox.y - 50} ${svgWidth} ${svgHeight}`);
    }
    
    const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bgRect.setAttribute('x', bbox.x - 50);
    bgRect.setAttribute('y', bbox.y - 50);
    bgRect.setAttribute('width', svgWidth);
    bgRect.setAttribute('height', svgHeight);
    bgRect.setAttribute('fill', 'white');
    clonedSvg.insertBefore(bgRect, clonedSvg.firstChild);
    
    const allElements = clonedSvg.querySelectorAll('*');
    allElements.forEach(el => {
      const computedStyle = window.getComputedStyle(el);
      const importantStyles = ['fill', 'stroke', 'stroke-width', 'font-family', 'font-size', 'font-weight', 'opacity'];
      importantStyles.forEach(prop => {
        const value = computedStyle.getPropertyValue(prop);
        if (value) el.style[prop] = value;
      });
    });
    
    const data = new XMLSerializer().serializeToString(clonedSvg);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    
    const scale = 2;
    canvas.width = svgWidth * scale;
    canvas.height = svgHeight * scale;

    return new Promise((resolve, reject) => {
      img.onload = () => {
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `${title || 'mindmap'}.png`;
          link.click();
          URL.revokeObjectURL(url);
          resolve();
        }, 'image/png');
      };
      img.onerror = (e) => {
        console.error('PNG图片加载失败:', e);
        reject(new Error('PNG导出失败'));
      };
      const svgBase64 = btoa(unescape(encodeURIComponent(data)));
      img.src = 'data:image/svg+xml;base64,' + svgBase64;
    });
  };

  const exportPDF = async () => {
    const svg = getSVGElement();
    if (!svg) throw new Error('未找到 SVG 元素');
    
    const { jsPDF } = await import('jspdf');
    
    const clonedSvg = svg.cloneNode(true);
    const bbox = svg.getBBox ? svg.getBBox() : { x: 0, y: 0, width: 800, height: 600 };
    const svgWidth = Math.max(bbox.width + bbox.x + 100, svg.clientWidth || 800);
    const svgHeight = Math.max(bbox.height + bbox.y + 100, svg.clientHeight || 600);
    
    clonedSvg.setAttribute('width', svgWidth);
    clonedSvg.setAttribute('height', svgHeight);
    if (!clonedSvg.getAttribute('viewBox')) {
      clonedSvg.setAttribute('viewBox', `${bbox.x - 50} ${bbox.y - 50} ${svgWidth} ${svgHeight}`);
    }
    
    const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bgRect.setAttribute('x', bbox.x - 50);
    bgRect.setAttribute('y', bbox.y - 50);
    bgRect.setAttribute('width', svgWidth);
    bgRect.setAttribute('height', svgHeight);
    bgRect.setAttribute('fill', 'white');
    clonedSvg.insertBefore(bgRect, clonedSvg.firstChild);
    
    const allElements = clonedSvg.querySelectorAll('*');
    allElements.forEach(el => {
      const computedStyle = window.getComputedStyle(el);
      const importantStyles = ['fill', 'stroke', 'stroke-width', 'font-family', 'font-size', 'font-weight', 'opacity', 'color'];
      importantStyles.forEach(prop => {
        const value = computedStyle.getPropertyValue(prop);
        if (value && value !== 'none' && value !== '') {
          el.style[prop] = value;
        }
      });
      
      if (el.tagName === 'text' || el.tagName === 'tspan') {
        if (!el.getAttribute('fill') && !el.style.fill) {
          el.setAttribute('fill', '#1C1C1E');
        }
      }
    });
    
    const data = new XMLSerializer().serializeToString(clonedSvg);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    
    const scale = 2;
    canvas.width = svgWidth * scale;
    canvas.height = svgHeight * scale;

    return new Promise((resolve, reject) => {
      img.onload = () => {
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        const imgData = canvas.toDataURL('image/png', 1.0);
        
        const isLandscape = svgWidth > svgHeight;
        const pdf = new jsPDF({
          orientation: isLandscape ? 'landscape' : 'portrait',
          unit: 'pt',
          format: 'a4'
        });
        
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        
        const margin = 40;
        const availableWidth = pageWidth - margin * 2;
        const availableHeight = pageHeight - margin * 2;
        
        const scaleX = availableWidth / svgWidth;
        const scaleY = availableHeight / svgHeight;
        const finalScale = Math.min(scaleX, scaleY, 1);
        
        const finalWidth = svgWidth * finalScale;
        const finalHeight = svgHeight * finalScale;
        
        const x = (pageWidth - finalWidth) / 2;
        const y = (pageHeight - finalHeight) / 2;
        
        pdf.addImage(imgData, 'PNG', x, y, finalWidth, finalHeight);
        pdf.save(`${title || 'mindmap'}.pdf`);
        resolve();
      };
      
      img.onerror = (e) => {
        console.error('PDF导出图片加载失败:', e);
        reject(new Error('PDF导出失败'));
      };
      
      const svgBase64 = btoa(unescape(encodeURIComponent(data)));
      img.src = 'data:image/svg+xml;base64,' + svgBase64;
    });
  };

  const exportMarkdown = async () => {
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${title || 'mindmap'}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  /**
   * v1.2 渲染预览内容
   * - Markdown：使用markmap渲染到svg
   * - Mermaid/SVG：使用CSS transform缩放，不使用d3-zoom
   */
  const renderPreviewContent = () => {
    if (contentType === 'markdown') {
      return (
        <div className="mindmap-svg" ref={previewRef}>
          <svg ref={svgRef}></svg>
        </div>
      );
    }

    // v1.2 Mermaid和SVG使用CSS transform缩放
    return (
      <div 
        style={{ 
          transform: `scale(${zoomLevel})`,
          transformOrigin: 'top left',
          transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          width: 'fit-content',
          minWidth: '100%'
        }} 
        ref={previewRef}
      >
        {contentType === 'mermaid' ? (
          <MermaidPreview code={content} />
        ) : (
          <SvgPreview code={content} />
        )}
      </div>
    );
  };

  const renderCreditsInfo = () => {
    if (!creditsConfig) return null;
    const current = user ? (user.credits_quota - user.used_credits) : 0;
    return (
      <Space direction="vertical" size={4} style={{ fontSize: '12px' }}>
        <Text type="secondary" style={{ color: '#8E8E93' }}>
          余额: {current}分 {creditsConfig.save_credits > 0 && `(保存: ${creditsConfig.save_credits}分)`}
        </Text>
        <Space size={8}>
          {creditsConfig.export_svg_credits > 0 && <Text type="secondary" style={{ color: '#8E8E93' }}>SVG: {creditsConfig.export_svg_credits}分</Text>}
          {creditsConfig.export_png_credits > 0 && <Text type="secondary" style={{ color: '#8E8E93' }}>PNG: {creditsConfig.export_png_credits}分</Text>}
          {creditsConfig.export_pdf_credits > 0 && <Text type="secondary" style={{ color: '#8E8E93' }}>PDF: {creditsConfig.export_pdf_credits}分</Text>}
          {creditsConfig.export_markdown_credits > 0 && <Text type="secondary" style={{ color: '#8E8E93' }}>MD: {creditsConfig.export_markdown_credits}分</Text>}
        </Space>
      </Space>
    );
  };

  return (
    <div className="mindmap-page-container">
      <div className="mindmap-page-header">
        <div className="page-header-left">
          <Input placeholder="输入标题" value={title} onChange={(e) => setTitle(e.target.value)} style={{ width: 300 }} />
        </div>
        <div className="page-header-actions">
          <Space size={16}>
            <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={isSaving}>保存</Button>
            <Button.Group>
              <Tooltip title={`SVG ${creditsConfig?.export_svg_credits > 0 ? `(${creditsConfig.export_svg_credits}分)` : ''}`}>
                <Button icon={<FileImageOutlined />} onClick={() => handleExport('svg')} loading={isExporting}>导出</Button>
              </Tooltip>
              <Tooltip title={`PNG ${creditsConfig?.export_png_credits > 0 ? `(${creditsConfig.export_png_credits}分)` : ''}`}>
                <Button icon={<FileImageOutlined />} onClick={() => handleExport('png')} loading={isExporting} />
              </Tooltip>
              <Tooltip title={`PDF ${creditsConfig?.export_pdf_credits > 0 ? `(${creditsConfig.export_pdf_credits}分)` : ''}`}>
                <Button icon={<FilePdfOutlined />} onClick={() => handleExport('pdf')} loading={isExporting} />
              </Tooltip>
              <Tooltip title={`Markdown ${creditsConfig?.export_markdown_credits > 0 ? `(${creditsConfig.export_markdown_credits}分)` : ''}`}>
                <Button icon={<FileTextOutlined />} onClick={() => handleExport('markdown')} loading={isExporting} />
              </Tooltip>
            </Button.Group>
            {renderCreditsInfo()}
          </Space>
        </div>
      </div>

      <div className="mindmap-tabs-container">
        <Tabs activeKey={contentType} onChange={handleTabChange} items={[
          { key: 'markdown', label: '思维导图 (Markdown)', icon: <FileTextOutlined /> },
          { key: 'mermaid', label: '流程图 (Mermaid)', icon: <FileImageOutlined /> },
          { key: 'svg', label: '矢量图 (SVG)', icon: <FileImageOutlined /> }
        ]} />
      </div>

      <div className="mindmap-main-layout">
        <div className="mindmap-editor-sider">
          <div className="editor-header">
            <Text strong>代码编辑器</Text>
          </div>
          <div className="editor-wrapper">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={`请输入 ${contentType === 'markdown' ? 'Markdown' : contentType === 'mermaid' ? 'Mermaid' : 'SVG'} 代码...`}
            />
          </div>
        </div>

        <div className="mindmap-preview-content">
          <div className="mindmap-toolbar">
            <Space size={8}>
              <Text strong>实时预览</Text>
              <div className="toolbar-divider" />
              <Tooltip title="放大"><button className="zoom-button" onClick={() => handleZoom('in')}><ZoomInOutlined /></button></Tooltip>
              <Tooltip title="缩小"><button className="zoom-button" onClick={() => handleZoom('out')}><ZoomOutOutlined /></button></Tooltip>
              <Tooltip title="自适应"><button className="zoom-button" onClick={() => handleZoom('fit')}><ReloadOutlined /></button></Tooltip>
              {contentType === 'markdown' && (
                <Tooltip title="展开所有"><button className="zoom-button" onClick={handleExpandAll}><ExpandOutlined /></button></Tooltip>
              )}
              {contentType !== 'markdown' && (
                <Text type="secondary" style={{ fontSize: '12px', marginLeft: '8px', color: '#8E8E93' }}>
                  {Math.round(zoomLevel * 100)}%
                </Text>
              )}
            </Space>
          </div>
          <div className="mindmap-canvas">
            {renderPreviewContent()}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Mindmap;
