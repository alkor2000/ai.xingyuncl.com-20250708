/**
 * HTML编辑器主页面 - 精简版本
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
  Divider
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
  GlobalOutlined
} from '@ant-design/icons';
import Editor from '@monaco-editor/react';
import { useTranslation } from 'react-i18next';
import useHtmlEditorStore from '../../stores/htmlEditorStore';
import useAuthStore from '../../stores/authStore';
import './HtmlEditor.less';

const { Sider, Content, Header } = Layout;
const { TextArea } = Input;

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
    loadPage
  } = useHtmlEditorStore();

  // 状态
  const [selectedProject, setSelectedProject] = useState(null);
  const [selectedPageId, setSelectedPageId] = useState(null);
  const [htmlContent, setHtmlContent] = useState('');
  const [previewMode, setPreviewMode] = useState('desktop');
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [showPageModal, setShowPageModal] = useState(false);
  const [projectForm] = Form.useForm();
  const [pageForm] = Form.useForm();
  const [isSaving, setIsSaving] = useState(false);
  const [compiledContent, setCompiledContent] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [editorTheme, setEditorTheme] = useState('vs-dark');

  // 初始化加载
  useEffect(() => {
    getProjects();
  }, []);

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
            `\n<style>\n${css}\n</style>\n` +
            compiled.slice(headEndIndex);
        }
      }
      
      if (js) {
        const bodyEndIndex = compiled.toLowerCase().lastIndexOf('</body>');
        if (bodyEndIndex > -1) {
          compiled = compiled.slice(0, bodyEndIndex) + 
            `\n<script>\n${js}\n</script>\n` + 
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

  // 创建页面
  const handleCreatePage = async (values) => {
    if (!selectedProject) {
      message.warning('请先选择一个项目');
      return;
    }

    try {
      const pageData = {
        ...values,
        project_id: selectedProject.id,
        html_content: htmlContent,
        css_content: '', // 保持空值以兼容后端
        js_content: ''   // 保持空值以兼容后端
      };
      
      const newPage = await createPage(pageData);
      message.success('页面创建成功');
      setShowPageModal(false);
      pageForm.resetFields();
      setSelectedPageId(newPage.id);
      
      getPages(selectedProject.id);
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

    setIsSaving(true);
    try {
      await updatePage(selectedPageId, {
        html_content: htmlContent,
        css_content: '', // 保持空值以兼容后端
        js_content: ''   // 保持空值以兼容后端
      });
      message.success('页面保存成功');
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

    try {
      const result = await togglePublish(selectedPageId);
      
      // 如果页面未发布，先发布
      if (!result.is_published) {
        const publishResult = await togglePublish(selectedPageId);
        if (publishResult.is_published) {
          showPermalinkModal(publishResult);
        }
      } else {
        showPermalinkModal(result);
      }
    } catch (error) {
      message.error('生成链接失败');
    }
  };

  // 显示永久链接弹窗
  const showPermalinkModal = (page) => {
    const publishUrl = `${window.location.origin}/pages/${user.id}/${page.slug}`;
    
    Modal.success({
      title: '永久链接已生成',
      content: (
        <div>
          <p>你的页面已发布，可以通过以下链接访问：</p>
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
              保存
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
              生成永久链接
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
                          <Tooltip title={page.is_published ? '已发布' : '未发布'}>
                            <Button
                              type="text"
                              size="small"
                              icon={<GlobalOutlined />}
                              style={{ color: page.is_published ? '#52c41a' : '#999' }}
                              onClick={(e) => {
                                e.stopPropagation();
                                showPermalinkModal(page);
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
      </Modal>
    </Layout>
  );
};

export default HtmlEditor;
