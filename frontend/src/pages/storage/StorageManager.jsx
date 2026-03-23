/**
 * 智能云盘 - Windows风格文件管理器 v2.0
 * 
 * v2.0 完整重构：
 * 1. 拖拽上传 - 拖拽文件到页面区域直接上传，全屏遮罩视觉反馈
 * 2. 拖拽移动 - 拖拽文件/文件夹到其他文件夹或左侧树实现移动
 * 3. 右键菜单 - Windows风格上下文菜单（打开/重命名/移动到/删除/下载/复制链接/属性）
 *    - 文件夹右键：打开、重命名、删除
 *    - 文件右键：预览、下载、重命名、移动到（含子菜单）、复制链接、删除
 *    - 空白处右键：上传、新建文件夹、粘贴、刷新、全选
 * 4. 多选操作 - Ctrl+点击多选、Shift+范围选
 * 5. 键盘快捷键 - Delete删除、F2重命名、Ctrl+A全选、Escape取消选择
 * 6. 内联重命名 - 双击文件名/F2直接在卡片上输入新名称
 * 7. 底部状态栏 - 显示当前项目数、选中数量
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  Button, Upload, Table, Space, Modal, Input, message, Progress,
  Tooltip, Tag, Row, Col, Statistic, Tree, Spin, Grid, Alert, Divider, Breadcrumb
} from 'antd'
import {
  FolderAddOutlined, DeleteOutlined, DownloadOutlined, EyeOutlined,
  CopyOutlined, FolderOutlined, FolderOpenOutlined, FileOutlined,
  FileImageOutlined, VideoCameraOutlined, FilePdfOutlined, FileTextOutlined,
  FileZipOutlined, HomeOutlined, ReloadOutlined, CloudUploadOutlined,
  InboxOutlined, SearchOutlined, AppstoreOutlined, BarsOutlined,
  EditOutlined, FolderFilled, FileWordOutlined, FileExcelOutlined,
  FilePptOutlined, FileUnknownOutlined, InfoCircleOutlined,
  DollarOutlined, LinkOutlined, CheckOutlined, RightOutlined,
  ScissorOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import useStorageStore from '../../stores/storageStore'
import useAuthStore from '../../stores/authStore'
import './StorageManager.less'

const { Dragger } = Upload
const { useBreakpoint } = Grid

// ===== 常量 =====
const ViewMode = { GRID: 'grid', LIST: 'list' }

// ===== 工具函数 =====

/** 获取文件类型对应的CSS类名 */
const getFileTypeClass = (mimeType, fileName) => {
  const ext = fileName ? fileName.split('.').pop().toLowerCase() : ''
  if (mimeType?.startsWith('image/') || ['jpg','jpeg','png','gif','svg','webp','bmp'].includes(ext)) return 'image-file'
  if (mimeType?.startsWith('video/') || ['mp4','avi','mov','wmv','flv','mkv'].includes(ext)) return 'video-file'
  if (mimeType?.includes('pdf') || ext === 'pdf') return 'pdf-file'
  if (mimeType?.includes('word') || ['doc','docx'].includes(ext)) return 'document-file'
  if (mimeType?.includes('excel') || mimeType?.includes('spreadsheet') || ['xls','xlsx'].includes(ext)) return 'excel-file'
  if (mimeType?.includes('powerpoint') || mimeType?.includes('presentation') || ['ppt','pptx'].includes(ext)) return 'ppt-file'
  if (mimeType?.includes('zip') || mimeType?.includes('rar') || ['zip','rar','7z','tar','gz'].includes(ext)) return 'archive-file'
  if (mimeType?.includes('text') || ['txt','md','json','js','css','html','xml','csv'].includes(ext)) return 'text-file'
  return 'unknown-file'
}

/** 文件图标组件 */
const FileIcon = ({ mimeType, fileName, size = 64 }) => {
  const iconProps = { style: { fontSize: size } }
  const ext = fileName ? fileName.split('.').pop().toLowerCase() : ''
  if (mimeType?.startsWith('image/') || ['jpg','jpeg','png','gif','svg','webp','bmp'].includes(ext))
    return <FileImageOutlined {...iconProps} className="file-icon image-icon" />
  if (mimeType?.startsWith('video/') || ['mp4','avi','mov','wmv','flv','mkv'].includes(ext))
    return <VideoCameraOutlined {...iconProps} className="file-icon video-icon" />
  if (mimeType?.includes('pdf') || ext === 'pdf')
    return <FilePdfOutlined {...iconProps} className="file-icon pdf-icon" />
  if (mimeType?.includes('word') || ['doc','docx'].includes(ext))
    return <FileWordOutlined {...iconProps} className="file-icon document-icon" />
  if (mimeType?.includes('excel') || mimeType?.includes('spreadsheet') || ['xls','xlsx'].includes(ext))
    return <FileExcelOutlined {...iconProps} className="file-icon excel-icon" style={{ color: '#10b981' }} />
  if (mimeType?.includes('powerpoint') || mimeType?.includes('presentation') || ['ppt','pptx'].includes(ext))
    return <FilePptOutlined {...iconProps} className="file-icon ppt-icon" style={{ color: '#f97316' }} />
  if (mimeType?.includes('zip') || mimeType?.includes('rar') || ['zip','rar','7z','tar','gz'].includes(ext))
    return <FileZipOutlined {...iconProps} className="file-icon archive-icon" />
  if (mimeType?.includes('text') || ['txt','md','json','js','css','html','xml','csv'].includes(ext))
    return <FileTextOutlined {...iconProps} className="file-icon document-icon" />
  return <FileUnknownOutlined {...iconProps} className="file-icon" />
}

/** 格式化文件大小 */
const formatFileSize = (bytes) => {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

/** 复制到剪贴板 */
const copyToClipboard = async (text, successMsg, errorMsg) => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    } else {
      const ta = document.createElement('textarea')
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select(); document.execCommand('copy')
      document.body.removeChild(ta)
    }
    message.success(successMsg || '已复制')
  } catch { message.error(errorMsg || '复制失败') }
}

// ===== 主组件 =====
const StorageManager = () => {
  const { t } = useTranslation()
  const screens = useBreakpoint()
  const contentRef = useRef(null)

  // Store
  const {
    files, folders, folderTree, currentFolder, selectedFiles, selectedFolders,
    storageStats, creditConfig, loading, uploading,
    getFiles, getFolders, getFolderTree, getStorageStats, getCreditConfig,
    uploadFiles, deleteFile, deleteFiles, moveFile, batchMoveFiles, renameFile,
    createFolder, renameFolder, deleteFolder,
    setCurrentFolder, setSelectedFiles, setSelectedFolders,
    toggleSelectAll, clearSelection, calculateUploadCredits
  } = useStorageStore()
  const { user } = useAuthStore()

  // ===== 状态 =====
  const [viewMode, setViewMode] = useState(ViewMode.GRID)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [createFolderVisible, setCreateFolderVisible] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [uploadModalVisible, setUploadModalVisible] = useState(false)
  const [fileList, setFileList] = useState([])
  const [previewVisible, setPreviewVisible] = useState(false)
  const [previewFile, setPreviewFile] = useState(null)
  const [treeSelectedKeys, setTreeSelectedKeys] = useState(['root'])
  const [treeExpandedKeys, setTreeExpandedKeys] = useState([])
  const [dragActive, setDragActive] = useState(false)
  const [contextMenu, setContextMenu] = useState(null) // { x, y, item, type: 'file'|'folder'|'blank' }
  const [renamingId, setRenamingId] = useState(null)    // 当前正在重命名的文件/文件夹ID
  const [renamingType, setRenamingType] = useState(null) // 'file' | 'folder'
  const [renameValue, setRenameValue] = useState('')
  const [moveModalVisible, setMoveModalVisible] = useState(false) // 移动到弹窗
  const [moveTargetFolderId, setMoveTargetFolderId] = useState(null)
  const [lastClickedIndex, setLastClickedIndex] = useState(-1) // Shift选择的锚点
  const [uploadCreditsNeeded, setUploadCreditsNeeded] = useState(0)
  const [dragOverFolderId, setDragOverFolderId] = useState(null) // 拖拽经过的文件夹ID
  const [draggingItems, setDraggingItems] = useState([])  // 正在拖拽的项目

  // 用户积分
  const userCredits = useMemo(() => {
    if (!user) return 0
    return Math.max(0, (user.credits_quota || 0) - (user.used_credits || 0))
  }, [user])

  // 文件夹内文件计数
  const folderCounts = useMemo(() => {
    const counts = {}
    folders.forEach(folder => {
      counts[folder.id] = files.filter(f => f.folder_id === folder.id).length
    })
    return counts
  }, [files, folders])

  // 过滤后的文件和文件夹
  const filteredFiles = useMemo(() =>
    files.filter(f => f.original_name.toLowerCase().includes(searchKeyword.toLowerCase())),
    [files, searchKeyword]
  )
  const filteredFolders = useMemo(() =>
    folders.filter(f => f.name.toLowerCase().includes(searchKeyword.toLowerCase())),
    [folders, searchKeyword]
  )

  // 所有可选项的有序列表（用于Shift选择）
  const allItems = useMemo(() => [
    ...filteredFolders.map(f => ({ id: f.id, type: 'folder' })),
    ...filteredFiles.map(f => ({ id: f.id, type: 'file' }))
  ], [filteredFolders, filteredFiles])

  // 计算上传所需积分
  useEffect(() => {
    if (fileList.length > 0 && creditConfig) {
      const fs = fileList.map(f => f.originFileObj || f).filter(Boolean)
      setUploadCreditsNeeded(calculateUploadCredits(fs))
    } else {
      setUploadCreditsNeeded(0)
    }
  }, [fileList, creditConfig, calculateUploadCredits])

  // ===== 数据加载 =====
  useEffect(() => { loadData(); getCreditConfig() }, [currentFolder])

  const loadData = async () => {
    await Promise.all([
      getFiles(currentFolder?.id),
      getFolders(currentFolder?.id),
      getFolderTree(),
      getStorageStats()
    ])
  }

  // ===== 键盘快捷键 =====
  useEffect(() => {
    const handleKeyDown = (e) => {
      // 如果正在重命名，不处理快捷键
      if (renamingId) return
      // 如果焦点在输入框，不处理
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return

      // Delete - 删除选中项
      if (e.key === 'Delete' && (selectedFiles.length > 0 || selectedFolders.length > 0)) {
        e.preventDefault()
        handleBatchDelete()
      }
      // F2 - 重命名（单选时）
      if (e.key === 'F2') {
        e.preventDefault()
        if (selectedFiles.length === 1 && selectedFolders.length === 0) {
          const file = files.find(f => f.id === selectedFiles[0])
          if (file) startRename(file.id, 'file', file.original_name)
        } else if (selectedFolders.length === 1 && selectedFiles.length === 0) {
          const folder = folders.find(f => f.id === selectedFolders[0])
          if (folder) startRename(folder.id, 'folder', folder.name)
        }
      }
      // Ctrl+A - 全选
      if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        setSelectedFiles(filteredFiles.map(f => f.id))
        setSelectedFolders(filteredFolders.map(f => f.id))
      }
      // Escape - 取消选择
      if (e.key === 'Escape') {
        clearSelection()
        setContextMenu(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedFiles, selectedFolders, renamingId, files, folders, filteredFiles, filteredFolders])

  // 点击空白处关闭右键菜单
  useEffect(() => {
    const handleClick = () => setContextMenu(null)
    window.addEventListener('click', handleClick)
    return () => window.removeEventListener('click', handleClick)
  }, [])

  // ===== 选择逻辑 =====
  const handleItemClick = useCallback((e, itemId, itemType, index) => {
    // 关闭右键菜单
    setContextMenu(null)

    if (e.ctrlKey || e.metaKey) {
      // Ctrl+点击：切换单个选择
      if (itemType === 'file') {
        setSelectedFiles(prev => 
          prev.includes(itemId) ? prev.filter(id => id !== itemId) : [...prev, itemId]
        )
      } else {
        setSelectedFolders(prev =>
          prev.includes(itemId) ? prev.filter(id => id !== itemId) : [...prev, itemId]
        )
      }
      setLastClickedIndex(index)
    } else if (e.shiftKey && lastClickedIndex >= 0) {
      // Shift+点击：范围选择
      const start = Math.min(lastClickedIndex, index)
      const end = Math.max(lastClickedIndex, index)
      const rangeItems = allItems.slice(start, end + 1)
      setSelectedFiles(rangeItems.filter(i => i.type === 'file').map(i => i.id))
      setSelectedFolders(rangeItems.filter(i => i.type === 'folder').map(i => i.id))
    } else {
      // 普通点击：单选
      if (itemType === 'file') {
        setSelectedFiles([itemId])
        setSelectedFolders([])
      } else {
        setSelectedFolders([itemId])
        setSelectedFiles([])
      }
      setLastClickedIndex(index)
    }
  }, [lastClickedIndex, allItems, setSelectedFiles, setSelectedFolders])

  // 点击空白区域取消选择
  const handleContentClick = useCallback((e) => {
    if (e.target === e.currentTarget || e.target.closest('.file-grid') === e.currentTarget.querySelector('.file-grid') && !e.target.closest('.file-item')) {
      clearSelection()
      setLastClickedIndex(-1)
    }
  }, [clearSelection])

  // ===== 拖拽上传 =====
  const dragCounter = useRef(0)
  const handleDragEnter = (e) => { e.preventDefault(); dragCounter.current++; setDragActive(true) }
  const handleDragLeave = (e) => { e.preventDefault(); dragCounter.current--; if (dragCounter.current <= 0) { setDragActive(false); dragCounter.current = 0 } }
  const handleDragOver = (e) => { e.preventDefault() }
  const handleDrop = async (e) => {
    e.preventDefault(); setDragActive(false); dragCounter.current = 0
    const droppedFiles = Array.from(e.dataTransfer.files)
    if (droppedFiles.length === 0) return
    try {
      const result = await uploadFiles(droppedFiles, currentFolder?.id)
      if (result.success?.length > 0) message.success(t('storage.uploadSuccess', { count: result.success.length }))
      if (result.failed?.length > 0) message.error(t('storage.uploadPartialFailed', { count: result.failed.length }))
      await loadData()
      // 刷新用户积分
      try { const authStore = useAuthStore.getState(); if (authStore.getCurrentUser) await authStore.getCurrentUser() } catch {}
    } catch { message.error(t('storage.uploadFailed')) }
  }

  // ===== 拖拽移动文件 =====
  const handleFileDragStart = useCallback((e, item, type) => {
    // 设置拖拽数据
    e.dataTransfer.setData('text/plain', JSON.stringify({ id: item.id, type }))
    e.dataTransfer.effectAllowed = 'move'
    // 如果拖拽的项目不在选中列表中，先选中它
    if (type === 'file' && !selectedFiles.includes(item.id)) {
      setSelectedFiles([item.id]); setSelectedFolders([])
    }
    if (type === 'folder' && !selectedFolders.includes(item.id)) {
      setSelectedFolders([item.id]); setSelectedFiles([])
    }
    setDraggingItems(type === 'file' ? selectedFiles.length > 0 && selectedFiles.includes(item.id) ? selectedFiles : [item.id] : [item.id])
  }, [selectedFiles, selectedFolders, setSelectedFiles, setSelectedFolders])

  const handleFolderDragOver = useCallback((e, folderId) => {
    e.preventDefault(); e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    setDragOverFolderId(folderId)
  }, [])

  const handleFolderDragLeave = useCallback((e) => {
    e.preventDefault()
    setDragOverFolderId(null)
  }, [])

  const handleFolderDrop = useCallback(async (e, targetFolderId) => {
    e.preventDefault(); e.stopPropagation(); setDragOverFolderId(null)
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'))
      if (!data?.id) return
      // 不能移动到自身
      if (data.type === 'folder' && data.id === targetFolderId) return
      // 移动选中的所有文件
      const fileIdsToMove = data.type === 'file' 
        ? (selectedFiles.includes(data.id) ? selectedFiles : [data.id])
        : []
      if (fileIdsToMove.length > 0) {
        const result = await batchMoveFiles(fileIdsToMove, targetFolderId)
        if (result.success > 0) message.success(t('storage.batchMoveSuccess', { success: result.success }))
        if (result.failed > 0) message.error(t('storage.batchMoveFailed', { failed: result.failed }))
        await loadData()
      }
    } catch { /* 忽略非内部拖拽 */ }
  }, [selectedFiles, batchMoveFiles, t, loadData])

  // 拖到左侧树的根目录
  const handleDropToRoot = useCallback(async (e) => {
    e.preventDefault(); e.stopPropagation()
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'))
      if (!data?.id || data.type !== 'file') return
      const fileIdsToMove = selectedFiles.includes(data.id) ? selectedFiles : [data.id]
      const result = await batchMoveFiles(fileIdsToMove, null)
      if (result.success > 0) message.success(t('storage.batchMoveSuccess', { success: result.success }))
      await loadData()
    } catch {}
  }, [selectedFiles, batchMoveFiles, t, loadData])

  // ===== 右键菜单 =====
  const handleContextMenu = useCallback((e, item = null, type = 'blank') => {
    e.preventDefault(); e.stopPropagation()
    // 如果右键了未选中的项目，先选中它
    if (item && type === 'file' && !selectedFiles.includes(item.id)) {
      setSelectedFiles([item.id]); setSelectedFolders([])
    }
    if (item && type === 'folder' && !selectedFolders.includes(item.id)) {
      setSelectedFolders([item.id]); setSelectedFiles([])
    }
    setContextMenu({ x: e.clientX, y: e.clientY, item, type })
  }, [selectedFiles, selectedFolders, setSelectedFiles, setSelectedFolders])

  // ===== 内联重命名 =====
  const startRename = useCallback((id, type, currentName) => {
    setRenamingId(id); setRenamingType(type); setRenameValue(currentName)
    setContextMenu(null)
  }, [])

  const commitRename = useCallback(async () => {
    if (!renamingId || !renameValue.trim()) { setRenamingId(null); return }
    try {
      if (renamingType === 'file') {
        await renameFile(renamingId, renameValue.trim())
        message.success(t('storage.renameFileSuccess'))
      } else {
        await renameFolder(renamingId, renameValue.trim())
        message.success(t('storage.renameFolderSuccess'))
      }
      await loadData()
    } catch {
      message.error(renamingType === 'file' ? t('storage.renameFileFailed') : t('storage.renameFolderFailed'))
    }
    setRenamingId(null); setRenamingType(null)
  }, [renamingId, renamingType, renameValue, renameFile, renameFolder, t, loadData])

  const handleRenameKeyDown = useCallback((e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitRename() }
    if (e.key === 'Escape') { setRenamingId(null) }
  }, [commitRename])

  // ===== 文件操作 =====
  const handleUpload = async () => {
    if (fileList.length === 0) { message.warning(t('storage.selectFilesFirst')); return }
    if (uploadCreditsNeeded > 0 && userCredits < uploadCreditsNeeded) {
      message.error(t('storage.insufficientCredits', { required: uploadCreditsNeeded, current: userCredits })); return
    }
    const fs = fileList.map(f => f.originFileObj || f)
    try {
      const result = await uploadFiles(fs, currentFolder?.id)
      if (result.success?.length > 0) message.success(t('storage.uploadSuccess', { count: result.success.length }))
      if (result.failed?.length > 0) message.error(t('storage.uploadPartialFailed', { count: result.failed.length }))
      setUploadModalVisible(false); setFileList([]); await loadData()
      try { const authStore = useAuthStore.getState(); if (authStore.getCurrentUser) await authStore.getCurrentUser() } catch {}
    } catch { message.error(t('storage.uploadFailed')) }
  }

  const handleDelete = useCallback(async (file) => {
    Modal.confirm({
      title: t('common.confirmDelete'),
      content: t('storage.confirmDeleteFile', { name: file.original_name }),
      onOk: async () => {
        try { await deleteFile(file.id); message.success(t('common.deleteSuccess')); await loadData() }
        catch { message.error(t('common.deleteFailed')) }
      }
    })
  }, [deleteFile, t, loadData])

  const handleDeleteFolder = useCallback(async (folder) => {
    const count = folderCounts[folder.id] || 0
    Modal.confirm({
      title: t('common.confirmDelete'),
      content: count > 0 ? t('storage.confirmDeleteFolderWithFiles', { name: folder.name, count }) : t('storage.confirmDeleteFolder', { name: folder.name }),
      okButtonProps: { danger: true },
      onOk: async () => {
        try { await deleteFolder(folder.id); message.success(t('common.deleteSuccess')); await loadData() }
        catch { message.error(t('common.deleteFailed')) }
      }
    })
  }, [deleteFolder, folderCounts, t, loadData])

  const handleBatchDelete = useCallback(async () => {
    const totalCount = selectedFiles.length + selectedFolders.length
    if (totalCount === 0) { message.warning(t('storage.selectFilesFirst')); return }
    Modal.confirm({
      title: t('common.confirmDelete'),
      content: t('storage.confirmDeleteFiles', { count: totalCount }),
      onOk: async () => {
        try {
          if (selectedFiles.length > 0) await deleteFiles(selectedFiles)
          for (const fId of selectedFolders) { try { await deleteFolder(fId) } catch {} }
          message.success(t('common.deleteSuccess')); clearSelection(); await loadData()
        } catch { message.error(t('common.deleteFailed')) }
      }
    })
  }, [selectedFiles, selectedFolders, deleteFiles, deleteFolder, clearSelection, t, loadData])

  const handleCreateFolder = async () => {
    if (!folderName) { message.warning(t('storage.enterFolderName')); return }
    try {
      await createFolder(folderName, currentFolder?.id)
      message.success(t('storage.createFolderSuccess'))
      setCreateFolderVisible(false); setFolderName(''); await loadData()
    } catch { message.error(t('storage.createFolderFailed')) }
  }

  // 打开"移动到"弹窗
  const openMoveModal = useCallback(() => {
    setMoveTargetFolderId(null)
    setMoveModalVisible(true)
    setContextMenu(null)
  }, [])

  const handleMoveConfirm = useCallback(async () => {
    const fileIdsToMove = selectedFiles.length > 0 ? selectedFiles : (contextMenu?.item ? [contextMenu.item.id] : [])
    if (fileIdsToMove.length === 0) return
    try {
      const result = await batchMoveFiles(fileIdsToMove, moveTargetFolderId)
      if (result.success > 0) message.success(t('storage.batchMoveSuccess', { success: result.success }))
      if (result.failed > 0) message.error(t('storage.batchMoveFailed', { failed: result.failed }))
      setMoveModalVisible(false); clearSelection(); await loadData()
    } catch { message.error(t('storage.moveFailed')) }
  }, [selectedFiles, contextMenu, moveTargetFolderId, batchMoveFiles, clearSelection, t, loadData])

  // ===== 树节点选择 =====
  const handleTreeSelect = (keys, info) => {
    setTreeSelectedKeys(keys)
    if (keys[0] === 'root') setCurrentFolder(null)
    else setCurrentFolder(info.node)
    clearSelection()
  }

  const buildFlatTreeData = () => {
    const convertToTreeData = (fds) => fds.map(folder => ({
      key: folder.id, title: folder.name,
      icon: folder.children?.length > 0 ? <FolderFilled /> : <FolderOutlined />,
      children: folder.children ? convertToTreeData(folder.children) : [],
      ...folder
    }))
    return [
      { key: 'root', title: t('storage.myFolder'), icon: <FolderOutlined />, children: [] },
      ...convertToTreeData(folderTree)
    ]
  }

  // 移动弹窗的树数据
  const buildMoveTreeData = () => {
    const convertToTreeData = (fds) => fds.map(folder => ({
      key: folder.id, title: folder.name, icon: <FolderOutlined />,
      children: folder.children ? convertToTreeData(folder.children) : []
    }))
    return [
      { key: 'root-target', title: t('storage.moveToRoot'), icon: <HomeOutlined />, children: [] },
      ...convertToTreeData(folderTree)
    ]
  }

  const getCurrentFolderDisplayName = () => currentFolder ? currentFolder.name : t('storage.myFolder')

  // ===== 右键菜单渲染 =====
  const renderContextMenu = () => {
    if (!contextMenu) return null
    const { x, y, item, type } = contextMenu

    // 调整菜单位置防止溢出屏幕
    const menuStyle = { left: x, top: y }
    if (x + 240 > window.innerWidth) menuStyle.left = x - 240
    if (y + 300 > window.innerHeight) menuStyle.top = y - 200

    if (type === 'folder') {
      return (
        <div className="context-menu" style={menuStyle} onClick={(e) => e.stopPropagation()}>
          <div className="menu-item" onClick={() => { setCurrentFolder(item); setContextMenu(null) }}>
            <FolderOpenOutlined className="menu-icon" /><span className="menu-label">{t('storage.open')}</span>
          </div>
          <div className="menu-item" onClick={() => startRename(item.id, 'folder', item.name)}>
            <EditOutlined className="menu-icon" /><span className="menu-label">{t('storage.rename')}</span><span className="menu-shortcut">F2</span>
          </div>
          <div className="menu-divider" />
          <div className="menu-item danger" onClick={() => { handleDeleteFolder(item); setContextMenu(null) }}>
            <DeleteOutlined className="menu-icon" /><span className="menu-label">{t('common.delete')}</span><span className="menu-shortcut">Del</span>
          </div>
        </div>
      )
    }

    if (type === 'file') {
      return (
        <div className="context-menu" style={menuStyle} onClick={(e) => e.stopPropagation()}>
          <div className="menu-item" onClick={() => { setPreviewFile(item); setPreviewVisible(true); setContextMenu(null) }}>
            <EyeOutlined className="menu-icon" /><span className="menu-label">{t('common.preview')}</span>
          </div>
          <div className="menu-item" onClick={() => { window.open(item.oss_url, '_blank'); setContextMenu(null) }}>
            <DownloadOutlined className="menu-icon" /><span className="menu-label">{t('common.download')}</span>
          </div>
          <div className="menu-divider" />
          <div className="menu-item" onClick={() => startRename(item.id, 'file', item.original_name)}>
            <EditOutlined className="menu-icon" /><span className="menu-label">{t('storage.rename')}</span><span className="menu-shortcut">F2</span>
          </div>
          <div className="menu-item" onClick={openMoveModal}>
            <ScissorOutlined className="menu-icon" />
            <span className="menu-label">{t('storage.moveTo')}</span>
            <RightOutlined className="submenu-arrow" />
          </div>
          <div className="menu-item" onClick={() => { copyToClipboard(item.oss_url, t('storage.linkCopied'), t('storage.copyFailed')); setContextMenu(null) }}>
            <LinkOutlined className="menu-icon" /><span className="menu-label">{t('storage.copyLink')}</span>
          </div>
          <div className="menu-divider" />
          <div className="menu-item danger" onClick={() => { handleDelete(item); setContextMenu(null) }}>
            <DeleteOutlined className="menu-icon" /><span className="menu-label">{t('common.delete')}</span><span className="menu-shortcut">Del</span>
          </div>
        </div>
      )
    }

    // 空白处右键
    return (
      <div className="context-menu" style={menuStyle} onClick={(e) => e.stopPropagation()}>
        <div className="menu-item" onClick={() => { setUploadModalVisible(true); setContextMenu(null) }}>
          <CloudUploadOutlined className="menu-icon" /><span className="menu-label">{t('storage.uploadHere')}</span>
        </div>
        <div className="menu-item" onClick={() => { setCreateFolderVisible(true); setContextMenu(null) }}>
          <FolderAddOutlined className="menu-icon" /><span className="menu-label">{t('storage.newFolderHere')}</span>
        </div>
        <div className="menu-divider" />
        <div className="menu-item" onClick={() => { setSelectedFiles(filteredFiles.map(f=>f.id)); setSelectedFolders(filteredFolders.map(f=>f.id)); setContextMenu(null) }}>
          <CheckOutlined className="menu-icon" /><span className="menu-label">{t('storage.selectAll')}</span><span className="menu-shortcut">Ctrl+A</span>
        </div>
        <div className="menu-item" onClick={() => { loadData(); setContextMenu(null) }}>
          <ReloadOutlined className="menu-icon" /><span className="menu-label">{t('storage.refresh')}</span>
        </div>
      </div>
    )
  }

  // ===== 网格视图 =====
  const renderGridView = () => (
    <div className="file-grid">
      {filteredFolders.map((folder, idx) => {
        const fileCount = folderCounts[folder.id] || 0
        const isSelected = selectedFolders.includes(folder.id)
        const isDropTarget = dragOverFolderId === folder.id
        const isDragging = draggingItems.includes(folder.id)
        const isRenaming = renamingId === folder.id && renamingType === 'folder'

        return (
          <div
            key={`folder-${folder.id}`}
            className={`file-item folder-item ${isSelected ? 'selected' : ''} ${isDropTarget ? 'drop-target' : ''} ${isDragging ? 'dragging' : ''}`}
            draggable={!isRenaming}
            onClick={(e) => handleItemClick(e, folder.id, 'folder', idx)}
            onDoubleClick={() => !isRenaming && setCurrentFolder(folder)}
            onContextMenu={(e) => handleContextMenu(e, folder, 'folder')}
            onDragStart={(e) => handleFileDragStart(e, folder, 'folder')}
            onDragOver={(e) => handleFolderDragOver(e, folder.id)}
            onDragLeave={handleFolderDragLeave}
            onDrop={(e) => handleFolderDrop(e, folder.id)}
            onDragEnd={() => { setDraggingItems([]); setDragOverFolderId(null) }}
          >
            <div className="select-badge">{isSelected ? <CheckOutlined /> : null}</div>
            <div className="file-icon folder-icon">
              {fileCount > 0 ? <FolderFilled /> : <FolderOutlined />}
              {fileCount > 0 && <span className="file-count">{fileCount}</span>}
            </div>
            {isRenaming ? (
              <input
                className="rename-input"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={handleRenameKeyDown}
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <div className="file-name">{folder.name}</div>
            )}
            <div className="file-size">{t('storage.folder')}</div>
          </div>
        )
      })}

      {filteredFiles.map((file, idx) => {
        const fileTypeClass = getFileTypeClass(file.mime_type, file.original_name)
        const isSelected = selectedFiles.includes(file.id)
        const isDragging = draggingItems.includes(file.id)
        const isRenaming = renamingId === file.id && renamingType === 'file'
        const globalIdx = filteredFolders.length + idx

        return (
          <div
            key={`file-${file.id}`}
            className={`file-item ${fileTypeClass} ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
            draggable={!isRenaming}
            onClick={(e) => handleItemClick(e, file.id, 'file', globalIdx)}
            onDoubleClick={() => !isRenaming && (() => { setPreviewFile(file); setPreviewVisible(true) })()}
            onContextMenu={(e) => handleContextMenu(e, file, 'file')}
            onDragStart={(e) => handleFileDragStart(e, file, 'file')}
            onDragEnd={() => setDraggingItems([])}
          >
            <div className="select-badge">{isSelected ? <CheckOutlined /> : null}</div>
            <FileIcon mimeType={file.mime_type} fileName={file.original_name} />
            {isRenaming ? (
              <input
                className="rename-input"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={handleRenameKeyDown}
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <div className="file-name">{file.original_name}</div>
            )}
            <div className="file-size">{formatFileSize(file.file_size)}</div>
          </div>
        )
      })}
    </div>
  )

  // ===== 列表视图表格列配置 =====
  const columns = [
    {
      title: t('storage.fileName'), dataIndex: 'name', key: 'name',
      render: (_, record) => {
        if (record._isFolder) {
          const count = folderCounts[record.id] || 0
          return (<Space><FolderFilled style={{ color: '#fbbf24', fontSize: 24 }} /><span style={{ fontWeight: 600 }}>{record.name}</span>{count > 0 && <Tag color="orange">{count}</Tag>}</Space>)
        }
        return (<Space><FileIcon mimeType={record.mime_type} fileName={record.original_name} size={24} /><span>{record.original_name}</span></Space>)
      }
    },
    { title: t('storage.fileSize'), dataIndex: 'file_size', key: 'size', width: 120, render: (s, r) => r._isFolder ? '-' : formatFileSize(s) },
    { title: t('storage.uploadTime'), dataIndex: 'created_at', key: 'time', width: 180, render: (d) => d ? new Date(d).toLocaleString() : '-' },
    {
      title: t('common.operation'), key: 'action', width: 200,
      render: (_, record) => {
        if (record._isFolder) {
          return (<Space>
            <Button type="link" size="small" onClick={() => setCurrentFolder(record)}>{t('storage.open')}</Button>
            <Button type="link" size="small" onClick={() => startRename(record.id, 'folder', record.name)}><EditOutlined /></Button>
            <Button type="link" size="small" danger onClick={() => handleDeleteFolder(record)}><DeleteOutlined /></Button>
          </Space>)
        }
        return (<Space>
          <Tooltip title={t('common.preview')}><Button type="link" size="small" onClick={() => { setPreviewFile(record); setPreviewVisible(true) }}><EyeOutlined /></Button></Tooltip>
          <Tooltip title={t('common.download')}><Button type="link" size="small" onClick={() => window.open(record.oss_url, '_blank')}><DownloadOutlined /></Button></Tooltip>
          <Tooltip title={t('storage.copyLink')}><Button type="link" size="small" onClick={() => copyToClipboard(record.oss_url, t('storage.linkCopied'))}><LinkOutlined /></Button></Tooltip>
          <Tooltip title={t('common.delete')}><Button type="link" size="small" danger onClick={() => handleDelete(record)}><DeleteOutlined /></Button></Tooltip>
        </Space>)
      }
    }
  ]

  const getCreditDescription = () => {
    if (!creditConfig) return ''
    return t('storage.creditRule5MB', { base: creditConfig.base_credits, per5mb: creditConfig.credits_per_5mb })
  }

  // ===== 渲染 =====
  return (
    <div className="storage-manager" tabIndex={-1}>
      <div className="storage-layout">
        {/* ===== 侧边栏 ===== */}
        <div className="storage-sidebar">
          <div className="folder-tree-card">
            <div className="folder-tree-header">{t('storage.smartStorage')}</div>
            <div className="folder-list-title">{t('storage.folderList')}</div>
            <div className="folder-tree">
              <Tree
                showIcon showLine={{ showLeafIcon: false }}
                selectedKeys={treeSelectedKeys}
                treeData={buildFlatTreeData()}
                onSelect={handleTreeSelect}
                expandedKeys={treeExpandedKeys}
                onExpand={setTreeExpandedKeys}
                onDrop={({ event }) => handleDropToRoot(event)}
              />
            </div>
          </div>
          {storageStats && (
            <div className="storage-info-card">
              <div>{t('storage.storageInfo')}</div>
              <Progress className="storage-progress"
                percent={Math.round((storageStats.storage_used / storageStats.storage_quota) * 100)}
                status={storageStats.storage_used > storageStats.storage_quota * 0.9 ? 'exception' : 'active'}
                strokeLinecap="round" />
              <div className="storage-stats">
                <div className="stat-item"><div className="stat-value">{formatFileSize(storageStats.storage_used)}</div><div className="stat-label">{t('storage.used')}</div></div>
                <div className="stat-item"><div className="stat-value">{formatFileSize(storageStats.storage_quota)}</div><div className="stat-label">{t('storage.total')}</div></div>
              </div>
            </div>
          )}
        </div>

        {/* ===== 主内容区 ===== */}
        <div className="storage-main">
          {/* 工具栏 */}
          <div className="storage-toolbar">
            <div className="breadcrumb-nav">
              <div className="current-folder-name">
                <FolderOutlined className="folder-icon" />{getCurrentFolderDisplayName()}
              </div>
              <Breadcrumb items={[
                { title: <HomeOutlined />, onClick: () => setCurrentFolder(null) },
                ...(currentFolder ? [{ title: currentFolder.name }] : [])
              ]} />
            </div>
            <div className="toolbar-actions">
              <div className="search-box">
                <Input placeholder={t('storage.searchPlaceholder')} value={searchKeyword} onChange={(e) => setSearchKeyword(e.target.value)} allowClear />
                <SearchOutlined className="search-icon" />
              </div>
              <div className="view-switcher">
                <button className={viewMode === ViewMode.GRID ? 'active' : ''} onClick={() => setViewMode(ViewMode.GRID)} title={t('storage.gridView')}><AppstoreOutlined /></button>
                <button className={viewMode === ViewMode.LIST ? 'active' : ''} onClick={() => setViewMode(ViewMode.LIST)} title={t('storage.listView')}><BarsOutlined /></button>
              </div>
              <Button icon={<FolderAddOutlined />} onClick={() => setCreateFolderVisible(true)}>{screens.md && t('storage.newFolder')}</Button>
              {(selectedFiles.length + selectedFolders.length) > 0 && (
                <Button danger icon={<DeleteOutlined />} onClick={handleBatchDelete}>
                  {t('storage.selectedCount', { count: selectedFiles.length + selectedFolders.length })}
                </Button>
              )}
              <Button icon={<ReloadOutlined />} onClick={loadData} title={t('storage.refresh')} />
            </div>
          </div>

          {/* 内容区域 */}
          <div ref={contentRef}
            className={`storage-content ${viewMode}-view ${dragActive ? 'drag-active' : ''}`}
            onDragEnter={handleDragEnter} onDragLeave={handleDragLeave}
            onDragOver={handleDragOver} onDrop={handleDrop}
            onClick={handleContentClick}
            onContextMenu={(e) => { if (e.target === e.currentTarget || !e.target.closest('.file-item')) handleContextMenu(e, null, 'blank') }}
          >
            {loading ? (
              <div className="loading-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                <Spin size="large" tip={t('storage.loading')} />
              </div>
            ) : (
              <>
                {viewMode === ViewMode.GRID ? renderGridView() : (
                  <Table columns={columns}
                    dataSource={[...filteredFolders.map(f => ({...f, _isFolder: true})), ...filteredFiles]}
                    rowKey={(r) => r._isFolder ? `folder-${r.id}` : `file-${r.id}`}
                    pagination={false}
                    onRow={(record) => ({
                      onDoubleClick: () => record._isFolder ? setCurrentFolder(record) : (() => { setPreviewFile(record); setPreviewVisible(true) })(),
                      onContextMenu: (e) => handleContextMenu(e, record, record._isFolder ? 'folder' : 'file'),
                      className: (record._isFolder ? selectedFolders.includes(record.id) : selectedFiles.includes(record.id)) ? 'selected-row' : ''
                    })}
                  />
                )}
                {filteredFiles.length === 0 && filteredFolders.length === 0 && (
                  <div className="empty-state">
                    <InboxOutlined className="empty-icon" />
                    <div className="empty-text">{t('storage.noFiles')}</div>
                    <div className="empty-hint">{t('storage.ctrlClickTip')} | {t('storage.deleteKeyTip')}</div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* 底部状态栏 */}
          <div className="storage-status-bar">
            <div className="status-left">
              <span>{t('storage.itemCount', { folders: filteredFolders.length, files: filteredFiles.length })}</span>
              {(selectedFiles.length + selectedFolders.length) > 0 && (
                <span style={{ color: '#3b82f6', fontWeight: 600 }}>
                  {t('storage.selectedCount', { count: selectedFiles.length + selectedFolders.length })}
                </span>
              )}
            </div>
            <div className="status-right">
              <span>Ctrl+Click {t('storage.ctrlClickTip')}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 浮动上传按钮 */}
      <button className="upload-fab" onClick={() => setUploadModalVisible(true)}><CloudUploadOutlined /></button>

      {/* 右键菜单 */}
      {renderContextMenu()}

      {/* ===== 弹窗 ===== */}

      {/* 上传弹窗 */}
      <Modal title={t('storage.uploadFiles')} open={uploadModalVisible}
        onOk={handleUpload} onCancel={() => { setUploadModalVisible(false); setFileList([]); setUploadCreditsNeeded(0) }}
        confirmLoading={uploading} width={700}>
        {creditConfig && (
          <Alert message={t('storage.uploadDescription')} description={
            <div>
              <div style={{ marginBottom: 8 }}><InfoCircleOutlined style={{ marginRight: 8 }} /><strong>{t('storage.fileSizeLimit')}</strong>{t('storage.singleFileLimit', { size: creditConfig.max_file_size || 100 })}</div>
              <div style={{ marginBottom: 8 }}><DollarOutlined style={{ marginRight: 8 }} /><strong>{t('storage.creditCalculation')}</strong>{getCreditDescription()}</div>
              <div><DollarOutlined style={{ marginRight: 8 }} /><strong>{t('storage.currentCredits')}</strong><span style={{ color: userCredits > 0 ? '#52c41a' : '#ff4d4f' }}>{userCredits} {t('storage.credits')}</span></div>
            </div>
          } type="info" showIcon style={{ marginBottom: 16 }} />
        )}
        <Dragger multiple fileList={fileList}
          beforeUpload={(file) => {
            const maxSize = (creditConfig?.max_file_size || 100) * 1024 * 1024
            if (file.size > maxSize) { message.error(t('storage.singleFileLimit', { size: creditConfig?.max_file_size || 100 })); return false }
            setFileList(prev => [...prev, file]); return false
          }}
          onRemove={(file) => setFileList(prev => prev.filter(f => f.uid !== file.uid))}>
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">{t('storage.uploadHint')}</p>
        </Dragger>
        {fileList.length > 0 && creditConfig && (
          <div style={{ marginTop: 16 }}><Divider />
            <Row gutter={16}>
              <Col span={8}><Statistic title={t('storage.selectedFiles')} value={fileList.length} suffix={t('storage.creditUnit')} /></Col>
              <Col span={8}><Statistic title={t('storage.totalSize')} value={formatFileSize(fileList.reduce((s, f) => s + (f.size || 0), 0))} /></Col>
              <Col span={8}><Statistic title={t('storage.requiredCredits')} value={uploadCreditsNeeded} suffix={t('storage.credits')} valueStyle={{ color: userCredits >= uploadCreditsNeeded ? '#52c41a' : '#ff4d4f' }} /></Col>
            </Row>
          </div>
        )}
      </Modal>

      {/* 创建文件夹弹窗 */}
      <Modal title={t('storage.createFolder')} open={createFolderVisible}
        onOk={handleCreateFolder} onCancel={() => { setCreateFolderVisible(false); setFolderName('') }}>
        <Input placeholder={t('storage.folderNamePlaceholder')} value={folderName} onChange={(e) => setFolderName(e.target.value)} onPressEnter={handleCreateFolder} />
      </Modal>

      {/* 移动到弹窗 */}
      <Modal title={t('storage.selectTargetFolder')} open={moveModalVisible}
        onOk={handleMoveConfirm} onCancel={() => setMoveModalVisible(false)} okText={t('storage.moveSuccess')} width={400}>
        <div className="move-folder-tree">
          <Tree showIcon treeData={buildMoveTreeData()}
            selectedKeys={moveTargetFolderId ? [moveTargetFolderId] : ['root-target']}
            onSelect={(keys) => setMoveTargetFolderId(keys[0] === 'root-target' ? null : keys[0])}
            defaultExpandAll />
        </div>
      </Modal>

      {/* 文件预览弹窗 */}
      <Modal title={previewFile?.original_name} open={previewVisible} footer={null} onCancel={() => setPreviewVisible(false)} width={800}>
        {previewFile && (
          <div className="file-preview">
            {previewFile.mime_type?.startsWith('image/')
              ? <img src={previewFile.oss_url} alt={previewFile.original_name} style={{ width: '100%' }} />
              : previewFile.mime_type?.startsWith('video/')
                ? <video src={previewFile.oss_url} controls style={{ width: '100%' }} />
                : <div style={{ textAlign: 'center', padding: 40 }}>
                    <FileOutlined style={{ fontSize: 64, color: '#999' }} />
                    <p>{t('storage.previewNotSupported')}</p>
                    <Button type="primary" icon={<DownloadOutlined />} onClick={() => window.open(previewFile.oss_url, '_blank')}>{t('common.download')}</Button>
                  </div>
            }
          </div>
        )}
      </Modal>
    </div>
  )
}

export default StorageManager
