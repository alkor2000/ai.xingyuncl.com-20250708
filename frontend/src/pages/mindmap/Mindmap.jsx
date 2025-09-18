/**
 * 思维导图编辑器页面 - 集成积分系统版本
 * 在BasicLayout内容区域正确显示
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Layout, 
  Button, 
  Space, 
  message, 
  Dropdown, 
  Modal,
  Input,
  Tooltip,
  Typography,
  Spin,
  Card,
  Badge
} from 'antd';
import {
  SaveOutlined,
  DownloadOutlined,
  ClearOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
  CopyOutlined,
  FileImageOutlined,
  FileOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  ReloadOutlined,
  FolderOpenOutlined,
  QuestionCircleOutlined,
  ExpandOutlined,
  CompressOutlined,
  DollarOutlined
} from '@ant-design/icons';
import Editor from '@monaco-editor/react';
import { Markmap } from 'markmap-view';
import { Transformer } from 'markmap-lib';
import apiClient from '../../utils/api';
import useAuthStore from '../../stores/authStore';
import './Mindmap.less';

const { Header, Sider, Content } = Layout;
const { Title, Text } = Typography;

// 默认的示例Markdown
const DEFAULT_MARKDOWN = `# 项目规划

## 第一阶段
### 需求分析
- 用户调研
- 竞品分析
- 功能清单

### 技术选型
- 前端框架
  - React 18
  - Ant Design 5
- 后端技术
  - Node.js
  - Express
  - MySQL

## 第二阶段
### 系统设计
#### 架构设计
- 微服务架构
- 容器化部署
- 负载均衡

#### 数据库设计
- 表结构设计
- 索引优化
- 分库分表策略

### UI/UX设计
- 设计规范
- 原型设计
- 交互优化

## 第三阶段
### 开发实施
- 敏捷开发
- 代码审查
- 单元测试

### 部署上线
- CI/CD流程
- 灰度发布
- 监控告警`;

const MindmapPage = () => {
  const [markdown, setMarkdown] = useState(DEFAULT_MARKDOWN);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [savedMaps, setSavedMaps] = useState([]);
  const [editorLoading, setEditorLoading] = useState(true);
  const [svgLoading, setSvgLoading] = useState(true);
  const [editorHeight, setEditorHeight] = useState('600px');
  const [creditsConfig, setCreditsConfig] = useState(null);
  const [userCredits, setUserCredits] = useState(0);
  
  const svgRef = useRef(null);
  const markmapRef = useRef(null);
  const transformerRef = useRef(null);
  const containerRef = useRef(null);
  const svgContainerRef = useRef(null);
  const editorWrapperRef = useRef(null);
  
  const { user } = useAuthStore();

  // 初始化
  useEffect(() => {
    transformerRef.current = new Transformer();
    
    // 加载本地保存的脑图
    const saved = localStorage.getItem('mindmap_saved');
    if (saved) {
      try {
        setSavedMaps(JSON.parse(saved));
      } catch (e) {
        console.error('加载保存的脑图失败:', e);
      }
    }

    // 获取积分配置
    fetchCreditsConfig();
    
    // 获取用户积分余额
    if (user) {
      setUserCredits(user.credits_stats?.remaining || 0);
    }

    const calculateHeight = () => {
      const windowHeight = window.innerHeight;
      const calculatedHeight = windowHeight - 220;
      setEditorHeight(`${Math.max(400, calculatedHeight)}px`);
    };

    calculateHeight();
    window.addEventListener('resize', calculateHeight);

    const initTimer = setTimeout(() => {
      setSvgLoading(false);
      renderMindmap();
    }, 500);

    return () => {
      clearTimeout(initTimer);
      window.removeEventListener('resize', calculateHeight);
    };
  }, [user]);

  // 获取积分配置
  const fetchCreditsConfig = async () => {
    try {
      const response = await apiClient.get('/mindmap/credits-config');
      if (response.data.success) {
        setCreditsConfig(response.data.data);
      }
    } catch (error) {
      console.error('获取积分配置失败:', error);
    }
  };

  // 获取用户最新积分
  const fetchUserCredits = async () => {
    try {
      const response = await apiClient.get(`/admin/users/${user.id}/credits`);
      if (response.data.success) {
        const creditsData = response.data.data;
        setUserCredits(creditsData.remaining || 0);
      }
    } catch (error) {
      console.error('获取用户积分失败:', error);
    }
  };

  // 检查积分是否充足
  const checkCredits = async (operation) => {
    try {
      const response = await apiClient.get('/mindmap/check-credits', {
        params: { operation }
      });
      if (response.data.success) {
        return response.data.data;
      }
    } catch (error) {
      console.error('检查积分失败:', error);
      return { sufficient: false, message: '检查积分失败' };
    }
  };

  // 渲染思维导图
  const renderMindmap = useCallback(() => {
    if (!svgRef.current || !transformerRef.current) {
      console.log('SVG ref or transformer not ready');
      return;
    }

    const container = svgContainerRef.current;
    if (!container) {
      console.log('Container not found');
      return;
    }

    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      console.log('Container has no size, retrying...');
      setTimeout(() => renderMindmap(), 200);
      return;
    }

    try {
      const { root } = transformerRef.current.transform(markdown);
      
      if (markmapRef.current) {
        markmapRef.current.destroy();
      }

      svgRef.current.innerHTML = '';
      
      svgRef.current.setAttribute('width', rect.width - 40);
      svgRef.current.setAttribute('height', rect.height - 40);
      
      const options = {
        duration: 300,
        nodeFont: '300 16px -apple-system, BlinkMacSystemFont, sans-serif',
        lineHeight: 1.5,
        paddingX: 8,
        autoFit: true,
        color: (node) => {
          const colors = ['#007AFF', '#5856D6', '#FF3B30', '#FF9500', '#34C759', '#00C7BE'];
          const depth = node.state?.depth || 0;
          return colors[depth % colors.length];
        },
        nodeMinHeight: 24,
        spacingVertical: 10,
        spacingHorizontal: 80
      };

      markmapRef.current = Markmap.create(svgRef.current, options, root);

      setTimeout(() => {
        if (markmapRef.current) {
          markmapRef.current.fit();
        }
      }, 100);
      
    } catch (error) {
      console.error('渲染思维导图失败:', error);
      message.error('渲染失败，请检查Markdown格式');
    }
  }, [markdown]);

  // 监听markdown变化
  useEffect(() => {
    if (svgLoading) return;
    
    const timer = setTimeout(() => {
      renderMindmap();
    }, 500);
    
    return () => clearTimeout(timer);
  }, [markdown, renderMindmap, svgLoading]);

  // 监听窗口大小变化
  useEffect(() => {
    const handleResize = () => {
      if (markmapRef.current) {
        renderMindmap();
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [renderMindmap]);

  // 编辑器挂载完成
  const handleEditorDidMount = (editor, monaco) => {
    setEditorLoading(false);
    
    editor.updateOptions({
      fontSize: 14,
      fontFamily: 'SF Mono, Monaco, Consolas, monospace',
      lineHeight: 22,
      renderWhitespace: 'none'
    });

    editor.focus();
    
    setTimeout(() => {
      editor.layout();
    }, 100);
  };

  // 保存到服务器（扣减积分）
  const handleSave = async () => {
    const title = prompt('请输入脑图名称：', `脑图_${new Date().toLocaleDateString()}`);
    if (!title) return;

    // 检查积分
    const credits = await checkCredits('save');
    if (!credits.sufficient) {
      Modal.error({
        title: '积分不足',
        content: `保存思维导图需要${credits.requiredCredits}积分，当前余额${credits.currentCredits}积分`
      });
      return;
    }

    // 如果需要积分，显示确认对话框
    if (credits.requiredCredits > 0) {
      Modal.confirm({
        title: '确认保存',
        content: `保存思维导图将消耗${credits.requiredCredits}积分，当前余额${credits.currentCredits}积分`,
        okText: '确认',
        cancelText: '取消',
        onOk: async () => {
          await saveToServer(title);
        }
      });
    } else {
      await saveToServer(title);
    }
  };

  // 实际保存到服务器
  const saveToServer = async (title) => {
    try {
      const response = await apiClient.post('/mindmap', {
        title,
        content: markdown
      });
      
      if (response.data.success) {
        message.success(response.data.data.message || '保存成功');
        
        // 同时保存到本地
        const newMap = {
          id: response.data.data.id || Date.now(),
          title,
          content: markdown,
          createdAt: new Date().toISOString()
        };
        
        const updated = [...savedMaps, newMap];
        setSavedMaps(updated);
        localStorage.setItem('mindmap_saved', JSON.stringify(updated));
        
        // 刷新用户积分
        fetchUserCredits();
      }
    } catch (error) {
      console.error('保存失败:', error);
      message.error(error.response?.data?.message || '保存失败');
    }
  };

  // 加载已保存的脑图
  const handleLoad = (map) => {
    setMarkdown(map.content);
    message.success(`已加载: ${map.title}`);
  };

  // 删除保存的脑图
  const handleDelete = (id) => {
    const updated = savedMaps.filter(m => m.id !== id);
    setSavedMaps(updated);
    localStorage.setItem('mindmap_saved', JSON.stringify(updated));
    message.success('删除成功');
  };

  // 导出SVG（扣减积分）
  const exportSVG = async () => {
    if (!svgRef.current) return;
    
    // 检查积分
    const credits = await checkCredits('export_svg');
    if (!credits.sufficient) {
      Modal.error({
        title: '积分不足',
        content: `导出SVG需要${credits.requiredCredits}积分，当前余额${credits.currentCredits}积分`
      });
      return;
    }

    // 如果需要积分，显示确认对话框
    if (credits.requiredCredits > 0) {
      Modal.confirm({
        title: '确认导出',
        content: `导出SVG将消耗${credits.requiredCredits}积分，当前余额${credits.currentCredits}积分`,
        okText: '确认',
        cancelText: '取消',
        onOk: async () => {
          await doExportSVG();
        }
      });
    } else {
      await doExportSVG();
    }
  };

  // 实际执行SVG导出
  const doExportSVG = async () => {
    try {
      // 记录导出操作
      const response = await apiClient.post('/mindmap/export-log', {
        type: 'svg'
      });
      
      if (response.data.success) {
        // 执行导出
        const svgClone = svgRef.current.cloneNode(true);
        const styleElement = document.createElement('style');
        styleElement.textContent = `
          .markmap-node rect { fill: #fff; stroke-width: 2px; rx: 6px; }
          .markmap-node text { font-family: sans-serif; }
          .markmap-link { fill: none; stroke-width: 2px; opacity: 0.6; }
        `;
        svgClone.insertBefore(styleElement, svgClone.firstChild);
        
        const svgData = new XMLSerializer().serializeToString(svgClone);
        const blob = new Blob([svgData], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `mindmap_${Date.now()}.svg`;
        a.click();
        URL.revokeObjectURL(url);
        
        message.success(response.data.data.message || 'SVG导出成功');
        
        // 刷新用户积分
        fetchUserCredits();
      }
    } catch (error) {
      console.error('导出失败:', error);
      message.error(error.response?.data?.message || '导出失败');
    }
  };

  // 导出Markdown（扣减积分）
  const exportMarkdown = async () => {
    // 检查积分
    const credits = await checkCredits('export_markdown');
    if (!credits.sufficient) {
      Modal.error({
        title: '积分不足',
        content: `导出Markdown需要${credits.requiredCredits}积分，当前余额${credits.currentCredits}积分`
      });
      return;
    }

    // 如果需要积分，显示确认对话框
    if (credits.requiredCredits > 0) {
      Modal.confirm({
        title: '确认导出',
        content: `导出Markdown将消耗${credits.requiredCredits}积分，当前余额${credits.currentCredits}积分`,
        okText: '确认',
        cancelText: '取消',
        onOk: async () => {
          await doExportMarkdown();
        }
      });
    } else {
      await doExportMarkdown();
    }
  };

  // 实际执行Markdown导出
  const doExportMarkdown = async () => {
    try {
      // 记录导出操作
      const response = await apiClient.post('/mindmap/export-log', {
        type: 'markdown'
      });
      
      if (response.data.success) {
        // 执行导出
        const blob = new Blob([markdown], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `mindmap_${Date.now()}.md`;
        a.click();
        URL.revokeObjectURL(url);
        
        message.success(response.data.data.message || 'Markdown导出成功');
        
        // 刷新用户积分
        fetchUserCredits();
      }
    } catch (error) {
      console.error('导出失败:', error);
      message.error(error.response?.data?.message || '导出失败');
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(markdown).then(() => {
      message.success('已复制到剪贴板');
    }).catch(() => {
      message.error('复制失败');
    });
  };

  // 完全清空内容
  const clearContent = () => {
    Modal.confirm({
      title: '确认清空',
      content: '确定要清空所有内容吗？此操作不可恢复。',
      okText: '确定',
      cancelText: '取消',
      onOk: () => {
        setMarkdown(''); // 完全清空
        message.success('已清空');
      }
    });
  };

  const handleZoom = (type) => {
    if (!markmapRef.current) return;
    if (type === 'in') {
      markmapRef.current.rescale(1.25);
    } else if (type === 'out') {
      markmapRef.current.rescale(0.8);
    } else if (type === 'fit') {
      markmapRef.current.fit();
    }
  };

  // 展开所有节点功能
  const handleExpandAll = () => {
    if (!markmapRef.current) {
      message.warning('请等待思维导图加载完成');
      return;
    }
    
    try {
      const mm = markmapRef.current;
      
      const expandNode = (node) => {
        if (node.payload) {
          node.payload.fold = false;
        }
        if (node.children && node.children.length > 0) {
          node.children.forEach(child => expandNode(child));
        }
      };
      
      if (mm.state && mm.state.data) {
        expandNode(mm.state.data);
        mm.setData(mm.state.data);
        mm.fit();
        message.success('已展开所有节点');
      }
    } catch (error) {
      console.error('展开节点失败:', error);
      message.error('展开失败，请重试');
    }
  };

  const toggleFullscreen = () => {
    if (!isFullscreen) {
      if (containerRef.current?.requestFullscreen) {
        containerRef.current.requestFullscreen();
        setIsFullscreen(true);
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
        setIsFullscreen(false);
      }
    }
  };

  // 导出菜单项 - 显示积分消耗
  const exportMenuItems = [
    { 
      key: 'svg', 
      label: (
        <Space>
          <FileImageOutlined />
          <span>SVG矢量图</span>
          {creditsConfig && creditsConfig.export_svg_credits > 0 && (
            <Badge count={`${creditsConfig.export_svg_credits}积分`} style={{ backgroundColor: '#52c41a' }} />
          )}
        </Space>
      ),
      onClick: exportSVG 
    },
    { 
      key: 'markdown', 
      label: (
        <Space>
          <FileOutlined />
          <span>Markdown文件</span>
          {creditsConfig && creditsConfig.export_markdown_credits > 0 && (
            <Badge count={`${creditsConfig.export_markdown_credits}积分`} style={{ backgroundColor: '#52c41a' }} />
          )}
        </Space>
      ),
      onClick: exportMarkdown 
    }
  ];

  // 已保存的脑图菜单
  const savedMenuItems = savedMaps.map(map => ({
    key: map.id,
    label: (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
        <span onClick={() => handleLoad(map)} style={{ flex: 1 }}>{map.title}</span>
        <Button
          type="text"
          size="small"
          danger
          onClick={(e) => {
            e.stopPropagation();
            handleDelete(map.id);
          }}
        >
          删除
        </Button>
      </div>
    )
  }));

  return (
    <div className="mindmap-page-container" ref={containerRef}>
      {/* 页面级工具栏 */}
      <div className="mindmap-page-header">
        <div className="page-header-left">
          <Space>
            <Text type="secondary">
              <DollarOutlined /> 积分余额: {userCredits}
            </Text>
            {creditsConfig && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                (保存: {creditsConfig.save_credits}积分, 
                导出SVG: {creditsConfig.export_svg_credits}积分, 
                导出MD: {creditsConfig.export_markdown_credits}积分)
              </Text>
            )}
          </Space>
        </div>
        
        <Space className="page-header-actions" size={12}>
          <Button 
            type="primary"
            icon={<SaveOutlined />} 
            onClick={handleSave}
          >
            保存
            {creditsConfig && creditsConfig.save_credits > 0 && (
              <Badge 
                count={creditsConfig.save_credits} 
                style={{ backgroundColor: '#52c41a', marginLeft: 8 }} 
              />
            )}
          </Button>
          
          {savedMaps.length > 0 && (
            <Dropdown menu={{ items: savedMenuItems }} placement="bottomRight">
              <Button icon={<FolderOpenOutlined />}>
                历史 ({savedMaps.length})
              </Button>
            </Dropdown>
          )}
          
          <Dropdown menu={{ items: exportMenuItems }} placement="bottomRight">
            <Button icon={<DownloadOutlined />}>
              导出
            </Button>
          </Dropdown>
          
          <Button 
            icon={<CopyOutlined />} 
            onClick={copyToClipboard}
          >
            复制
          </Button>
          
          <Button 
            danger
            icon={<ClearOutlined />} 
            onClick={clearContent}
          >
            清空
          </Button>
          
          <Button 
            icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
            onClick={toggleFullscreen}
          >
            {isFullscreen ? '退出全屏' : '全屏'}
          </Button>
        </Space>
      </div>
      
      {/* 主体内容区 */}
      <Layout className="mindmap-main-layout">
        {/* 左侧编辑器 */}
        <Sider width="50%" theme="light" className="mindmap-editor-sider">
          <div className="editor-header">
            <Text strong style={{ fontSize: 15 }}>
              Markdown编辑器
            </Text>
            <Tooltip title="使用Markdown语法编写，支持多级标题和列表">
              <QuestionCircleOutlined style={{ color: '#8E8E93' }} />
            </Tooltip>
          </div>
          <div className="editor-wrapper" ref={editorWrapperRef} style={{ height: editorHeight }}>
            {editorLoading && (
              <div className="editor-loading">
                <Spin tip="加载编辑器..." />
              </div>
            )}
            <Editor
              height={editorHeight}
              language="markdown"
              theme="vs-light"
              value={markdown}
              onChange={(value) => setMarkdown(value || '')}
              onMount={handleEditorDidMount}
              loading={null}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                fontFamily: 'SF Mono, Monaco, Consolas, monospace',
                lineNumbers: 'on',
                renderLineHighlight: 'all',
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                automaticLayout: true,
                tabSize: 2,
                insertSpaces: true,
                folding: true,
                lineHeight: 22,
                letterSpacing: 0.3,
                cursorBlinking: 'smooth',
                smoothScrolling: true,
                padding: { top: 16, bottom: 16 },
                scrollbar: {
                  verticalScrollbarSize: 10,
                  horizontalScrollbarSize: 10
                }
              }}
            />
          </div>
        </Sider>
        
        {/* 右侧思维导图 */}
        <Content className="mindmap-preview-content">
          <div className="mindmap-toolbar">
            <Space size={16}>
              <Text strong style={{ fontSize: 15 }}>
                思维导图预览
              </Text>
              <div className="toolbar-divider" />
              <Space size={8}>
                <Tooltip title="放大">
                  <Button 
                    className="zoom-button"
                    icon={<ZoomInOutlined />} 
                    onClick={() => handleZoom('in')}
                  />
                </Tooltip>
                <Tooltip title="缩小">
                  <Button 
                    className="zoom-button"
                    icon={<ZoomOutOutlined />} 
                    onClick={() => handleZoom('out')}
                  />
                </Tooltip>
                <Tooltip title="自适应">
                  <Button 
                    className="zoom-button"
                    icon={<ReloadOutlined />} 
                    onClick={() => handleZoom('fit')}
                  />
                </Tooltip>
                <Tooltip title="展开所有">
                  <Button 
                    className="zoom-button"
                    icon={<ExpandOutlined />} 
                    onClick={handleExpandAll}
                  />
                </Tooltip>
              </Space>
            </Space>
          </div>
          <div className="mindmap-canvas" ref={svgContainerRef}>
            {svgLoading ? (
              <div className="svg-loading">
                <Spin tip="初始化思维导图..." />
              </div>
            ) : (
              <svg ref={svgRef} className="mindmap-svg" />
            )}
          </div>
        </Content>
      </Layout>
    </div>
  );
};

export default MindmapPage;
