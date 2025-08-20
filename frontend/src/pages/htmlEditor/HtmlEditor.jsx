/**
 * HTML编辑器主页面 - 增强版本（支持文件夹删除）
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
  Typography
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
  EyeOutlined
} from '@ant-design/icons';
import Editor from '@monaco-editor/react';
import { useTranslation } from 'react-i18next';
import useHtmlEditorStore from '../../stores/htmlEditorStore';
import useAuthStore from '../../stores/authStore';
import apiClient from '../../utils/api';
import './HtmlEditor.less';

const { Sider, Content, Header } = Layout;
const { TextArea } = Input;
const { Text } = Typography;

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

  // 状态
  const [selectedProject, setSelectedProject] = useState(null);
  const [selectedPageId, setSelectedPageId] = useState(null);
  const [htmlContent, setHtmlContent] = useState('');
  const [previewMode, setPreviewMode] = useState('desktop');
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [showPageModal, setShowPageModal] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameType, setRenameType] = useState(''); // 'project' or 'page'
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
        setSelectedProject(defaultProject);
        getPages(defaultProject.id);
        setDefaultProjectSelected(true);
      }
    }
  }, [projects, defaultProjectSelected, selectedProject]);

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
      // 如果页面有完整HTML内容，使用它；否则尝试编译旧格式的内容
      if (currentPage.html_content) {
        setHtmlContent(currentPage.html_content);
      } else if (currentPage.compiled_content) {
        setHtmlContent(currentPage.compiled_content);
      } else {
        // 兼容旧数据：如果有分离的CSS/JS，编译它们
        const compiled = compileOldContent(
          currentPage.html_content || '',
          currentPage.css_content || '',
          currentPage.js_content || ''
        );
        setHtmlContent(compiled);
      }
    } else {
      // 加载默认模板
      setHtmlContent(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>我的页面</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .container {
            text-align: center;
            padding: 40px;
            background: rgba(255, 255, 255, 0.95);
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            max-width: 600px;
        }
        h1 {
            color: #333;
            font-size: 2.5em;
            margin-bottom: 0.5em;
        }
        p {
            color: #666;
            font-size: 1.2em;
            margin-bottom: 1.5em;
        }
        button {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 12px 30px;
            font-size: 16px;
            border-radius: 25px;
            cursor: pointer;
            transition: transform 0.3s ease;
        }
        button:hover {
            transform: scale(1.05);
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>欢迎使用HTML编辑器</h1>
        <p>开始创建你的精彩内容...</p>
        <button onclick="alert('欢迎使用HTML编辑器！')">点击我</button>
    </div>
</body>
</html>`);
    }
  }, [currentPage]);

  // 实时预览更新
  useEffect(() => {
    setCompiledContent(htmlContent);
  }, [htmlContent]);

  // 编译旧格式内容（用于兼容旧数据）
  const compileOldContent = (html, css, js) => {
    if (html && (html.includes('<!DOCTYPE') || html.includes('<html'))) {
      let compiled = html;
      
      if (css) {
        const headEndIndex = compiled.toLowerCase().indexOf('</head>');
        if (headEndIndex > -1) {
          compiled = compiled.slice(0, headEndIndex) + 
            `\\n<style>\\n${css}\\n</style>\\n` +
            compiled.slice(headEndIndex);
        }
      }
      
      if (js) {
        const bodyEndIndex = compiled.toLowerCase().lastIndexOf('</body>');
        if (bodyEndIndex > -1) {
          compiled = compiled.slice(0, bodyEndIndex) + 
            `\\n<script>\\n${js}\\n</script>\\n` + 
            compiled.slice(bodyEndIndex);
        }
      }
      
      return compiled;
    } else {
      return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>预览</title>
    <style>
${css || ''}
    </style>
</head>
<body>
${html || ''}
    <script>
${js || ''}
    </script>
</body>
</html>`;
    }
  };

  // 预览页面（新窗口）
  const handlePreview = () => {
    if (!htmlContent) {
      message.warning('编辑器内容为空');
      return;
    }

    // 创建Blob URL
    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    
    // 在新窗口打开
    const previewWindow = window.open(url, '_blank');
    
    // 清理URL（延迟执行，确保窗口已打开）
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

  // 编辑项目名称
  const handleEditProject = (project) => {
    setRenameType('project');
    setRenameItem(project);
    renameForm.setFieldsValue({ name: project.name });
    setShowRenameModal(true);
  };

  // 删除文件夹
  const handleDeleteProject = (project) => {
    // 检查是否为默认项目
    if (project.is_default === 1 || project.name === '默认项目') {
      message.warning('默认项目不能删除');
      return;
    }

    Modal.confirm({
      title: '确认删除',
      content: (
        <div>
          <p>确定要删除文件夹 "{project.name}" 吗？</p>
          <p style={{ color: '#ff4d4f', marginTop: 8 }}>
            注意：只能删除空文件夹。如果文件夹内有页面或子文件夹，请先删除它们。
          </p>
        </div>
      ),
      okText: '确定删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteProject(project.id);
          message.success('文件夹删除成功');
          
          // 如果删除的是当前选中的项目，清空选择
          if (selectedProject?.id === project.id) {
            setSelectedProject(null);
          }
          
          // 刷新项目列表
          await getProjects();
        } catch (error) {
          // 显示具体的错误信息
          const errorMsg = error.response?.data?.message || '删除文件夹失败';
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

  // 创建页面
  const handleCreatePage = async (values) => {
    // 如果没有选择项目，使用默认项目
    let projectId = selectedProject?.id;
    
    if (!projectId) {
      const defaultProject = projects.find(p => p.name === '默认项目' || p.is_default === 1);
      if (defaultProject) {
        projectId = defaultProject.id;
        setSelectedProject(defaultProject);
      } else {
        message.warning('系统正在创建默认项目，请稍后再试');
        await getProjects();
        return;
      }
    }

    // 检查积分（只有积分大于0时才检查）
    if (creditsConfig.credits_per_page > 0 && userCredits < creditsConfig.credits_per_page) {
      message.error(`积分不足！创建页面需要 ${creditsConfig.credits_per_page} 积分，当前余额 ${userCredits} 积分`);
      return;
    }

    try {
      const pageData = {
        ...values,
        project_id: projectId,
        html_content: htmlContent,
        css_content: '', // 保持空值以兼容后端
        js_content: ''   // 保持空值以兼容后端
      };
      
      const newPage = await createPage(pageData);
      message.success('页面创建成功');
      setShowPageModal(false);
      pageForm.resetFields();
      setSelectedPageId(newPage.id);
      
      getPages(projectId);
      fetchUserCredits(); // 刷新积分
    } catch (error) {
      message.error(error.message || '创建页面失败');
    }
  };

  // 保存页面
  const handleSavePage = async () => {
    if (!selectedPageId) {
      setShowPageModal(true);
      return;
    }

    // 检查积分（只有积分大于0时才检查）
    if (creditsConfig.credits_per_update > 0 && userCredits < creditsConfig.credits_per_update) {
      message.error(`积分不足！保存页面需要 ${creditsConfig.credits_per_update} 积分，当前余额 ${userCredits} 积分`);
      return;
    }

    setIsSaving(true);
    try {
      await updatePage(selectedPageId, {
        html_content: htmlContent,
        css_content: '', // 保持空值以兼容后端
        js_content: ''   // 保持空值以兼容后端
      });
      message.success('页面保存成功');
      fetchUserCredits(); // 刷新积分
    } catch (error) {
      message.error(error.message || '保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  // 复制内容到剪贴板
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

  // 清空编辑器内容
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

    // 检查当前页面是否已发布
    const currentPageData = pages.find(p => p.id === selectedPageId);
    if (currentPageData?.is_published) {
      // 如果已发布，直接显示链接
      showPermalinkModal(currentPageData);
      return;
    }

    // 检查积分（只有积分大于0时才检查）
    if (creditsConfig.credits_per_publish > 0 && userCredits < creditsConfig.credits_per_publish) {
      Modal.confirm({
        title: '积分不足',
        content: (
          <div>
            <p>生成永久链接需要 <Text strong>{creditsConfig.credits_per_publish}</Text> 积分</p>
            <p>您当前积分余额：<Text type="danger">{userCredits}</Text> 积分</p>
            <p>请联系管理员充值积分后再试。</p>
          </div>
        ),
        okText: '我知道了',
        cancelText: '取消',
        onOk: () => {}
      });
      return;
    }

    // 显示确认弹窗
    const confirmContent = creditsConfig.credits_per_publish > 0 ? (
      <div>
        <p>生成永久链接将消耗 <Text strong type="warning">{creditsConfig.credits_per_publish}</Text> 积分</p>
        <p>您当前积分余额：<Text strong>{userCredits}</Text> 积分</p>
        <p>生成后剩余：<Text strong>{userCredits - creditsConfig.credits_per_publish}</Text> 积分</p>
        <Divider />
        <p><Text type="secondary">提示：生成永久链接后，您的页面将可以通过固定URL访问</Text></p>
      </div>
    ) : (
      <div>
        <p><Text strong>生成永久链接（免费）</Text></p>
        <Divider />
        <p><Text type="secondary">提示：生成永久链接后，您的页面将可以通过固定URL访问</Text></p>
      </div>
    );

    Modal.confirm({
      title: '确认生成永久链接',
      content: confirmContent,
      okText: '确认生成',
      cancelText: '取消',
      onOk: async () => {
        try {
          const result = await togglePublish(selectedPageId);
          if (result.is_published) {
            showPermalinkModal(result);
            fetchUserCredits(); // 刷新积分
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

  // 构建文件树数据
  const buildTreeData = () => {
    if (!projects || projects.length === 0) return [];
    
    return projects.map(project => ({
      title: (
        <Space size={4}>
          {project.type === 'folder' ? <FolderOutlined /> : <FileOutlined />}
          <span>{project.name}</span>
          {(project.is_default === 1 || project.name === '默认项目') && (
            <Tag color="blue" style={{ marginLeft: 4 }}>默认</Tag>
          )}
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              handleEditProject(project);
            }}
          />
          {/* 添加删除按钮（非默认文件夹） */}
          {project.type === 'folder' && project.is_default !== 1 && project.name !== '默认项目' && (
            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteProject(project);
              }}
            />
          )}
        </Space>
      ),
      key: `project-${project.id}`,
      children: project.children?.map(child => ({
        title: child.name,
        key: `project-${child.id}`,
        isLeaf: child.type === 'page'
      })) || []
    }));
  };

  // 选择树节点
  const handleTreeSelect = (selectedKeys) => {
    if (selectedKeys.length > 0) {
      const key = selectedKeys[0];
      if (key.startsWith('project-')) {
        const projectId = parseInt(key.replace('project-', ''));
        const project = projects.find(p => p.id === projectId);
        setSelectedProject(project);
        getPages(projectId);
      }
    }
  };

  // Monaco编辑器配置
  const editorOptions = {
    minimap: { enabled: false },
    fontSize: 14,
    fontFamily: 'Consolas, Monaco, monospace',
    formatOnPaste: true,
    formatOnType: true,
    automaticLayout: true,
    tabSize: 2,
    wordWrap: 'on',
    scrollBeyondLastLine: false
  };

  // Dropdown菜单项 - Antd 5.x 格式
  const projectMenuItems = [
    {
      key: 'folder',
      icon: <FolderAddOutlined />,
      label: '新建文件夹',
      onClick: () => {
        projectForm.setFieldValue('type', 'folder');
        setShowProjectModal(true);
      }
    },
    {
      key: 'page',
      icon: <FileAddOutlined />,
      label: '新建页面',
      onClick: () => setShowPageModal(true)
    }
  ];

  return (
    <Layout className="html-editor-container">
      {/* 顶部工具栏 */}
      <Header className="editor-header">
        <div className="header-left">
          <Space>
            <Button
              icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            />
            <Button 
              type="primary" 
              icon={<SaveOutlined />} 
              onClick={handleSavePage}
              loading={isSaving}
            >
              保存 ({formatCreditsDisplay(creditsConfig.credits_per_update)})
            </Button>
            <Button
              icon={<EyeOutlined />}
              onClick={handlePreview}
            >
              预览
            </Button>
            <Button
              icon={<CopyOutlined />}
              onClick={handleCopyContent}
            >
              复制
            </Button>
            <Button
              icon={<ClearOutlined />}
              onClick={handleClearContent}
            >
              清空
            </Button>
            <Button
              icon={<LinkOutlined />}
              onClick={handleGeneratePermalink}
              disabled={!selectedPageId}
            >
              生成永久链接 ({formatCreditsDisplay(creditsConfig.credits_per_publish)})
            </Button>
          </Space>
        </div>
        
        <div className="header-center">
          {currentPage && (
            <Space>
              <Tag color="blue">{currentPage.title}</Tag>
              {currentPage.is_published && <Tag color="green">已发布</Tag>}
            </Space>
          )}
        </div>
        
        <div className="header-right">
          <Space>
            <Tag icon={<DollarOutlined />} color="gold">
              积分余额: {userCredits}
            </Tag>
            <Select
              value={previewMode}
              onChange={setPreviewMode}
              style={{ width: 120 }}
              options={[
                { value: 'desktop', label: '桌面' },
                { value: 'tablet', label: '平板' },
                { value: 'mobile', label: '手机' }
              ]}
            />
            <Select
              value={editorTheme}
              onChange={setEditorTheme}
              style={{ width: 100 }}
              options={[
                { value: 'vs-dark', label: '暗色' },
                { value: 'vs-light', label: '亮色' }
              ]}
            />
          </Space>
        </div>
      </Header>

      <Layout>
        {/* 左侧文件树 */}
        <Sider 
          width={260} 
          className="editor-sider"
          collapsed={sidebarCollapsed}
          collapsedWidth={0}
        >
          <div className="sider-header">
            <Space>
              <h3>项目管理</h3>
              <Dropdown menu={{ items: projectMenuItems }}>
                <Button type="primary" size="small" icon={<PlusOutlined />} />
              </Dropdown>
            </Space>
          </div>
          
          <div className="project-tree">
            {projects.length > 0 ? (
              <Tree
                treeData={buildTreeData()}
                onSelect={handleTreeSelect}
                defaultExpandAll
                selectedKeys={selectedProject ? [`project-${selectedProject.id}`] : []}
              />
            ) : (
              <Empty description="暂无项目" />
            )}
          </div>

          {selectedProject && (
            <div className="page-list">
              <div className="list-header">
                <span>{selectedProject.name}</span>
                <Button 
                  type="link" 
                  size="small" 
                  icon={<ReloadOutlined />}
                  onClick={() => getPages(selectedProject.id)}
                />
              </div>
              <div className="list-content">
                {pages.length > 0 ? (
                  pages.map(page => (
                    <Card
                      key={page.id}
                      size="small"
                      className={`page-card ${selectedPageId === page.id ? 'active' : ''}`}
                      onClick={() => {
                        setSelectedPageId(page.id);
                        loadPage(page.id);
                      }}
                    >
                      <div className="page-card-content">
                        <div className="page-info">
                          <div className="page-title">{page.title}</div>
                          <div className="page-slug">{page.slug}</div>
                        </div>
                        <Space size={4}>
                          <Tooltip title="编辑名称">
                            <Button
                              type="text"
                              size="small"
                              icon={<EditOutlined />}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEditPage(page);
                              }}
                            />
                          </Tooltip>
                          <Tooltip title={page.is_published ? '已发布' : '点击发布'}>
                            <Button
                              type="text"
                              size="small"
                              icon={<GlobalOutlined />}
                              style={{ color: page.is_published ? '#52c41a' : '#999' }}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (page.is_published) {
                                  showPermalinkModal(page);
                                } else {
                                  setSelectedPageId(page.id);
                                  handleGeneratePermalink();
                                }
                              }}
                            />
                          </Tooltip>
                          <Tooltip title="删除">
                            <Button
                              type="text"
                              size="small"
                              danger
                              icon={<DeleteOutlined />}
                              onClick={(e) => {
                                e.stopPropagation();
                                Modal.confirm({
                                  title: '确认删除',
                                  content: '确定要删除这个页面吗？',
                                  onOk: async () => {
                                    await deletePage(page.id);
                                    if (selectedPageId === page.id) {
                                      setSelectedPageId(null);
                                    }
                                    getPages(selectedProject.id);
                                  }
                                });
                              }}
                            />
                          </Tooltip>
                        </Space>
                      </div>
                    </Card>
                  ))
                ) : (
                  <Empty description="暂无页面" />
                )}
              </div>
            </div>
          )}
        </Sider>

        {/* 主编辑区 */}
        <Content className="editor-content">
          <div className="editor-container">
            {/* 编辑器区域 */}
            <div className="code-editor-section">
              <div className="editor-header-bar">
                <span className="editor-title">HTML编辑器</span>
                <span className="editor-hint">粘贴完整的HTML代码</span>
              </div>
              <Editor
                height="calc(100vh - 200px)"
                language="html"
                theme={editorTheme}
                value={htmlContent}
                onChange={setHtmlContent}
                options={editorOptions}
              />
            </div>

            {/* 预览区域 */}
            <div className="preview-section">
              <div className="preview-header">
                <span>实时预览</span>
              </div>
              <div className={`preview-frame preview-${previewMode}`}>
                <iframe
                  title="preview"
                  className="preview-iframe"
                  srcDoc={compiledContent}
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
            <Input placeholder="输入项目名称" />
          </Form.Item>
          <Form.Item
            name="type"
            label="类型"
            initialValue="folder"
          >
            <Select
              options={[
                { value: 'folder', label: '文件夹' },
                { value: 'page', label: '页面' }
              ]}
            />
          </Form.Item>
          <Form.Item
            name="description"
            label="描述"
          >
            <TextArea rows={3} placeholder="项目描述（可选）" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 创建页面弹窗 */}
      <Modal
        title="创建页面"
        open={showPageModal}
        onOk={() => pageForm.submit()}
        onCancel={() => {
          setShowPageModal(false);
          pageForm.resetFields();
        }}
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
            rules={[{ required: true, message: '请输入页面标题' }]}
          >
            <Input placeholder="输入页面标题" />
          </Form.Item>
          <Form.Item
            name="slug"
            label="URL路径"
            tooltip="留空将自动生成"
          >
            <Input placeholder="例如: my-page" />
          </Form.Item>
        </Form>
        <Divider />
        <Space direction="vertical" style={{ width: '100%' }}>
          {creditsConfig.credits_per_page > 0 ? (
            <>
              <Text type="secondary">
                创建页面需要消耗 <Text strong>{creditsConfig.credits_per_page}</Text> 积分
              </Text>
              <Text type="secondary">
                您当前积分余额：<Text strong type={userCredits < creditsConfig.credits_per_page ? 'danger' : 'success'}>
                  {userCredits}
                </Text> 积分
              </Text>
            </>
          ) : (
            <Text type="success">
              <strong>创建页面免费！</strong>
            </Text>
          )}
        </Space>
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
            <Input placeholder="输入新名称" />
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  );
};

export default HtmlEditor;
