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
  Progress,
  Collapse,
  List,
  Tooltip
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
  CloudUploadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  FileTextOutlined,
  InfoCircleOutlined,
  PictureOutlined,
  FileDoneOutlined
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
const { Panel } = Collapse;

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
  const [batchResultModalVisible, setBatchResultModalVisible] = useState(false);
  const [batchResult, setBatchResult] = useState(null);
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

    // 检查文件数量限制
    if (fileList.length >= 20) {
      message.warning('最多支持同时上传20个文件');
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
      
      // 保存批量结果并显示
      setBatchResult(result);
      setBatchResultModalVisible(true);
      
      // 清空文件列表
      setFileList([]);
      
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

  // 下载批量结果
  const handleDownloadBatchResults = (results) => {
    let content = '# OCR批量识别结果\n\n';
    results.forEach((item, index) => {
      content += `## ${index + 1}. ${item.file}\n\n`;
      content += item.markdown || item.text || '无识别内容';
      content += '\n\n---\n\n';
    });
    
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ocr_batch_results_${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    message.success('批量结果已下载');
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
      <Content style={{ padding: '24px', minHeight: '100vh' }}>
        <Card className="ios-glass-card">
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

        <Card style={{ marginTop: 16 }} className="ios-glass-card">
          <Tabs activeKey={activeTab} onChange={setActiveTab}>
            <TabPane 
              tab={
                <span>
                  <InboxOutlined /> 文件上传
                </span>
              } 
              key="upload"
            >
              {/* 上传说明卡片 */}
              <div className="upload-info-cards">
                <Row gutter={16} style={{ marginBottom: 20 }}>
                  <Col xs={24} sm={8}>
                    <Card className="info-card" bordered={false}>
                      <Space direction="vertical" align="center" style={{ width: '100%' }}>
                        <div className="info-icon">
                          <PictureOutlined style={{ fontSize: 32, color: '#667eea' }} />
                        </div>
                        <Text strong>支持多种格式</Text>
                        <Text type="secondary" style={{ fontSize: 12, textAlign: 'center' }}>
                          JPG、PNG、WebP、PDF等
                        </Text>
                      </Space>
                    </Card>
                  </Col>
                  <Col xs={24} sm={8}>
                    <Card className="info-card" bordered={false}>
                      <Space direction="vertical" align="center" style={{ width: '100%' }}>
                        <div className="info-icon">
                          <FileDoneOutlined style={{ fontSize: 32, color: '#764ba2' }} />
                        </div>
                        <Text strong>批量处理</Text>
                        <Text type="secondary" style={{ fontSize: 12, textAlign: 'center' }}>
                          一次最多可上传20个文件
                        </Text>
                      </Space>
                    </Card>
                  </Col>
                  <Col xs={24} sm={8}>
                    <Card className="info-card" bordered={false}>
                      <Space direction="vertical" align="center" style={{ width: '100%' }}>
                        <div className="info-icon">
                          <CloudUploadOutlined style={{ fontSize: 32, color: '#f093fb' }} />
                        </div>
                        <Text strong>智能识别</Text>
                        <Text type="secondary" style={{ fontSize: 12, textAlign: 'center' }}>
                          基于Mistral OCR引擎
                        </Text>
                      </Space>
                    </Card>
                  </Col>
                </Row>
              </div>

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
                action=""
                customRequest={({ onSuccess }) => {
                  onSuccess("ok");
                }}
                className="ocr-upload-dragger"
              >
                <p className="ant-upload-drag-icon">
                  <InboxOutlined style={{ fontSize: 64 }} />
                </p>
                <p className="ant-upload-text">
                  点击或拖拽文件到此区域
                </p>
                <p className="ant-upload-hint">
                  <Space direction="vertical" size={4}>
                    <span>支持批量上传，一次最多20个文件</span>
                    <span>单个文件最大 {config?.max_file_size_mb || 50}MB</span>
                  </Space>
                </p>
                {fileList.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <Tag color="blue">
                      已选择 {fileList.length} 个文件
                    </Tag>
                  </div>
                )}
              </Dragger>
              
              {fileList.length > 0 && (
                <div style={{ marginTop: 20 }}>
                  {/* 预计消耗积分提示 */}
                  <Alert
                    message={
                      <Space>
                        <InfoCircleOutlined />
                        <span>
                          预计消耗积分：
                          {fileList.reduce((sum, file) => {
                            const isImage = file.type?.startsWith('image/');
                            const isPDF = file.type === 'application/pdf';
                            if (isImage) {
                              return sum + parseInt(config?.credits_per_image || 5);
                            } else if (isPDF) {
                              // PDF按页数计算，这里暂时按1页估算
                              return sum + parseInt(config?.credits_per_pdf_page || 3);
                            }
                            return sum;
                          }, 0)}
                          （PDF按实际页数计算）
                        </span>
                      </Space>
                    }
                    type="info"
                    showIcon={false}
                    style={{ marginBottom: 16 }}
                  />

                  <Row justify="center" gutter={16}>
                    <Col>
                      <Button
                        type="primary"
                        size="large"
                        icon={<CloudUploadOutlined />}
                        onClick={fileList.length === 1 ? handleProcessSingle : handleBatchProcess}
                        loading={processing}
                        disabled={!config?.has_api_key}
                        className="ios-gradient-btn"
                        style={{ minWidth: 180 }}
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
                    <div style={{ marginTop: 20, textAlign: 'center' }}>
                      <Progress percent={50} status="active" />
                      <Text type="secondary">正在处理，请稍候...</Text>
                    </div>
                  )}
                </div>
              )}
            </TabPane>
            
            <TabPane 
              tab={
                <Space>
                  <HistoryOutlined />
                  <span>历史记录</span>
                  {tasks.length > 0 && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      ({tasks.length})
                    </Text>
                  )}
                </Space>
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
                  showQuickJumper: true,
                  showTotal: (total) => `共 ${total} 条记录`
                }}
              />
            </TabPane>
          </Tabs>
        </Card>

        {/* 单个结果展示弹窗 */}
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

        {/* 批量结果展示弹窗 */}
        <Modal
          title={
            <Space>
              <FileTextOutlined />
              <span>批量OCR识别结果</span>
            </Space>
          }
          open={batchResultModalVisible}
          onCancel={() => {
            setBatchResultModalVisible(false);
            setBatchResult(null);
          }}
          width={900}
          bodyStyle={{ maxHeight: '600px', overflowY: 'auto' }}
          footer={[
            <Button
              key="download"
              type="primary"
              icon={<DownloadOutlined />}
              onClick={() => handleDownloadBatchResults(batchResult?.results || [])}
              disabled={!batchResult?.results || batchResult.results.length === 0}
            >
              下载全部结果
            </Button>,
            <Button
              key="history"
              icon={<HistoryOutlined />}
              onClick={() => {
                setBatchResultModalVisible(false);
                setActiveTab('history');
                getTasks(); // 刷新历史记录
              }}
            >
              查看历史记录
            </Button>,
            <Button
              key="close"
              onClick={() => {
                setBatchResultModalVisible(false);
                setBatchResult(null);
              }}
            >
              关闭
            </Button>
          ]}
        >
          {batchResult && (
            <div>
              {/* 统计信息 */}
              <Row gutter={16} style={{ marginBottom: 20 }}>
                <Col span={8}>
                  <Card size="small" className="ios-stat-card">
                    <Space>
                      <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 20 }} />
                      <div>
                        <Text type="secondary">成功处理</Text>
                        <br />
                        <Text strong style={{ fontSize: 18 }}>{batchResult.success} 个文件</Text>
                      </div>
                    </Space>
                  </Card>
                </Col>
                <Col span={8}>
                  <Card size="small" className="ios-stat-card">
                    <Space>
                      <CloseCircleOutlined style={{ color: '#ff4d4f', fontSize: 20 }} />
                      <div>
                        <Text type="secondary">处理失败</Text>
                        <br />
                        <Text strong style={{ fontSize: 18 }}>{batchResult.failed} 个文件</Text>
                      </div>
                    </Space>
                  </Card>
                </Col>
                <Col span={8}>
                  <Card size="small" className="ios-stat-card">
                    <Space>
                      <DollarOutlined style={{ color: '#faad14', fontSize: 20 }} />
                      <div>
                        <Text type="secondary">总消耗积分</Text>
                        <br />
                        <Text strong style={{ fontSize: 18 }}>
                          {batchResult.results?.reduce((sum, item) => 
                            sum + (item.creditsConsumed || 0), 0) || 0}
                        </Text>
                      </div>
                    </Space>
                  </Card>
                </Col>
              </Row>

              <Divider />

              {/* 成功的识别结果 */}
              {batchResult.results && batchResult.results.length > 0 && (
                <>
                  <Title level={5}>
                    <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 8 }} />
                    识别成功的文件 ({batchResult.results.length})
                  </Title>
                  <Collapse 
                    defaultActiveKey={['0']}
                    style={{ marginBottom: 16 }}
                  >
                    {batchResult.results.map((item, index) => (
                      <Panel
                        key={index.toString()}
                        header={
                          <Space>
                            <FileTextOutlined />
                            <Text strong>{item.file}</Text>
                            <Tag color="green" size="small">成功</Tag>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              消耗积分: {item.creditsConsumed || 0}
                            </Text>
                          </Space>
                        }
                        extra={
                          <Space onClick={e => e.stopPropagation()}>
                            <Button
                              size="small"
                              icon={<CopyOutlined />}
                              onClick={() => handleCopyText(item.text || '')}
                            >
                              复制
                            </Button>
                            <Button
                              size="small"
                              icon={<DownloadOutlined />}
                              onClick={() => handleDownloadResult(item)}
                            >
                              下载
                            </Button>
                          </Space>
                        }
                      >
                        <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                          <Paragraph
                            copyable
                            style={{ 
                              background: '#f9f9f9',
                              padding: 12,
                              borderRadius: 4,
                              whiteSpace: 'pre-wrap',
                              marginBottom: 0
                            }}
                          >
                            {item.markdown || item.text || '无识别内容'}
                          </Paragraph>
                        </div>
                      </Panel>
                    ))}
                  </Collapse>
                </>
              )}

              {/* 失败的文件 */}
              {batchResult.errors && batchResult.errors.length > 0 && (
                <>
                  <Title level={5}>
                    <CloseCircleOutlined style={{ color: '#ff4d4f', marginRight: 8 }} />
                    处理失败的文件 ({batchResult.errors.length})
                  </Title>
                  <div style={{ marginBottom: 16 }}>
                    {batchResult.errors.map((err, index) => (
                      <Alert
                        key={index}
                        message={
                          <Space>
                            <FileTextOutlined />
                            <Text strong>{err.file}</Text>
                          </Space>
                        }
                        description={err.error}
                        type="error"
                        showIcon
                        style={{ marginBottom: 8 }}
                      />
                    ))}
                  </div>
                </>
              )}

              {/* 无结果提示 */}
              {(!batchResult.results || batchResult.results.length === 0) && 
               (!batchResult.errors || batchResult.errors.length === 0) && (
                <Empty description="暂无处理结果" />
              )}
            </div>
          )}
        </Modal>
      </Content>
    </Layout>
  );
};

export default OcrTool;
