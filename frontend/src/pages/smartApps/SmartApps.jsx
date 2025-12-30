/**
 * 智能应用广场页面
 * 功能：展示已发布的预设AI应用，用户可一键使用
 * 
 * 版本：v1.2.0
 * 更新：
 * - 2025-12-30 v1.1.0 完善使用流程，获取应用配置创建会话
 * - 2025-12-30 v1.2.0 删除页面头部节省空间，增大应用图标
 */

import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  Row,
  Col,
  Input,
  Tag,
  Space,
  Spin,
  Empty,
  Typography,
  Segmented,
  message,
  Tooltip,
  Badge
} from 'antd';
import {
  SearchOutlined,
  RocketOutlined,
  FireOutlined,
  ThunderboltOutlined,
  AppstoreOutlined,
  EditOutlined,
  CodeOutlined,
  BookOutlined,
  ScheduleOutlined,
  BulbOutlined,
  HomeOutlined,
  StarFilled
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import useSmartAppStore from '../../stores/smartAppStore';
import useChatStore from '../../stores/chatStore';
import './SmartApps.less';

const { Title, Text, Paragraph } = Typography;

/**
 * 分类图标映射
 */
const CATEGORY_ICONS = {
  '写作助手': <EditOutlined />,
  '编程开发': <CodeOutlined />,
  '学习教育': <BookOutlined />,
  '办公效率': <ScheduleOutlined />,
  '创意设计': <BulbOutlined />,
  '生活助手': <HomeOutlined />,
  '其他': <AppstoreOutlined />
};

/**
 * 分类颜色映射
 */
const CATEGORY_COLORS = {
  '写作助手': { bg: '#e6f4ff', color: '#1677ff', border: '#91caff' },
  '编程开发': { bg: '#f6ffed', color: '#52c41a', border: '#b7eb8f' },
  '学习教育': { bg: '#f9f0ff', color: '#722ed1', border: '#d3adf7' },
  '办公效率': { bg: '#fff7e6', color: '#fa8c16', border: '#ffd591' },
  '创意设计': { bg: '#fff0f6', color: '#eb2f96', border: '#ffadd2' },
  '生活助手': { bg: '#e6fffb', color: '#13c2c2', border: '#87e8de' },
  '其他': { bg: '#f5f5f5', color: '#8c8c8c', border: '#d9d9d9' }
};

/**
 * 智能应用广场组件
 */
const SmartApps = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  
  // 状态管理
  const { 
    apps, 
    categories, 
    loading, 
    getPublishedApps, 
    getCategories,
    getAppConfig,
    useApp 
  } = useSmartAppStore();
  
  const { createConversation, getAIModels, aiModels } = useChatStore();
  
  // 本地状态
  const [searchKeyword, setSearchKeyword] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('全部');
  const [usingAppId, setUsingAppId] = useState(null);
  
  // 响应式检测
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 初始化加载
  useEffect(() => {
    getPublishedApps();
    getCategories();
    if (!aiModels.length) {
      getAIModels();
    }
  }, []);

  /**
   * 过滤应用列表
   */
  const filteredApps = useMemo(() => {
    let result = apps;
    
    // 分类过滤
    if (selectedCategory && selectedCategory !== '全部') {
      result = result.filter(app => app.category === selectedCategory);
    }
    
    // 关键词搜索
    if (searchKeyword.trim()) {
      const keyword = searchKeyword.toLowerCase();
      result = result.filter(app => 
        app.name.toLowerCase().includes(keyword) ||
        (app.description && app.description.toLowerCase().includes(keyword))
      );
    }
    
    return result;
  }, [apps, selectedCategory, searchKeyword]);

  /**
   * 构建分类选项
   */
  const categoryOptions = useMemo(() => {
    const options = [{ label: '全部', value: '全部' }];
    
    // 统计每个分类的应用数量
    const categoryCounts = {};
    apps.forEach(app => {
      const cat = app.category || '其他';
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    });
    
    // 添加有应用的分类
    Object.keys(CATEGORY_COLORS).forEach(cat => {
      if (categoryCounts[cat]) {
        options.push({
          label: (
            <Space size={4}>
              {CATEGORY_ICONS[cat]}
              <span>{cat}</span>
              <Badge count={categoryCounts[cat]} style={{ backgroundColor: CATEGORY_COLORS[cat].color }} />
            </Space>
          ),
          value: cat
        });
      }
    });
    
    return options;
  }, [apps]);

  /**
   * 使用应用 - 获取配置并创建带预设配置的对话
   */
  const handleUseApp = async (app) => {
    try {
      setUsingAppId(app.id);
      
      // 1. 获取应用配置（包含系统提示词）
      const config = await getAppConfig(app.id);
      
      // 2. 创建新对话，使用应用的预设配置
      const conversationData = {
        title: config.name || app.name,
        model_name: config.model_name,
        system_prompt: config.system_prompt,
        smart_app_id: config.smart_app_id,
        ai_temperature: config.temperature || 0.7,
        context_length: config.context_length || 10
      };
      
      const newConversation = await createConversation(conversationData);
      
      if (newConversation) {
        message.success(`已创建「${app.name}」对话`);
        // 跳转到聊天页面
        navigate('/chat');
      }
    } catch (error) {
      console.error('使用应用失败:', error);
      message.error(error.response?.data?.message || '启动应用失败');
    } finally {
      setUsingAppId(null);
    }
  };

  /**
   * 获取分类样式
   */
  const getCategoryStyle = (category) => {
    return CATEGORY_COLORS[category] || CATEGORY_COLORS['其他'];
  };

  /**
   * 渲染应用卡片
   */
  const renderAppCard = (app) => {
    const categoryStyle = getCategoryStyle(app.category);
    const isUsing = usingAppId === app.id;
    
    return (
      <Col xs={24} sm={12} md={8} lg={6} key={app.id}>
        <Card
          className={`smart-app-card ${isUsing ? 'using' : ''}`}
          hoverable
          onClick={() => !isUsing && handleUseApp(app)}
          style={{
            borderColor: categoryStyle.border,
            backgroundColor: categoryStyle.bg
          }}
        >
          {/* 热门标识 */}
          {app.use_count > 10 && (
            <div className="hot-badge">
              <FireOutlined /> 热门
            </div>
          )}
          
          {/* 应用图标和名称 */}
          <div className="app-header">
            <div 
              className="app-icon"
              style={{ backgroundColor: categoryStyle.color }}
            >
              {app.icon ? (
                <img src={app.icon} alt={app.name} />
              ) : (
                <RocketOutlined />
              )}
            </div>
            <div className="app-title-area">
              <Text strong className="app-name" ellipsis={{ tooltip: app.name }}>
                {app.name}
              </Text>
              <Tag 
                color={categoryStyle.color}
                style={{ marginTop: 4 }}
              >
                {CATEGORY_ICONS[app.category] || <AppstoreOutlined />}
                <span style={{ marginLeft: 4 }}>{app.category || '其他'}</span>
              </Tag>
            </div>
          </div>
          
          {/* 应用描述 */}
          <Paragraph 
            className="app-description"
            ellipsis={{ rows: 2 }}
            style={{ color: categoryStyle.color }}
          >
            {app.description || '暂无描述'}
          </Paragraph>
          
          {/* 应用信息 */}
          <div className="app-footer">
            <Space size="small" wrap>
              <Tooltip title="AI模型">
                <Tag icon={<ThunderboltOutlined />} color="processing">
                  {app.model_display_name || app.model_name}
                </Tag>
              </Tooltip>
              {app.is_stream ? (
                <Tag color="green">流式</Tag>
              ) : null}
            </Space>
            
            {/* 使用次数 */}
            <Text type="secondary" className="use-count">
              <StarFilled style={{ color: '#faad14', marginRight: 4 }} />
              {app.use_count || 0}次使用
            </Text>
          </div>
          
          {/* 加载遮罩 */}
          {isUsing && (
            <div className="loading-overlay">
              <Spin tip="正在启动..." />
            </div>
          )}
        </Card>
      </Col>
    );
  };

  return (
    <div className="smart-apps-container">
      {/* v1.2.0 删除页面头部，直接显示搜索和筛选区 */}
      
      {/* 搜索和筛选区 */}
      <div className="filter-section">
        <Input
          placeholder="搜索应用名称或描述..."
          prefix={<SearchOutlined />}
          value={searchKeyword}
          onChange={(e) => setSearchKeyword(e.target.value)}
          allowClear
          className="search-input"
        />
        
        <div className="category-filter">
          <Segmented
            options={categoryOptions}
            value={selectedCategory}
            onChange={setSelectedCategory}
            className="category-segmented"
          />
        </div>
      </div>

      {/* 应用列表 */}
      <div className="apps-section">
        {loading ? (
          <div className="loading-container">
            <Spin size="large" tip="加载应用中..." />
          </div>
        ) : filteredApps.length > 0 ? (
          <Row gutter={[16, 16]}>
            {filteredApps.map(renderAppCard)}
          </Row>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              searchKeyword || selectedCategory !== '全部'
                ? '没有找到匹配的应用'
                : '暂无可用应用'
            }
          />
        )}
      </div>
    </div>
  );
};

export default SmartApps;
