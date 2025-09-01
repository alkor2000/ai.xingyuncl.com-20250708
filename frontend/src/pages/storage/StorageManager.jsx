/**
 * 文件存储管理页面 - iOS风格界面（增强版）
 * 支持拖拽上传、多视图切换、右键菜单、文件夹删除等功能
 * 修改：在列表视图操作列添加复制链接按钮
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  Layout,
  Card,
  Button,
  Upload,
  Table,
  Space,
  Modal,
  Input,
  message,
  Dropdown,
  Menu,
  Progress,
  Empty,
  Breadcrumb,
  Checkbox,
  Tooltip,
  Tag,
  Row,
  Col,
  Statistic,
  Tree,
  Spin,
  Grid,
  Avatar,
  Badge,
  Alert,
  Divider
} from 'antd'
import {
  UploadOutlined,
  FolderAddOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  CopyOutlined,
  ScissorOutlined,
  FolderOutlined,
  FolderOpenOutlined,
  FileOutlined,
  FileImageOutlined,
  VideoCameraOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  FileZipOutlined,
  HomeOutlined,
  ReloadOutlined,
  CloudUploadOutlined,
  InboxOutlined,
  SearchOutlined,
  AppstoreOutlined,
  BarsOutlined,
  PictureOutlined,
  PlusOutlined,
  MoreOutlined,
  ShareAltOutlined,
  EditOutlined,
  StarOutlined,
  StarFilled,
  ClockCircleOutlined,
  FolderFilled,
  FileWordOutlined,
  FileExcelOutlined,
  FilePptOutlined,
  FileUnknownOutlined,
  InfoCircleOutlined,
  DollarOutlined,
  LinkOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { DndProvider, useDrag, useDrop } from 'react-dnd'
import { HTML5Backend } from 'react-dnd-html5-backend'
import useStorageStore from '../../stores/storageStore'
import useAuthStore from '../../stores/authStore'
import './StorageManager.less'

const { Content, Sider } = Layout
const { Dragger } = Upload
const { useBreakpoint } = Grid
const { Search } = Input

// 文件拖拽项类型
const ItemTypes = {
  FILE: 'file',
  FOLDER: 'folder'
}

// 视图模式枚举
const ViewMode = {
  GRID: 'grid',
  LIST: 'list',
  GALLERY: 'gallery'
}

/**
 * 获取文件类型对应的CSS类名
 */
const getFileTypeClass = (mimeType, fileName) => {
  const ext = fileName ? fileName.split('.').pop().toLowerCase() : ''
  
  // 图片类型
  if (mimeType?.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp'].includes(ext)) {
    return 'image-file'
  }
  
  // 视频类型
  if (mimeType?.startsWith('video/') || ['mp4', 'avi', 'mov', 'wmv', 'flv', 'mkv'].includes(ext)) {
    return 'video-file'
  }
  
  // PDF
  if (mimeType?.includes('pdf') || ext === 'pdf') {
    return 'pdf-file'
  }
  
  // Word文档
  if (mimeType?.includes('word') || ['doc', 'docx'].includes(ext)) {
    return 'document-file'
  }
  
  // Excel表格
  if (mimeType?.includes('excel') || mimeType?.includes('spreadsheet') || ['xls', 'xlsx'].includes(ext)) {
    return 'excel-file'
  }
  
  // PPT演示
  if (mimeType?.includes('powerpoint') || mimeType?.includes('presentation') || ['ppt', 'pptx'].includes(ext)) {
    return 'ppt-file'
  }
  
  // 压缩文件
  if (mimeType?.includes('zip') || mimeType?.includes('rar') || ['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
    return 'archive-file'
  }
  
  // 文本文件
  if (mimeType?.includes('text') || ['txt', 'md', 'json', 'js', 'css', 'html', 'xml', 'csv'].includes(ext)) {
    return 'text-file'
  }
  
  // 未知类型
  return 'unknown-file'
}

/**
 * 文件/文件夹拖拽组件
 */
const DraggableItem = ({ item, type, children, onMove }) => {
  const [{ isDragging }, drag] = useDrag({
    type: type,
    item: { id: item.id, type },
    collect: (monitor) => ({
      isDragging: monitor.isDragging()
    })
  })

  const [{ isOver, canDrop }, drop] = useDrop({
    accept: [ItemTypes.FILE, ItemTypes.FOLDER],
    drop: (draggedItem, monitor) => {
      if (draggedItem.id !== item.id && type === ItemTypes.FOLDER) {
        onMove(draggedItem, item.id)
      }
    },
    canDrop: (draggedItem) => {
      return type === ItemTypes.FOLDER && draggedItem.id !== item.id
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
      canDrop: monitor.canDrop()
    })
  })

  const opacity = isDragging ? 0.5 : 1
  const backgroundColor = isOver && canDrop ? 'rgba(102, 126, 234, 0.1)' : 'transparent'

  return (
    <div 
      ref={type === ItemTypes.FOLDER ? node => drag(drop(node)) : drag}
      style={{ opacity, backgroundColor, borderRadius: '20px', transition: 'all 0.3s' }}
    >
      {children}
    </div>
  )
}

/**
 * 文件图标组件 - 增强版本，更多文件类型
 */
const FileIcon = ({ mimeType, fileName, size = 64 }) => {
  const iconProps = { style: { fontSize: size } }
  
  // 根据文件扩展名判断
  const ext = fileName ? fileName.split('.').pop().toLowerCase() : ''
  
  // 图片类型
  if (mimeType?.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp'].includes(ext)) {
    return <FileImageOutlined {...iconProps} className="file-icon image-icon" />
  }
  
  // 视频类型
  if (mimeType?.startsWith('video/') || ['mp4', 'avi', 'mov', 'wmv', 'flv', 'mkv'].includes(ext)) {
    return <VideoCameraOutlined {...iconProps} className="file-icon video-icon" />
  }
  
  // PDF
  if (mimeType?.includes('pdf') || ext === 'pdf') {
    return <FilePdfOutlined {...iconProps} className="file-icon pdf-icon" />
  }
  
  // Word文档
  if (mimeType?.includes('word') || ['doc', 'docx'].includes(ext)) {
    return <FileWordOutlined {...iconProps} className="file-icon document-icon" />
  }
  
  // Excel表格
  if (mimeType?.includes('excel') || mimeType?.includes('spreadsheet') || ['xls', 'xlsx'].includes(ext)) {
    return <FileExcelOutlined {...iconProps} className="file-icon excel-icon" style={{ color: '#10b981' }} />
  }
  
  // PPT演示
  if (mimeType?.includes('powerpoint') || mimeType?.includes('presentation') || ['ppt', 'pptx'].includes(ext)) {
    return <FilePptOutlined {...iconProps} className="file-icon ppt-icon" style={{ color: '#f97316' }} />
  }
  
  // 压缩文件
  if (mimeType?.includes('zip') || mimeType?.includes('rar') || ['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
    return <FileZipOutlined {...iconProps} className="file-icon archive-icon" />
  }
  
  // 文本文件
  if (mimeType?.includes('text') || ['txt', 'md', 'json', 'js', 'css', 'html', 'xml', 'csv'].includes(ext)) {
    return <FileTextOutlined {...iconProps} className="file-icon document-icon" />
  }
  
  // 未知类型
  return <FileUnknownOutlined {...iconProps} className="file-icon" />
}

/**
 * 复制链接到剪贴板的辅助函数
 */
const copyToClipboard = async (text, successMessage) => {
  try {
    // 优先使用现代API
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text)
      message.success(successMessage || '链接已复制到剪贴板')
    } else {
      // 降级方案
      const textArea = document.createElement('textarea')
      textArea.value = text
      textArea.style.position = 'fixed'
      textArea.style.opacity = '0'
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      message.success(successMessage || '链接已复制到剪贴板')
    }
  } catch (error) {
    message.error('复制失败，请手动复制')
    console.error('复制到剪贴板失败:', error)
  }
}

/**
 * 主组件
 */
const StorageManager = () => {
  const { t } = useTranslation()
  const screens = useBreakpoint()
  const fileInputRef = useRef(null)
  
  const {
    files,
    folders,
    folderTree,
    currentFolder,
    selectedFiles,
    storageStats,
    creditConfig,
    loading,
    uploading,
    getFiles,
    getFolders,
    getFolderTree,
    getStorageStats,
    getCreditConfig,
    uploadFiles,
    deleteFile,
    deleteFiles,
    moveFile,
    createFolder,
    deleteFolder,
    setCurrentFolder,
    toggleFileSelection,
    toggleSelectAll,
    clearSelection,
    calculateUploadCredits
  } = useStorageStore()
  
  const { user } = useAuthStore()

  // 状态管理
  const [viewMode, setViewMode] = useState(ViewMode.GRID)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [createFolderVisible, setCreateFolderVisible] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [uploadModalVisible, setUploadModalVisible] = useState(false)
  const [fileList, setFileList] = useState([])
  const [previewVisible, setPreviewVisible] = useState(false)
  const [previewFile, setPreviewFile] = useState(null)
  const [treeExpandedKeys, setTreeExpandedKeys] = useState(['root'])
  const [dragActive, setDragActive] = useState(false)
  const [contextMenu, setContextMenu] = useState(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [folderCounts, setFolderCounts] = useState({}) // 文件夹内文件数量
  const [uploadCreditsNeeded, setUploadCreditsNeeded] = useState(0) // 上传所需积分
  const [userCredits, setUserCredits] = useState(0) // 用户当前积分

  // 初始化加载数据
  useEffect(() => {
    loadData()
    // 获取积分配置
    getCreditConfig()
    // 获取用户当前积分
    if (user) {
      const credits = (user.credits_quota || 0) - (user.used_credits || 0)
      setUserCredits(Math.max(0, credits))
    }
  }, [currentFolder])

  // 监听用户信息变化，更新积分显示
  useEffect(() => {
    if (user) {
      const credits = (user.credits_quota || 0) - (user.used_credits || 0)
      setUserCredits(Math.max(0, credits))
    }
  }, [user])

  // 计算文件夹内的文件数量
  useEffect(() => {
    const counts = {}
    folders.forEach(folder => {
      // 计算每个文件夹内的文件数
      const count = files.filter(file => file.folder_id === folder.id).length
      counts[folder.id] = count
    })
    setFolderCounts(counts)
  }, [files, folders])

  // 文件列表变化时，重新计算所需积分
  useEffect(() => {
    if (fileList.length > 0 && creditConfig) {
      const files = fileList.map(f => f.originFileObj || f).filter(Boolean)
      const credits = calculateUploadCredits(files)
      setUploadCreditsNeeded(credits)
    } else {
      setUploadCreditsNeeded(0)
    }
  }, [fileList, creditConfig, calculateUploadCredits])

  const loadData = async () => {
    await Promise.all([
      getFiles(currentFolder?.id),
      getFolders(currentFolder?.id),
      getFolderTree(),
      getStorageStats()
    ])
  }

  // 格式化文件大小
  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  // 处理文件拖拽上传
  const handleDragEnter = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(true)
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    const droppedFiles = Array.from(e.dataTransfer.files)
    if (droppedFiles.length === 0) return

    try {
      const result = await uploadFiles(droppedFiles, currentFolder?.id)
      
      if (result.success && result.success.length > 0) {
        message.success(t('storage.uploadSuccess', { count: result.success.length }))
      }
      
      if (result.failed && result.failed.length > 0) {
        message.error(t('storage.uploadPartialFailed', { count: result.failed.length }))
      }
      
      await loadData()
      // 刷新用户信息以更新积分
      if (window.useAuthStore) {
        const authStore = window.useAuthStore.getState()
        if (authStore.getCurrentUser) {
          await authStore.getCurrentUser()
        }
      }
    } catch (error) {
      message.error(t('storage.uploadFailed'))
    }
  }

  // 处理文件上传（点击按钮）
  const handleUpload = async () => {
    if (fileList.length === 0) {
      message.warning(t('storage.selectFilesFirst'))
      return
    }

    // 检查积分是否足够
    if (uploadCreditsNeeded > 0 && userCredits < uploadCreditsNeeded) {
      message.error(`积分不足！需要 ${uploadCreditsNeeded} 积分，当前余额 ${userCredits} 积分`)
      return
    }

    const files = fileList.map(f => f.originFileObj || f)
    
    try {
      const result = await uploadFiles(files, currentFolder?.id)
      
      if (result.success && result.success.length > 0) {
        message.success(t('storage.uploadSuccess', { count: result.success.length }))
      }
      
      if (result.failed && result.failed.length > 0) {
        message.error(t('storage.uploadPartialFailed', { count: result.failed.length }))
      }
      
      setUploadModalVisible(false)
      setFileList([])
      await loadData()
      // 刷新用户信息以更新积分
      if (window.useAuthStore) {
        const authStore = window.useAuthStore.getState()
        if (authStore.getCurrentUser) {
          await authStore.getCurrentUser()
        }
      }
    } catch (error) {
      message.error(t('storage.uploadFailed'))
    }
  }

  // 处理右键菜单
  const handleContextMenu = (e, item, type) => {
    e.preventDefault()
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      item,
      type
    })
  }

  // 关闭右键菜单
  const closeContextMenu = () => {
    setContextMenu(null)
  }

  // 处理文件/文件夹移动
  const handleMove = async (draggedItem, targetFolderId) => {
    try {
      if (draggedItem.type === ItemTypes.FILE) {
        await moveFile(draggedItem.id, targetFolderId)
      }
      message.success(t('storage.moveSuccess'))
      await loadData()
    } catch (error) {
      message.error(t('storage.moveFailed'))
    }
  }

  // 处理文件删除
  const handleDelete = async (file) => {
    Modal.confirm({
      title: t('common.confirmDelete'),
      content: t('storage.confirmDeleteFile', { name: file.original_name }),
      onOk: async () => {
        try {
          await deleteFile(file.id)
          message.success(t('common.deleteSuccess'))
          await loadData()
        } catch (error) {
          message.error(t('common.deleteFailed'))
        }
      }
    })
  }

  // 处理文件夹删除
  const handleDeleteFolder = async (folder) => {
    const fileCount = folderCounts[folder.id] || 0
    const warningMsg = fileCount > 0 
      ? t('storage.confirmDeleteFolderWithFiles', { name: folder.name, count: fileCount })
      : t('storage.confirmDeleteFolder', { name: folder.name })
    
    Modal.confirm({
      title: t('common.confirmDelete'),
      content: warningMsg,
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteFolder(folder.id)
          message.success(t('common.deleteSuccess'))
          await loadData()
        } catch (error) {
          message.error(t('common.deleteFailed'))
        }
      }
    })
  }

  // 批量删除
  const handleBatchDelete = async () => {
    if (selectedFiles.length === 0) {
      message.warning(t('storage.selectFilesFirst'))
      return
    }

    Modal.confirm({
      title: t('common.confirmDelete'),
      content: t('storage.confirmDeleteFiles', { count: selectedFiles.length }),
      onOk: async () => {
        try {
          await deleteFiles(selectedFiles)
          message.success(t('common.deleteSuccess'))
          clearSelection()
          await loadData()
        } catch (error) {
          message.error(t('common.deleteFailed'))
        }
      }
    })
  }

  // 创建文件夹
  const handleCreateFolder = async () => {
    if (!folderName) {
      message.warning(t('storage.enterFolderName'))
      return
    }

    try {
      await createFolder(folderName, currentFolder?.id)
      message.success(t('storage.createFolderSuccess'))
      setCreateFolderVisible(false)
      setFolderName('')
      await loadData()
    } catch (error) {
      message.error(t('storage.createFolderFailed'))
    }
  }

  // 过滤文件和文件夹
  const filteredFiles = files.filter(file => 
    file.original_name.toLowerCase().includes(searchKeyword.toLowerCase())
  )
  const filteredFolders = folders.filter(folder => 
    folder.name.toLowerCase().includes(searchKeyword.toLowerCase())
  )

  // 转换文件夹数据为树形结构
  const convertToTreeData = (folders) => {
    return folders.map(folder => ({
      key: folder.id,
      title: (
        <span style={{ fontWeight: folder.children && folder.children.length > 0 ? 600 : 400 }}>
          {folder.name}
          {folderCounts[folder.id] > 0 && (
            <span style={{ marginLeft: 8, color: '#999', fontSize: 12 }}>
              ({folderCounts[folder.id]})
            </span>
          )}
        </span>
      ),
      icon: folder.children && folder.children.length > 0 ? <FolderFilled /> : <FolderOutlined />,
      children: folder.children ? convertToTreeData(folder.children) : [],
      ...folder
    }))
  }

  // 面包屑导航项
  const breadcrumbItems = []
  let current = currentFolder
  while (current) {
    breadcrumbItems.unshift({
      title: current.name,
      onClick: () => {
        setCurrentFolder(current)
      }
    })
    current = current.parent
  }
  breadcrumbItems.unshift({
    title: <HomeOutlined />,
    onClick: () => setCurrentFolder(null)
  })

  // 渲染网格视图
  const renderGridView = () => (
    <div className="file-grid">
      {/* 文件夹 - 添加folder-item类名 */}
      {filteredFolders.map(folder => {
        const fileCount = files.filter(f => f.folder_id === folder.id).length
        
        return (
          <DraggableItem
            key={folder.id}
            item={folder}
            type={ItemTypes.FOLDER}
            onMove={handleMove}
          >
            <div
              className="file-item folder-item"
              onDoubleClick={() => {
                setCurrentFolder(folder)
              }}
              onContextMenu={(e) => handleContextMenu(e, folder, 'folder')}
            >
              <div className="file-icon folder-icon">
                {fileCount > 0 ? <FolderFilled /> : <FolderOutlined />}
                {fileCount > 0 && (
                  <span className="file-count">{fileCount}</span>
                )}
              </div>
              <div className="file-name">{folder.name}</div>
              <div className="file-size">{t('storage.folder')}</div>
            </div>
          </DraggableItem>
        )
      })}
      
      {/* 文件 - 根据类型添加对应的类名 */}
      {filteredFiles.map(file => {
        const fileTypeClass = getFileTypeClass(file.mime_type, file.original_name)
        
        return (
          <DraggableItem
            key={file.id}
            item={file}
            type={ItemTypes.FILE}
            onMove={handleMove}
          >
            <div
              className={`file-item ${fileTypeClass} ${selectedFiles.includes(file.id) ? 'selected' : ''}`}
              onClick={() => toggleFileSelection(file.id)}
              onDoubleClick={() => {
                setPreviewFile(file)
                setPreviewVisible(true)
              }}
              onContextMenu={(e) => handleContextMenu(e, file, 'file')}
            >
              <Checkbox
                className="select-checkbox"
                checked={selectedFiles.includes(file.id)}
                onClick={(e) => e.stopPropagation()}
              />
              <FileIcon mimeType={file.mime_type} fileName={file.original_name} />
              <div className="file-name">{file.original_name}</div>
              <div className="file-size">{formatFileSize(file.file_size)}</div>
            </div>
          </DraggableItem>
        )
      })}
    </div>
  )

  // 表格列配置（列表视图）
  const columns = [
    {
      title: () => (
        <Checkbox
          checked={selectedFiles.length === files.length && files.length > 0}
          indeterminate={selectedFiles.length > 0 && selectedFiles.length < files.length}
          onChange={toggleSelectAll}
        />
      ),
      width: 50,
      render: (_, record) => (
        record.isFolder ? null : (
          <Checkbox
            checked={selectedFiles.includes(record.id)}
            onChange={() => toggleFileSelection(record.id)}
          />
        )
      )
    },
    {
      title: t('storage.fileName'),
      dataIndex: 'name',
      key: 'name',
      render: (text, record) => {
        if (record.isFolder) {
          const fileCount = files.filter(f => f.folder_id === record.id).length
          return (
            <Space>
              {fileCount > 0 ? <FolderFilled style={{ color: '#fbbf24', fontSize: 24 }} /> : <FolderOutlined style={{ color: '#fbbf24', fontSize: 24 }} />}
              <span style={{ fontWeight: 600 }}>{record.name}</span>
              {fileCount > 0 && (
                <Tag color="orange">{fileCount} {t('storage.files')}</Tag>
              )}
            </Space>
          )
        }
        return (
          <Space>
            <FileIcon mimeType={record.mime_type} fileName={record.original_name} size={24} />
            <span>{record.original_name}</span>
          </Space>
        )
      }
    },
    {
      title: t('storage.fileSize'),
      dataIndex: 'file_size',
      key: 'size',
      width: 120,
      render: (size, record) => record.isFolder ? '-' : formatFileSize(size)
    },
    {
      title: t('storage.fileType'),
      dataIndex: 'mime_type',
      key: 'type',
      width: 150,
      render: (type, record) => {
        if (record.isFolder) {
          return <Tag color="gold">{t('storage.folder')}</Tag>
        }
        
        const typeMap = {
          'image': { color: 'green', text: t('storage.type.image') },
          'video': { color: 'blue', text: t('storage.type.video') },
          'pdf': { color: 'red', text: t('storage.type.pdf') },
          'document': { color: 'orange', text: t('storage.type.document') },
          'zip': { color: 'purple', text: t('storage.type.archive') }
        }
        
        let typeInfo = { color: 'default', text: t('storage.type.other') }
        Object.keys(typeMap).forEach(key => {
          if (type?.includes(key)) {
            typeInfo = typeMap[key]
          }
        })
        
        return <Tag color={typeInfo.color}>{typeInfo.text}</Tag>
      }
    },
    {
      title: t('storage.uploadTime'),
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (date) => date ? new Date(date).toLocaleString() : '-'
    },
    {
      title: t('common.operation'),
      key: 'action',
      width: 160,
      render: (_, record) => {
        if (record.isFolder) {
          return (
            <Space>
              <Button 
                type="link" 
                size="small"
                onClick={() => setCurrentFolder(record)}
              >
                {t('storage.open')}
              </Button>
              <Button 
                type="link" 
                size="small" 
                danger 
                onClick={() => handleDeleteFolder(record)}
              >
                <DeleteOutlined />
              </Button>
            </Space>
          )
        }
        
        return (
          <Space>
            <Tooltip title={t('common.preview')}>
              <Button type="link" size="small" onClick={() => {
                setPreviewFile(record)
                setPreviewVisible(true)
              }}>
                <EyeOutlined />
              </Button>
            </Tooltip>
            <Tooltip title={t('common.download')}>
              <Button type="link" size="small" onClick={() => {
                window.open(record.oss_url, '_blank')
              }}>
                <DownloadOutlined />
              </Button>
            </Tooltip>
            <Tooltip title={t('storage.copyLink')}>
              <Button 
                type="link" 
                size="small" 
                onClick={() => {
                  copyToClipboard(record.oss_url, t('storage.linkCopied'))
                }}
              >
                <LinkOutlined />
              </Button>
            </Tooltip>
            <Tooltip title={t('common.delete')}>
              <Button type="link" size="small" danger onClick={() => handleDelete(record)}>
                <DeleteOutlined />
              </Button>
            </Tooltip>
          </Space>
        )
      }
    }
  ]

  // 生成积分说明文本
  const getCreditDescription = () => {
    if (!creditConfig) return ''
    
    return `5MB及以下文件：${creditConfig.base_credits}积分/个，超过5MB部分：每5MB收取${creditConfig.credits_per_5mb}积分`
  }

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="storage-manager">
        <div className="storage-layout">
          {/* 侧边栏 */}
          <div className={`storage-sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
            {/* 文件夹树卡片 */}
            <div className="folder-tree-card">
              <div className="folder-tree-header">
                {t('storage.myFiles')}
              </div>
              <div className="folder-tree">
                <Tree
                  showIcon
                  showLine={{ showLeafIcon: false }}
                  treeData={[
                    {
                      key: 'root',
                      title: (
                        <span style={{ fontWeight: 600 }}>
                          {t('storage.myFiles')}
                        </span>
                      ),
                      icon: <HomeOutlined />,
                      children: convertToTreeData(folderTree)
                    }
                  ]}
                  onSelect={(keys, info) => {
                    if (keys[0] === 'root') {
                      setCurrentFolder(null)
                    } else {
                      const folder = info.node
                      setCurrentFolder(folder)
                    }
                    clearSelection()
                  }}
                  expandedKeys={treeExpandedKeys}
                  onExpand={setTreeExpandedKeys}
                />
              </div>
            </div>
            
            {/* 存储信息卡片 - 更紧凑 */}
            {storageStats && !sidebarCollapsed && (
              <div className="storage-info-card">
                <div>{t('storage.storageInfo')}</div>
                <Progress
                  className="storage-progress"
                  percent={Math.round((storageStats.storage_used / storageStats.storage_quota) * 100)}
                  status={storageStats.storage_used > storageStats.storage_quota * 0.9 ? 'exception' : 'active'}
                  strokeLinecap="round"
                />
                <div className="storage-stats">
                  <div className="stat-item">
                    <div className="stat-value">{formatFileSize(storageStats.storage_used)}</div>
                    <div className="stat-label">{t('storage.used')}</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-value">{formatFileSize(storageStats.storage_quota)}</div>
                    <div className="stat-label">{t('storage.total')}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
          
          {/* 主内容区 */}
          <div className="storage-main">
            {/* 工具栏 */}
            <div className="storage-toolbar">
              <div className="breadcrumb-nav">
                <Breadcrumb items={breadcrumbItems} />
              </div>
              
              <div className="toolbar-actions">
                {/* 搜索框 */}
                <div className="search-box">
                  <Input
                    placeholder={t('storage.searchPlaceholder')}
                    value={searchKeyword}
                    onChange={(e) => setSearchKeyword(e.target.value)}
                    allowClear
                  />
                  <SearchOutlined className="search-icon" />
                </div>
                
                {/* 视图切换 */}
                <div className="view-switcher">
                  <button 
                    className={viewMode === ViewMode.GRID ? 'active' : ''}
                    onClick={() => setViewMode(ViewMode.GRID)}
                    title={t('storage.gridView')}
                  >
                    <AppstoreOutlined />
                  </button>
                  <button 
                    className={viewMode === ViewMode.LIST ? 'active' : ''}
                    onClick={() => setViewMode(ViewMode.LIST)}
                    title={t('storage.listView')}
                  >
                    <BarsOutlined />
                  </button>
                </div>
                
                {/* 操作按钮 */}
                <Button icon={<FolderAddOutlined />} onClick={() => setCreateFolderVisible(true)}>
                  {screens.md && t('storage.newFolder')}
                </Button>
                
                {selectedFiles.length > 0 && (
                  <Button danger icon={<DeleteOutlined />} onClick={handleBatchDelete}>
                    {t('storage.batchDelete')}
                  </Button>
                )}
                
                <Button icon={<ReloadOutlined />} onClick={loadData} title={t('common.refresh')} />
              </div>
            </div>
            
            {/* 内容区域 */}
            <div
              className={`storage-content ${viewMode}-view ${dragActive ? 'drag-active' : ''}`}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onClick={closeContextMenu}
            >
              {loading ? (
                <div className="loading-container">
                  <Spin size="large" tip={t('storage.loading')} />
                </div>
              ) : (
                <>
                  {viewMode === ViewMode.GRID ? (
                    renderGridView()
                  ) : (
                    <Table
                      columns={columns}
                      dataSource={[
                        ...filteredFolders.map(f => ({...f, isFolder: true})), 
                        ...filteredFiles
                      ]}
                      rowKey={(record) => record.isFolder ? `folder-${record.id}` : `file-${record.id}`}
                      pagination={false}
                      className={viewMode === ViewMode.LIST ? 'list-view-table' : ''}
                      onRow={(record) => ({
                        onDoubleClick: () => {
                          if (record.isFolder) {
                            setCurrentFolder(record)
                          } else {
                            setPreviewFile(record)
                            setPreviewVisible(true)
                          }
                        },
                        onContextMenu: (e) => handleContextMenu(e, record, record.isFolder ? 'folder' : 'file')
                      })}
                    />
                  )}
                  
                  {filteredFiles.length === 0 && filteredFolders.length === 0 && (
                    <div className="empty-state">
                      <InboxOutlined className="empty-icon" />
                      <div className="empty-text">{t('storage.noFiles')}</div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
        
        {/* 浮动上传按钮 */}
        <button className="upload-fab" onClick={() => setUploadModalVisible(true)}>
          <CloudUploadOutlined />
        </button>
        
        {/* 右键菜单 */}
        {contextMenu && (
          <div 
            className="context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {contextMenu.type === 'folder' ? (
              <>
                <div className="menu-item" onClick={() => {
                  setCurrentFolder(contextMenu.item)
                  closeContextMenu()
                }}>
                  <FolderOpenOutlined className="menu-icon" />
                  {t('storage.open')}
                </div>
                
                <div className="menu-divider" />
                
                <div className="menu-item danger" onClick={() => {
                  handleDeleteFolder(contextMenu.item)
                  closeContextMenu()
                }}>
                  <DeleteOutlined className="menu-icon" />
                  {t('common.delete')}
                </div>
              </>
            ) : (
              <>
                <div className="menu-item" onClick={() => {
                  setPreviewFile(contextMenu.item)
                  setPreviewVisible(true)
                  closeContextMenu()
                }}>
                  <EyeOutlined className="menu-icon" />
                  {t('common.preview')}
                </div>
                
                <div className="menu-item" onClick={() => {
                  window.open(contextMenu.item.oss_url, '_blank')
                  closeContextMenu()
                }}>
                  <DownloadOutlined className="menu-icon" />
                  {t('common.download')}
                </div>
                
                <div className="menu-item" onClick={() => {
                  copyToClipboard(contextMenu.item.oss_url, t('storage.linkCopied'))
                  closeContextMenu()
                }}>
                  <CopyOutlined className="menu-icon" />
                  {t('storage.copyLink')}
                </div>
                
                <div className="menu-divider" />
                
                <div className="menu-item danger" onClick={() => {
                  handleDelete(contextMenu.item)
                  closeContextMenu()
                }}>
                  <DeleteOutlined className="menu-icon" />
                  {t('common.delete')}
                </div>
              </>
            )}
          </div>
        )}
        
        {/* 上传弹窗 - 增强版，显示积分和限制信息 */}
        <Modal
          title={t('storage.uploadFiles')}
          open={uploadModalVisible}
          onOk={handleUpload}
          onCancel={() => {
            setUploadModalVisible(false)
            setFileList([])
            setUploadCreditsNeeded(0)
          }}
          confirmLoading={uploading}
          width={700}
        >
          {/* 积分和限制信息 */}
          {creditConfig && (
            <Alert
              message="上传说明"
              description={
                <div>
                  <div style={{ marginBottom: 8 }}>
                    <InfoCircleOutlined style={{ marginRight: 8 }} />
                    <strong>文件大小限制：</strong>
                    单个文件不超过 <span style={{ color: '#1890ff' }}>{creditConfig.max_file_size || 100}MB</span>
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <DollarOutlined style={{ marginRight: 8 }} />
                    <strong>积分计算规则：</strong>
                    {getCreditDescription()}
                  </div>
                  <div>
                    <DollarOutlined style={{ marginRight: 8 }} />
                    <strong>当前可用积分：</strong>
                    <span style={{ color: userCredits > 0 ? '#52c41a' : '#ff4d4f' }}>
                      {userCredits} 积分
                    </span>
                  </div>
                </div>
              }
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}
          
          <Dragger
            multiple
            fileList={fileList}
            beforeUpload={(file) => {
              // 检查文件大小
              const maxSize = (creditConfig?.max_file_size || 100) * 1024 * 1024
              if (file.size > maxSize) {
                message.error(`文件 ${file.name} 超过最大限制 ${creditConfig?.max_file_size || 100}MB`)
                return false
              }
              setFileList([...fileList, file])
              return false
            }}
            onRemove={(file) => {
              setFileList(fileList.filter(f => f.uid !== file.uid))
            }}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">{t('storage.uploadHint')}</p>
            <p className="ant-upload-hint">
              {creditConfig ? 
                `支持批量上传，单个文件不超过${creditConfig.max_file_size || 100}MB` : 
                t('storage.uploadTip')
              }
            </p>
          </Dragger>
          
          {/* 显示选中文件的积分消耗 */}
          {fileList.length > 0 && creditConfig && (
            <div style={{ marginTop: 16 }}>
              <Divider />
              <Row gutter={16}>
                <Col span={8}>
                  <Statistic 
                    title="已选文件" 
                    value={fileList.length} 
                    suffix="个" 
                  />
                </Col>
                <Col span={8}>
                  <Statistic 
                    title="总大小" 
                    value={formatFileSize(fileList.reduce((sum, f) => sum + (f.size || 0), 0))} 
                  />
                </Col>
                <Col span={8}>
                  <Statistic 
                    title="需要积分" 
                    value={uploadCreditsNeeded} 
                    suffix="积分"
                    valueStyle={{ 
                      color: userCredits >= uploadCreditsNeeded ? '#52c41a' : '#ff4d4f' 
                    }}
                  />
                </Col>
              </Row>
              {userCredits < uploadCreditsNeeded && (
                <Alert
                  message={`积分不足！需要 ${uploadCreditsNeeded} 积分，当前余额 ${userCredits} 积分`}
                  type="error"
                  showIcon
                  style={{ marginTop: 16 }}
                />
              )}
            </div>
          )}
        </Modal>
        
        {/* 创建文件夹弹窗 */}
        <Modal
          title={t('storage.createFolder')}
          open={createFolderVisible}
          onOk={handleCreateFolder}
          onCancel={() => {
            setCreateFolderVisible(false)
            setFolderName('')
          }}
        >
          <Input
            placeholder={t('storage.folderNamePlaceholder')}
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            onPressEnter={handleCreateFolder}
          />
        </Modal>
        
        {/* 文件预览弹窗 */}
        <Modal
          title={previewFile?.original_name}
          open={previewVisible}
          footer={null}
          onCancel={() => setPreviewVisible(false)}
          width={800}
        >
          {previewFile && (
            <div className="file-preview">
              {previewFile.mime_type?.startsWith('image/') ? (
                <img src={previewFile.oss_url} alt={previewFile.original_name} style={{ width: '100%' }} />
              ) : previewFile.mime_type?.startsWith('video/') ? (
                <video src={previewFile.oss_url} controls style={{ width: '100%' }} />
              ) : (
                <div className="preview-not-supported">
                  <FileOutlined style={{ fontSize: 64, color: '#999' }} />
                  <p>{t('storage.previewNotSupported')}</p>
                  <Button type="primary" icon={<DownloadOutlined />} onClick={() => window.open(previewFile.oss_url, '_blank')}>
                    {t('common.download')}
                  </Button>
                </div>
              )}
            </div>
          )}
        </Modal>
      </div>
    </DndProvider>
  )
}

export default StorageManager
