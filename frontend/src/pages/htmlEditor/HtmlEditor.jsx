/**
 * HTML编辑器主页面
 * 
 * v1.8 (2026-03-01): 修复转圈加载不出来 + Monaco降级textarea
 *   - 积分加载不再阻塞页面初始化(去掉creditsLoading对项目选择的阻塞)
 *   - 移除waitForCreditsLoaded轮询，autoHandlePage直接加载页面
 *   - initializeCredits加5秒超时保护
 *   - Monaco加载超时15秒自动降级为FallbackEditor(原生textarea)
 *   - FallbackEditor提取为独立组件，主文件保持<600行
 * v1.7: 容器高度calc(100vh-60px)+工具栏按钮紧凑化
 * v1.6: 删除最后页面不再自动创建新页面
 * v1.5: 生成链接移除确认框
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Layout, Button, Space, message, Modal, Form, Input, Select,
  Empty, Tag, Divider, Typography, Spin, Tooltip
} from 'antd';
import {
  FolderOutlined, PlusOutlined, SaveOutlined, CopyOutlined,
  DeleteOutlined, EditOutlined, FileAddOutlined, FileTextOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined, ClearOutlined, LinkOutlined,
  GlobalOutlined, DollarOutlined, EyeOutlined, CodeOutlined,
  Html5Outlined, AppstoreOutlined, CheckCircleOutlined, LoadingOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import useHtmlEditorStore from '../../stores/htmlEditorStore';
import useAuthStore from '../../stores/authStore';
import apiClient from '../../utils/api';
import moment from 'moment';
import FallbackEditor from './FallbackEditor';
import './HtmlEditor.less';

const { Sider, Content, Header } = Layout;
const { Text } = Typography;

// v1.8 Monaco懒加载，不阻塞页面渲染
const MonacoEditor = React.lazy(() => import('@monaco-editor/react'));

const HtmlEditor = () => {
  const { t } = useTranslation();
  const { user, getCurrentUser } = useAuthStore();
  const {
    projects, pages, currentPage,
    getProjects, getPages, createProject, createPage, updatePage,
    deletePage, deleteProject, togglePublish, loadPage, updateProject
  } = useHtmlEditorStore();

  const BLANK_HTML = `<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n    <meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n    <title>${t('htmlEditor.newPage')}</title>\n    <style>\n        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 20px; line-height: 1.6; }\n    </style>\n</head>\n<body>\n    <h1>${t('htmlEditor.startCreate')}</h1>\n    <p>${t('htmlEditor.blankPage')}</p>\n</body>\n</html>`;

  const genTitle = () => `${t('htmlEditor.page')}_${moment().format('YYYYMMDD_HHmmss')}`;

  // ============ 状态 ============
  const [selectedProject, setSelectedProject] = useState(null);
  const [selectedPageId, setSelectedPageId] = useState(null);
  const [htmlContent, setHtmlContent] = useState(BLANK_HTML);
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
  const [creditsConfig, setCreditsConfig] = useState({ credits_per_page: 10, credits_per_update: 2, credits_per_publish: 5 });
  const [userCredits, setUserCredits] = useState(0);
  const [creditsLoading, setCreditsLoading] = useState(true);
  const [defaultProjectSelected, setDefaultProjectSelected] = useState(false);
  const [loadingPages, setLoadingPages] = useState(false);
  const [isGeneratingLink, setIsGeneratingLink] = useState(false);
  // v1.8 Monaco状态: 'loading' | 'ready' | 'failed'
  const [monacoStatus, setMonacoStatus] = useState('loading');

  const autoPageCreatedRef = useRef(false);
  const isAutoCreatingRef = useRef(false);
  const creditsConfigRef = useRef(creditsConfig);
  const monacoTimerRef = useRef(null);

  useEffect(() => { creditsConfigRef.current = creditsConfig; }, [creditsConfig]);

  // v1.8 Monaco 15秒超时降级
  const startMonacoTimer = () => {
    clearTimeout(monacoTimerRef.current);
    monacoTimerRef.current = setTimeout(() => {
      setMonacoStatus(prev => {
        if (prev === 'loading') { console.warn('[HtmlEditor] Monaco超时15秒，降级textarea'); return 'failed'; }
        return prev;
      });
    }, 15000);
  };
  useEffect(() => { startMonacoTimer(); return () => clearTimeout(monacoTimerRef.current); }, []);

  // ============ 积分（v1.8 不阻塞页面） ============
  const initializeCredits = async () => {
    setCreditsLoading(true);
    try {
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('超时')), 5000));
      await Promise.race([Promise.all([fetchCreditsConfig(), getCurrentUser()]), timeout]);
    } catch (e) { console.warn('[HtmlEditor] 积分加载失败/超时:', e.message); }
    finally { updateUserCredits(); setCreditsLoading(false); }
  };

  const updateUserCredits = () => {
    const u = useAuthStore.getState().user;
    if (!u) return;
    let c = 0;
    if (u.credits_stats?.remaining !== undefined) c = u.credits_stats.remaining;
    else if (u.credits_quota !== undefined) c = (u.credits_quota || 0) - (u.used_credits || 0);
    else if (u.credits !== undefined) c = u.credits;
    setUserCredits(Math.max(0, c));
  };

  const getLatestCredits = () => {
    const u = useAuthStore.getState().user;
    if (!u) return 0;
    if (u.credits_stats?.remaining !== undefined) return Math.max(0, u.credits_stats.remaining);
    if (u.credits_quota !== undefined) return Math.max(0, (u.credits_quota || 0) - (u.used_credits || 0));
    return Math.max(0, u.credits || 0);
  };

  const fetchCreditsConfig = async () => {
    try {
      const res = await apiClient.get('/html-editor/credits-config');
      if (res.data.success) { setCreditsConfig(res.data.data); creditsConfigRef.current = res.data.data; }
    } catch (e) { /* 使用默认值 */ }
  };

  const refreshCredits = async () => { try { await getCurrentUser(); updateUserCredits(); } catch (e) { /* 静默 */ } };
  const fmtCredits = (c) => c === 0 ? t('htmlEditor.credits.free') : t('htmlEditor.credits.required', { credits: c });
  const fmtCreditsSave = (c) => c === 0 ? '' : `(${c} ${t('htmlEditor.credits.creditsUnit')})`;

  const canCredit = (required, name) => {
    if (creditsLoading) { message.warning(t('htmlEditor.credits.loading')); return false; }
    if (required > 0 && userCredits < required) { message.error(t('htmlEditor.credits.insufficient', { action: name, required, current: userCredits })); return false; }
    return true;
  };

  // ============ 初始化 ============
  useEffect(() => { getProjects(); initializeCredits(); }, []);
  useEffect(() => { if (user) updateUserCredits(); }, [user]);

  // v1.8 自动选择默认项目 - 不再等creditsLoading
  useEffect(() => {
    if (projects.length > 0 && !defaultProjectSelected && !selectedProject) {
      const def = projects.find(p => p.name === '默认项目' || p.is_default === 1);
      if (def) { handleSelectProject(def); setDefaultProjectSelected(true); }
    }
  }, [projects, defaultProjectSelected]);

  // v1.8 autoHandlePage - 不再等积分
  const autoHandlePage = async (projectId) => {
    if (autoPageCreatedRef.current || isAutoCreatingRef.current) return;
    isAutoCreatingRef.current = true;
    setLoadingPages(true);
    try {
      await getPages(projectId);
      const curPages = useHtmlEditorStore.getState().pages;
      if (curPages?.length > 0) {
        const first = curPages[0];
        setSelectedPageId(first.id);
        await loadPage(first.id);
        message.info(t('htmlEditor.page.loaded', { title: first.title }));
      } else {
        const credits = getLatestCredits();
        const cfg = creditsConfigRef.current;
        if (cfg.credits_per_page > 0 && credits < cfg.credits_per_page) {
          message.warning(t('htmlEditor.credits.cannotAutoCreate', '积分不足，请手动创建页面'));
          setHtmlContent(BLANK_HTML);
        } else {
          const title = genTitle();
          try {
            const np = await createPage({ title, project_id: projectId, html_content: BLANK_HTML, css_content: '', js_content: '' });
            message.success(t('htmlEditor.page.autoCreated', { title }));
            setSelectedPageId(np.id); await loadPage(np.id); setHtmlContent(BLANK_HTML);
            await getPages(projectId); refreshCredits();
          } catch (e) { setHtmlContent(BLANK_HTML); }
        }
      }
      autoPageCreatedRef.current = true;
    } catch (e) { console.error('[HtmlEditor] autoHandlePage:', e); }
    finally { setLoadingPages(false); isAutoCreatingRef.current = false; }
  };

  // ============ 内容同步 ============
  useEffect(() => { if (currentPage) setHtmlContent(currentPage.html_content ?? currentPage.compiled_content ?? BLANK_HTML); }, [currentPage]);
  useEffect(() => { setCompiledContent(htmlContent || `<!DOCTYPE html><html><body style="padding:20px;color:#999;font-family:system-ui;">${t('htmlEditor.editor.startWriting')}</body></html>`); }, [htmlContent, t]);

  // ============ 操作函数 ============
  const handlePreview = () => { if (!htmlContent) { message.warning(t('htmlEditor.editor.empty')); return; } const b = new Blob([htmlContent], { type: 'text/html;charset=utf-8' }); const u = URL.createObjectURL(b); window.open(u, '_blank'); setTimeout(() => URL.revokeObjectURL(u), 1000); };
  const handleCreateProject = async (v) => { try { await createProject(v); message.success(t('htmlEditor.project.createSuccess')); setShowProjectModal(false); projectForm.resetFields(); } catch (e) { message.error(t('htmlEditor.project.createFailed')); } };
  const handleSelectProject = async (p) => { setSelectedProject(p); setSelectedPageId(null); setHtmlContent(BLANK_HTML); autoPageCreatedRef.current = false; isAutoCreatingRef.current = false; await autoHandlePage(p.id); };
  const handleEditProject = (p) => { setRenameType('project'); setRenameItem(p); renameForm.setFieldsValue({ name: p.name }); setShowRenameModal(true); };

  const handleDeleteProject = (p) => {
    if (p.is_default === 1 || p.name === '默认项目') { message.warning(t('htmlEditor.project.defaultCannotDelete')); return; }
    Modal.confirm({ title: t('htmlEditor.project.deleteConfirm'), content: (<div><p>{t('htmlEditor.project.deleteContent', { name: p.name })}</p><p style={{ color: '#ff4d4f', marginTop: 8 }}>{t('htmlEditor.project.deleteWarning')}</p></div>), okText: t('htmlEditor.project.deleteButton'), okType: 'danger', cancelText: t('htmlEditor.action.cancel'),
      onOk: async () => { try { await deleteProject(p.id); message.success(t('htmlEditor.project.deleteSuccess')); if (selectedProject?.id === p.id) { setSelectedProject(null); setSelectedPageId(null); setHtmlContent(BLANK_HTML); } await getProjects(); } catch (e) { message.error(e.response?.data?.message || t('htmlEditor.project.deleteFailed')); } }
    });
  };

  const handleEditPage = (p) => { setRenameType('page'); setRenameItem(p); renameForm.setFieldsValue({ name: p.title }); setShowRenameModal(true); };
  const handleRename = async (v) => { try { if (renameType === 'project') { await updateProject(renameItem.id, { name: v.name }); message.success(t('htmlEditor.project.renameSuccess')); await getProjects(); } else { await updatePage(renameItem.id, { title: v.name }); message.success(t('htmlEditor.page.renameSuccess')); await getPages(selectedProject?.id); if (renameItem.id === selectedPageId) await loadPage(renameItem.id); } setShowRenameModal(false); renameForm.resetFields(); setRenameItem(null); } catch (e) { message.error(t('htmlEditor.project.createFailed')); } };
  const handleOpenPageModal = () => { pageForm.setFieldsValue({ title: genTitle() }); setShowPageModal(true); };

  const handleCreatePage = async (v) => {
    if (!selectedProject) { message.warning(t('htmlEditor.page.selectFirst')); return; }
    if (!canCredit(creditsConfig.credits_per_page, t('htmlEditor.page.create'))) return;
    try { const np = await createPage({ title: v.title || genTitle(), project_id: selectedProject.id, html_content: BLANK_HTML, css_content: '', js_content: '' }); message.success(t('htmlEditor.page.createSuccess')); setShowPageModal(false); pageForm.resetFields(); setSelectedPageId(np.id); loadPage(np.id); setHtmlContent(BLANK_HTML); await getPages(selectedProject.id); await refreshCredits(); } catch (e) { message.error(e.message || t('htmlEditor.page.createFailed')); }
  };

  const handleSavePage = async () => {
    if (!selectedPageId) { message.warning(t('htmlEditor.page.selectFirst')); return; }
    if (!canCredit(creditsConfig.credits_per_update, t('htmlEditor.credits.perUpdate'))) return;
    setIsSaving(true);
    try { await updatePage(selectedPageId, { html_content: htmlContent, css_content: '', js_content: '' }); message.success(t('htmlEditor.page.saveSuccess')); await refreshCredits(); await getPages(selectedProject?.id); } catch (e) { message.error(e.message || t('htmlEditor.page.saveFailed')); } finally { setIsSaving(false); }
  };

  const handleSelectPage = (p) => { setSelectedPageId(p.id); loadPage(p.id); };

  const handleDeletePage = (p) => { Modal.confirm({ title: t('htmlEditor.project.deleteConfirm'), content: t('htmlEditor.page.deleteConfirm', { title: p.title }), okText: t('htmlEditor.project.deleteButton'), okType: 'danger', cancelText: t('htmlEditor.action.cancel'), onOk: async () => { try { await deletePage(p.id); message.success(t('htmlEditor.page.deleteSuccess')); if (selectedPageId === p.id) { setSelectedPageId(null); setHtmlContent(BLANK_HTML); } await getPages(selectedProject.id); } catch (e) { message.error(t('htmlEditor.page.deleteFailed')); } } }); };
  const handleCopy = () => { if (!htmlContent) { message.warning(t('htmlEditor.editor.empty')); return; } navigator.clipboard.writeText(htmlContent).then(() => message.success(t('htmlEditor.editor.copied'))).catch(() => message.error(t('htmlEditor.editor.copyFailed'))); };
  const handleClear = () => { setHtmlContent(''); message.success(t('htmlEditor.editor.cleared')); };

  const handleGeneratePermalink = async () => {
    if (!selectedPageId) { message.warning(t('htmlEditor.link.saveFirst')); return; }
    const cur = pages.find(p => p.id === selectedPageId);
    if (cur?.is_published) { showLinkModal(cur); return; }
    if (!canCredit(creditsConfig.credits_per_publish, t('htmlEditor.link.generate'))) return;
    setIsGeneratingLink(true);
    try { const r = await togglePublish(selectedPageId); if (r.is_published) { showLinkModal(r); await refreshCredits(); await getPages(selectedProject?.id); } } catch (e) { message.error(t('htmlEditor.link.generateFailed')); } finally { setIsGeneratingLink(false); }
  };

  const showLinkModal = (page) => {
    const url = `${window.location.origin}/pages/${user.id}/${page.slug}`;
    Modal.info({ title: t('htmlEditor.link.permanentLink'), width: 600, icon: <CheckCircleOutlined style={{ color: '#52c41a' }} />, content: (<div><p>{t('htmlEditor.link.yourLink')}</p><Space.Compact style={{ width: '100%', marginTop: 10 }}><Input value={url} readOnly /><Button icon={<CopyOutlined />} onClick={() => { navigator.clipboard.writeText(url); message.success(t('htmlEditor.link.copied')); }} /></Space.Compact><Divider /><Text type="secondary">{t('htmlEditor.link.tip')}</Text></div>), okText: t('htmlEditor.link.openPage'), cancelText: t('htmlEditor.action.close', '关闭'), okCancel: true, onOk: () => window.open(url, '_blank') });
  };

  // v1.8 Monaco就绪回调
  const handleEditorMount = (editor) => {
    clearTimeout(monacoTimerRef.current);
    setMonacoStatus('ready');
    [
      { id: 'cut', label: '✂️ 剪切', order: 1, fn: async (ed) => { const s = ed.getSelection(); const t2 = ed.getModel().getValueInRange(s); if (t2) { await navigator.clipboard.writeText(t2); ed.executeEdits('cut', [{ range: s, text: '', forceMoveMarkers: true }]); } } },
      { id: 'copy', label: '📄 复制', order: 2, fn: async (ed) => { const s = ed.getSelection(); const t2 = ed.getModel().getValueInRange(s); if (t2) await navigator.clipboard.writeText(t2); } },
      { id: 'paste', label: '📋 粘贴', order: 3, fn: async (ed) => { const t2 = await navigator.clipboard.readText(); if (t2) { ed.executeEdits('paste', [{ range: ed.getSelection(), text: t2, forceMoveMarkers: true }]); ed.focus(); } } }
    ].forEach(a => editor.addAction({ id: `custom-${a.id}`, label: a.label, keybindings: [], contextMenuGroupId: '9_cutcopypaste', contextMenuOrder: a.order, run: a.fn }));
  };

  // v1.8 重试Monaco加载
  const handleRetryMonaco = () => { setMonacoStatus('loading'); startMonacoTimer(); };

  // ============ 编辑器选项 ============
  const editorOptions = { minimap: { enabled: false }, fontSize: 14, fontFamily: 'SF Mono, Monaco, Consolas, monospace', formatOnPaste: true, formatOnType: true, automaticLayout: true, tabSize: 2, wordWrap: 'on', scrollBeyondLastLine: false, lineNumbers: 'on', renderWhitespace: 'selection', folding: true, bracketPairColorization: { enabled: true }, guides: { indentation: true, bracketPairs: true }, padding: { top: 16, bottom: 16 } };

  // ============ 样式 ============
  const S = {
    container: { height: 'calc(100vh - 60px)', background: '#F2F2F7', overflow: 'hidden' },
    header: { background: 'rgba(255,255,255,0.98)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(60,60,67,0.12)', height: 52, padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 },
    sidebar: { background: 'rgba(255,255,255,0.98)', backdropFilter: 'blur(20px)', borderRight: '1px solid rgba(60,60,67,0.12)' },
    sidebarContent: { height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
    sidebarSection: { padding: 20, borderBottom: '1px solid rgba(60,60,67,0.08)', flexShrink: 0 },
    pageSection: { padding: 20, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' },
    pageScroll: { flex: 1, overflowY: 'auto', overflowX: 'hidden', paddingRight: 4, minHeight: 0 },
    secHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
    secTitle: { fontSize: 17, fontWeight: 600, color: '#000', margin: 0, display: 'flex', alignItems: 'center', gap: 8 },
    projItem: (sel) => ({ padding: '10px 14px', cursor: 'pointer', borderRadius: 10, marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between', ...(sel ? { background: 'linear-gradient(135deg,#007AFF,#0051D5)', color: 'white' } : { background: 'rgba(60,60,67,0.03)' }) }),
    pageCard: (sel) => ({ background: 'white', borderRadius: 10, padding: '12px 14px', marginBottom: 8, cursor: 'pointer', ...(sel ? { border: '2px solid #007AFF', background: 'rgba(0,122,255,0.02)' } : { border: '1px solid rgba(60,60,67,0.08)' }) }),
    edSec: { flex: 1, display: 'flex', flexDirection: 'column', background: 'white', overflow: 'hidden' },
    edHead: { padding: '14px 20px', background: 'rgba(255,255,255,0.98)', borderBottom: '1px solid rgba(60,60,67,0.12)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    pvSec: { width: '50%', display: 'flex', flexDirection: 'column', background: '#F2F2F7' },
    pvContent: { flex: 1, padding: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' },
    pvFrame: { background: 'white', borderRadius: 12, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' },
    btn: (bg, color = 'white') => ({ background: bg, borderColor: 'transparent', borderRadius: 8, fontWeight: 600, height: 34, color }),
    iconBtn: { borderRadius: 8, width: 34, height: 34, background: 'rgba(142,142,147,0.12)', border: 'none' },
    tag: { borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 600, border: 'none' },
    smallBtn: (bg) => ({ borderRadius: 6, fontSize: 13, height: 30, fontWeight: 600, background: bg, borderColor: 'transparent' }),
  };

  // ============ 渲染 ============
  return (
    <Layout style={S.container}>
      <Header style={S.header}>
        <Space size={8}>
          <Button style={S.iconBtn} icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setSidebarCollapsed(!sidebarCollapsed)} />
          <Button type="primary" style={S.btn('linear-gradient(135deg,#34C759,#30B854)')} icon={<SaveOutlined />} onClick={handleSavePage} loading={isSaving} disabled={!selectedPageId}>{t('htmlEditor.save')} {fmtCreditsSave(creditsConfig.credits_per_update)}</Button>
          <Button style={S.btn('linear-gradient(135deg,#AF52DE,#9F44D3)')} icon={<EyeOutlined />} onClick={handlePreview}>{t('htmlEditor.preview')}</Button>
          <Button style={S.btn('rgba(142,142,147,0.12)', '#3C3C43')} icon={<CopyOutlined />} onClick={handleCopy}>{t('htmlEditor.copy')}</Button>
          <Button style={S.btn('linear-gradient(135deg,#FF9500,#FF8200)')} icon={<ClearOutlined />} onClick={handleClear}>{t('htmlEditor.clear')}</Button>
        </Space>
        <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
          {currentPage && <Space size={6}>
            <Tag style={{ ...S.tag, background: 'linear-gradient(135deg,#007AFF,#0051D5)', color: 'white' }}><Html5Outlined /> {currentPage.title}</Tag>
            {currentPage.is_published && <Tag style={{ ...S.tag, background: 'linear-gradient(135deg,#34C759,#30B854)', color: 'white' }}><GlobalOutlined /> {t('htmlEditor.published')}</Tag>}
          </Space>}
        </div>
        <Space size={8}>
          <Tooltip title={`${t('htmlEditor.generateLink')} (${fmtCredits(creditsConfig.credits_per_publish)})`}>
            <Button style={{ ...S.btn('linear-gradient(135deg,#007AFF,#0051D5)'), width: 34, display: 'flex', alignItems: 'center', justifyContent: 'center' }} icon={<LinkOutlined />} onClick={handleGeneratePermalink} loading={isGeneratingLink} disabled={!selectedPageId} />
          </Tooltip>
          <Tag style={{ ...S.tag, background: creditsLoading ? '#C7C7CC' : 'linear-gradient(135deg,#FFD60A,#FFCC00)', color: creditsLoading ? '#666' : '#000' }}>
            {creditsLoading ? <><LoadingOutlined spin /> {t('htmlEditor.loading')}</> : <><DollarOutlined /> {t('htmlEditor.credits')}: {userCredits}</>}
          </Tag>
          <Select value={previewMode} onChange={setPreviewMode} style={{ width: 80 }} size="small" options={[{ value: 'desktop', label: t('htmlEditor.desktop') }, { value: 'tablet', label: t('htmlEditor.tablet') }, { value: 'mobile', label: t('htmlEditor.mobile') }]} />
          <Select value={editorTheme} onChange={setEditorTheme} style={{ width: 76 }} size="small" options={[{ value: 'vs-dark', label: t('htmlEditor.dark') }, { value: 'vs-light', label: t('htmlEditor.light') }]} />
        </Space>
      </Header>

      <Layout style={{ background: 'transparent', flex: 1, overflow: 'hidden' }}>
        <Sider width={300} collapsed={sidebarCollapsed} collapsedWidth={0} style={S.sidebar}>
          <div style={S.sidebarContent}>
            {/* 项目列表 */}
            <div style={S.sidebarSection}>
              <div style={S.secHeader}>
                <h3 style={S.secTitle}><AppstoreOutlined style={{ color: '#007AFF' }} /> {t('htmlEditor.projects')}</h3>
                <Button type="primary" size="small" style={S.smallBtn('linear-gradient(135deg,#007AFF,#0051D5)')} icon={<PlusOutlined />} onClick={() => setShowProjectModal(true)}>{t('htmlEditor.new')}</Button>
              </div>
              {projects.length > 0 ? projects.map(p => (
                <div key={p.id} style={S.projItem(selectedProject?.id === p.id)} onClick={() => handleSelectProject(p)}>
                  <Space size={8}><FolderOutlined /><span style={{ fontWeight: 500 }}>{p.name}</span>{p.is_default === 1 && <Tag style={{ ...S.tag, background: 'rgba(0,122,255,0.1)', color: '#007AFF', padding: '2px 6px', fontSize: 11 }}>{t('htmlEditor.default')}</Tag>}</Space>
                  <Space size={4}>
                    <Button type="text" size="small" icon={<EditOutlined />} onClick={e => { e.stopPropagation(); handleEditProject(p); }} style={{ color: selectedProject?.id === p.id ? 'white' : '#8E8E93' }} />
                    {p.is_default !== 1 && <Button type="text" size="small" icon={<DeleteOutlined />} onClick={e => { e.stopPropagation(); handleDeleteProject(p); }} style={{ color: selectedProject?.id === p.id ? '#FFD1DC' : '#FF3B30' }} />}
                  </Space>
                </div>
              )) : <Empty description={t('htmlEditor.noProjects')} style={{ marginTop: 40 }} />}
            </div>
            {/* 页面列表 */}
            {selectedProject ? (
              <div style={S.pageSection}>
                <div style={S.secHeader}>
                  <h3 style={S.secTitle}><FileTextOutlined style={{ color: '#AF52DE' }} /> {t('htmlEditor.pages')}</h3>
                  <Button type="primary" size="small" style={S.smallBtn('linear-gradient(135deg,#AF52DE,#9F44D3)')} icon={<PlusOutlined />} onClick={handleOpenPageModal} disabled={creditsLoading}>{t('htmlEditor.new')}</Button>
                </div>
                {loadingPages ? <div style={{ textAlign: 'center', padding: 40 }}><Spin tip={t('htmlEditor.page.loadingPages')} /></div>
                : pages.length > 0 ? <div style={S.pageScroll}>{pages.map(p => (
                  <div key={p.id} style={S.pageCard(selectedPageId === p.id)} onClick={() => handleSelectPage(p)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: 14 }}>{p.title}</div><div style={{ fontSize: 11, color: '#8E8E93', marginTop: 4 }}>{p.slug}</div></div>
                      <Space size={6}>
                        <Button type="text" size="small" icon={<EditOutlined />} onClick={e => { e.stopPropagation(); handleEditPage(p); }} style={{ color: '#8E8E93' }} />
                        {p.is_published && <CheckCircleOutlined style={{ color: '#34C759', fontSize: 16 }} />}
                        <Button type="text" size="small" icon={<DeleteOutlined />} onClick={e => { e.stopPropagation(); handleDeletePage(p); }} style={{ color: '#FF3B30' }} />
                      </Space>
                    </div>
                  </div>
                ))}</div>
                : <Empty description={t('htmlEditor.noPages')} style={{ marginTop: 40 }}><Button type="primary" style={{ borderRadius: 8, marginTop: 16, background: 'linear-gradient(135deg,#AF52DE,#9F44D3)', border: 'none' }} icon={<FileAddOutlined />} onClick={handleOpenPageModal} disabled={creditsLoading}>{t('htmlEditor.createFirstPage')}</Button></Empty>}
              </div>
            ) : <div style={{ padding: 40, textAlign: 'center' }}><Empty description={t('htmlEditor.selectProject')} /></div>}
          </div>
        </Sider>

        <Content style={{ display: 'flex', background: 'transparent', padding: 0, overflow: 'hidden' }}>
          {/* 编辑器区域 */}
          <div style={S.edSec}>
            <div style={S.edHead}>
              <span style={{ fontWeight: 600, fontSize: 15 }}><CodeOutlined style={{ color: '#007AFF' }} /> {t('htmlEditor.title')}</span>
              <Space size={8}>
                <span style={{ fontSize: 12, color: '#8E8E93' }}>{monacoStatus === 'ready' ? t('htmlEditor.ready') : monacoStatus === 'failed' ? '基础模式' : t('htmlEditor.loadingEditor')}</span>
                <Tooltip title={monacoStatus === 'failed' ? '切换到高级编辑器' : '切换到基础编辑器'}>
                  <Button size="small" type={monacoStatus === 'failed' ? 'primary' : 'default'} style={{ fontSize: 11, height: 24, borderRadius: 6 }} onClick={() => { if (monacoStatus === 'failed') { setMonacoStatus('loading'); startMonacoTimer(); } else { clearTimeout(monacoTimerRef.current); setMonacoStatus('failed'); } }}>
                    {monacoStatus === 'failed' ? '⚡ 高级' : '📝 基础'}
                  </Button>
                </Tooltip>
              </Space>
            </div>
            <div style={{ flex: 1, background: editorTheme === 'vs-dark' ? '#1e1e1e' : '#fff' }}>
              {monacoStatus === 'failed' ? (
                <FallbackEditor value={htmlContent} onChange={setHtmlContent} theme={editorTheme} onRetry={handleRetryMonaco} />
              ) : (
                <React.Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', flexDirection: 'column', gap: 16, background: '#1e1e1e' }}><Spin size="large" /><div style={{ color: '#8E8E93' }}>{t('htmlEditor.loadingEditor')}</div></div>}>
                  <MonacoEditor height="100%" language="html" theme={editorTheme} value={htmlContent} onChange={setHtmlContent} options={editorOptions} onMount={handleEditorMount} />
                </React.Suspense>
              )}
            </div>
          </div>
          {/* 预览区域 */}
          <div style={S.pvSec}>
            <div style={S.edHead}>
              <span style={{ fontWeight: 600, fontSize: 15 }}><EyeOutlined style={{ color: '#AF52DE' }} /> {t('htmlEditor.realTimePreview')}</span>
              <span style={{ fontSize: 12, color: '#8E8E93' }}>{previewMode === 'desktop' ? t('htmlEditor.desktop') : previewMode === 'tablet' ? t('htmlEditor.tablet') : t('htmlEditor.mobile')}</span>
            </div>
            <div style={S.pvContent}>
              <div style={{ ...S.pvFrame, width: previewMode === 'desktop' ? '100%' : previewMode === 'tablet' ? 768 : 375, height: '100%', maxHeight: '90%' }}>
                <iframe title="preview" srcDoc={compiledContent} style={{ width: '100%', height: '100%', border: 'none' }} sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin" />
              </div>
            </div>
          </div>
        </Content>
      </Layout>

      {/* 弹窗 */}
      <Modal title={t('htmlEditor.project.create')} open={showProjectModal} onOk={() => projectForm.submit()} onCancel={() => { setShowProjectModal(false); projectForm.resetFields(); }} centered>
        <Form form={projectForm} layout="vertical" onFinish={handleCreateProject}>
          <Form.Item name="name" label={t('htmlEditor.project.name')} rules={[{ required: true, message: t('htmlEditor.project.nameRequired') }]}><Input placeholder={t('htmlEditor.project.namePlaceholder')} style={{ borderRadius: 8 }} /></Form.Item>
          <Form.Item name="type" initialValue="folder" hidden><Input /></Form.Item>
          <Form.Item name="description" label={t('htmlEditor.project.description')}><Input.TextArea rows={3} placeholder={t('htmlEditor.project.descriptionPlaceholder')} style={{ borderRadius: 8 }} /></Form.Item>
        </Form>
      </Modal>

      <Modal title={t('htmlEditor.page.createIn', { project: selectedProject?.name })} open={showPageModal} onOk={() => pageForm.submit()} onCancel={() => { setShowPageModal(false); pageForm.resetFields(); }} centered
        footer={[<Button key="c" onClick={() => { setShowPageModal(false); pageForm.resetFields(); }}>{t('htmlEditor.action.cancel')}</Button>, <Button key="s" type="primary" onClick={() => pageForm.submit()} icon={creditsConfig.credits_per_page > 0 ? <DollarOutlined /> : null} style={{ background: 'linear-gradient(135deg,#34C759,#30B854)', border: 'none' }} disabled={creditsLoading}>{t('htmlEditor.page.createButton')} ({fmtCredits(creditsConfig.credits_per_page)})</Button>]}>
        <Form form={pageForm} layout="vertical" onFinish={handleCreatePage}>
          <Form.Item name="title" label={t('htmlEditor.page.title')} tooltip={t('htmlEditor.page.titleTooltip')}><Input placeholder={t('htmlEditor.page.titlePlaceholder')} allowClear style={{ borderRadius: 8 }} /></Form.Item>
        </Form>
        {creditsConfig.credits_per_page > 0 && <><Divider /><Space direction="vertical" style={{ width: '100%' }}><Text type="secondary">{t('htmlEditor.credits.perPage', { credits: creditsConfig.credits_per_page })}</Text><Text type="secondary">{t('htmlEditor.credits.currentBalance')}{creditsLoading ? <Text strong><LoadingOutlined spin /> {t('htmlEditor.loading')}</Text> : <Text strong type={userCredits < creditsConfig.credits_per_page ? 'danger' : 'success'}>{userCredits}</Text>} {t('htmlEditor.credits.creditsUnit')}</Text></Space></>}
      </Modal>

      <Modal title={renameType === 'project' ? t('htmlEditor.project.rename') : t('htmlEditor.page.rename')} open={showRenameModal} onOk={() => renameForm.submit()} onCancel={() => { setShowRenameModal(false); renameForm.resetFields(); setRenameItem(null); }} centered>
        <Form form={renameForm} layout="vertical" onFinish={handleRename}>
          <Form.Item name="name" label={renameType === 'project' ? t('htmlEditor.project.name') : t('htmlEditor.page.name')} rules={[{ required: true, message: t('htmlEditor.page.nameRequired') }]}><Input placeholder={t('htmlEditor.page.namePlaceholder')} style={{ borderRadius: 8 }} /></Form.Item>
        </Form>
      </Modal>
    </Layout>
  );
};

export default HtmlEditor;
