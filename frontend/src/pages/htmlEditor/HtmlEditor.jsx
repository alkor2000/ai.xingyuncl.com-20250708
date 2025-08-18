/**
 * HTML编辑器主页面
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Layout,
  Tabs,
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
  Spin,
  Tooltip,
  Tag,
  Dropdown,
  Menu,
  Badge,
  Row,
  Col,
  Alert
} from 'antd';
import {
  FolderOutlined,
  FileOutlined,
  PlusOutlined,
  SaveOutlined,
  PlayCircleOutlined,
  EyeOutlined,
  SettingOutlined,
  CodeOutlined,
  GlobalOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderAddOutlined,
  FileAddOutlined,
  ReloadOutlined,
  CloudUploadOutlined,
  DownloadOutlined,
  HistoryOutlined,
  FileImageOutlined,
  VideoCameraOutlined,
  AudioOutlined,
  FileTextOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import useHtmlEditorStore from '../../stores/htmlEditorStore';
import useAuthStore from '../../stores/authStore';
import './HtmlEditor.less';

const { Sider, Content } = Layout;
const { TabPane } = Tabs;
const { TextArea } = Input;
const { Option } = Select;

const HtmlEditor = () => {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const {
    projects,
    pages,
    currentPage,
    templates,
    loading,
    getProjects,
    getPages,
    getTemplates,
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
  const [cssContent, setCssContent] = useState('');
  const [jsContent, setJsContent] = useState('');
  const [activeTab, setActiveTab] = useState('html');
  const [previewMode, setPreviewMode] = useState('desktop');
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [showPageModal, setShowPageModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [projectForm] = Form.useForm();
  const [pageForm] = Form.useForm();
  const [isSaving, setIsSaving] = useState(false);
  const [compiledContent, setCompiledContent] = useState('');

  // 初始化加载
  useEffect(() => {
    getProjects();
    getTemplates();
  }, []);

  // 加载选中页面的内容
  useEffect(() => {
    if (currentPage) {
      setHtmlContent(currentPage.html_content || '');
      setCssContent(currentPage.css_content || '');
      setJsContent(currentPage.js_content || '');
    } else {
      // 加载默认模板
      setHtmlContent(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>我的页面</title>
</head>
<body>
    <h1>欢迎使用HTML编辑器</h1>
    <p>开始创建你的精彩内容...</p>
</body>
</html>`);
      setCssContent(`body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    margin: 0;
    padding: 20px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    min-height: 100vh;
    color: white;
}

h1 {
    text-align: center;
    font-size: 2.5em;
    margin-bottom: 0.5em;
}

p {
    text-align: center;
    font-size: 1.2em;
    opacity: 0.9;
}`);
      setJsContent(`// 在这里编写JavaScript代码
console.log('页面加载完成');

// 示例：添加点击事件
document.addEventListener('DOMContentLoaded', function() {
    const h1 = document.querySelector('h1');
    if (h1) {
        h1.addEventListener('click', function() {
            alert('你点击了标题！');
        });
    }
});`);
    }
  }, [currentPage]);

  // 实时预览更新
  useEffect(() => {
    const compiled = compileContent();
    setCompiledContent(compiled);
  }, [htmlContent, cssContent, jsContent]);

  // 编译内容
  const compileContent = () => {
    // 如果HTML内容已经包含完整的HTML结构，直接使用
    if (htmlContent.includes('<!DOCTYPE') || htmlContent.includes('<html')) {
      // 找到</head>标签，插入CSS
      let compiled = htmlContent;
      if (cssContent) {
        const headEndIndex = compiled.toLowerCase().indexOf('</head>');
        if (headEndIndex > -1) {
          compiled = compiled.slice(0, headEndIndex) + 
            `\n<style>\n${cssContent}\n</style>\n` + 
            compiled.slice(headEndIndex);
        }
      }
      
      // 找到</body>标签，插入JS
      if (jsContent) {
        const bodyEndIndex = compiled.toLowerCase().lastIndexOf('</body>');
        if (bodyEndIndex > -1) {
          compiled = compiled.slice(0, bodyEndIndex) + 
            `\n<script>\n${jsContent}\n</script>\n` + 
            compiled.slice(bodyEndIndex);
        }
      }
      
      return compiled;
    } else {
      // 如果只有body内容，构建完整HTML
      return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>预览</title>
    <style>
${cssContent || ''}
    </style>
</head>
<body>
${htmlContent || ''}
    <script>
${jsContent || ''}
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
        css_content: cssContent,
        js_content: jsContent
      };
      
      const newPage = await createPage(pageData);
      message.success('页面创建成功');
      setShowPageModal(false);
      pageForm.resetFields();
      setSelectedPageId(newPage.id);
      
      // 刷新页面列表
      getPages(selectedProject.id);
    } catch (error) {
      message.error(error.message || '创建页面失败');
    }
  };

  // 保存页面
  const handleSavePage = async () => {
    if (!selectedPageId) {
      // 如果没有选中页面，弹出创建页面对话框
      setShowPageModal(true);
      return;
    }

    setIsSaving(true);
    try {
      await updatePage(selectedPageId, {
        html_content: htmlContent,
        css_content: cssContent,
        js_content: jsContent
      });
      message.success('页面保存成功');
    } catch (error) {
      message.error(error.message || '保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  // 选择模板
  const handleSelectTemplate = (template) => {
    setHtmlContent(template.html_template || '');
    setCssContent(template.css_template || '');
    setJsContent(template.js_template || '');
    setShowTemplateModal(false);
    message.success('模板已加载');
  };

  // 发布/取消发布页面
  const handleTogglePublish = async (pageId) => {
    try {
      const result = await togglePublish(pageId);
      if (result.is_published) {
        const publishUrl = `${window.location.origin}/pages/${user.id}/${result.slug}`;
        Modal.success({
          title: '发布成功',
          content: (
            <div>
              <p>你的页面已发布，可以通过以下链接访问：</p>
              <Input.Group compact>
                <Input value={publishUrl} readOnly style={{ width: 'calc(100% - 32px)' }} />
                <Button 
                  icon={<CopyOutlined />}
                  onClick={() => {
                    navigator.clipboard.writeText(publishUrl);
                    message.success('链接已复制');
                  }}
                />
              </Input.Group>
            </div>
          ),
          okText: '打开页面',
          onOk: () => window.open(publishUrl, '_blank')
        });
      } else {
        message.success('页面已取消发布');
      }
      
      // 刷新页面列表
      if (selectedProject) {
        getPages(selectedProject.id);
      }
    } catch (error) {
      message.error('操作失败');
    }
  };

  // 构建文件树数据
  const buildTreeData = () => {
    if (!projects || projects.length === 0) return [];
    
    return projects.map(project => ({
      title: (
        <Space>
          {project.type === 'folder' ? <FolderOutlined /> : <FileOutlined />}
          <span>{project.name}</span>
          {project.page_count > 0 && (
            <Badge count={project.page_count} style={{ backgroundColor: '#52c41a' }} />
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
  const handleTreeSelect = (selectedKeys, info) => {
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

  return (
    <Layout className="html-editor-container">
      {/* 左侧文件树 */}
      <Sider width={260} className="editor-sider">
        <div className="sider-header">
          <Space>
            <h3>项目管理</h3>
            <Dropdown
              overlay={
                <Menu>
                  <Menu.Item 
                    key="folder" 
                    icon={<FolderAddOutlined />}
                    onClick={() => {
                      projectForm.setFieldValue('type', 'folder');
                      setShowProjectModal(true);
                    }}
                  >
                    新建文件夹
                  </Menu.Item>
                  <Menu.Item 
                    key="page" 
                    icon={<FileAddOutlined />}
                    onClick={() => setShowPageModal(true)}
                  >
                    新建页面
                  </Menu.Item>
                </Menu>
              }
            >
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

        {/* 页面列表 */}
        {selectedProject && (
          <div className="page-list">
            <div className="list-header">
              <span>{selectedProject.name} 的页面</span>
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
                    actions={[
                      <Tooltip title="编辑" key="edit">
                        <EditOutlined />
                      </Tooltip>,
                      <Tooltip title={page.is_published ? '已发布' : '未发布'} key="publish">
                        <GlobalOutlined 
                          style={{ color: page.is_published ? '#52c41a' : '#999' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTogglePublish(page.id);
                          }}
                        />
                      </Tooltip>,
                      <Tooltip title="删除" key="delete">
                        <DeleteOutlined 
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
                    ]}
                  >
                    <Card.Meta
                      title={page.title}
                      description={
                        <Space direction="vertical" size={0}>
                          <small>{page.slug}</small>
                          {page.is_published && (
                            <Tag color="green" style={{ fontSize: '10px' }}>已发布</Tag>
                          )}
                        </Space>
                      }
                    />
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
      <Layout>
        <Content className="editor-content">
          {/* 工具栏 */}
          <div className="editor-toolbar">
            <Space>
              <Button 
                type="primary" 
                icon={<SaveOutlined />} 
                onClick={handleSavePage}
                loading={isSaving}
              >
                保存
              </Button>
              <Button
                icon={<FileTextOutlined />}
                onClick={() => setShowTemplateModal(true)}
              >
                选择模板
              </Button>
              <Select
                value={previewMode}
                onChange={setPreviewMode}
                style={{ width: 120 }}
              >
                <Option value="desktop">桌面</Option>
                <Option value="tablet">平板</Option>
                <Option value="mobile">手机</Option>
              </Select>
            </Space>
            
            {currentPage && (
              <Space>
                <Tag>版本: {currentPage.version}</Tag>
                <Tag>积分消耗: {currentPage.credits_consumed}</Tag>
                {currentPage.is_published && (
                  <Tag color="green">已发布</Tag>
                )}
              </Space>
            )}
          </div>

          {/* 编辑器和预览区 */}
          <Row gutter={16} className="editor-main">
            <Col span={12}>
              <Card className="editor-panel">
                <Tabs activeKey={activeTab} onChange={setActiveTab}>
                  <TabPane tab="HTML" key="html">
                    <TextArea
                      value={htmlContent}
                      onChange={(e) => setHtmlContent(e.target.value)}
                      style={{ 
                        height: 'calc(100vh - 250px)', 
                        fontFamily: 'monospace',
                        fontSize: '14px'
                      }}
                      placeholder="输入HTML代码..."
                    />
                  </TabPane>
                  <TabPane tab="CSS" key="css">
                    <TextArea
                      value={cssContent}
                      onChange={(e) => setCssContent(e.target.value)}
                      style={{ 
                        height: 'calc(100vh - 250px)', 
                        fontFamily: 'monospace',
                        fontSize: '14px'
                      }}
                      placeholder="输入CSS样式..."
                    />
                  </TabPane>
                  <TabPane tab="JavaScript" key="js">
                    <TextArea
                      value={jsContent}
                      onChange={(e) => setJsContent(e.target.value)}
                      style={{ 
                        height: 'calc(100vh - 250px)', 
                        fontFamily: 'monospace',
                        fontSize: '14px'
                      }}
                      placeholder="输入JavaScript代码..."
                    />
                  </TabPane>
                </Tabs>
              </Card>
            </Col>
            
            <Col span={12}>
              <Card className="preview-panel" title="实时预览">
                <div className={`preview-frame preview-${previewMode}`}>
                  <iframe
                    title="preview"
                    className="preview-iframe"
                    srcDoc={compiledContent}
                    sandbox="allow-scripts allow-forms allow-modals allow-popups"
                    style={{
                      width: '100%',
                      height: '100%',
                      border: 'none',
                      background: 'white'
                    }}
                  />
                </div>
              </Card>
            </Col>
          </Row>
        </Content>
      </Layout>

      {/* 创建项目弹窗 */}
      <Modal
        title="创建项目"
        visible={showProjectModal}
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
            <Select>
              <Option value="folder">文件夹</Option>
              <Option value="page">页面</Option>
            </Select>
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
        visible={showPageModal}
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

      {/* 模板选择弹窗 */}
      <Modal
        title="选择模板"
        visible={showTemplateModal}
        width={800}
        footer={null}
        onCancel={() => setShowTemplateModal(false)}
      >
        <Row gutter={[16, 16]}>
          {templates.map(template => (
            <Col span={8} key={template.id}>
              <Card
                hoverable
                className="template-card"
                onClick={() => handleSelectTemplate(template)}
              >
                <Card.Meta
                  title={template.name}
                  description={template.description}
                />
                <div className="template-category">
                  <Tag>{template.category}</Tag>
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      </Modal>
    </Layout>
  );
};

export default HtmlEditor;
