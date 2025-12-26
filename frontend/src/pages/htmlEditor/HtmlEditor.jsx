/**
 * HTML编辑器主页面 - 简化Monaco加载版本
 * 
 * 修改：移除手动Monaco加载逻辑，让@monaco-editor/react自动处理
 * 支持国际化(i18n)
 * 
 * v1.1 修复右键菜单Paste不生效问题 - 2025-12-26
 *   - Monaco内置粘贴使用已废弃的execCommand，现代浏览器受限
 *   - 添加自定义粘贴Action使用Clipboard API
 */

import React, { useState, useEffect } from 'react';
import {
  Layout,
  Button,
  Space,
  message,
  Modal,
  Form,
  Input,
  Select,
  Empty,
  Tag,
  Divider,
  Typography,
  Spin
} from 'antd';
import {
  FolderOutlined,
  PlusOutlined,
  SaveOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  FileAddOutlined,
  FileTextOutlined,
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
  CheckCircleOutlined,
  LoadingOutlined
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
const { Text } = Typography;

const HtmlEditor = () => {
  const { t } = useTranslation();
  const { user, getCurrentUser } = useAuthStore();
  const {
    projects,
    pages,
    currentPage,
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

  // 简单的空白HTML模板
  const BLANK_HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${t('htmlEditor.newPage')}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
            padding: 20px;
            line-height: 1.6;
        }
    </style>
</head>
<body>
    <h1>${t('htmlEditor.startCreate')}</h1>
    <p>${t('htmlEditor.blankPage')}</p>
</body>
</html>`;

  // 生成带时间戳的页面标题
  const generateTimestampTitle = () => {
    const now = moment();
    return `${t('htmlEditor.page')}_${now.format('YYYYMMDD_HHmmss')}`;
  };

  // 状态管理
  const [selectedProject, setSelectedProject] = useState(null);
  const [selectedPageId, setSelectedPageId] = useState(null);
  const [htmlContent, setHtmlContent] = useState(BLANK_HTML_TEMPLATE);
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
  const [creditsLoading, setCreditsLoading] = useState(true);
  const [defaultProjectSelected, setDefaultProjectSelected] = useState(false);
  const [editorReady, setEditorReady] = useState(false);
  const [loadingPages, setLoadingPages] = useState(false);
  const [autoPageCreated, setAutoPageCreated] = useState(false);

  // 初始化加载
  useEffect(() => {
    getProjects();
    initializeCredits();
  }, []);

  // 监听user变化，自动更新积分
  useEffect(() => {
    if (user) {
      updateUserCredits();
    }
  }, [user]);

  // 初始化积分信息
  const initializeCredits = async () => {
    setCreditsLoading(true);
    try {
      await Promise.all([
        fetchCreditsConfig(),
        getCurrentUser()
      ]);
      updateUserCredits();
    } catch (error) {
      console.error('初始化积分信息失败:', error);
      updateUserCredits();
    } finally {
      setCreditsLoading(false);
    }
  };

  // 从authStore更新用户积分
  const updateUserCredits = () => {
    if (user) {
      let credits = 0;
      if (user.credits_stats && typeof user.credits_stats.remaining !== 'undefined') {
        credits = user.credits_stats.remaining;
      } else if (typeof user.credits_quota !== 'undefined' && typeof user.used_credits !== 'undefined') {
        credits = (user.credits_quota || 0) - (user.used_credits || 0);
      } else if (typeof user.credits !== 'undefined') {
        credits = user.credits;
      }
      setUserCredits(Math.max(0, credits));
    }
  };

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
        return response.data.data;
      }
    } catch (error) {
      console.error(t('htmlEditor.credits.configFailed'), error);
    }
    return null;
  };

  // 刷新用户积分
  const refreshUserCredits = async () => {
    try {
      await getCurrentUser();
      updateUserCredits();
    } catch (error) {
      console.error(t('htmlEditor.credits.refreshFailed'), error);
    }
  };

  // 格式化积分显示
  const formatCreditsDisplay = (credits) => {
    return credits === 0 ? t('htmlEditor.credits.free') : t('htmlEditor.credits.required', { credits });
  };

  const formatCreditsDisplayForSave = (credits) => {
    return credits === 0 ? '' : `(${credits} ${t('htmlEditor.credits.creditsUnit')})`;
  };

  // 检查积分
  const canPerformCreditAction = (requiredCredits, actionName) => {
    if (creditsLoading) {
      message.warning(t('htmlEditor.credits.loading'));
      return false;
    }
    if (requiredCredits > 0 && userCredits < requiredCredits) {
      message.error(t('htmlEditor.credits.insufficient', {
        action: actionName,
        required: requiredCredits,
        current: userCredits
      }));
      return false;
    }
    return true;
  };

  // 加载选中页面的内容
  useEffect(() => {
    if (currentPage) {
      if (currentPage.html_content !== undefined && currentPage.html_content !== null) {
        setHtmlContent(currentPage.html_content);
      } else if (currentPage.compiled_content) {
        setHtmlContent(currentPage.compiled_content);
      } else {
        setHtmlContent(BLANK_HTML_TEMPLATE);
      }
    }
  }, [currentPage, BLANK_HTML_TEMPLATE]);

  // 实时预览更新
  useEffect(() => {
    setCompiledContent(htmlContent || `<!DOCTYPE html><html><body style="padding:20px;color:#999;font-family:system-ui;">${t('htmlEditor.editor.startWriting')}</body></html>`);
  }, [htmlContent, t]);

  // 自动创建或选择页面
  const autoHandlePage = async (projectId) => {
    if (autoPageCreated) return;
    
    setLoadingPages(true);
    try {
      await getPages(projectId);
      
      setTimeout(async () => {
        const currentPages = useHtmlEditorStore.getState().pages;
        
        if (currentPages && currentPages.length > 0) {
          const firstPage = currentPages[0];
          setSelectedPageId(firstPage.id);
          await loadPage(firstPage.id);
          message.info(t('htmlEditor.page.loaded', { title: firstPage.title }));
        } else {
          if (creditsLoading) {
            setTimeout(() => autoHandlePage(projectId), 500);
            return;
          }
          
          setAutoPageCreated(true);
          const autoTitle = generateTimestampTitle();
          
          if (!canPerformCreditAction(creditsConfig.credits_per_page, t('htmlEditor.page.create'))) {
            message.warning(t('htmlEditor.credits.cannotAutoCreate'));
            setHtmlContent(BLANK_HTML_TEMPLATE);
            return;
          }
          
          try {
            const pageData = {
              title: autoTitle,
              project_id: projectId,
              html_content: BLANK_HTML_TEMPLATE,
              css_content: '',
              js_content: ''
            };
            
            const newPage = await createPage(pageData);
            message.success(t('htmlEditor.page.autoCreated', { title: autoTitle }));
            setSelectedPageId(newPage.id);
            await loadPage(newPage.id);
            setHtmlContent(BLANK_HTML_TEMPLATE);
            
            await getPages(projectId);
            await refreshUserCredits();
          } catch (error) {
            console.error('自动创建页面失败:', error);
            message.error(t('htmlEditor.page.createFailed'));
            setHtmlContent(BLANK_HTML_TEMPLATE);
          }
        }
      }, 300);
      
    } finally {
      setLoadingPages(false);
    }
  };

  // 预览页面
  const handlePreview = () => {
    if (!htmlContent) {
      message.warning(t('htmlEditor.editor.empty'));
      return;
    }

    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    message.success(t('htmlEditor.editor.previewOpened'));
  };

  // 创建项目
  const handleCreateProject = async (values) => {
    try {
      await createProject(values);
      message.success(t('htmlEditor.project.createSuccess'));
      setShowProjectModal(false);
      projectForm.resetFields();
    } catch (error) {
      message.error(t('htmlEditor.project.createFailed'));
    }
  };

  // 选择项目
  const handleSelectProject = async (project) => {
    setSelectedProject(project);
    setSelectedPageId(null);
    setHtmlContent(BLANK_HTML_TEMPLATE);
    setAutoPageCreated(false);
    await autoHandlePage(project.id);
  };

  // 编辑项目
  const handleEditProject = (project) => {
    setRenameType('project');
    setRenameItem(project);
    renameForm.setFieldsValue({ name: project.name });
    setShowRenameModal(true);
  };

  // 删除项目
  const handleDeleteProject = (project) => {
    if (project.is_default === 1 || project.name === '默认项目') {
      message.warning(t('htmlEditor.project.defaultCannotDelete'));
      return;
    }

    Modal.confirm({
      title: t('htmlEditor.project.deleteConfirm'),
      content: (
        <div>
          <p>{t('htmlEditor.project.deleteContent', { name: project.name })}</p>
          <p style={{ color: '#ff4d4f', marginTop: 8 }}>
            {t('htmlEditor.project.deleteWarning')}
          </p>
        </div>
      ),
      okText: t('htmlEditor.project.deleteButton'),
      okType: 'danger',
      cancelText: t('htmlEditor.action.cancel'),
      onOk: async () => {
        try {
          await deleteProject(project.id);
          message.success(t('htmlEditor.project.deleteSuccess'));
          
          if (selectedProject?.id === project.id) {
            setSelectedProject(null);
            setSelectedPageId(null);
            setHtmlContent(BLANK_HTML_TEMPLATE);
          }
          
          await getProjects();
        } catch (error) {
          message.error(error.response?.data?.message || t('htmlEditor.project.deleteFailed'));
        }
      }
    });
  };

  // 编辑页面
  const handleEditPage = (page) => {
    setRenameType('page');
    setRenameItem(page);
    renameForm.setFieldsValue({ name: page.title });
    setShowRenameModal(true);
  };

  // 重命名
  const handleRename = async (values) => {
    try {
      if (renameType === 'project') {
        await updateProject(renameItem.id, { name: values.name });
        message.success(t('htmlEditor.project.renameSuccess'));
        await getProjects();
      } else if (renameType === 'page') {
        await updatePage(renameItem.id, { title: values.name });
        message.success(t('htmlEditor.page.renameSuccess'));
        await getPages(selectedProject?.id);
        if (renameItem.id === selectedPageId) {
          await loadPage(renameItem.id);
        }
      }
      setShowRenameModal(false);
      renameForm.resetFields();
      setRenameItem(null);
    } catch (error) {
      message.error(t('htmlEditor.project.createFailed'));
    }
  };

  // 打开创建页面弹窗
  const handleOpenPageModal = () => {
    pageForm.setFieldsValue({ title: generateTimestampTitle() });
    setShowPageModal(true);
  };

  // 创建页面
  const handleCreatePage = async (values) => {
    if (!selectedProject) {
      message.warning(t('htmlEditor.page.selectFirst'));
      return;
    }

    if (!canPerformCreditAction(creditsConfig.credits_per_page, t('htmlEditor.page.create'))) {
      return;
    }

    try {
      const pageData = {
        title: values.title || generateTimestampTitle(),
        project_id: selectedProject.id,
        html_content: BLANK_HTML_TEMPLATE,
        css_content: '',
        js_content: ''
      };
      
      const newPage = await createPage(pageData);
      message.success(t('htmlEditor.page.createSuccess'));
      setShowPageModal(false);
      pageForm.resetFields();
      setSelectedPageId(newPage.id);
      loadPage(newPage.id);
      setHtmlContent(BLANK_HTML_TEMPLATE);
      
      await getPages(selectedProject.id);
      await refreshUserCredits();
    } catch (error) {
      message.error(error.message || t('htmlEditor.page.createFailed'));
    }
  };

  // 保存页面
  const handleSavePage = async () => {
    if (!selectedPageId) {
      message.warning(t('htmlEditor.page.selectFirst'));
      return;
    }

    if (!canPerformCreditAction(creditsConfig.credits_per_update, t('htmlEditor.credits.perUpdate'))) {
      return;
    }

    setIsSaving(true);
    try {
      await updatePage(selectedPageId, {
        html_content: htmlContent,
        css_content: '',
        js_content: ''
      });
      message.success(t('htmlEditor.page.saveSuccess'));
      await refreshUserCredits();
      await getPages(selectedProject?.id);
    } catch (error) {
      message.error(error.message || t('htmlEditor.page.saveFailed'));
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
      title: t('htmlEditor.project.deleteConfirm'),
      content: t('htmlEditor.page.deleteConfirm', { title: page.title }),
      okText: t('htmlEditor.project.deleteButton'),
      okType: 'danger',
      cancelText: t('htmlEditor.action.cancel'),
      onOk: async () => {
        try {
          await deletePage(page.id);
          message.success(t('htmlEditor.page.deleteSuccess'));
          if (selectedPageId === page.id) {
            setSelectedPageId(null);
            setHtmlContent(BLANK_HTML_TEMPLATE);
            
            const remainingPages = pages.filter(p => p.id !== page.id);
            if (remainingPages.length === 0 && selectedProject) {
              setAutoPageCreated(false);
              await autoHandlePage(selectedProject.id);
            }
          }
          await getPages(selectedProject.id);
        } catch (error) {
          message.error(t('htmlEditor.page.deleteFailed'));
        }
      }
    });
  };

  // 复制内容
  const handleCopyContent = () => {
    if (!htmlContent) {
      message.warning(t('htmlEditor.editor.empty'));
      return;
    }
    navigator.clipboard.writeText(htmlContent).then(() => {
      message.success(t('htmlEditor.editor.copied'));
    }).catch(() => {
      message.error(t('htmlEditor.editor.copyFailed'));
    });
  };

  // 清空
  const handleClearContent = () => {
    setHtmlContent('');
    message.success(t('htmlEditor.editor.cleared'));
  };

  // 生成永久链接
  const handleGeneratePermalink = async () => {
    if (!selectedPageId) {
      message.warning(t('htmlEditor.link.saveFirst'));
      return;
    }

    const currentPageData = pages.find(p => p.id === selectedPageId);
    if (currentPageData?.is_published) {
      showPermalinkModal(currentPageData);
      return;
    }

    if (!canPerformCreditAction(creditsConfig.credits_per_publish, t('htmlEditor.link.generate'))) {
      return;
    }

    Modal.confirm({
      title: t('htmlEditor.link.generate'),
      content: (
        <div>
          <p>{t('htmlEditor.link.generateConfirm')}</p>
          {creditsConfig.credits_per_publish > 0 && (
            <p>{t('htmlEditor.link.costCredits')} <Text strong type="warning">{creditsConfig.credits_per_publish}</Text> {t('htmlEditor.credits.creditsUnit')}</p>
          )}
        </div>
      ),
      okText: t('htmlEditor.link.confirmGenerate'),
      cancelText: t('htmlEditor.action.cancel'),
      onOk: async () => {
        try {
          const result = await togglePublish(selectedPageId);
          if (result.is_published) {
            showPermalinkModal(result);
            await refreshUserCredits();
          }
        } catch (error) {
          message.error(t('htmlEditor.link.generateFailed'));
        }
      }
    });
  };

  // 显示永久链接弹窗
  const showPermalinkModal = (page) => {
    const publishUrl = `${window.location.origin}/pages/${user.id}/${page.slug}`;
    
    Modal.success({
      title: t('htmlEditor.link.permanentLink'),
      width: 600,
      content: (
        <div>
          <p>{t('htmlEditor.link.yourLink')}</p>
          <Space.Compact style={{ width: '100%', marginTop: 10 }}>
            <Input value={publishUrl} readOnly />
            <Button 
              icon={<CopyOutlined />}
              onClick={() => {
                navigator.clipboard.writeText(publishUrl);
                message.success(t('htmlEditor.link.copied'));
              }}
            />
          </Space.Compact>
          <Divider />
          <Text type="secondary">{t('htmlEditor.link.tip')}</Text>
        </div>
      ),
      okText: t('htmlEditor.link.openPage'),
      onOk: () => window.open(publishUrl, '_blank')
    });
  };

  // Monaco配置
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
    guides: { indentation: true, bracketPairs: true },
    padding: { top: 16, bottom: 16 }
  };

  /**
   * 编辑器就绪回调
   * v1.1 修复右键菜单Paste不工作的问题
   * 
   * 问题原因：
   *   Monaco内置的粘贴命令使用已废弃的document.execCommand('paste')
   *   现代浏览器出于安全考虑限制了这个API
   *   而Ctrl+V使用的是浏览器原生paste事件，可以正常工作
   * 
   * 解决方案：
   *   添加自定义粘贴Action，使用现代的navigator.clipboard.readText() API
   */
  const handleEditorDidMount = (editor, monaco) => {
    setEditorReady(true);
    console.log('[HtmlEditor] Monaco编辑器已就绪');
    
    // ===== 修复右键菜单Paste不工作的问题 =====
    // 添加自定义粘贴Action到右键菜单
    editor.addAction({
      // Action的唯一标识
      id: 'custom-clipboard-paste',
      // 右键菜单中显示的标签
      label: '📋 粘贴 (Paste)',
      // 不需要快捷键，Ctrl+V已经能正常工作
      keybindings: [],
      // 放在剪贴板操作组（与Cut、Copy同组）
      contextMenuGroupId: '9_cutcopypaste',
      // 排序：放在Copy之后
      contextMenuOrder: 3,
      // 执行粘贴操作
      run: async (ed) => {
        try {
          // 使用现代Clipboard API读取剪贴板内容
          const text = await navigator.clipboard.readText();
          if (text) {
            // 获取当前选区
            const selection = ed.getSelection();
            // 执行编辑操作：替换选区内容为剪贴板文本
            ed.executeEdits('custom-paste', [{
              range: selection,
              text: text,
              forceMoveMarkers: true
            }]);
            // 聚焦编辑器
            ed.focus();
          }
        } catch (err) {
          // Clipboard API可能因权限问题失败
          console.error('[HtmlEditor] 剪贴板访问失败:', err);
          // 提示用户使用Ctrl+V
          message.warning(t('htmlEditor.editor.pasteFailedUseCtrlV', '右键粘贴失败，请使用 Ctrl+V'));
        }
      }
    });
    
    // 同样添加自定义复制Action（确保一致性）
    editor.addAction({
      id: 'custom-clipboard-copy',
      label: '📄 复制 (Copy)',
      keybindings: [],
      contextMenuGroupId: '9_cutcopypaste',
      contextMenuOrder: 2,
      run: async (ed) => {
        try {
          // 获取选中的文本
          const selection = ed.getSelection();
          const selectedText = ed.getModel().getValueInRange(selection);
          if (selectedText) {
            await navigator.clipboard.writeText(selectedText);
            message.success(t('htmlEditor.editor.copied', '已复制到剪贴板'));
          }
        } catch (err) {
          console.error('[HtmlEditor] 复制失败:', err);
          message.warning(t('htmlEditor.editor.copyFailedUseCtrlC', '复制失败，请使用 Ctrl+C'));
        }
      }
    });
    
    // 添加自定义剪切Action
    editor.addAction({
      id: 'custom-clipboard-cut',
      label: '✂️ 剪切 (Cut)',
      keybindings: [],
      contextMenuGroupId: '9_cutcopypaste',
      contextMenuOrder: 1,
      run: async (ed) => {
        try {
          // 获取选中的文本
          const selection = ed.getSelection();
          const selectedText = ed.getModel().getValueInRange(selection);
          if (selectedText) {
            // 复制到剪贴板
            await navigator.clipboard.writeText(selectedText);
            // 删除选中内容
            ed.executeEdits('custom-cut', [{
              range: selection,
              text: '',
              forceMoveMarkers: true
            }]);
            message.success(t('htmlEditor.editor.cut', '已剪切到剪贴板'));
          }
        } catch (err) {
          console.error('[HtmlEditor] 剪切失败:', err);
          message.warning(t('htmlEditor.editor.cutFailedUseCtrlX', '剪切失败，请使用 Ctrl+X'));
        }
      }
    });
  };

  // iOS风格样式
  const iosStyles = {
    container: { height: '100vh', background: '#F2F2F7' },
    header: { background: 'rgba(255, 255, 255, 0.98)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(60, 60, 67, 0.12)', height: 60, padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
    sidebar: { background: 'rgba(255, 255, 255, 0.98)', backdropFilter: 'blur(20px)', borderRight: '1px solid rgba(60, 60, 67, 0.12)' },
    sidebarContent: { height: 'calc(100vh - 60px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
    sidebarSection: { padding: '20px', borderBottom: '1px solid rgba(60, 60, 67, 0.08)', flexShrink: 0 },
    pageListSection: { padding: '20px', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' },
    pageListScrollContainer: { flex: 1, overflowY: 'auto', overflowX: 'hidden', paddingRight: '4px', minHeight: 0 },
    sectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
    sectionTitle: { fontSize: 17, fontWeight: 600, color: '#000', margin: 0, display: 'flex', alignItems: 'center', gap: 8 },
    projectItem: { padding: '10px 14px', cursor: 'pointer', borderRadius: 10, marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
    projectItemSelected: { background: 'linear-gradient(135deg, #007AFF 0%, #0051D5 100%)', color: 'white' },
    pageCard: { background: 'white', borderRadius: 10, padding: '12px 14px', marginBottom: 8, cursor: 'pointer', border: '1px solid rgba(60, 60, 67, 0.08)' },
    pageCardSelected: { border: '2px solid #007AFF', background: 'rgba(0, 122, 255, 0.02)' },
    editorSection: { flex: 1, display: 'flex', flexDirection: 'column', background: 'white', overflow: 'hidden' },
    editorHeader: { padding: '14px 20px', background: 'rgba(255, 255, 255, 0.98)', borderBottom: '1px solid rgba(60, 60, 67, 0.12)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    previewSection: { width: '50%', display: 'flex', flexDirection: 'column', background: '#F2F2F7' },
    previewContent: { flex: 1, padding: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' },
    previewFrame: { background: 'white', borderRadius: 12, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.08)' },
    saveButton: { background: 'linear-gradient(135deg, #34C759 0%, #30B854 100%)', borderColor: 'transparent', borderRadius: 8, fontWeight: 600, height: 38, color: 'white' },
    previewButton: { background: 'linear-gradient(135deg, #AF52DE 0%, #9F44D3 100%)', borderColor: 'transparent', color: 'white', borderRadius: 8, fontWeight: 600, height: 38 },
    copyButton: { background: 'rgba(142, 142, 147, 0.12)', borderColor: 'transparent', color: '#3C3C43', borderRadius: 8, fontWeight: 600, height: 38 },
    clearButton: { background: 'linear-gradient(135deg, #FF9500 0%, #FF8200 100%)', borderColor: 'transparent', color: 'white', borderRadius: 8, fontWeight: 600, height: 38 },
    linkButton: { background: 'linear-gradient(135deg, #007AFF 0%, #0051D5 100%)', borderColor: 'transparent', color: 'white', borderRadius: 8, fontWeight: 600, height: 38 },
    iconButton: { borderRadius: 8, width: 38, height: 38, background: 'rgba(142, 142, 147, 0.12)', border: 'none' },
    tag: { borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 600, border: 'none' },
    smallButton: { borderRadius: 6, fontSize: 13, height: 30, fontWeight: 600, background: 'linear-gradient(135deg, #007AFF 0%, #0051D5 100%)', borderColor: 'transparent' }
  };

  return (
    <Layout style={iosStyles.container}>
      {/* 顶部工具栏 */}
      <Header style={iosStyles.header}>
        <Space size={12}>
          <Button style={iosStyles.iconButton} icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setSidebarCollapsed(!sidebarCollapsed)} />
          <Button type="primary" style={iosStyles.saveButton} icon={<SaveOutlined />} onClick={handleSavePage} loading={isSaving} disabled={!selectedPageId || creditsLoading}>{t('htmlEditor.save')} {formatCreditsDisplayForSave(creditsConfig.credits_per_update)}</Button>
          <Button style={iosStyles.previewButton} icon={<EyeOutlined />} onClick={handlePreview}>{t('htmlEditor.preview')}</Button>
          <Button style={iosStyles.copyButton} icon={<CopyOutlined />} onClick={handleCopyContent}>{t('htmlEditor.copy')}</Button>
          <Button style={iosStyles.clearButton} icon={<ClearOutlined />} onClick={handleClearContent}>{t('htmlEditor.clear')}</Button>
          <Button style={iosStyles.linkButton} icon={<LinkOutlined />} onClick={handleGeneratePermalink} disabled={!selectedPageId || creditsLoading}>{t('htmlEditor.generateLink')} ({formatCreditsDisplay(creditsConfig.credits_per_publish)})</Button>
        </Space>
        
        <div style={{ flex: 1, textAlign: 'center' }}>
          {currentPage && (
            <Space size={8}>
              <Tag style={{ ...iosStyles.tag, background: 'linear-gradient(135deg, #007AFF 0%, #0051D5 100%)', color: 'white' }}>
                <Html5Outlined /> {currentPage.title}
              </Tag>
              {currentPage.is_published && (
                <Tag style={{ ...iosStyles.tag, background: 'linear-gradient(135deg, #34C759 0%, #30B854 100%)', color: 'white' }}>
                  <GlobalOutlined /> {t('htmlEditor.published')}
                </Tag>
              )}
            </Space>
          )}
        </div>
        
        <Space size={12}>
          <Tag style={{ ...iosStyles.tag, background: creditsLoading ? '#C7C7CC' : 'linear-gradient(135deg, #FFD60A 0%, #FFCC00 100%)', color: creditsLoading ? '#666' : '#000' }}>
            {creditsLoading ? <><LoadingOutlined spin /> {t('htmlEditor.loading')}</> : <><DollarOutlined /> {t('htmlEditor.credits')}: {userCredits}</>}
          </Tag>
          <Select value={previewMode} onChange={setPreviewMode} style={{ width: 100 }} options={[{ value: 'desktop', label: t('htmlEditor.desktop') }, { value: 'tablet', label: t('htmlEditor.tablet') }, { value: 'mobile', label: t('htmlEditor.mobile') }]} />
          <Select value={editorTheme} onChange={setEditorTheme} style={{ width: 90 }} options={[{ value: 'vs-dark', label: t('htmlEditor.dark') }, { value: 'vs-light', label: t('htmlEditor.light') }]} />
        </Space>
      </Header>

      <Layout style={{ background: 'transparent' }}>
        {/* 侧边栏 */}
        <Sider width={300} collapsed={sidebarCollapsed} collapsedWidth={0} style={iosStyles.sidebar}>
          <div style={iosStyles.sidebarContent}>
            <div style={iosStyles.sidebarSection}>
              <div style={iosStyles.sectionHeader}>
                <h3 style={iosStyles.sectionTitle}><AppstoreOutlined style={{ color: '#007AFF' }} /> {t('htmlEditor.projects')}</h3>
                <Button type="primary" size="small" style={iosStyles.smallButton} icon={<PlusOutlined />} onClick={() => setShowProjectModal(true)}>{t('htmlEditor.new')}</Button>
              </div>
              {projects.length > 0 ? (
                <div>
                  {projects.map(project => (
                    <div key={project.id} style={{ ...iosStyles.projectItem, ...(selectedProject?.id === project.id ? iosStyles.projectItemSelected : { background: 'rgba(60, 60, 67, 0.03)' }) }} onClick={() => handleSelectProject(project)}>
                      <Space size={8}>
                        <FolderOutlined />
                        <span style={{ fontWeight: 500 }}>{project.name}</span>
                        {project.is_default === 1 && (<Tag style={{ ...iosStyles.tag, background: 'rgba(0, 122, 255, 0.1)', color: '#007AFF', padding: '2px 6px', fontSize: 11 }}>{t('htmlEditor.default')}</Tag>)}
                      </Space>
                      <Space size={4}>
                        <Button type="text" size="small" icon={<EditOutlined />} onClick={(e) => { e.stopPropagation(); handleEditProject(project); }} style={{ color: selectedProject?.id === project.id ? 'white' : '#8E8E93' }} />
                        {project.is_default !== 1 && (<Button type="text" size="small" icon={<DeleteOutlined />} onClick={(e) => { e.stopPropagation(); handleDeleteProject(project); }} style={{ color: selectedProject?.id === project.id ? '#FFD1DC' : '#FF3B30' }} />)}
                      </Space>
                    </div>
                  ))}
                </div>
              ) : (<Empty description={t('htmlEditor.noProjects')} style={{ marginTop: 40 }} />)}
            </div>
            
            {selectedProject && (
              <div style={iosStyles.pageListSection}>
                <div style={iosStyles.sectionHeader}>
                  <h3 style={iosStyles.sectionTitle}><FileTextOutlined style={{ color: '#AF52DE' }} /> {t('htmlEditor.pages')}</h3>
                  <Button type="primary" size="small" style={{ ...iosStyles.smallButton, background: 'linear-gradient(135deg, #AF52DE 0%, #9F44D3 100%)' }} icon={<PlusOutlined />} onClick={handleOpenPageModal} disabled={creditsLoading}>{t('htmlEditor.new')}</Button>
                </div>
                {loadingPages ? (
                  <div style={{ textAlign: 'center', padding: 40 }}><Spin tip={t('htmlEditor.page.loadingPages')} /></div>
                ) : pages.length > 0 ? (
                  <div style={iosStyles.pageListScrollContainer}>
                    {pages.map(page => (
                      <div key={page.id} style={{ ...iosStyles.pageCard, ...(selectedPageId === page.id ? iosStyles.pageCardSelected : {}) }} onClick={() => handleSelectPage(page)}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600, fontSize: 14 }}>{page.title}</div>
                            <div style={{ fontSize: 11, color: '#8E8E93', marginTop: 4 }}>{page.slug}</div>
                          </div>
                          <Space size={6}>
                            <Button type="text" size="small" icon={<EditOutlined />} onClick={(e) => { e.stopPropagation(); handleEditPage(page); }} style={{ color: '#8E8E93' }} />
                            {page.is_published && (<CheckCircleOutlined style={{ color: '#34C759', fontSize: 16 }} />)}
                            <Button type="text" size="small" icon={<DeleteOutlined />} onClick={(e) => { e.stopPropagation(); handleDeletePage(page); }} style={{ color: '#FF3B30' }} />
                          </Space>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty description={t('htmlEditor.noPages')} style={{ marginTop: 40 }}>
                    <Button type="primary" style={{ borderRadius: 8, marginTop: 16, background: 'linear-gradient(135deg, #AF52DE 0%, #9F44D3 100%)', border: 'none' }} icon={<FileAddOutlined />} onClick={handleOpenPageModal} disabled={creditsLoading}>{t('htmlEditor.createFirstPage')}</Button>
                  </Empty>
                )}
              </div>
            )}
            {!selectedProject && (<div style={{ padding: 40, textAlign: 'center' }}><Empty description={t('htmlEditor.selectProject')} /></div>)}
          </div>
        </Sider>

        {/* 主内容区 */}
        <Content style={{ display: 'flex', background: 'transparent', padding: 0 }}>
          <div style={iosStyles.editorSection}>
            <div style={iosStyles.editorHeader}>
              <span style={{ fontWeight: 600, fontSize: 15 }}><CodeOutlined style={{ color: '#007AFF' }} /> {t('htmlEditor.title')}</span>
              <span style={{ fontSize: 12, color: '#8E8E93' }}>{editorReady ? t('htmlEditor.ready') : t('htmlEditor.loadingEditor')}</span>
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
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', flexDirection: 'column', gap: 16, background: '#1e1e1e' }}>
                    <Spin size="large" />
                    <div style={{ color: '#8E8E93' }}>{t('htmlEditor.loadingEditor')}</div>
                  </div>
                }
              />
            </div>
          </div>

          <div style={iosStyles.previewSection}>
            <div style={iosStyles.editorHeader}>
              <span style={{ fontWeight: 600, fontSize: 15 }}><EyeOutlined style={{ color: '#AF52DE' }} /> {t('htmlEditor.realTimePreview')}</span>
              <span style={{ fontSize: 12, color: '#8E8E93' }}>{previewMode === 'desktop' ? t('htmlEditor.desktop') : previewMode === 'tablet' ? t('htmlEditor.tablet') : t('htmlEditor.mobile')}</span>
            </div>
            <div style={iosStyles.previewContent}>
              <div style={{ ...iosStyles.previewFrame, width: previewMode === 'desktop' ? '100%' : previewMode === 'tablet' ? '768px' : '375px', height: '100%', maxHeight: '90%' }}>
                <iframe title="preview" srcDoc={compiledContent} style={{ width: '100%', height: '100%', border: 'none' }} sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin" />
              </div>
            </div>
          </div>
        </Content>
      </Layout>

      {/* 创建项目弹窗 */}
      <Modal title={t('htmlEditor.project.create')} open={showProjectModal} onOk={() => projectForm.submit()} onCancel={() => { setShowProjectModal(false); projectForm.resetFields(); }} centered>
        <Form form={projectForm} layout="vertical" onFinish={handleCreateProject}>
          <Form.Item name="name" label={t('htmlEditor.project.name')} rules={[{ required: true, message: t('htmlEditor.project.nameRequired') }]}>
            <Input placeholder={t('htmlEditor.project.namePlaceholder')} style={{ borderRadius: 8 }} />
          </Form.Item>
          <Form.Item name="type" initialValue="folder" hidden><Input /></Form.Item>
          <Form.Item name="description" label={t('htmlEditor.project.description')}>
            <TextArea rows={3} placeholder={t('htmlEditor.project.descriptionPlaceholder')} style={{ borderRadius: 8 }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 创建页面弹窗 */}
      <Modal
        title={t('htmlEditor.page.createIn', { project: selectedProject?.name })}
        open={showPageModal}
        onOk={() => pageForm.submit()}
        onCancel={() => { setShowPageModal(false); pageForm.resetFields(); }}
        centered
        footer={[
          <Button key="cancel" onClick={() => { setShowPageModal(false); pageForm.resetFields(); }}>{t('htmlEditor.action.cancel')}</Button>,
          <Button key="submit" type="primary" onClick={() => pageForm.submit()} icon={creditsConfig.credits_per_page > 0 ? <DollarOutlined /> : null} style={{ background: 'linear-gradient(135deg, #34C759 0%, #30B854 100%)', border: 'none' }} disabled={creditsLoading}>
            {t('htmlEditor.page.createButton')} ({formatCreditsDisplay(creditsConfig.credits_per_page)})
          </Button>
        ]}
      >
        <Form form={pageForm} layout="vertical" onFinish={handleCreatePage}>
          <Form.Item name="title" label={t('htmlEditor.page.title')} tooltip={t('htmlEditor.page.titleTooltip')}>
            <Input placeholder={t('htmlEditor.page.titlePlaceholder')} allowClear style={{ borderRadius: 8 }} />
          </Form.Item>
        </Form>
        {creditsConfig.credits_per_page > 0 && (
          <>
            <Divider />
            <Space direction="vertical" style={{ width: '100%' }}>
              <Text type="secondary">{t('htmlEditor.credits.perPage', { credits: creditsConfig.credits_per_page })}</Text>
              <Text type="secondary">
                {t('htmlEditor.credits.currentBalance')}
                {creditsLoading ? (<Text strong><LoadingOutlined spin /> {t('htmlEditor.loading')}</Text>) : (<Text strong type={userCredits < creditsConfig.credits_per_page ? 'danger' : 'success'}>{userCredits}</Text>)} {t('htmlEditor.credits.creditsUnit')}
              </Text>
            </Space>
          </>
        )}
      </Modal>

      {/* 重命名弹窗 */}
      <Modal title={renameType === 'project' ? t('htmlEditor.project.rename') : t('htmlEditor.page.rename')} open={showRenameModal} onOk={() => renameForm.submit()} onCancel={() => { setShowRenameModal(false); renameForm.resetFields(); setRenameItem(null); }} centered>
        <Form form={renameForm} layout="vertical" onFinish={handleRename}>
          <Form.Item name="name" label={renameType === 'project' ? t('htmlEditor.project.name') : t('htmlEditor.page.name')} rules={[{ required: true, message: t('htmlEditor.page.nameRequired') }]}>
            <Input placeholder={t('htmlEditor.page.namePlaceholder')} style={{ borderRadius: 8 }} />
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  );
};

export default HtmlEditor;
