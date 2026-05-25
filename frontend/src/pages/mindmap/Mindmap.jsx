/**
 * 思维导图工具 v4.3 - 导出裁切根治（SVG序列化 + foreignObject 内部样式全量内联）
 *
 * v4.3 修复（基于 dom-to-image 核心原理 + v4.1 诊断数据）：
 *   两条已被排除的死路：
 *     - html2canvas foreignObjectRendering:false → 自身引擎解析 SVG 内
 *       foreignObject，丢字（v4.0/v4.1）。
 *     - html2canvas foreignObjectRendering:true → 整图空白（v4.2，浏览器对
 *       SVG 内嵌 foreignObject 的原生截图路径在本环境崩溃）。
 *   诊断数据（v4.1-debug）已证明：导出边界、截图区域都正确，问题不在尺寸。
 *   真因（结合 dom-to-image-more 文档）：
 *     SVG 序列化导出（v3.x）裁切，并非边界算错，而是序列化出的 SVG 里
 *     foreignObject 内部 HTML 文字「缺少字体/CSS」。浏览器用 <img> 渲染该 SVG 时，
 *     foreignObject 内 HTML 以默认字体重排版，大字号中文变宽并溢出，于是被裁。
 *     v3.x 的 cloneAndPrepare 只内联了 SVG 原生元素样式，遗漏了 foreignObject
 *     内部 HTML 子节点（div/span）的 font-family/font-size 等关键样式。
 *   方案（与 dom-to-image-more 同源思路、零新依赖）：
 *     回归 SVG 序列化导出（浏览器原生 <img> 渲染 SVG+foreignObject 可靠）；
 *     对 foreignObject 内部「所有 HTML 后代」无差别内联完整 computed style
 *     （字体/字号/字重/颜色/行高/换行/对齐/盒模型），令序列化 SVG 自包含样式，
 *     <img> 渲染时文字宽度与页面完全一致，不再重排、不再溢出被裁。
 *   导出尺寸：用诊断已证明正确的「内容 <g> 真实包围盒」换算到 viewBox。
 *
 * v4.2 foreignObjectRendering:true（空白，失败）
 * v4.1 html2canvas + 负偏移截取（缺字，失败）
 * v4.0 改用 html2canvas 截 wrapper（缺字，失败）
 * v3.x SVG 序列化系列（字体未内联导致溢出裁切，失败）
 * v3.2 体验优化（#17 切 Tab 不重置 / 顶部精简 / 新建入口移至抽屉）
 * v3.1 修复导出黑底 + 顶部布局错乱
 * v3.0 项目式持久化基础架构
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Button, Input, Space, message, Tabs, Tooltip, Typography, Dropdown,
  Drawer, List, Empty, Modal, Popconfirm, Tag, Spin
} from 'antd';
import {
  SaveOutlined, ZoomInOutlined, ZoomOutOutlined,
  ReloadOutlined, ExpandOutlined, ExportOutlined,
  FileTextOutlined, FileImageOutlined, FilePdfOutlined,
  DownOutlined, FolderOpenOutlined, ShareAltOutlined,
  PlusOutlined, EditOutlined, DeleteOutlined,
  CopyOutlined, ClockCircleOutlined, WalletOutlined
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

const IOS_COLORS = [
  '#007AFF', '#34C759', '#FF9500', '#AF52DE', '#5856D6', '#00C7BE'
];

const waitForFrame = () => new Promise(resolve =>
  requestAnimationFrame(() => requestAnimationFrame(resolve))
);

const BG_RECT_MARK = 'data-mindmap-bg';

/* 需要内联到导出 SVG 的关键 CSS 属性（覆盖文字排版与盒模型，保证 <img> 渲染不重排） */
const INLINE_STYLE_PROPS = [
  'font-family', 'font-size', 'font-weight', 'font-style',
  'line-height', 'letter-spacing', 'white-space', 'word-break',
  'text-align', 'text-decoration', 'color', 'fill', 'stroke',
  'stroke-width', 'opacity', 'display', 'box-sizing', 'padding',
  'margin', 'border', 'background', 'background-color', 'border-radius',
  'vertical-align', 'width', 'height'
];

const isDefaultTemplate = (content) => {
  if (!content) return true;
  const trimmed = content.trim();
  return trimmed === MARKDOWN_TEMPLATE.trim()
      || trimmed === MERMAID_TEMPLATE.trim()
      || trimmed === SVG_TEMPLATE.trim();
};

const Mindmap = () => {
  const [contentType, setContentType] = useState('markdown');
  const [content, setContent] = useState(MARKDOWN_TEMPLATE);
  const [title, setTitle] = useState('');
  const [currentId, setCurrentId] = useState(null);
  const [shareToken, setShareToken] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [creditsConfig, setCreditsConfig] = useState(null);
  const [zoomLevel, setZoomLevel] = useState(1);

  const [listDrawerOpen, setListDrawerOpen] = useState(false);
  const [mindmapList, setMindmapList] = useState([]);
  const [listLoading, setListLoading] = useState(false);

  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  const svgRef = useRef(null);
  const markmapRef = useRef(null);
  const previewRef = useRef(null);
  const svgWrapperRef = useRef(null);
  const user = useAuthStore(state => state.user);

  useEffect(() => {
    loadCreditsConfig();
  }, []);

  const loadCreditsConfig = async () => {
    try {
      const response = await apiClient.get('/mindmap/credits-config');
      if (response.data.success) setCreditsConfig(response.data.data);
    } catch (error) {
      console.error('加载积分配置失败:', error);
    }
  };

  const handleTabChange = (key) => {
    setContentType(key);
    setZoomLevel(1);
    if (currentId !== null) return;
    if (isDefaultTemplate(content)) {
      if (key === 'markdown') setContent(MARKDOWN_TEMPLATE);
      else if (key === 'mermaid') setContent(MERMAID_TEMPLATE);
      else if (key === 'svg') setContent(SVG_TEMPLATE);
    }
  };

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
                path.style.strokeLinecap = 'round';
                path.style.strokeLinejoin = 'round';
                path.style.fill = 'none';
              }
            });
          }
        } catch (e) {
          console.warn('markmap fit失败:', e);
        }
      }, 300);
    } catch (error) {
      console.error('Markmap 渲染失败:', error);
      message.error('思维导图渲染失败');
    }
  }, [content, contentType]);

  useEffect(() => {
    if (contentType === 'markdown') renderMarkdownPreview();
  }, [renderMarkdownPreview]);

  const handleZoom = (type) => {
    if (contentType === 'markdown') {
      if (!markmapRef.current) return;
      try {
        if (type === 'in') markmapRef.current.rescale(1.25);
        else if (type === 'out') markmapRef.current.rescale(0.8);
        else if (type === 'fit') markmapRef.current.fit();
      } catch (e) {
        console.error('缩放失败:', e);
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
    } catch (e) {
      console.error('展开失败:', e);
    }
  };

  const openListDrawer = async () => {
    setListDrawerOpen(true);
    setListLoading(true);
    try {
      const response = await apiClient.get('/mindmap/');
      if (response.data.success) {
        setMindmapList(response.data.data || []);
      }
    } catch (error) {
      message.error('加载列表失败');
    } finally {
      setListLoading(false);
    }
  };

  const handleOpenMindmap = async (item) => {
    try {
      const response = await apiClient.get(`/mindmap/${item.id}`);
      if (response.data.success) {
        const data = response.data.data;
        setCurrentId(data.id);
        setTitle(data.title);
        setContent(data.content);
        setContentType(data.content_type || 'markdown');
        setShareToken(data.share_token);
        setListDrawerOpen(false);
        message.success(`已打开: ${data.title}`);
      }
    } catch (error) {
      message.error(error.response?.data?.message || '打开失败');
    }
  };

  const handleNew = () => {
    const hasUnsavedContent =
      currentId !== null ||
      title.trim() ||
      !isDefaultTemplate(content);

    const doReset = () => {
      setCurrentId(null);
      setShareToken(null);
      setTitle('');
      if (contentType === 'markdown') setContent(MARKDOWN_TEMPLATE);
      else if (contentType === 'mermaid') setContent(MERMAID_TEMPLATE);
      else setContent(SVG_TEMPLATE);
      setListDrawerOpen(false);
    };

    if (hasUnsavedContent) {
      Modal.confirm({
        title: '新建导图',
        content: '当前未保存的修改将丢失，确定要新建吗？',
        okText: '确定新建',
        cancelText: '取消',
        onOk: doReset
      });
    } else {
      doReset();
    }
  };

  const handleDelete = async (item) => {
    try {
      const response = await apiClient.delete(`/mindmap/${item.id}`);
      if (response.data.success) {
        message.success('删除成功');
        setMindmapList(prev => prev.filter(m => m.id !== item.id));
        if (currentId === item.id) {
          setCurrentId(null);
          setShareToken(null);
          setTitle('');
        }
      }
    } catch (error) {
      message.error('删除失败');
    }
  };

  const handleOpenRename = (item) => {
    setRenameTarget(item);
    setRenameValue(item.title);
    setRenameModalOpen(true);
  };

  const handleSubmitRename = async () => {
    if (!renameValue.trim()) return message.warning('标题不能为空');
    if (renameValue.length > 200) return message.warning('标题过长');

    try {
      const detailRes = await apiClient.get(`/mindmap/${renameTarget.id}`);
      if (!detailRes.data.success) throw new Error('加载失败');
      const detail = detailRes.data.data;

      const response = await apiClient.put(`/mindmap/${renameTarget.id}`, {
        title: renameValue.trim(),
        content: detail.content,
        content_type: detail.content_type || 'markdown'
      });

      if (response.data.success) {
        message.success('重命名成功');
        setMindmapList(prev => prev.map(m =>
          m.id === renameTarget.id ? { ...m, title: renameValue.trim() } : m
        ));
        if (currentId === renameTarget.id) {
          setTitle(renameValue.trim());
        }
        setRenameModalOpen(false);
        setRenameTarget(null);
        setRenameValue('');
      }
    } catch (error) {
      message.error(error.response?.data?.message || '重命名失败');
    }
  };

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
      let response;
      if (currentId === null) {
        response = await apiClient.post('/mindmap', {
          title: title.trim(),
          content: content.trim(),
          content_type: contentType
        });
      } else {
        response = await apiClient.put(`/mindmap/${currentId}`, {
          title: title.trim(),
          content: content.trim(),
          content_type: contentType
        });
      }

      if (response.data.success) {
        const data = response.data.data || {};
        if (data.id) setCurrentId(data.id);
        if (data.share_token) setShareToken(data.share_token);
        message.success(data.message || '保存成功');
        if (required > 0) await useAuthStore.getState().getCurrentUser();
      }
    } catch (error) {
      message.error(error.response?.data?.message || '保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAs = async () => {
    if (!title.trim()) return message.warning('请输入标题');
    if (!content.trim()) return message.warning('请输入内容');

    setIsSaving(true);
    try {
      const newTitle = currentId ? `${title.trim()} (副本)` : title.trim();
      const response = await apiClient.post('/mindmap', {
        title: newTitle,
        content: content.trim(),
        content_type: contentType
      });

      if (response.data.success) {
        const data = response.data.data || {};
        if (data.id) setCurrentId(data.id);
        if (data.share_token) setShareToken(data.share_token);
        setTitle(newTitle);
        message.success(data.message || '另存为成功');
      }
    } catch (error) {
      message.error(error.response?.data?.message || '另存为失败');
    } finally {
      setIsSaving(false);
    }
  };

  const buildShareUrl = useCallback(() => {
    if (!currentId || !shareToken) return '';
    return `${window.location.origin}/mindmap/share/${currentId}/${shareToken}`;
  }, [currentId, shareToken]);

  const handleOpenShareModal = () => {
    if (!currentId) {
      message.warning('请先保存导图后再分享');
      return;
    }
    setShareModalOpen(true);
  };

  const handleCopyShareLink = () => {
    const url = buildShareUrl();
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      message.success('分享链接已复制');
    }).catch(() => {
      message.error('复制失败');
    });
  };

  const handleOpenShareInNewTab = () => {
    const url = buildShareUrl();
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
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

  /**
   * v4.3 核心：计算 markmap 内容真实包围盒并换算到 SVG 用户坐标系
   *
   * 用内容总容器 <g> 的真实屏幕框（getBoundingClientRect，诊断已证明正确），
   * 结合 svg 自身屏幕框与 viewBox 的比例，换算回 SVG 用户坐标，得到导出 viewBox。
   *
   * @param {SVGSVGElement} svg
   * @returns {{x:number,y:number,width:number,height:number}}
   */
  const computeExportViewBox = (svg) => {
    /* 默认回退：svg 自身 viewBox 或 client 尺寸 */
    const fallback = () => {
      const vb = svg.getAttribute('viewBox');
      if (vb) {
        const p = vb.trim().split(/[\s,]+/).map(Number);
        if (p.length === 4 && p.every(isFinite) && p[2] > 0 && p[3] > 0) {
          return { x: p[0], y: p[1], width: p[2], height: p[3] };
        }
      }
      return { x: 0, y: 0, width: svg.clientWidth || 800, height: svg.clientHeight || 600 };
    };

    try {
      const svgRect = svg.getBoundingClientRect();
      const contentG = svg.querySelector('g');
      if (!contentG || !svgRect.width || !svgRect.height) return fallback();

      const gRect = contentG.getBoundingClientRect();
      if (!gRect.width || !gRect.height) return fallback();

      /* svg 用户坐标系（viewBox）到屏幕像素的比例 */
      const vb = svg.getAttribute('viewBox');
      let vbX = 0, vbY = 0, vbW = svgRect.width, vbH = svgRect.height;
      if (vb) {
        const p = vb.trim().split(/[\s,]+/).map(Number);
        if (p.length === 4 && p.every(isFinite) && p[2] > 0 && p[3] > 0) {
          [vbX, vbY, vbW, vbH] = p;
        }
      }
      const scaleX = vbW / svgRect.width;   /* 每屏幕像素对应多少用户单位 */
      const scaleY = vbH / svgRect.height;

      /* 内容 <g> 屏幕框 → 相对 svg 左上的偏移 → 换算回用户坐标 */
      const userX = vbX + (gRect.left - svgRect.left) * scaleX;
      const userY = vbY + (gRect.top - svgRect.top) * scaleY;
      const userW = gRect.width * scaleX;
      const userH = gRect.height * scaleY;

      /* 四周留白（用户坐标单位） */
      const PAD = 20 * Math.max(scaleX, scaleY);

      return {
        x: userX - PAD,
        y: userY - PAD,
        width: userW + PAD * 2,
        height: userH + PAD * 2
      };
    } catch (e) {
      return fallback();
    }
  };

  /**
   * v4.3 关键：对 foreignObject 内部「所有 HTML 后代」无差别内联完整 computed style
   *
   * 这是修复的核心——序列化后的 SVG 必须自包含 foreignObject 内 HTML 的字体/排版样式，
   * 否则 <img> 渲染时浏览器用默认字体重排，大字号中文变宽溢出被裁。
   * 不依赖具体 class，遍历每个 foreignObject 的所有后代逐一内联。
   *
   * @param {SVGElement} sourceSvg  页面原始 svg（读取 computed style 的来源）
   * @param {SVGElement} clonedSvg  克隆体（写入内联 style 的目标）
   */
  const inlineForeignObjectStyles = (sourceSvg, clonedSvg) => {
    const srcFOs = sourceSvg.querySelectorAll('foreignObject');
    const cloFOs = clonedSvg.querySelectorAll('foreignObject');

    srcFOs.forEach((srcFO, foIdx) => {
      const cloFO = cloFOs[foIdx];
      if (!cloFO) return;

      /* foreignObject 自身 + 其所有 HTML 后代 */
      const srcNodes = [srcFO, ...srcFO.querySelectorAll('*')];
      const cloNodes = [cloFO, ...cloFO.querySelectorAll('*')];

      srcNodes.forEach((srcNode, idx) => {
        const cloNode = cloNodes[idx];
        if (!cloNode || cloNode.nodeType !== 1) return;
        try {
          const cs = window.getComputedStyle(srcNode);
          INLINE_STYLE_PROPS.forEach(prop => {
            const val = cs.getPropertyValue(prop);
            if (val && val !== 'none' && val !== '') {
              cloNode.style.setProperty(prop, val);
            }
          });
        } catch (e) { /* 跳过不可读节点 */ }
      });
    });
  };

  /**
   * 克隆 SVG 并准备导出
   * v4.3：viewBox 用内容真实包围盒；内联 SVG 原生元素样式 + foreignObject 内部 HTML 样式。
   */
  const cloneAndPrepare = (svg) => {
    const cloned = svg.cloneNode(true);

    const bounds = computeExportViewBox(svg);
    const x = bounds.x;
    const y = bounds.y;
    const w = bounds.width;
    const h = bounds.height;

    cloned.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
    cloned.setAttribute('width', w);
    cloned.setAttribute('height', h);
    cloned.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    cloned.setAttribute('overflow', 'visible');
    cloned.style.overflow = 'visible';

    /* 1) 内联 SVG 原生元素样式（path/circle/text 等） */
    const sourceElements = svg.querySelectorAll('*');
    const targetElements = cloned.querySelectorAll('*');
    sourceElements.forEach((srcEl, idx) => {
      const tgtEl = targetElements[idx];
      if (!tgtEl) return;
      const tag = (srcEl.tagName || '').toLowerCase();
      if (tag === 'style' || tag === 'defs' || tag === 'metadata' || tag === 'title') return;
      /* foreignObject 内部交由 inlineForeignObjectStyles 专门处理，这里只处理 SVG 原生元素 */
      try {
        const cs = window.getComputedStyle(srcEl);
        ['fill', 'stroke', 'stroke-width', 'font-family', 'font-size',
         'font-weight', 'opacity', 'color'].forEach(prop => {
          const val = cs.getPropertyValue(prop);
          if (val && val !== 'none' && val !== '') {
            tgtEl.style[prop] = val;
          }
        });
        if ((tag === 'text' || tag === 'tspan')
            && !tgtEl.getAttribute('fill') && !tgtEl.style.fill) {
          tgtEl.setAttribute('fill', '#1C1C1E');
        }
      } catch (e) { /* 跳过 */ }
    });

    /* 2) 关键：内联 foreignObject 内部 HTML 的完整排版样式（防 img 渲染重排溢出） */
    inlineForeignObjectStyles(svg, cloned);

    /* 3) 白色背景，覆盖整个 viewBox */
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('x', x);
    bg.setAttribute('y', y);
    bg.setAttribute('width', w);
    bg.setAttribute('height', h);
    bg.setAttribute('fill', '#ffffff');
    bg.setAttribute(BG_RECT_MARK, 'true');
    cloned.insertBefore(bg, cloned.firstChild);

    return { cloned, width: w, height: h };
  };

  const svgToImage = (svgEl, width, height, scale = 2) => {
    return new Promise((resolve, reject) => {
      const data = new XMLSerializer().serializeToString(svgEl);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));

      const img = new Image();
      img.onload = () => {
        ctx.fillStyle = '#ffffff';
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
    await waitForFrame();
    const { cloned } = cloneAndPrepare(svg);
    const data = new XMLSerializer().serializeToString(cloned);
    const blob = new Blob([data], { type: 'image/svg+xml' });
    downloadBlob(blob, `${title || 'mindmap'}.svg`);
  };

  const exportPNG = async () => {
    const svg = getSVGElement();
    if (!svg) throw new Error('未找到 SVG 元素');
    await waitForFrame();
    const { cloned, width, height } = cloneAndPrepare(svg);
    const canvas = await svgToImage(cloned, width, height);
    await new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (!blob) return reject(new Error('PNG 生成失败'));
        downloadBlob(blob, `${title || 'mindmap'}.png`);
        resolve();
      }, 'image/png');
    });
  };

  const exportPDF = async () => {
    const svg = getSVGElement();
    if (!svg) throw new Error('未找到 SVG 元素');
    const { jsPDF } = await import('jspdf');
    await waitForFrame();
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

  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportMenuItems = [
    { key: 'svg', label: `SVG ${creditsConfig?.export_svg_credits > 0 ? `(${creditsConfig.export_svg_credits}分)` : ''}`, icon: <FileImageOutlined /> },
    { key: 'png', label: `PNG ${creditsConfig?.export_png_credits > 0 ? `(${creditsConfig.export_png_credits}分)` : ''}`, icon: <FileImageOutlined /> },
    { key: 'pdf', label: `PDF ${creditsConfig?.export_pdf_credits > 0 ? `(${creditsConfig.export_pdf_credits}分)` : ''}`, icon: <FilePdfOutlined /> },
    { key: 'markdown', label: `Markdown ${creditsConfig?.export_markdown_credits > 0 ? `(${creditsConfig.export_markdown_credits}分)` : ''}`, icon: <FileTextOutlined /> }
  ];

  const saveMenuItems = [
    {
      key: 'saveAs',
      label: '另存为新导图',
      icon: <CopyOutlined />,
      onClick: handleSaveAs
    }
  ];

  const renderPreviewContent = () => {
    if (contentType === 'markdown') {
      return (
        <div className="mindmap-svg-wrapper" ref={svgWrapperRef}>
          <svg ref={svgRef}></svg>
        </div>
      );
    }
    return (
      <div className="mindmap-transform-wrapper" ref={previewRef}>
        <div
          className="mindmap-transform-content"
          style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'center top' }}
        >
          {contentType === 'mermaid'
            ? <MermaidPreview code={content} />
            : <SvgPreview code={content} />}
        </div>
      </div>
    );
  };

  const currentCredits = user ? (user.credits_quota - user.used_credits) : 0;

  const formatTime = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now - d;
    const diffHours = diffMs / 1000 / 3600;
    if (diffHours < 1) return Math.max(1, Math.floor(diffMs / 60000)) + '分钟前';
    if (diffHours < 24) return Math.floor(diffHours) + '小时前';
    if (diffHours < 24 * 7) return Math.floor(diffHours / 24) + '天前';
    return d.toLocaleDateString();
  };

  const getTypeTag = (type) => {
    const map = {
      markdown: { color: 'blue', label: '思维导图' },
      mermaid: { color: 'green', label: '流程图' },
      svg: { color: 'purple', label: 'SVG' }
    };
    const info = map[type] || { color: 'default', label: type };
    return <Tag color={info.color} style={{ fontSize: 11, padding: '0 6px' }}>{info.label}</Tag>;
  };

  return (
    <div className="mindmap-page">
      <div className="mindmap-header">
        <div className="mindmap-header-left">
          <Button
            icon={<FolderOpenOutlined />}
            onClick={openListDrawer}
            className="mindmap-list-btn"
          >
            我的导图
          </Button>
          <Input
            placeholder="输入标题"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mindmap-title-input"
            maxLength={200}
          />
        </div>
        <div className="mindmap-header-right">
          <Dropdown.Button
            type="primary"
            icon={<DownOutlined />}
            onClick={handleSave}
            loading={isSaving}
            menu={{ items: saveMenuItems }}
            className="mindmap-save-dropdown"
          >
            <SaveOutlined /> 保存
          </Dropdown.Button>

          <Tooltip title={currentId ? '生成永久分享链接' : '请先保存后才能分享'}>
            <Button
              icon={<ShareAltOutlined />}
              onClick={handleOpenShareModal}
              disabled={!currentId}
            >
              分享
            </Button>
          </Tooltip>

          <Dropdown
            menu={{ items: exportMenuItems, onClick: ({ key }) => handleExport(key) }}
            trigger={['click']}
          >
            <Button icon={<ExportOutlined />} loading={isExporting}>
              导出 <DownOutlined />
            </Button>
          </Dropdown>

          {creditsConfig && (
            <Tooltip title={`当前积分余额: ${currentCredits} 分`}>
              <span className="mindmap-credits-icon">
                <WalletOutlined />
              </span>
            </Tooltip>
          )}
        </div>
      </div>

      <div className="mindmap-tabs">
        <Tabs activeKey={contentType} onChange={handleTabChange} items={[
          { key: 'markdown', label: '思维导图 (Markdown)', icon: <FileTextOutlined /> },
          { key: 'mermaid', label: '流程图 (Mermaid)', icon: <FileImageOutlined /> },
          { key: 'svg', label: '矢量图 (SVG)', icon: <FileImageOutlined /> }
        ]} />
      </div>

      <div className="mindmap-body">
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

        <div className="mindmap-preview">
          <div className="mindmap-preview-header">
            <Text strong>实时预览</Text>
            <div className="mindmap-preview-tools">
              <Tooltip title="放大">
                <button className="tool-btn" onClick={() => handleZoom('in')}><ZoomInOutlined /></button>
              </Tooltip>
              <Tooltip title="缩小">
                <button className="tool-btn" onClick={() => handleZoom('out')}><ZoomOutOutlined /></button>
              </Tooltip>
              <Tooltip title="自适应">
                <button className="tool-btn" onClick={() => handleZoom('fit')}><ReloadOutlined /></button>
              </Tooltip>
              {contentType === 'markdown' && (
                <Tooltip title="展开所有">
                  <button className="tool-btn" onClick={handleExpandAll}><ExpandOutlined /></button>
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

      <Drawer
        title="我的导图"
        placement="left"
        width={380}
        open={listDrawerOpen}
        onClose={() => setListDrawerOpen(false)}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={handleNew}>
            新建
          </Button>
        }
        className="mindmap-list-drawer"
      >
        {listLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : mindmapList.length === 0 ? (
          <Empty description="还没有保存的导图" />
        ) : (
          <List
            dataSource={mindmapList}
            renderItem={item => (
              <List.Item
                className={`mindmap-list-item ${currentId === item.id ? 'active' : ''}`}
                actions={[
                  <Tooltip title="重命名" key="rename">
                    <Button
                      type="text"
                      size="small"
                      icon={<EditOutlined />}
                      onClick={(e) => { e.stopPropagation(); handleOpenRename(item); }}
                    />
                  </Tooltip>,
                  <Popconfirm
                    key="delete"
                    title="确定删除这张导图？"
                    description="删除后不可恢复"
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                    onConfirm={(e) => { e?.stopPropagation?.(); handleDelete(item); }}
                  >
                    <Tooltip title="删除">
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </Tooltip>
                  </Popconfirm>
                ]}
                onClick={() => handleOpenMindmap(item)}
              >
                <List.Item.Meta
                  title={
                    <div className="mindmap-list-item-title">
                      {item.title}
                      {currentId === item.id && <Tag color="processing" style={{ marginLeft: 6, fontSize: 10 }}>当前</Tag>}
                    </div>
                  }
                  description={
                    <div className="mindmap-list-item-meta">
                      {getTypeTag(item.content_type)}
                      <span className="meta-time">
                        <ClockCircleOutlined /> {formatTime(item.updated_at)}
                      </span>
                    </div>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Drawer>

      <Modal
        title={<><ShareAltOutlined /> 分享链接</>}
        open={shareModalOpen}
        onCancel={() => setShareModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setShareModalOpen(false)}>关闭</Button>,
          <Button key="preview" onClick={handleOpenShareInNewTab}>
            在新窗口预览
          </Button>,
          <Button key="copy" type="primary" icon={<CopyOutlined />} onClick={handleCopyShareLink}>
            复制链接
          </Button>
        ]}
      >
        <div style={{ marginBottom: 12 }}>
          <Text>持此链接的任何人均可在线查看该导图（只读）：</Text>
        </div>
        <Input.TextArea
          value={buildShareUrl()}
          rows={3}
          readOnly
          onClick={(e) => e.target.select()}
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />
        <div style={{ marginTop: 12, fontSize: 12, color: '#8E8E93' }}>
          • 链接含安全签名，无法被遍历猜测<br />
          • 如需取消分享，请删除该导图<br />
          • 重命名/更新内容不会改变链接
        </div>
      </Modal>

      <Modal
        title="重命名导图"
        open={renameModalOpen}
        onOk={handleSubmitRename}
        onCancel={() => {
          setRenameModalOpen(false);
          setRenameTarget(null);
          setRenameValue('');
        }}
        okText="确定"
        cancelText="取消"
      >
        <Input
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          placeholder="请输入新标题"
          maxLength={200}
          showCount
          onPressEnter={handleSubmitRename}
        />
      </Modal>
    </div>
  );
};

export default Mindmap;
