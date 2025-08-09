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
  Statistic,
  Badge,
  Dropdown,
  Modal,
  Popconfirm
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
  HistoryOutlined,
  FireOutlined,
  ThunderboltOutlined,
  StarOutlined,
  MoreOutlined,
  AppstoreOutlined,
  UnorderedListOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import useImageStore from '../../stores/imageStore';
import useAuthStore from '../../stores/authStore';
import './ImageGeneration.less';

const { Content, Sider } = Layout;
const { TextArea } = Input;
const { TabPane } = Tabs;

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

const ImageGeneration = () => {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const {
    models,
    selectedModel,
    generating,
    generationHistory,
    historyPagination,
    loading,
    userStats,
    getModels,
    selectModel,
    generateImage,
    getUserHistory,
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
  const [viewMode, setViewMode] = useState('grid'); // grid | list
  const [activeTab, setActiveTab] = useState('all');
  const [previewImage, setPreviewImage] = useState(null);

  // 初始化
  useEffect(() => {
    getModels();
    getUserHistory();
    getUserStats();
  }, []);

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

    const result = await generateImage({
      prompt: prompt.trim(),
      negative_prompt: negativePrompt.trim(),
      size: selectedSize,
      seed: seed === -1 ? undefined : seed,
      guidance_scale: guidanceScale,
      watermark
    });

    if (result) {
      // 清空输入
      setPrompt('');
      setNegativePrompt('');
      setSeed(-1);
    }
  };

  // 处理Tab切换
  const handleTabChange = (key) => {
    setActiveTab(key);
    const params = { page: 1, limit: 20 };
    if (key === 'favorites') {
      params.is_favorite = true;
    } else if (key === 'public') {
      params.is_public = true;
    }
    getUserHistory(params);
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

  // 渲染模型卡片
  const renderModelCard = (model) => (
    <Card
      key={model.id}
      className={`model-card ${selectedModel?.id === model.id ? 'selected' : ''}`}
      onClick={() => selectModel(model)}
      hoverable
    >
      <div className="model-header">
        <Badge 
          dot 
          status={model.is_active ? 'success' : 'default'}
          offset={[-5, 5]}
        >
          <FireOutlined className="model-icon" />
        </Badge>
        <div className="model-info">
          <div className="model-name">{model.display_name}</div>
          <div className="model-provider">{model.provider}</div>
        </div>
        <Tag color="blue">{model.price_per_image} 积分</Tag>
      </div>
      {model.description && (
        <div className="model-description">{model.description}</div>
      )}
      {selectedModel?.id === model.id && (
        <div className="selected-indicator">
          <ThunderboltOutlined /> 已选择
        </div>
      )}
    </Card>
  );

  // 渲染历史图片卡片
  const renderHistoryCard = (item) => (
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
              <Tooltip title={item.is_favorite ? '取消收藏' : '收藏'}>
                <Button
                  type="text"
                  icon={item.is_favorite ? <HeartFilled /> : <HeartOutlined />}
                  onClick={() => toggleFavorite(item.id)}
                  className={item.is_favorite ? 'favorited' : ''}
                />
              </Tooltip>
              <Tooltip title={item.is_public ? '设为私密' : '公开分享'}>
                <Button
                  type="text"
                  icon={item.is_public ? <GlobalOutlined /> : <LockOutlined />}
                  onClick={() => togglePublic(item.id)}
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
            </Space>
          </div>
        </div>
      }
    >
      <Card.Meta
        title={
          <div className="card-meta-title">
            <span className="model-tag">{item.model_name}</span>
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
              <span>{new Date(item.created_at).toLocaleString()}</span>
              <span>{item.credits_consumed} 积分</span>
            </div>
          </div>
        }
      />
    </Card>
  );

  return (
    <Layout className="image-generation-page">
      {/* 左侧生成区域 */}
      <Sider width={400} className="generation-sider" theme="light">
        <div className="generation-container">
          <Card title="选择模型" className="model-selection">
            <div className="model-list">
              {models.map(renderModelCard)}
            </div>
          </Card>

          <Card title="输入提示词" className="prompt-input">
            <TextArea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="描述你想生成的图片内容..."
              rows={4}
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

            <div className="param-item">
              <div className="param-label">
                引导系数
                <Tooltip title="控制生成图像与提示词的相关程度，值越大越相关">
                  <span className="info-icon">?</span>
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
                  />
                </Col>
              </Row>
            </div>

            <div className="param-item">
              <div className="param-label">
                随机种子
                <Tooltip title="使用相同的种子值可以生成相似的图片，-1为随机">
                  <span className="info-icon">?</span>
                </Tooltip>
              </div>
              <InputNumber
                min={-1}
                max={2147483647}
                value={seed}
                onChange={setSeed}
                style={{ width: '100%' }}
              />
            </div>

            <div className="param-item">
              <Row justify="space-between" align="middle">
                <Col>添加水印</Col>
                <Col>
                  <Switch checked={watermark} onChange={setWatermark} />
                </Col>
              </Row>
            </div>
          </Card>

          <div className="generate-actions">
            <Button
              type="primary"
              size="large"
              icon={<SendOutlined />}
              onClick={handleGenerate}
              loading={generating}
              disabled={!selectedModel || !prompt.trim()}
              block
            >
              {generating ? '生成中...' : `生成图片 (${selectedModel?.price_per_image || 0} 积分)`}
            </Button>
          </div>

          {userStats && (
            <Card className="user-stats">
              <Row gutter={16}>
                <Col span={12}>
                  <Statistic
                    title="累计生成"
                    value={userStats.total_generations || 0}
                    prefix={<PictureOutlined />}
                  />
                </Col>
                <Col span={12}>
                  <Statistic
                    title="消耗积分"
                    value={userStats.total_credits_consumed || 0}
                    prefix={<FireOutlined />}
                  />
                </Col>
              </Row>
            </Card>
          )}
        </div>
      </Sider>

      {/* 右侧历史记录 */}
      <Content className="history-content">
        <div className="history-header">
          <Tabs activeKey={activeTab} onChange={handleTabChange}>
            <TabPane tab="全部" key="all" />
            <TabPane tab="收藏" key="favorites" />
            <TabPane tab="公开" key="public" />
          </Tabs>
          <Space>
            <Button
              icon={viewMode === 'grid' ? <AppstoreOutlined /> : <UnorderedListOutlined />}
              onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
            />
            <Button
              icon={<ReloadOutlined />}
              onClick={() => getUserHistory()}
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
          ) : generationHistory.length > 0 ? (
            generationHistory.map(renderHistoryCard)
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无生成记录"
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
                引导系数 {previewImage.guidance_scale} | 
                种子 {previewImage.seed}
              </p>
            </div>
          </div>
        )}
      </Modal>
    </Layout>
  );
};

export default ImageGeneration;
