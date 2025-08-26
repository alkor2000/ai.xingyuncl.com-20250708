/**
 * 文件存储管理页面
 */

import React, { useState, useEffect, useRef } from 'react'
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
  Spin
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
  FileOutlined,
  FileImageOutlined,
  VideoCameraOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  FileZipOutlined,
  HomeOutlined,
  ReloadOutlined,
  CloudUploadOutlined,
  InboxOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import useStorageStore from '../../stores/storageStore'
import './StorageManager.less'

const { Content, Sider } = Layout
const { Dragger } = Upload

const StorageManager = () => {
  const { t } = useTranslation()
  const {
    files,
    folders,
    folderTree,
    currentFolder,
    selectedFiles,
    storageStats,
    loading,
    uploading,
    getFiles,
    getFolders,
    getFolderTree,
    getStorageStats,
    uploadFiles,
    deleteFile,
    deleteFiles,
    moveFile,
    createFolder,
    deleteFolder,
    setCurrentFolder,
    toggleFileSelection,
    toggleSelectAll,
    clearSelection
  } = useStorageStore()

  const [createFolderVisible, setCreateFolderVisible] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [uploadModalVisible, setUploadModalVisible] = useState(false)
  const [fileList, setFileList] = useState([])
  const [previewVisible, setPreviewVisible] = useState(false)
  const [previewFile, setPreviewFile] = useState(null)
  const [treeExpandedKeys, setTreeExpandedKeys] = useState([])

  useEffect(() => {
    // 初始加载
    loadData()
  }, [])

  const loadData = async () => {
    await Promise.all([
      getFiles(currentFolder?.id),
      getFolders(currentFolder?.id),
      getFolderTree(),
      getStorageStats()
    ])
  }

  // 获取文件图标
  const getFileIcon = (mimeType, fileName) => {
    if (mimeType?.startsWith('image/')) return <FileImageOutlined style={{ fontSize: 24, color: '#52c41a' }} />
    if (mimeType?.startsWith('video/')) return <VideoCameraOutlined style={{ fontSize: 24, color: '#1890ff' }} />
    if (mimeType?.includes('pdf')) return <FilePdfOutlined style={{ fontSize: 24, color: '#f5222d' }} />
    if (mimeType?.includes('zip') || mimeType?.includes('rar')) return <FileZipOutlined style={{ fontSize: 24, color: '#722ed1' }} />
    if (mimeType?.includes('text') || mimeType?.includes('document')) return <FileTextOutlined style={{ fontSize: 24, color: '#fa8c16' }} />
    return <FileOutlined style={{ fontSize: 24, color: '#8c8c8c' }} />
  }

  // 格式化文件大小
  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  // 处理文件上传 - 修复：正确获取文件对象
  const handleUpload = async () => {
    if (fileList.length === 0) {
      message.warning(t('storage.selectFilesFirst'))
      return
    }

    // 修复：兼容处理文件对象，originFileObj可能不存在
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
    } catch (error) {
      message.error(t('storage.uploadFailed'))
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

  // 文件夹树选择
  const onTreeSelect = (selectedKeys, info) => {
    const folder = info.node
    setCurrentFolder(folder)
    getFiles(folder.id)
    getFolders(folder.id)
    clearSelection()
  }

  // 转换文件夹数据为树形结构
  const convertToTreeData = (folders) => {
    return folders.map(folder => ({
      key: folder.id,
      title: folder.name,
      icon: <FolderOutlined />,
      children: folder.children ? convertToTreeData(folder.children) : [],
      ...folder
    }))
  }

  // 文件操作菜单
  const fileMenu = (file) => (
    <Menu>
      <Menu.Item key="preview" icon={<EyeOutlined />} onClick={() => {
        setPreviewFile(file)
        setPreviewVisible(true)
      }}>
        {t('common.preview')}
      </Menu.Item>
      <Menu.Item key="download" icon={<DownloadOutlined />} onClick={() => {
        window.open(file.oss_url, '_blank')
      }}>
        {t('common.download')}
      </Menu.Item>
      <Menu.Item key="copy" icon={<CopyOutlined />} onClick={() => {
        navigator.clipboard.writeText(file.oss_url)
        message.success(t('storage.linkCopied'))
      }}>
        {t('storage.copyLink')}
      </Menu.Item>
      <Menu.Divider />
      <Menu.Item key="delete" icon={<DeleteOutlined />} danger onClick={() => handleDelete(file)}>
        {t('common.delete')}
      </Menu.Item>
    </Menu>
  )

  // 文件表格列配置
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
        <Checkbox
          checked={selectedFiles.includes(record.id)}
          onChange={() => toggleFileSelection(record.id)}
        />
      )
    },
    {
      title: t('storage.fileName'),
      dataIndex: 'original_name',
      key: 'name',
      render: (text, record) => (
        <Space>
          {getFileIcon(record.mime_type, text)}
          <span>{text}</span>
        </Space>
      )
    },
    {
      title: t('storage.fileSize'),
      dataIndex: 'file_size',
      key: 'size',
      width: 120,
      render: (size) => formatFileSize(size)
    },
    {
      title: t('storage.fileType'),
      dataIndex: 'mime_type',
      key: 'type',
      width: 150,
      render: (type) => {
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
      render: (date) => new Date(date).toLocaleString()
    },
    {
      title: t('common.operation'),
      key: 'action',
      width: 100,
      render: (_, record) => (
        <Dropdown overlay={fileMenu(record)} trigger={['click']}>
          <Button type="link">{t('common.more')}</Button>
        </Dropdown>
      )
    }
  ]

  // 面包屑导航
  const breadcrumbItems = []
  let current = currentFolder
  while (current) {
    breadcrumbItems.unshift({
      title: current.name,
      onClick: () => {
        setCurrentFolder(current)
        getFiles(current.id)
        getFolders(current.id)
      }
    })
    current = current.parent
  }
  breadcrumbItems.unshift({
    title: <HomeOutlined />,
    onClick: () => {
      setCurrentFolder(null)
      getFiles(null)
      getFolders(null)
    }
  })

  return (
    <div className="storage-manager">
      <Layout>
        <Sider width={250} className="storage-sider" theme="light">
          <Card
            title={t('storage.folders')}
            size="small"
            extra={
              <Button
                type="link"
                icon={<FolderAddOutlined />}
                onClick={() => setCreateFolderVisible(true)}
              />
            }
          >
            <Tree
              showIcon
              treeData={[
                {
                  key: 'root',
                  title: t('storage.myFiles'),
                  icon: <HomeOutlined />,
                  children: convertToTreeData(folderTree)
                }
              ]}
              onSelect={onTreeSelect}
              expandedKeys={treeExpandedKeys}
              onExpand={setTreeExpandedKeys}
            />
          </Card>
          
          {storageStats && (
            <Card title={t('storage.storageInfo')} size="small" style={{ marginTop: 16 }}>
              <div className="storage-stats">
                <Progress
                  percent={Math.round((storageStats.storage_used / storageStats.storage_quota) * 100)}
                  size="small"
                  status={storageStats.storage_used > storageStats.storage_quota * 0.9 ? 'exception' : 'active'}
                />
                <div className="stats-text">
                  {formatFileSize(storageStats.storage_used)} / {formatFileSize(storageStats.storage_quota)}
                </div>
                <div className="stats-info">
                  <div>{t('storage.fileCount')}: {storageStats.file_count}</div>
                  <div>{t('storage.folderCount')}: {storageStats.folder_count}</div>
                </div>
              </div>
            </Card>
          )}
        </Sider>
        
        <Layout className="storage-content">
          <div className="storage-header">
            <Breadcrumb items={breadcrumbItems} />
            <Space>
              {selectedFiles.length > 0 && (
                <>
                  <span>{t('storage.selected', { count: selectedFiles.length })}</span>
                  <Button
                    danger
                    icon={<DeleteOutlined />}
                    onClick={handleBatchDelete}
                  >
                    {t('storage.batchDelete')}
                  </Button>
                </>
              )}
              <Button icon={<ReloadOutlined />} onClick={loadData}>
                {t('common.refresh')}
              </Button>
              <Button
                type="primary"
                icon={<CloudUploadOutlined />}
                onClick={() => setUploadModalVisible(true)}
              >
                {t('storage.upload')}
              </Button>
            </Space>
          </div>
          
          <Content className="storage-main">
            {loading ? (
              <div className="loading-container">
                <Spin size="large" />
              </div>
            ) : (
              <>
                {folders.length > 0 && (
                  <div className="folder-grid">
                    {folders.map(folder => (
                      <Card
                        key={folder.id}
                        className="folder-card"
                        hoverable
                        onClick={() => {
                          setCurrentFolder(folder)
                          getFiles(folder.id)
                          getFolders(folder.id)
                        }}
                      >
                        <div className="folder-icon">
                          <FolderOutlined style={{ fontSize: 48, color: '#faad14' }} />
                        </div>
                        <div className="folder-name">{folder.name}</div>
                      </Card>
                    ))}
                  </div>
                )}
                
                <Table
                  columns={columns}
                  dataSource={files}
                  rowKey="id"
                  loading={loading}
                  locale={{
                    emptyText: <Empty description={t('storage.noFiles')} />
                  }}
                />
              </>
            )}
          </Content>
        </Layout>
      </Layout>
      
      {/* 上传弹窗 */}
      <Modal
        title={t('storage.uploadFiles')}
        open={uploadModalVisible}
        onOk={handleUpload}
        onCancel={() => {
          setUploadModalVisible(false)
          setFileList([])
        }}
        confirmLoading={uploading}
        width={600}
      >
        <Dragger
          multiple
          fileList={fileList}
          beforeUpload={(file) => {
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
          <p className="ant-upload-hint">{t('storage.uploadTip')}</p>
        </Dragger>
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
  )
}

export default StorageManager
