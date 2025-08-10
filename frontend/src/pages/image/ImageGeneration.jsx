/**
 * 图像生成页面
 */

import React, { useEffect, useState } from 'react';
import {
  Layout,
  Card,
  Input,
  Button,
  Space,
  Row,
  Col,
  Slider,
  InputNumber,
  Switch,
  Tabs,
  Empty,
  Spin,
  Image,
  Tooltip,
  Tag,
  message,
  Badge,
  Modal,
  Popconfirm,
  Segmented,
  Collapse,
  Alert,
  Select
} from 'antd';
import {
  PictureOutlined,
  SendOutlined,
  ReloadOutlined,
  HeartOutlined,
  HeartFilled,
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  CopyOutlined,
  GlobalOutlined,
  LockOutlined,
  FireOutlined,
  ThunderboltOutlined,
  AppstoreOutlined,
  UnorderedListOutlined,
  SettingOutlined,
  CaretRightOutlined,
  UserOutlined,
  WarningOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import useImageStore from '../../stores/imageStore';
import useAuthStore from '../../stores/authStore';
import './ImageGeneration.less';

const { Content, Sider } = Layout;
const { TextArea } = Input;
const { TabPane } = Tabs;
const { Panel } = Collapse;
const { Option } = Select;

// 预设尺寸
const presetSizes = [
  { label: '正方形 1:1', value: '1024x1024', ratio: '1:1' },
  { label: '竖屏 3:4', value: '864x1152', ratio: '3:4' },
  { label: '横屏 4:3', value: '1152x864', ratio: '4:3' },
  { label: '宽屏 16:9', value: '1280x720', ratio: '16:9' },
  { label: '竖屏 9:16', value: '720x1280', ratio: '9:16' },
  { label: '竖屏 2:3', value: '832x1248', ratio: '2:3' },
  { label: '横屏 3:2', value: '1248x832', ratio: '3:2' },
  { label: '超宽 21:9', value: '1512x648', ratio: '21:9' }
];

// 生成数量选项
const quantityOptions = [
  { label: '1张', value: 1 },
  { label: '2张', value: 2 },
  { label: '3张', value: 3 },
  { label: '4张', value: 4 }
];

const ImageGeneration = () => {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const {
    models,
    selectedModel,
    generating,
    generationHistory,
    historyPagination,
    publicGallery,
    galleryPagination,
    loading,
    userStats,
    generationProgress,
    getModels,
    selectModel,
    generateImage,
    generateImages,
    getUserHistory,
    getPublicGallery,
    deleteGeneration,
    toggleFavorite,
    togglePublic,
    getUserStats
  } = useImageStore();

  // 生成参数状态
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [selectedSize, setSelectedSize] = useState('1024x1024');
  const [seed, setSeed] = useState(-1);
  const [guidanceScale, setGuidanceScale] = useState(2.5);
  const [watermark, setWatermark] = useState(true);
  const [quantity, setQuantity] = useState(1);
  const [viewMode, setViewMode] = useState('grid');
  const [activeTab, setActiveTab] = useState('all');
  const [previewImage, setPreviewImage] = useState(null);
  const [batchResults, setBatchResults] = useState(null);

  // 初始化
  useEffect(() => {
    getModels();
    getUserHistory();
    getUserStats();
  }, []);

  // 计算总价格
  const getTotalPrice = () => {
    if (!selectedModel) return 0;
    return (selectedModel.price_per_image || 0) * quantity;
  };

  // 处理模型选择
  const handleModelChange = (modelId) => {
    const model = models.find(m => m.id === modelId);
    if (model) {
      selectModel(model);
    }
  };

  // 处理生成
  const handleGenerate = async () => {
    if (!prompt.trim()) {
      message.warning('请输入提示词');
      return;
    }

    if (!selectedModel) {
      message.warning('请选择模型');
      return;
    }

    // 检查积分是否充足
    const totalPrice = getTotalPrice();
    if (user.credits_stats && user.credits_stats.remaining < totalPrice) {
      message.error(`积分不足！需要 ${totalPrice} 积分，当前余额 ${user.credits_stats.remaining} 积分`);
      return;
    }

    setBatchResults(null);

    const params = {
      prompt: prompt.trim(),
      negative_prompt: negativePrompt.trim(),
      size: selectedSize,
      seed: seed === -1 ? undefined : seed,
      guidance_scale: guidanceScale,
      watermark,
      quantity
    };

    const result = await generateImages(params);

    if (result) {
      // 批量生成完成后的处理 - 移除弹窗，只使用message提示
      if (quantity > 1 && result.results) {
        setBatchResults(result);
        
        // 根据结果显示不同类型的提示
        if (result.succeeded === result.requested) {
          message.success(`成功生成 ${result.succeeded} 张图片，消耗 ${result.creditsConsumed} 积分`);
        } else if (result.succeeded > 0) {
          message.warning(`部分成功：生成了 ${result.succeeded}/${result.requested} 张图片，消耗 ${result.creditsConsumed} 积分`);
        } else {
          message.error('所有图片生成失败');
        }
        
        // 如果有错误，额外显示错误信息
        if (result.errors && result.errors.length > 0) {
          result.errors.forEach(e => {
            message.error(`第${e.index}张生成失败: ${e.error}`);
          });
        }
      }
      
      // 清空输入
      setPrompt('');
      setNegativePrompt('');
      setSeed(-1);
    }
  };

  // 处理Tab切换
  const handleTabChange = (key) => {
    setActiveTab(key);
    
    if (key === 'public') {
      // 公开标签页：显示所有用户的公开画廊
      getPublicGallery({ page: 1, limit: 20 });
    } else {
      // 全部和收藏标签页：显示当前用户的图片
      const params = { page: 1, limit: 20 };
      if (key === 'favorites') {
        params.is_favorite = true;
      }
      getUserHistory(params);
    }
  };

  // 复制提示词
  const copyPrompt = (text) => {
    navigator.clipboard.writeText(text);
    message.success('提示词已复制');
  };

  // 下载图片
  const downloadImage = (url, filename) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || 'image.jpg';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // 处理公开/私有切换
  const handleTogglePublic = async (item) => {
    const success = await togglePublic(item.id);
    if (success) {
      // 根据当前是否公开显示不同提示
      if (item.is_public) {
        message.success('已设为私密');
      } else {
        message.success('已公开分享');
      }
      
      // 如果在公开标签页，刷新画廊
      if (activeTab === 'public') {
        getPublicGallery();
      }
    }
  };

  // 处理收藏切换
  const handleToggleFavorite = async (item) => {
    const success = await toggleFavorite(item.id);
    if (success) {
      // 根据当前是否收藏显示不同提示
      if (item.is_favorite) {
        message.success('已取消收藏');
      } else {
        message.success('已添加收藏');
      }
    }
  };

  // 渲染历史图片卡片（支持公开画廊和个人历史）
  const renderImageCard = (item, isGallery = false) => {
    // 检查是否是当前用户的图片
    const isOwner = !isGallery || item.user_id === user?.id;
    
    return (
      <Card
        key={item.id}
        className="history-card"
        cover={
          <div className="image-wrapper">
            <Image
              src={item.local_path || item.thumbnail_path}
              alt={item.prompt}
              placeholder={<Spin />}
              preview={{
                src: item.local_path
              }}
            />
            <div className="image-overlay">
              <Space>
                <Tooltip title="查看大图">
                  <Button
                    type="text"
                    icon={<EyeOutlined />}
                    onClick={() => setPreviewImage(item)}
                  />
                </Tooltip>
                <Tooltip title="下载">
                  <Button
                    type="text"
                    icon={<DownloadOutlined />}
                    onClick={() => downloadImage(item.local_path, `ai_${item.id}.jpg`)}
                  />
                </Tooltip>
                {isOwner && (
                  <>
                    <Tooltip title={item.is_favorite ? '取消收藏' : '收藏'}>
                      <Button
                        type="text"
                        icon={item.is_favorite ? <HeartFilled style={{ color: '#ff4d4f' }} /> : <HeartOutlined />}
                        onClick={() => handleToggleFavorite(item)}
                        className={item.is_favorite ? 'favorited' : ''}
                      />
                    </Tooltip>
                    <Tooltip title={item.is_public ? '设为私密' : '公开分享'}>
                      <Button
                        type="text"
                        icon={item.is_public ? <GlobalOutlined style={{ color: '#52c41a' }} /> : <LockOutlined />}
                        onClick={() => handleTogglePublic(item)}
                      />
                    </Tooltip>
                    <Popconfirm
                      title="确定删除这张图片吗？"
                      onConfirm={() => deleteGeneration(item.id)}
                      okText="确定"
                      cancelText="取消"
                    >
                      <Tooltip title="删除">
                        <Button
                          type="text"
                          danger
                          icon={<DeleteOutlined />}
                        />
                      </Tooltip>
                    </Popconfirm>
                  </>
                )}
              </Space>
            </div>
          </div>
        }
      >
        <Card.Meta
          title={
            <div className="card-meta-title">
              {item.model_name ? (
                <span className="model-tag">{item.model_name}</span>
              ) : (
                <span className="model-tag" style={{ background: '#f0f0f0', color: '#999' }}>
                  <WarningOutlined /> 模型已删除
                </span>
              )}
              <span className="size-tag">{item.size}</span>
            </div>
          }
          description={
            <div className="card-meta-description">
              <div className="prompt-text">
                {item.prompt}
                <Button
                  type="link"
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() => copyPrompt(item.prompt)}
                >
                  复制
                </Button>
              </div>
              <div className="meta-info">
                {isGallery && item.username && (
                  <span style={{ marginRight: 8 }}>
                    <UserOutlined /> {item.username}
                  </span>
                )}
                <span>{new Date(item.created_at).toLocaleString()}</span>
                {item.credits_consumed !== undefined && (
                  <span>{item.credits_consumed} 积分</span>
                )}
                {item.is_public && <Tag color="green">公开</Tag>}
                {item.is_favorite && isOwner && <Tag color="red">已收藏</Tag>}
                {isGallery && item.view_count !== undefined && (
                  <span style={{ fontSize: 12, color: '#999' }}>
                    <EyeOutlined /> {item.view_count}
                  </span>
                )}
              </div>
            </div>
          }
        />
      </Card>
    );
  };

  // 获取当前显示的数据
  const getCurrentData = () => {
    if (activeTab === 'public') {
      return publicGallery;
    }
    return generationHistory;
  };

  // 处理刷新
  const handleRefresh = () => {
    if (activeTab === 'public') {
      getPublicGallery();
    } else {
      const params = {};
      if (activeTab === 'favorites') {
        params.is_favorite = true;
      }
      getUserHistory(params);
    }
  };

  return (
    <Layout className="image-generation-page">
      {/* 左侧生成区域 */}
      <Sider width={380} className="generation-sider" theme="light">
        <div className="generation-container">
          {/* 模型选择 - 改为下拉框 */}
          <div className="model-selection-compact">
            <div className="section-title">选择模型</div>
            <Select
              className="model-select"
              placeholder="请选择生成模型"
              value={selectedModel?.id}
              onChange={handleModelChange}
              style={{ width: '100%' }}
            >
              {models.map(model => (
                <Option key={model.id} value={model.id}>
                  <Space>
                    <FireOutlined style={{ color: '#ff6b6b' }} />
                    <span>{model.display_name}</span>
                    <Tag color="blue" style={{ marginLeft: 'auto' }}>
                      {model.price_per_image} 积分
                    </Tag>
                  </Space>
                </Option>
              ))}
            </Select>
            {selectedModel && (
              <div className="model-description">
                <Space>
                  <Tag color="volcano">{selectedModel.provider}</Tag>
                  <span style={{ fontSize: '11px', color: '#8c8c8c' }}>
                    {selectedModel.description}
                  </span>
                </Space>
              </div>
            )}
          </div>

          <Card title="输入提示词" className="prompt-input">
            <TextArea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="描述你想生成的图片内容..."
              rows={3}
              maxLength={1000}
              showCount
            />
            <div className="negative-prompt">
              <div className="label">负面提示词（可选）</div>
              <TextArea
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
                placeholder="描述你不想在图片中出现的内容..."
                rows={2}
                maxLength={500}
              />
            </div>
          </Card>

          <Card title="参数设置" className="parameters">
            {/* 生成数量 - 使用Segmented组件 */}
            <div className="param-item">
              <div className="param-label">
                生成数量
                <Tooltip title="一次生成多张图片，每张使用不同的随机种子">
                  <span className="info-icon"> ❓</span>
                </Tooltip>
              </div>
              <Segmented
                options={quantityOptions}
                value={quantity}
                onChange={setQuantity}
                block
              />
              {quantity > 1 && (
                <div style={{ marginTop: 8 }}>
                  <Alert
                    message={`批量生成将消耗 ${getTotalPrice()} 积分`}
                    type="info"
                    showIcon={false}
                    banner
                  />
                </div>
              )}
            </div>

            {/* 图片尺寸 */}
            <div className="param-item">
              <div className="param-label">图片尺寸</div>
              <div className="size-grid">
                {presetSizes.map(size => (
                  <Button
                    key={size.value}
                    className={selectedSize === size.value ? 'selected' : ''}
                    onClick={() => setSelectedSize(size.value)}
                  >
                    {size.ratio}
                  </Button>
                ))}
              </div>
              <div className="size-display">{selectedSize}</div>
            </div>

            {/* 生成按钮 - 移到高级选项上方 */}
            <div className="generate-button-section">
              <Button
                type="primary"
                size="large"
                icon={<SendOutlined />}
                onClick={handleGenerate}
                loading={generating}
                disabled={!selectedModel || !prompt.trim()}
                block
              >
                {generating ? (
                  generationProgress ? (
                    <span>生成中 {generationProgress}...</span>
                  ) : (
                    '生成中...'
                  )
                ) : (
                  <Space>
                    <span>生成图片</span>
                    <Tag color="blue">{getTotalPrice()} 积分</Tag>
                  </Space>
                )}
              </Button>
            </div>

            {/* 高级选项 - 使用折叠面板 */}
            <Collapse
              ghost
              expandIcon={({ isActive }) => <CaretRightOutlined rotate={isActive ? 90 : 0} />}
              className="advanced-options"
            >
              <Panel 
                header={
                  <Space>
                    <SettingOutlined />
                    <span>高级选项</span>
                  </Space>
                } 
                key="1"
              >
                <div className="param-item">
                  <div className="param-label">
                    引导系数
                    <Tooltip title="控制生成图像与提示词的相关程度，值越大越相关">
                      <span className="info-icon"> ❓</span>
                    </Tooltip>
                  </div>
                  <Row gutter={16}>
                    <Col span={16}>
                      <Slider
                        min={1}
                        max={10}
                        step={0.5}
                        value={guidanceScale}
                        onChange={setGuidanceScale}
                      />
                    </Col>
                    <Col span={8}>
                      <InputNumber
                        min={1}
                        max={10}
                        step={0.5}
                        value={guidanceScale}
                        onChange={setGuidanceScale}
                        style={{ width: '100%' }}
                      />
                    </Col>
                  </Row>
                </div>

                <div className="param-item">
                  <div className="param-label">
                    随机种子
                    <Tooltip title="使用相同的种子值可以生成相似的图片，-1为随机。批量生成时每张图片种子会递增">
                      <span className="info-icon"> ❓</span>
                    </Tooltip>
                  </div>
                  <InputNumber
                    min={-1}
                    max={2147483647}
                    value={seed}
                    onChange={setSeed}
                    style={{ width: '100%' }}
                    placeholder="-1 为随机"
                  />
                  {quantity > 1 && seed !== -1 && (
                    <div style={{ fontSize: 12, color: '#888', marginTop: 5 }}>
                      批量生成种子值：{seed}, {seed + 1}, {seed + 2}...
                    </div>
                  )}
                </div>

                <div className="param-item">
                  <Row justify="space-between" align="middle">
                    <Col>添加水印</Col>
                    <Col>
                      <Switch checked={watermark} onChange={setWatermark} />
                    </Col>
                  </Row>
                </div>
              </Panel>
            </Collapse>
          </Card>
        </div>
      </Sider>

      {/* 右侧历史记录 */}
      <Content className="history-content">
        <div className="history-header">
          <Tabs activeKey={activeTab} onChange={handleTabChange}>
            <TabPane tab="我的图片" key="all" />
            <TabPane tab="我的收藏" key="favorites" />
            <TabPane tab={<span><GlobalOutlined /> 公开画廊</span>} key="public" />
          </Tabs>
          <Space>
            <Button
              icon={viewMode === 'grid' ? <AppstoreOutlined /> : <UnorderedListOutlined />}
              onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
            />
            <Button
              icon={<ReloadOutlined />}
              onClick={handleRefresh}
            >
              刷新
            </Button>
          </Space>
        </div>

        <div className={`history-grid ${viewMode}`}>
          {loading ? (
            <div className="loading-container">
              <Spin size="large" />
            </div>
          ) : getCurrentData().length > 0 ? (
            getCurrentData().map(item => renderImageCard(item, activeTab === 'public'))
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                activeTab === 'public' 
                  ? '暂无公开的图片' 
                  : activeTab === 'favorites'
                  ? '暂无收藏的图片'
                  : '暂无生成记录'
              }
            />
          )}
        </div>
      </Content>

      {/* 图片预览Modal */}
      <Modal
        open={!!previewImage}
        footer={null}
        onCancel={() => setPreviewImage(null)}
        width={800}
        centered
      >
        {previewImage && (
          <div className="preview-modal">
            <img src={previewImage.local_path} alt={previewImage.prompt} />
            <div className="preview-info">
              <p><strong>提示词：</strong>{previewImage.prompt}</p>
              {previewImage.negative_prompt && (
                <p><strong>负面提示词：</strong>{previewImage.negative_prompt}</p>
              )}
              <p>
                <strong>参数：</strong>
                尺寸 {previewImage.size} | 
                引导系数 {previewImage.guidance_scale || 'N/A'} | 
                种子 {previewImage.seed || 'N/A'}
              </p>
              {previewImage.username && (
                <p><strong>作者：</strong>{previewImage.username}</p>
              )}
            </div>
          </div>
        )}
      </Modal>
    </Layout>
  );
};

export default ImageGeneration;
