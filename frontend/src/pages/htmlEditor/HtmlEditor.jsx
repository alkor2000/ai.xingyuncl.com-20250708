/**
 * HTML编辑器主页面 - iOS设计风格增强版（修复页面列表滚动）
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Layout,
  Button,
  Space,
  message,
  Modal,
  Form,
  Input,
  Select,
  Tree,
  Card,
  Empty,
  Tooltip,
  Tag,
  Dropdown,
  Badge,
  Row,
  Col,
  Divider,
  Typography,
  Spin,
  List
} from 'antd';
import {
  FolderOutlined,
  FileOutlined,
  PlusOutlined,
  SaveOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderAddOutlined,
  FileAddOutlined,
  ReloadOutlined,
  FileTextOutlined,
  DesktopOutlined,
  TabletOutlined,
  MobileOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ClearOutlined,
  LinkOutlined,
  GlobalOutlined,
  DollarOutlined,
  EyeOutlined,
  CodeOutlined,
  Html5Outlined,
  AppstoreOutlined,
  CheckCircleOutlined
} from '@ant-design/icons';
import Editor from '@monaco-editor/react';
import { useTranslation } from 'react-i18next';
import useHtmlEditorStore from '../../stores/htmlEditorStore';
import useAuthStore from '../../stores/authStore';
import apiClient from '../../utils/api';
import moment from 'moment';
import './HtmlEditor.less';

const { Sider, Content, Header } = Layout;
const { TextArea } = Input;
const { Text, Title } = Typography;

// Monaco环境配置
if (typeof window !== 'undefined' && !window.MonacoEnvironment) {
  window.MonacoEnvironment = {
    getWorker: () => undefined,
    getWorkerUrl: () => undefined
  };
}

// 默认欢迎页面模板 - 展示HTML编辑器功能
const EMPTY_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>欢迎使用HTML编辑器</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
            line-height: 1.6;
            color: #333;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
            overflow: hidden;
        }
        
        .hero {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 60px 40px;
            text-align: center;
        }
        
        .hero h1 {
            font-size: 3em;
            margin-bottom: 20px;
            font-weight: 700;
            text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.2);
        }
        
        .hero p {
            font-size: 1.2em;
            opacity: 0.95;
            max-width: 600px;
            margin: 0 auto;
        }
        
        .content {
            padding: 60px 40px;
        }
        
        .section {
            margin-bottom: 50px;
        }
        
        .section h2 {
            color: #667eea;
            font-size: 2em;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 3px solid #667eea;
        }
        
        .feature-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 30px;
            margin-top: 30px;
        }
        
        .feature-card {
            background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
            padding: 30px;
            border-radius: 15px;
            text-align: center;
            transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        
        .feature-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
        }
        
        .feature-icon {
            font-size: 3em;
            margin-bottom: 15px;
        }
        
        .feature-card h3 {
            color: #333;
            margin-bottom: 10px;
        }
        
        .feature-card p {
            color: #666;
            font-size: 0.95em;
        }
        
        .example-code {
            background: #f8f9fa;
            border: 1px solid #e9ecef;
            border-radius: 10px;
            padding: 20px;
            margin: 20px 0;
            font-family: 'Courier New', monospace;
            overflow-x: auto;
        }
        
        .button-group {
            display: flex;
            gap: 15px;
            margin-top: 30px;
            flex-wrap: wrap;
            justify-content: center;
        }
        
        .btn {
            padding: 12px 30px;
            border: none;
            border-radius: 25px;
            font-size: 1em;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            text-decoration: none;
            display: inline-block;
        }
        
        .btn-primary {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }
        
        .btn-primary:hover {
            transform: scale(1.05);
            box-shadow: 0 10px 20px rgba(102, 126, 234, 0.4);
        }
        
        .btn-secondary {
            background: white;
            color: #667eea;
            border: 2px solid #667eea;
        }
        
        .btn-secondary:hover {
            background: #667eea;
            color: white;
        }
        
        .tips {
            background: linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%);
            border-radius: 15px;
            padding: 30px;
            margin-top: 40px;
        }
        
        .tips h3 {
            color: #d94f00;
            margin-bottom: 15px;
        }
        
        .tips ul {
            list-style: none;
            padding-left: 0;
        }
        
        .tips li {
            padding: 8px 0;
            padding-left: 30px;
            position: relative;
        }
        
        .tips li:before {
            content: "✓";
            position: absolute;
            left: 0;
            color: #d94f00;
            font-weight: bold;
        }
        
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
        }
        
        table th,
        table td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #e9ecef;
        }
        
        table th {
            background: #f8f9fa;
            color: #667eea;
            font-weight: 600;
        }
        
        table tr:hover {
            background: #f8f9fa;
        }
        
        .demo-form {
            background: #f8f9fa;
            padding: 30px;
            border-radius: 15px;
            margin-top: 30px;
        }
        
        .form-group {
            margin-bottom: 20px;
        }
        
        .form-group label {
            display: block;
            margin-bottom: 8px;
            color: #333;
            font-weight: 600;
        }
        
        .form-group input,
        .form-group select,
        .form-group textarea {
            width: 100%;
            padding: 10px;
            border: 2px solid #e9ecef;
            border-radius: 8px;
            font-size: 1em;
            transition: border-color 0.3s ease;
        }
        
        .form-group input:focus,
        .form-group select:focus,
        .form-group textarea:focus {
            outline: none;
            border-color: #667eea;
        }
        
        @media (max-width: 768px) {
            .hero h1 {
                font-size: 2em;
            }
            
            .content {
                padding: 40px 20px;
            }
            
            .feature-grid {
                grid-template-columns: 1fr;
            }
        }
        
        /* 动画效果 */
        @keyframes fadeIn {
            from {
                opacity: 0;
                transform: translateY(20px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        
        .animate {
            animation: fadeIn 0.8s ease-out;
        }
    </style>
</head>
<body>
    <div class="container animate">
        <div class="hero">
            <h1>🎨 HTML编辑器</h1>
            <p>欢迎使用专业的HTML在线编辑器！在这里，您可以创建精美的网页，实时预览效果，并生成永久访问链接。</p>
        </div>
        
        <div class="content">
            <div class="section">
                <h2>✨ 核心功能</h2>
                <div class="feature-grid">
                    <div class="feature-card">
                        <div class="feature-icon">📝</div>
                        <h3>智能编辑</h3>
                        <p>Monaco编辑器提供代码高亮、自动补全、格式化等专业功能</p>
                    </div>
                    <div class="feature-card">
                        <div class="feature-icon">👁️</div>
                        <h3>实时预览</h3>
                        <p>编写代码的同时实时查看页面效果，支持多种设备预览模式</p>
                    </div>
                    <div class="feature-card">
                        <div class="feature-icon">🔗</div>
                        <h3>永久链接</h3>
                        <p>一键生成永久访问链接，轻松分享您的作品</p>
                    </div>
                    <div class="feature-card">
                        <div class="feature-icon">📁</div>
                        <h3>项目管理</h3>
                        <p>创建多个项目和页面，有序管理您的所有作品</p>
                    </div>
                </div>
            </div>
            
            <div class="section">
                <h2>📚 HTML元素示例</h2>
                
                <h3 style="margin-top: 30px; color: #764ba2;">文本元素</h3>
                <p>这是一个普通段落，包含<strong>加粗文本</strong>和<em>斜体文本</em>。</p>
                <p>您还可以使用<mark>高亮文本</mark>、<del>删除线</del>和<u>下划线</u>。</p>
                
                <h3 style="margin-top: 30px; color: #764ba2;">列表示例</h3>
                <ul>
                    <li>无序列表项目 1</li>
                    <li>无序列表项目 2</li>
                    <li>无序列表项目 3</li>
                </ul>
                
                <ol>
                    <li>有序列表项目 1</li>
                    <li>有序列表项目 2</li>
                    <li>有序列表项目 3</li>
                </ol>
                
                <h3 style="margin-top: 30px; color: #764ba2;">表格示例</h3>
                <table>
                    <thead>
                        <tr>
                            <th>功能</th>
                            <th>快捷键</th>
                            <th>描述</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>保存</td>
                            <td>Ctrl + S</td>
                            <td>保存当前页面</td>
                        </tr>
                        <tr>
                            <td>预览</td>
                            <td>F5</td>
                            <td>预览页面效果</td>
                        </tr>
                        <tr>
                            <td>格式化</td>
                            <td>Shift + Alt + F</td>
                            <td>格式化代码</td>
                        </tr>
                    </tbody>
                </table>
                
                <h3 style="margin-top: 30px; color: #764ba2;">表单示例</h3>
                <div class="demo-form">
                    <div class="form-group">
                        <label for="name">姓名</label>
                        <input type="text" id="name" placeholder="请输入您的姓名">
                    </div>
                    <div class="form-group">
                        <label for="email">邮箱</label>
                        <input type="email" id="email" placeholder="example@email.com">
                    </div>
                    <div class="form-group">
                        <label for="category">类别</label>
                        <select id="category">
                            <option>个人网站</option>
                            <option>企业官网</option>
                            <option>在线商城</option>
                            <option>博客</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="message">留言</label>
                        <textarea id="message" rows="4" placeholder="请输入您的留言..."></textarea>
                    </div>
                    <button class="btn btn-primary" type="button" onclick="alert('这是一个示例表单！')">提交</button>
                </div>
            </div>
            
            <div class="section">
                <h2>💡 使用技巧</h2>
                <div class="tips">
                    <h3>快速上手指南</h3>
                    <ul>
                        <li>使用左侧项目管理器创建和管理您的项目</li>
                        <li>在编辑器中编写HTML代码，右侧会实时显示预览效果</li>
                        <li>点击"保存"按钮保存您的更改（消耗2积分）</li>
                        <li>点击"生成链接"创建永久访问链接（消耗5积分）</li>
                        <li>使用顶部工具栏切换预览模式（桌面/平板/手机）</li>
                        <li>点击"清空"可以清除编辑器内容，重新开始</li>
                        <li>支持HTML5、CSS3和JavaScript，尽情发挥创意！</li>
                    </ul>
                </div>
            </div>
            
            <div class="section">
                <h2>🚀 开始创作</h2>
                <p style="text-align: center; font-size: 1.1em; color: #666; margin: 30px 0;">
                    现在就开始修改这个页面，创建属于您的精彩内容吧！<br>
                    您可以删除所有内容从零开始，或者在此基础上进行修改。
                </p>
                <div class="button-group">
                    <button class="btn btn-primary" onclick="alert('开始编辑这个页面吧！')">
                        立即开始
                    </button>
                    <button class="btn btn-secondary" onclick="alert('查看更多示例和教程')">
                        学习更多
                    </button>
                </div>
            </div>
        </div>
    </div>
    
    <script>
        // 简单的交互效果示例
        document.addEventListener('DOMContentLoaded', function() {
            console.log('欢迎使用HTML编辑器！');
            
            // 为所有按钮添加点击效果
            const buttons = document.querySelectorAll('.btn');
            buttons.forEach(button => {
                button.addEventListener('click', function(e) {
                    // 创建涟漪效果
                    const ripple = document.createElement('span');
                    ripple.style.position = 'absolute';
                    ripple.style.width = '20px';
                    ripple.style.height = '20px';
                    ripple.style.background = 'rgba(255, 255, 255, 0.5)';
                    ripple.style.borderRadius = '50%';
                    ripple.style.transform = 'scale(0)';
                    ripple.style.animation = 'ripple 0.6s ease-out';
                    
                    this.style.position = 'relative';
                    this.style.overflow = 'hidden';
                    
                    const rect = this.getBoundingClientRect();
                    ripple.style.left = (e.clientX - rect.left - 10) + 'px';
                    ripple.style.top = (e.clientY - rect.top - 10) + 'px';
                    
                    this.appendChild(ripple);
                    
                    setTimeout(() => {
                        ripple.remove();
                    }, 600);
                });
            });
        });
        
        // 添加涟漪动画
        const style = document.createElement('style');
        style.textContent = \`
            @keyframes ripple {
                to {
                    transform: scale(10);
                    opacity: 0;
                }
            }
        \`;
        document.head.appendChild(style);
    </script>
</body>
</html>`;

// 生成默认页面标题
const generateDefaultTitle = () => {
  const now = moment();
  return `页面-${now.format('YYYY年MM月DD日-HH时mm分')}`;
};

const HtmlEditor = () => {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const {
    projects,
    pages,
    currentPage,
    loading,
    getProjects,
    getPages,
    createProject,
    createPage,
    updatePage,
    deletePage,
    deleteProject,
    togglePublish,
    loadPage,
    updateProject
  } = useHtmlEditorStore();

  // 状态管理
  const [selectedProject, setSelectedProject] = useState(null);
  const [selectedPageId, setSelectedPageId] = useState(null);
  const [htmlContent, setHtmlContent] = useState(EMPTY_TEMPLATE);
  const [previewMode, setPreviewMode] = useState('desktop');
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [showPageModal, setShowPageModal] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameType, setRenameType] = useState('');
  const [renameItem, setRenameItem] = useState(null);
  const [projectForm] = Form.useForm();
  const [pageForm] = Form.useForm();
  const [renameForm] = Form.useForm();
  const [isSaving, setIsSaving] = useState(false);
  const [compiledContent, setCompiledContent] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [editorTheme, setEditorTheme] = useState('vs-dark');
  const [creditsConfig, setCreditsConfig] = useState({
    credits_per_page: 10,
    credits_per_update: 2,
    credits_per_publish: 5
  });
  const [userCredits, setUserCredits] = useState(0);
  const [defaultProjectSelected, setDefaultProjectSelected] = useState(false);
  const [editorReady, setEditorReady] = useState(false);
  const [loadingPages, setLoadingPages] = useState(false);

  // 初始化加载
  useEffect(() => {
    getProjects();
    fetchCreditsConfig();
    fetchUserCredits();
  }, []);

  // 自动选择默认项目
  useEffect(() => {
    if (projects.length > 0 && !defaultProjectSelected && !selectedProject) {
      const defaultProject = projects.find(p => p.name === '默认项目' || p.is_default === 1);
      if (defaultProject) {
        handleSelectProject(defaultProject);
        setDefaultProjectSelected(true);
      }
    }
  }, [projects, defaultProjectSelected]);

  // 获取积分配置
  const fetchCreditsConfig = async () => {
    try {
      const response = await apiClient.get('/html-editor/credits-config');
      if (response.data.success) {
        setCreditsConfig(response.data.data);
      }
    } catch (error) {
      console.error('获取积分配置失败:', error);
    }
  };

  // 获取用户当前积分
  const fetchUserCredits = async () => {
    try {
      const response = await apiClient.get('/auth/me');
      if (response.data.success) {
        const userData = response.data.data.user;
        const credits = (userData.credits_quota || 0) - (userData.used_credits || 0);
        setUserCredits(Math.max(0, credits));
      }
    } catch (error) {
      console.error('获取用户积分失败:', error);
    }
  };

  // 格式化积分显示
  const formatCreditsDisplay = (credits) => {
    return credits === 0 ? '免费' : `${credits} 积分`;
  };

  // 加载选中页面的内容
  useEffect(() => {
    if (currentPage) {
      if (currentPage.html_content !== undefined && currentPage.html_content !== null) {
        setHtmlContent(currentPage.html_content);
      } else if (currentPage.compiled_content) {
        setHtmlContent(currentPage.compiled_content);
      } else {
        setHtmlContent(EMPTY_TEMPLATE);
      }
    }
  }, [currentPage]);

  // 实时预览更新
  useEffect(() => {
    setCompiledContent(htmlContent || '<!DOCTYPE html><html><body style="padding:20px;color:#999;font-family:system-ui;">开始编写你的HTML代码...</body></html>');
  }, [htmlContent]);

  // 预览页面
  const handlePreview = () => {
    if (!htmlContent) {
      message.warning('编辑器内容为空');
      return;
    }

    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const previewWindow = window.open(url, '_blank');
    
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
    
    message.success('预览窗口已打开');
  };

  // 创建项目
  const handleCreateProject = async (values) => {
    try {
      await createProject(values);
      message.success('项目创建成功');
      setShowProjectModal(false);
      projectForm.resetFields();
    } catch (error) {
      message.error('创建项目失败');
    }
  };

  // 选择项目 - 修复：确保正确加载对应项目的页面
  const handleSelectProject = async (project) => {
    // 先清空当前状态
    setSelectedProject(project);
    setSelectedPageId(null);
    setHtmlContent(EMPTY_TEMPLATE);
    
    // 加载新项目的页面
    setLoadingPages(true);
    try {
      await getPages(project.id);
    } finally {
      setLoadingPages(false);
    }
  };

  // 编辑项目名称
  const handleEditProject = (project) => {
    setRenameType('project');
    setRenameItem(project);
    renameForm.setFieldsValue({ name: project.name });
    setShowRenameModal(true);
  };

  // 删除项目
  const handleDeleteProject = (project) => {
    if (project.is_default === 1 || project.name === '默认项目') {
      message.warning('默认项目不能删除');
      return;
    }

    Modal.confirm({
      title: '确认删除',
      content: (
        <div>
          <p>确定要删除项目 "{project.name}" 吗？</p>
          <p style={{ color: '#ff4d4f', marginTop: 8 }}>
            注意：只能删除空项目。如果项目内有页面，请先删除页面。
          </p>
        </div>
      ),
      okText: '确定删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteProject(project.id);
          message.success('项目删除成功');
          
          if (selectedProject?.id === project.id) {
            setSelectedProject(null);
            setSelectedPageId(null);
            setHtmlContent(EMPTY_TEMPLATE);
          }
          
          await getProjects();
        } catch (error) {
          const errorMsg = error.response?.data?.message || '删除项目失败';
          message.error(errorMsg);
        }
      }
    });
  };

  // 编辑页面名称
  const handleEditPage = (page) => {
    setRenameType('page');
    setRenameItem(page);
    renameForm.setFieldsValue({ name: page.title });
    setShowRenameModal(true);
  };

  // 处理重命名
  const handleRename = async (values) => {
    try {
      if (renameType === 'project') {
        await updateProject(renameItem.id, { name: values.name });
        message.success('项目名称更新成功');
        await getProjects();
      } else if (renameType === 'page') {
        await updatePage(renameItem.id, { title: values.name });
        message.success('页面名称更新成功');
        await getPages(selectedProject?.id);
        if (renameItem.id === selectedPageId) {
          await loadPage(renameItem.id);
        }
      }
      setShowRenameModal(false);
      renameForm.resetFields();
      setRenameItem(null);
    } catch (error) {
      message.error('更新名称失败');
    }
  };

  // 打开创建页面弹窗时，设置默认标题
  const handleOpenPageModal = () => {
    const defaultTitle = generateDefaultTitle();
    pageForm.setFieldsValue({ title: defaultTitle });
    setShowPageModal(true);
  };

  // 创建页面 - 确保在选中的项目下创建
  const handleCreatePage = async (values) => {
    if (!selectedProject) {
      message.warning('请先选择一个项目');
      return;
    }

    if (creditsConfig.credits_per_page > 0 && userCredits < creditsConfig.credits_per_page) {
      message.error(`积分不足！创建页面需要 ${creditsConfig.credits_per_page} 积分，当前余额 ${userCredits} 积分`);
      return;
    }

    try {
      const pageData = {
        title: values.title || generateDefaultTitle(),
        project_id: selectedProject.id,
        html_content: EMPTY_TEMPLATE,
        css_content: '',
        js_content: ''
      };
      
      const newPage = await createPage(pageData);
      message.success('页面创建成功');
      setShowPageModal(false);
      pageForm.resetFields();
      setSelectedPageId(newPage.id);
      loadPage(newPage.id);
      setHtmlContent(EMPTY_TEMPLATE);
      
      await getPages(selectedProject.id);
      fetchUserCredits();
    } catch (error) {
      message.error(error.message || '创建页面失败');
    }
  };

  // 保存页面
  const handleSavePage = async () => {
    if (!selectedPageId) {
      message.warning('请先选择或创建一个页面');
      return;
    }

    if (creditsConfig.credits_per_update > 0 && userCredits < creditsConfig.credits_per_update) {
      message.error(`积分不足！保存页面需要 ${creditsConfig.credits_per_update} 积分，当前余额 ${userCredits} 积分`);
      return;
    }

    setIsSaving(true);
    try {
      await updatePage(selectedPageId, {
        html_content: htmlContent,
        css_content: '',
        js_content: ''
      });
      message.success('页面保存成功');
      fetchUserCredits();
      // 刷新页面列表以更新状态
      await getPages(selectedProject?.id);
    } catch (error) {
      message.error(error.message || '保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  // 选择页面
  const handleSelectPage = (page) => {
    setSelectedPageId(page.id);
    loadPage(page.id);
  };

  // 删除页面
  const handleDeletePage = (page) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除页面 "${page.title}" 吗？`,
      okText: '确定删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await deletePage(page.id);
          message.success('页面删除成功');
          if (selectedPageId === page.id) {
            setSelectedPageId(null);
            setHtmlContent(EMPTY_TEMPLATE);
          }
          await getPages(selectedProject.id);
        } catch (error) {
          message.error('删除页面失败');
        }
      }
    });
  };

  // 复制内容
  const handleCopyContent = () => {
    if (!htmlContent) {
      message.warning('编辑器内容为空');
      return;
    }
    
    navigator.clipboard.writeText(htmlContent).then(() => {
      message.success('内容已复制到剪贴板');
    }).catch(() => {
      message.error('复制失败，请手动复制');
    });
  };

  // 清空编辑器
  const handleClearContent = () => {
    Modal.confirm({
      title: '确认清空',
      content: '确定要清空编辑器内容吗？此操作不可恢复。',
      okText: '确定',
      cancelText: '取消',
      onOk: () => {
        setHtmlContent('');
        message.success('编辑器已清空');
      }
    });
  };

  // 生成永久链接
  const handleGeneratePermalink = async () => {
    if (!selectedPageId) {
      message.warning('请先保存页面');
      return;
    }

    const currentPageData = pages.find(p => p.id === selectedPageId);
    if (currentPageData?.is_published) {
      showPermalinkModal(currentPageData);
      return;
    }

    if (creditsConfig.credits_per_publish > 0 && userCredits < creditsConfig.credits_per_publish) {
      Modal.error({
        title: '积分不足',
        content: (
          <div>
            <p>生成永久链接需要 <Text strong>{creditsConfig.credits_per_publish}</Text> 积分</p>
            <p>您当前积分余额：<Text type="danger">{userCredits}</Text> 积分</p>
          </div>
        )
      });
      return;
    }

    Modal.confirm({
      title: '生成永久链接',
      content: (
        <div>
          <p>生成永久链接后，页面将可以通过固定URL访问</p>
          {creditsConfig.credits_per_publish > 0 && (
            <p>需要消耗 <Text strong type="warning">{creditsConfig.credits_per_publish}</Text> 积分</p>
          )}
        </div>
      ),
      okText: '确认生成',
      cancelText: '取消',
      onOk: async () => {
        try {
          const result = await togglePublish(selectedPageId);
          if (result.is_published) {
            showPermalinkModal(result);
            fetchUserCredits();
          }
        } catch (error) {
          message.error('生成链接失败');
        }
      }
    });
  };

  // 显示永久链接弹窗
  const showPermalinkModal = (page) => {
    const publishUrl = `${window.location.origin}/pages/${user.id}/${page.slug}`;
    
    Modal.success({
      title: '永久链接',
      width: 600,
      content: (
        <div>
          <p>你的页面永久链接：</p>
          <Space.Compact style={{ width: '100%', marginTop: 10 }}>
            <Input value={publishUrl} readOnly />
            <Button 
              icon={<CopyOutlined />}
              onClick={() => {
                navigator.clipboard.writeText(publishUrl);
                message.success('链接已复制');
              }}
            />
          </Space.Compact>
          <Divider />
          <Text type="secondary">提示：此链接永久有效，可以分享给任何人访问</Text>
        </div>
      ),
      okText: '打开页面',
      onOk: () => window.open(publishUrl, '_blank')
    });
  };

  // Monaco编辑器配置
  const editorOptions = {
    minimap: { enabled: false },
    fontSize: 14,
    fontFamily: 'SF Mono, Monaco, Consolas, monospace',
    formatOnPaste: true,
    formatOnType: true,
    automaticLayout: true,
    tabSize: 2,
    wordWrap: 'on',
    scrollBeyondLastLine: false,
    lineNumbers: 'on',
    renderWhitespace: 'selection',
    folding: true,
    bracketPairColorization: { enabled: true },
    guides: {
      indentation: true,
      bracketPairs: true
    },
    padding: { top: 16, bottom: 16 }
  };

  // 编辑器加载完成
  const handleEditorDidMount = (editor, monaco) => {
    setEditorReady(true);
    if (monaco?.languages?.html?.htmlDefaults) {
      try {
        monaco.languages.html.htmlDefaults.setOptions({
          format: {
            tabSize: 2,
            insertSpaces: true,
            wrapLineLength: 120,
            wrapAttributes: 'auto'
          },
          suggest: { html5: true }
        });
      } catch (e) {
        console.error('Monaco配置失败:', e);
      }
    }
  };

  // iOS风格的样式对象 - 增强配色方案
  const iosStyles = {
    container: {
      height: '100vh',
      background: '#F2F2F7'
    },
    header: {
      background: 'rgba(255, 255, 255, 0.98)',
      backdropFilter: 'blur(20px)',
      borderBottom: '1px solid rgba(60, 60, 67, 0.12)',
      height: 60,
      padding: '0 24px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      boxShadow: '0 1px 0 rgba(0, 0, 0, 0.05)'
    },
    sidebar: {
      background: 'rgba(255, 255, 255, 0.98)',
      backdropFilter: 'blur(20px)',
      borderRight: '1px solid rgba(60, 60, 67, 0.12)'
    },
    // 关键修改：侧边栏内容容器
    sidebarContent: {
      height: 'calc(100vh - 60px)',  // 固定高度
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'  // 防止整体溢出
    },
    sidebarSection: {
      padding: '20px',
      borderBottom: '1px solid rgba(60, 60, 67, 0.08)',
      flexShrink: 0  // 项目区域不收缩
    },
    // 修改：页面列表区域样式
    pageListSection: {
      padding: '20px',
      borderBottom: '1px solid rgba(60, 60, 67, 0.08)',
      flex: 1,  // 占用剩余空间
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,  // 重要：允许收缩到0
      overflow: 'hidden'  // 防止整个section溢出
    },
    // 页面列表滚动容器
    pageListScrollContainer: {
      flex: 1,
      overflowY: 'auto',  // 允许垂直滚动
      overflowX: 'hidden',  // 禁止水平滚动
      paddingRight: '4px',  // 给滚动条留出空间
      minHeight: 0,  // 重要：允许收缩
      maxHeight: 'calc(100vh - 300px)'  // 明确设置最大高度
    },
    sectionHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 16,
      flexShrink: 0  // 防止header被压缩
    },
    sectionTitle: {
      fontSize: 17,
      fontWeight: 600,
      color: '#000',
      margin: 0,
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      letterSpacing: '-0.4px'
    },
    projectItem: {
      padding: '10px 14px',
      cursor: 'pointer',
      borderRadius: 10,
      marginBottom: 6,
      transition: 'all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    },
    projectItemSelected: {
      background: 'linear-gradient(135deg, #007AFF 0%, #0051D5 100%)',
      color: 'white',
      boxShadow: '0 2px 8px rgba(0, 122, 255, 0.25)'
    },
    pageCard: {
      background: 'white',
      borderRadius: 10,
      padding: '12px 14px',
      marginBottom: 8,
      cursor: 'pointer',
      border: '1px solid rgba(60, 60, 67, 0.08)',
      transition: 'all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)'
    },
    pageCardSelected: {
      border: '2px solid #007AFF',
      boxShadow: '0 4px 12px rgba(0, 122, 255, 0.15)',
      background: 'linear-gradient(135deg, rgba(0, 122, 255, 0.02) 0%, rgba(0, 81, 213, 0.04) 100%)'
    },
    editorSection: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      background: 'white',
      borderRadius: '12px 0 0 0',
      overflow: 'hidden',
      margin: '0 0 0 1px'
    },
    editorHeader: {
      padding: '14px 20px',
      background: 'rgba(255, 255, 255, 0.98)',
      backdropFilter: 'blur(20px)',
      borderBottom: '1px solid rgba(60, 60, 67, 0.12)',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    },
    previewSection: {
      width: '50%',
      display: 'flex',
      flexDirection: 'column',
      background: 'linear-gradient(135deg, #F2F2F7 0%, #E5E5EA 100%)'
    },
    previewContent: {
      flex: 1,
      padding: 20,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    },
    previewFrame: {
      background: 'white',
      borderRadius: 12,
      overflow: 'hidden',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.08)',
      transition: 'all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)'
    },
    // 按钮样式 - 多彩iOS风格
    saveButton: {
      background: 'linear-gradient(135deg, #34C759 0%, #30B854 100%)',
      borderColor: 'transparent',
      borderRadius: 8,
      fontWeight: 600,
      padding: '6px 16px',
      height: 38,
      transition: 'all 0.2s ease',
      boxShadow: '0 2px 8px rgba(52, 199, 89, 0.3)',
      color: 'white'
    },
    previewButton: {
      background: 'linear-gradient(135deg, #AF52DE 0%, #9F44D3 100%)',
      borderColor: 'transparent',
      color: 'white',
      borderRadius: 8,
      fontWeight: 600,
      padding: '6px 16px',
      height: 38,
      transition: 'all 0.2s ease',
      boxShadow: '0 2px 8px rgba(175, 82, 222, 0.3)'
    },
    copyButton: {
      background: 'rgba(142, 142, 147, 0.12)',
      borderColor: 'transparent',
      color: '#3C3C43',
      borderRadius: 8,
      fontWeight: 600,
      padding: '6px 16px',
      height: 38,
      transition: 'all 0.2s ease'
    },
    clearButton: {
      background: 'linear-gradient(135deg, #FF9500 0%, #FF8200 100%)',
      borderColor: 'transparent',
      color: 'white',
      borderRadius: 8,
      fontWeight: 600,
      padding: '6px 16px',
      height: 38,
      transition: 'all 0.2s ease',
      boxShadow: '0 2px 8px rgba(255, 149, 0, 0.3)'
    },
    linkButton: {
      background: 'linear-gradient(135deg, #007AFF 0%, #0051D5 100%)',
      borderColor: 'transparent',
      color: 'white',
      borderRadius: 8,
      fontWeight: 600,
      padding: '6px 16px',
      height: 38,
      transition: 'all 0.2s ease',
      boxShadow: '0 2px 8px rgba(0, 122, 255, 0.3)'
    },
    iconButton: {
      borderRadius: 8,
      width: 38,
      height: 38,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(142, 142, 147, 0.12)',
      border: 'none',
      transition: 'all 0.2s ease'
    },
    tag: {
      borderRadius: 6,
      padding: '4px 10px',
      fontSize: 12,
      fontWeight: 600,
      border: 'none'
    },
    smallButton: {
      borderRadius: 6,
      fontSize: 13,
      height: 30,
      fontWeight: 600,
      background: 'linear-gradient(135deg, #007AFF 0%, #0051D5 100%)',
      borderColor: 'transparent',
      boxShadow: '0 1px 4px rgba(0, 122, 255, 0.25)'
    }
  };

  return (
    <Layout style={iosStyles.container}>
      {/* 顶部工具栏 - iOS风格增强 */}
      <Header style={iosStyles.header}>
        <Space size={12}>
          <Button
            style={iosStyles.iconButton}
            icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          />
          <Button 
            type="primary"
            style={iosStyles.saveButton}
            icon={<SaveOutlined />} 
            onClick={handleSavePage}
            loading={isSaving}
            disabled={!selectedPageId}
          >
            保存 ({formatCreditsDisplay(creditsConfig.credits_per_update)})
          </Button>
          <Button 
            style={iosStyles.previewButton}
            icon={<EyeOutlined />} 
            onClick={handlePreview}
          >
            预览
          </Button>
          <Button 
            style={iosStyles.copyButton}
            icon={<CopyOutlined />} 
            onClick={handleCopyContent}
          >
            复制
          </Button>
          <Button 
            style={iosStyles.clearButton}
            icon={<ClearOutlined />} 
            onClick={handleClearContent}
          >
            清空
          </Button>
          <Button
            style={iosStyles.linkButton}
            icon={<LinkOutlined />}
            onClick={handleGeneratePermalink}
            disabled={!selectedPageId}
          >
            生成链接 ({formatCreditsDisplay(creditsConfig.credits_per_publish)})
          </Button>
        </Space>
        
        <div style={{ flex: 1, textAlign: 'center' }}>
          {currentPage && (
            <Space size={8}>
              <Tag style={{ 
                ...iosStyles.tag, 
                background: 'linear-gradient(135deg, #007AFF 0%, #0051D5 100%)', 
                color: 'white' 
              }}>
                <Html5Outlined /> {currentPage.title}
              </Tag>
              {currentPage.is_published && (
                <Tag style={{ 
                  ...iosStyles.tag, 
                  background: 'linear-gradient(135deg, #34C759 0%, #30B854 100%)', 
                  color: 'white' 
                }}>
                  <GlobalOutlined /> 已发布
                </Tag>
              )}
            </Space>
          )}
        </div>
        
        <Space size={12}>
          <Tag style={{ 
            ...iosStyles.tag, 
            background: 'linear-gradient(135deg, #FFD60A 0%, #FFCC00 100%)', 
            color: '#000' 
          }}>
            <DollarOutlined /> 积分: {userCredits}
          </Tag>
          <Select
            value={previewMode}
            onChange={setPreviewMode}
            style={{ width: 100, borderRadius: 8 }}
            options={[
              { value: 'desktop', label: '桌面' },
              { value: 'tablet', label: '平板' },
              { value: 'mobile', label: '手机' }
            ]}
          />
          <Select
            value={editorTheme}
            onChange={setEditorTheme}
            style={{ width: 90, borderRadius: 8 }}
            options={[
              { value: 'vs-dark', label: '暗色' },
              { value: 'vs-light', label: '亮色' }
            ]}
          />
        </Space>
      </Header>

      <Layout style={{ background: 'transparent' }}>
        {/* 左侧项目管理区 - iOS风格 */}
        <Sider 
          width={300} 
          collapsed={sidebarCollapsed}
          collapsedWidth={0}
          style={iosStyles.sidebar}
        >
          {/* 关键修改：添加内容容器 */}
          <div style={iosStyles.sidebarContent}>
            {/* 项目列表 */}
            <div style={iosStyles.sidebarSection}>
              <div style={iosStyles.sectionHeader}>
                <h3 style={iosStyles.sectionTitle}>
                  <AppstoreOutlined style={{ color: '#007AFF' }} /> 项目
                </h3>
                <Button
                  type="primary"
                  size="small"
                  style={iosStyles.smallButton}
                  icon={<PlusOutlined />}
                  onClick={() => setShowProjectModal(true)}
                >
                  新建
                </Button>
              </div>
              
              {projects.length > 0 ? (
                <div>
                  {projects.map(project => (
                    <div
                      key={project.id}
                      style={{
                        ...iosStyles.projectItem,
                        ...(selectedProject?.id === project.id ? iosStyles.projectItemSelected : {
                          background: 'rgba(60, 60, 67, 0.03)',
                          '&:hover': { background: 'rgba(60, 60, 67, 0.06)' }
                        })
                      }}
                      onClick={() => handleSelectProject(project)}
                    >
                      <Space size={8}>
                        <FolderOutlined style={{ fontSize: 16 }} />
                        <span style={{ fontWeight: 500 }}>{project.name}</span>
                        {project.is_default === 1 && (
                          <Tag style={{ 
                            ...iosStyles.tag, 
                            background: 'rgba(0, 122, 255, 0.1)', 
                            color: '#007AFF',
                            padding: '2px 6px',
                            fontSize: 11
                          }}>
                            默认
                          </Tag>
                        )}
                      </Space>
                      <Space size={4}>
                        <Button
                          type="text"
                          size="small"
                          icon={<EditOutlined />}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditProject(project);
                          }}
                          style={{ 
                            color: selectedProject?.id === project.id ? 'white' : '#8E8E93',
                            opacity: 0.8
                          }}
                        />
                        {project.is_default !== 1 && (
                          <Button
                            type="text"
                            size="small"
                            icon={<DeleteOutlined />}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteProject(project);
                            }}
                            style={{ 
                              color: selectedProject?.id === project.id ? '#FFD1DC' : '#FF3B30',
                              opacity: 0.8
                            }}
                          />
                        )}
                      </Space>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty description="暂无项目" style={{ marginTop: 40 }} />
              )}
            </div>

            {/* 页面列表 - 修复滚动问题 */}
            {selectedProject && (
              <div style={iosStyles.pageListSection}>
                <div style={iosStyles.sectionHeader}>
                  <h3 style={iosStyles.sectionTitle}>
                    <FileTextOutlined style={{ color: '#AF52DE' }} /> 页面
                  </h3>
                  <Button
                    type="primary"
                    size="small"
                    style={{
                      ...iosStyles.smallButton,
                      background: 'linear-gradient(135deg, #AF52DE 0%, #9F44D3 100%)',
                      boxShadow: '0 1px 4px rgba(175, 82, 222, 0.25)'
                    }}
                    icon={<PlusOutlined />}
                    onClick={handleOpenPageModal}
                  >
                    新建
                  </Button>
                </div>
                
                {loadingPages ? (
                  <div style={{ textAlign: 'center', padding: 40 }}>
                    <Spin tip="加载页面中..." />
                  </div>
                ) : pages.length > 0 ? (
                  <div style={iosStyles.pageListScrollContainer} className="page-list-scroll">
                    {pages.map(page => (
                      <div
                        key={page.id}
                        style={{
                          ...iosStyles.pageCard,
                          ...(selectedPageId === page.id ? iosStyles.pageCardSelected : {})
                        }}
                        onClick={() => handleSelectPage(page)}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600, fontSize: 14, color: '#000' }}>
                              {page.title}
                            </div>
                            <div style={{ fontSize: 11, color: '#8E8E93', marginTop: 4 }}>
                              {page.slug}
                            </div>
                          </div>
                          <Space size={6}>
                            <Button
                              type="text"
                              size="small"
                              icon={<EditOutlined />}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEditPage(page);
                              }}
                              style={{ color: '#8E8E93' }}
                            />
                            {page.is_published && (
                              <CheckCircleOutlined style={{ color: '#34C759', fontSize: 16 }} />
                            )}
                            <Button
                              type="text"
                              size="small"
                              icon={<DeleteOutlined />}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeletePage(page);
                              }}
                              style={{ color: '#FF3B30' }}
                            />
                          </Space>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty description="暂无页面" style={{ marginTop: 40 }}>
                    <Button 
                      type="primary" 
                      style={{ 
                        borderRadius: 8, 
                        marginTop: 16,
                        background: 'linear-gradient(135deg, #AF52DE 0%, #9F44D3 100%)',
                        border: 'none',
                        fontWeight: 600
                      }}
                      icon={<FileAddOutlined />}
                      onClick={handleOpenPageModal}
                    >
                      创建第一个页面
                    </Button>
                  </Empty>
                )}
              </div>
            )}

            {!selectedProject && (
              <div style={{ padding: 40, textAlign: 'center' }}>
                <Empty description="请选择一个项目" />
              </div>
            )}
          </div>
        </Sider>

        {/* 主编辑区 */}
        <Content style={{ display: 'flex', background: 'transparent', padding: 0 }}>
          {/* 编辑器区域 */}
          <div style={iosStyles.editorSection}>
            <div style={iosStyles.editorHeader}>
              <span style={{ fontWeight: 600, fontSize: 15, color: '#000' }}>
                <CodeOutlined style={{ color: '#007AFF' }} /> HTML编辑器
              </span>
              <span style={{ fontSize: 12, color: '#8E8E93' }}>
                {editorReady ? '就绪' : '加载中...'}
              </span>
            </div>
            <div style={{ flex: 1, background: '#1e1e1e' }}>
              <Editor
                height="100%"
                language="html"
                theme={editorTheme}
                value={htmlContent}
                onChange={setHtmlContent}
                options={editorOptions}
                onMount={handleEditorDidMount}
                loading={
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'center', 
                    alignItems: 'center', 
                    height: '100%',
                    flexDirection: 'column',
                    gap: 16,
                    background: 'white'
                  }}>
                    <Spin size="large" />
                    <div style={{ color: '#8E8E93' }}>正在加载编辑器...</div>
                  </div>
                }
              />
            </div>
          </div>

          {/* 预览区域 */}
          <div style={iosStyles.previewSection}>
            <div style={iosStyles.editorHeader}>
              <span style={{ fontWeight: 600, fontSize: 15, color: '#000' }}>
                <EyeOutlined style={{ color: '#AF52DE' }} /> 实时预览
              </span>
              <span style={{ fontSize: 12, color: '#8E8E93' }}>
                {previewMode === 'desktop' ? '桌面' : 
                 previewMode === 'tablet' ? '平板' : '手机'}
              </span>
            </div>
            <div style={iosStyles.previewContent}>
              <div style={{
                ...iosStyles.previewFrame,
                width: previewMode === 'desktop' ? '100%' : 
                       previewMode === 'tablet' ? '768px' : '375px',
                height: '100%',
                maxHeight: '90%'
              }}>
                <iframe
                  title="preview"
                  srcDoc={compiledContent}
                  style={{ 
                    width: '100%', 
                    height: '100%', 
                    border: 'none',
                    display: 'block'
                  }}
                  sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"
                />
              </div>
            </div>
          </div>
        </Content>
      </Layout>

      {/* 创建项目弹窗 */}
      <Modal
        title="创建项目"
        open={showProjectModal}
        onOk={() => projectForm.submit()}
        onCancel={() => {
          setShowProjectModal(false);
          projectForm.resetFields();
        }}
        centered
      >
        <Form
          form={projectForm}
          layout="vertical"
          onFinish={handleCreateProject}
        >
          <Form.Item
            name="name"
            label="项目名称"
            rules={[{ required: true, message: '请输入项目名称' }]}
          >
            <Input placeholder="输入项目名称" style={{ borderRadius: 8 }} />
          </Form.Item>
          <Form.Item
            name="type"
            label="类型"
            initialValue="folder"
            hidden
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="description"
            label="描述"
          >
            <TextArea rows={3} placeholder="项目描述（可选）" style={{ borderRadius: 8 }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 创建页面弹窗 */}
      <Modal
        title={`在 "${selectedProject?.name}" 中创建页面`}
        open={showPageModal}
        onOk={() => pageForm.submit()}
        onCancel={() => {
          setShowPageModal(false);
          pageForm.resetFields();
        }}
        centered
        footer={[
          <Button key="cancel" onClick={() => {
            setShowPageModal(false);
            pageForm.resetFields();
          }}>
            取消
          </Button>,
          <Button 
            key="submit" 
            type="primary" 
            onClick={() => pageForm.submit()}
            icon={creditsConfig.credits_per_page > 0 ? <DollarOutlined /> : null}
            style={{
              background: 'linear-gradient(135deg, #34C759 0%, #30B854 100%)',
              border: 'none'
            }}
          >
            创建 ({formatCreditsDisplay(creditsConfig.credits_per_page)})
          </Button>
        ]}
      >
        <Form
          form={pageForm}
          layout="vertical"
          onFinish={handleCreatePage}
        >
          <Form.Item
            name="title"
            label="页面标题"
            tooltip="默认以当前时间命名，您可以修改为自己想要的标题"
          >
            <Input 
              placeholder="输入页面标题（可选）" 
              allowClear
              style={{ borderRadius: 8 }}
            />
          </Form.Item>
        </Form>
        {creditsConfig.credits_per_page > 0 && (
          <>
            <Divider />
            <Space direction="vertical" style={{ width: '100%' }}>
              <Text type="secondary">
                创建页面需要消耗 <Text strong>{creditsConfig.credits_per_page}</Text> 积分
              </Text>
              <Text type="secondary">
                您当前积分余额：<Text strong type={userCredits < creditsConfig.credits_per_page ? 'danger' : 'success'}>
                  {userCredits}
                </Text> 积分
              </Text>
            </Space>
          </>
        )}
      </Modal>

      {/* 重命名弹窗 */}
      <Modal
        title={renameType === 'project' ? '修改项目名称' : '修改页面名称'}
        open={showRenameModal}
        onOk={() => renameForm.submit()}
        onCancel={() => {
          setShowRenameModal(false);
          renameForm.resetFields();
          setRenameItem(null);
        }}
        centered
      >
        <Form
          form={renameForm}
          layout="vertical"
          onFinish={handleRename}
        >
          <Form.Item
            name="name"
            label={renameType === 'project' ? '项目名称' : '页面名称'}
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input placeholder="输入新名称" style={{ borderRadius: 8 }} />
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  );
};

export default HtmlEditor;
