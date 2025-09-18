/**
 * OCR识别工具页面
 */

import React, { useState, useEffect } from 'react';
import {
  Layout,
  Card,
  Upload,
  Button,
  message,
  Spin,
  Typography,
  Space,
  Divider,
  Row,
  Col,
  Tag,
  Table,
  Modal,
  Input,
  Empty,
  Alert,
  Tabs,
  Badge,
  Progress
} from 'antd';
import {
  InboxOutlined,
  FileImageOutlined,
  FilePdfOutlined,
  ScanOutlined,
  HistoryOutlined,
  CopyOutlined,
  DownloadOutlined,
  DollarOutlined,
  DeleteOutlined,
  CloudUploadOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import useOcrStore from '../../stores/ocrStore';
import useAuthStore from '../../stores/authStore';
import './OcrTool.less';

const { Content } = Layout;
const { Title, Text, Paragraph } = Typography;
const { Dragger } = Upload;
const { TextArea } = Input;
const { TabPane } = Tabs;

const OcrTool = () => {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const {
    config,
    tasks,
    currentTask,
    loading,
    uploading,
    getConfig,
    processImage,
    processPDF,
    processBatch,
    getTasks,
    getTask
  } = useOcrStore();

  const [fileList, setFileList] = useState([]);
  const [resultModalVisible, setResultModalVisible] = useState(false);
  const [currentResult, setCurrentResult] = useState(null);
  const [activeTab, setActiveTab] = useState('upload');
  const [processing, setProcessing] = useState(false);

  // 初始化
  useEffect(() => {
    getConfig();
    getTasks();
  }, []);

  // 计算用户积分
  const userCredits = user ? (user.credits_quota || 0) - (user.used_credits || 0) : 0;

  // 文件上传前的验证
  const beforeUpload = (file) => {
    const isImage = file.type.startsWith('image/');
    const isPDF = file.type === 'application/pdf';
    
    if (!isImage && !isPDF) {
      message.error('只支持图片和PDF文件！');
      return Upload.LIST_IGNORE;
    }
    
    const maxSize = parseInt(config?.max_file_size_mb || 50);
    const isLtSize = file.size / 1024 / 1024 < maxSize;
    
    if (!isLtSize) {
      message.error(`文件大小不能超过 ${maxSize}MB！`);
      return Upload.LIST_IGNORE;
    }
    
    // 检查积分
    let requiredCredits = 0;
    if (isImage) {
      requiredCredits = parseInt(config?.credits_per_image || 5);
    } else if (isPDF) {
      requiredCredits = parseInt(config?.credits_per_pdf_page || 3);
    }
    
    if (requiredCredits > 0 && userCredits < requiredCredits) {
      message.error(`积分不足！需要至少 ${requiredCredits} 积分`);
      return Upload.LIST_IGNORE;
    }
    
    // 添加到文件列表
    return true;
  };

  // 处理单个文件
  const handleProcessSingle = async () => {
    if (fileList.length === 0) {
      message.warning('请先选择要识别的文件');
      return;
    }

    if (fileList.length > 1) {
      message.warning('单个处理只能选择一个文件，请使用批量处理功能');
      return;
    }

    const file = fileList[0];
    setProcessing(true);

    try {
      let result;
      
      if (file.type.startsWith('image/')) {
        result = await processImage(file.originFileObj || file);
      } else if (file.type === 'application/pdf') {
        result = await processPDF(file.originFileObj || file);
      } else {
        throw new Error('不支持的文件类型');
      }
      
      // 显示结果
      setCurrentResult(result);
      setResultModalVisible(true);
      
      // 清空文件列表
      setFileList([]);
      
    } catch (error) {
      console.error('处理失败:', error);
      message.error(error.message || '识别失败');
    } finally {
      setProcessing(false);
    }
  };

  // 批量处理
  const handleBatchProcess = async () => {
    if (fileList.length === 0) {
      message.warning('请选择要处理的文件');
      return;
    }
    
    if (fileList.length === 1) {
      // 如果只有一个文件，直接调用单个处理
      return handleProcessSingle();
    }

    setProcessing(true);
    
    try {
      const files = fileList.map(item => item.originFileObj || item);
      const result = await processBatch(files);
      
      // 显示批量结果
      Modal.info({
        title: '批量处理结果',
        width: 600,
        content: (
          <div>
            <p>成功: {result.success} 个文件</p>
            <p>失败: {result.failed} 个文件</p>
            {result.errors && result.errors.length > 0 && (
              <>
                <Divider />
                <Title level={5}>错误详情:</Title>
                {result.errors.map((err, index) => (
                  <Alert
                    key={index}
                    message={err.file}
                    description={err.error}
                    type="error"
                    showIcon
                    style={{ marginBottom: 8 }}
                  />
                ))}
              </>
            )}
          </div>
        ),
        onOk: () => {
          setFileList([]);
        }
      });
    } catch (error) {
      console.error('批量处理失败:', error);
      message.error('批量处理失败');
    } finally {
      setProcessing(false);
    }
  };

  // 清空文件列表
  const handleClearFiles = () => {
    setFileList([]);
    message.info('已清空文件列表');
  };

  // 复制文本
  const handleCopyText = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      message.success('已复制到剪贴板');
    }).catch(() => {
      message.error('复制失败');
    });
  };

  // 下载结果
  const handleDownloadResult = (result) => {
    const content = result.markdown || result.text || '';
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ocr_result_${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    message.success('下载成功');
  };

  // 任务列表列
  const taskColumns = [
    {
      title: '文件名',
      dataIndex: 'file_name',
      key: 'file_name',
      ellipsis: true
    },
    {
      title: '类型',
      dataIndex: 'task_type',
      key: 'task_type',
      width: 80,
      render: (type) => (
        <Tag color={type === 'pdf' ? 'purple' : 'blue'}>
          {type === 'pdf' ? 'PDF' : '图片'}
        </Tag>
      )
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status) => {
        const statusMap = {
          pending: { color: 'gold', text: '待处理' },
          processing: { color: 'blue', text: '处理中' },
          completed: { color: 'green', text: '已完成' },
          failed: { color: 'red', text: '失败' }
        };
        const config = statusMap[status] || { color: 'default', text: status };
        return <Tag color={config.color}>{config.text}</Tag>;
      }
    },
    {
      title: '积分消耗',
      dataIndex: 'credits_consumed',
      key: 'credits_consumed',
      width: 100,
      render: (credits) => (
        <Space>
          <DollarOutlined />
          <Text>{credits || 0}</Text>
        </Space>
      )
    },
    {
      title: '处理时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (date) => new Date(date).toLocaleString()
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_, record) => (
        <Space>
          <Button
            size="small"
            onClick={async () => {
              const task = await getTask(record.id);
              setCurrentResult(task);
              setResultModalVisible(true);
            }}
            disabled={record.status !== 'completed'}
          >
            查看结果
          </Button>
        </Space>
      )
    }
  ];

  return (
    <Layout className="ocr-tool-container">
      <Content style={{ padding: '24px' }}>
        <Card>
          <Row gutter={[16, 16]} align="middle">
            <Col flex="auto">
              <Title level={3}>
                <ScanOutlined /> OCR文字识别
              </Title>
            </Col>
            <Col>
              <Tag color="gold" style={{ fontSize: 14, padding: '4px 12px' }}>
                <DollarOutlined /> 积分余额: {userCredits}
              </Tag>
            </Col>
          </Row>
          
          {config && config.has_api_key ? (
            <Alert
              message="积分消耗说明"
              description={
                <Space>
                  <Text>图片: {config.credits_per_image} 积分/张</Text>
                  <Divider type="vertical" />
                  <Text>PDF: {config.credits_per_pdf_page} 积分/页</Text>
                  <Divider type="vertical" />
                  <Text>最大文件: {config.max_file_size_mb}MB</Text>
                </Space>
              }
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />
          ) : (
            <Alert
              message="OCR服务未配置"
              description="请联系管理员配置Mistral OCR API密钥"
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}
        </Card>

        <Card style={{ marginTop: 16 }}>
          <Tabs activeKey={activeTab} onChange={setActiveTab}>
            <TabPane 
              tab={<span><InboxOutlined /> 文件上传</span>} 
              key="upload"
            >
              <Dragger
                multiple
                fileList={fileList}
                beforeUpload={beforeUpload}
                onRemove={(file) => {
                  const newFileList = fileList.filter(item => item.uid !== file.uid);
                  setFileList(newFileList);
                }}
                onChange={({ fileList: newFileList }) => setFileList(newFileList)}
                disabled={processing || !config?.has_api_key}
                action=""  // 修复：设置空的action防止默认POST请求
                customRequest={({ onSuccess }) => {
                  // 修复：自定义请求处理，直接标记成功
                  onSuccess("ok");
                }}
              >
                <p className="ant-upload-drag-icon">
                  <InboxOutlined style={{ fontSize: 48 }} />
                </p>
                <p className="ant-upload-text">
                  点击或拖拽文件到此区域上传
                </p>
                <p className="ant-upload-hint">
                  支持图片（JPG、PNG、WebP等）和PDF文件，最大 {config?.max_file_size_mb || 50}MB
                </p>
              </Dragger>
              
              {fileList.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <Row justify="center" gutter={16}>
                    <Col>
                      <Button
                        type="primary"
                        size="large"
                        icon={<CloudUploadOutlined />}
                        onClick={fileList.length === 1 ? handleProcessSingle : handleBatchProcess}
                        loading={processing}
                        disabled={!config?.has_api_key}
                      >
                        {fileList.length === 1 ? '开始识别' : `批量识别 (${fileList.length} 个文件)`}
                      </Button>
                    </Col>
                    <Col>
                      <Button
                        size="large"
                        icon={<DeleteOutlined />}
                        onClick={handleClearFiles}
                        disabled={processing}
                      >
                        清空列表
                      </Button>
                    </Col>
                  </Row>
                  {processing && (
                    <div style={{ marginTop: 16, textAlign: 'center' }}>
                      <Progress percent={50} status="active" />
                      <Text type="secondary">正在处理，请稍候...</Text>
                    </div>
                  )}
                </div>
              )}
            </TabPane>
            
            <TabPane 
              tab={
                <Badge count={tasks.length} offset={[10, 0]}>
                  <span><HistoryOutlined /> 历史记录</span>
                </Badge>
              } 
              key="history"
            >
              <Table
                dataSource={tasks}
                columns={taskColumns}
                rowKey="id"
                loading={loading}
                pagination={{
                  pageSize: 10,
                  showSizeChanger: true,
                  showQuickJumper: true
                }}
              />
            </TabPane>
          </Tabs>
        </Card>

        {/* 结果展示弹窗 */}
        <Modal
          title="OCR识别结果"
          open={resultModalVisible}
          onCancel={() => {
            setResultModalVisible(false);
            setCurrentResult(null);
          }}
          width={800}
          footer={[
            <Button
              key="copy"
              icon={<CopyOutlined />}
              onClick={() => handleCopyText(currentResult?.text || '')}
            >
              复制文本
            </Button>,
            <Button
              key="download"
              icon={<DownloadOutlined />}
              onClick={() => handleDownloadResult(currentResult)}
            >
              下载结果
            </Button>,
            <Button
              key="close"
              type="primary"
              onClick={() => {
                setResultModalVisible(false);
                setCurrentResult(null);
              }}
            >
              关闭
            </Button>
          ]}
        >
          {currentResult && (
            <div>
              <Row gutter={16} style={{ marginBottom: 16 }}>
                <Col span={8}>
                  <Text type="secondary">文件名:</Text>
                  <Text strong style={{ marginLeft: 8 }}>
                    {currentResult.file_name}
                  </Text>
                </Col>
                <Col span={8}>
                  <Text type="secondary">消耗积分:</Text>
                  <Text strong style={{ marginLeft: 8 }}>
                    {currentResult.creditsConsumed || currentResult.credits_consumed || 0}
                  </Text>
                </Col>
                <Col span={8}>
                  <Text type="secondary">处理时长:</Text>
                  <Text strong style={{ marginLeft: 8 }}>
                    {currentResult.processingTime || currentResult.processing_time || 0}ms
                  </Text>
                </Col>
              </Row>
              
              <Divider />
              
              <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                {currentResult.results && currentResult.results.length > 0 ? (
                  // 多页结果
                  currentResult.results.map((page, index) => (
                    <div key={index}>
                      <Title level={5}>第 {page.page_number} 页</Title>
                      <Paragraph
                        copyable
                        style={{ 
                          background: '#f5f5f5', 
                          padding: 12, 
                          borderRadius: 4,
                          whiteSpace: 'pre-wrap'
                        }}
                      >
                        {page.markdown || page.text}
                      </Paragraph>
                    </div>
                  ))
                ) : (
                  // 单页结果
                  <Paragraph
                    copyable
                    style={{ 
                      background: '#f5f5f5', 
                      padding: 12, 
                      borderRadius: 4,
                      whiteSpace: 'pre-wrap'
                    }}
                  >
                    {currentResult.markdown || currentResult.text || '无识别结果'}
                  </Paragraph>
                )}
              </div>
            </div>
          )}
        </Modal>
      </Content>
    </Layout>
  );
};

export default OcrTool;
