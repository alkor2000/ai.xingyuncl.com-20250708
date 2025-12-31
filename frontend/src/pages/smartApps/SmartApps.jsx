/**
 * 智能应用广场页面
 * 功能：展示已发布的预设AI应用，点击打开弹窗对话
 * 
 * 版本：v2.2.0
 * 更新：
 * - 2025-12-30 v2.0.1 去掉应用卡片上的模型名称
 * - 2025-12-30 v2.2.0 新增用户收藏功能，卡片底部心形按钮
 */

import React, { useEffect, useState, useMemo } from 'react';
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
  Tooltip,
  Badge
} from 'antd';
import {
  SearchOutlined,
  RocketOutlined,
  FireOutlined,
  AppstoreOutlined,
  StarFilled,
  DollarOutlined,
  HeartOutlined,
  HeartFilled
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import useSmartAppStore from '../../stores/smartAppStore';
import SmartAppChatModal from '../../components/smartApps/SmartAppChatModal';
import './SmartApps.less';

const { Text, Paragraph } = Typography;

/**
 * 智能应用广场组件
 */
const SmartApps = () => {
  const { t } = useTranslation();
  
  // 状态管理
  const { 
    apps, 
    loading, 
    categories,
    categoryStats,
    favoriteCount,
    getPublishedApps, 
    getCategories,
    getFavorites,
    toggleFavorite
  } = useSmartAppStore();
  
  // 本地状态
  const [searchKeyword, setSearchKeyword] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('all');
  const [favoriteApps, setFavoriteApps] = useState([]);  // v2.2.0 收藏列表
  const [favoriteLoading, setFavoriteLoading] = useState({});  // 收藏按钮加载状态
  
  // 弹窗对话状态
  const [chatModalVisible, setChatModalVisible] = useState(false);
  const [selectedApp, setSelectedApp] = useState(null);
  
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
  }, []);

  /**
   * v2.2.0 当选择"我的收藏"时加载收藏列表
   */
  useEffect(() => {
    if (selectedCategoryId === 'favorites') {
      loadFavorites();
    }
  }, [selectedCategoryId]);

  /**
   * v2.2.0 加载收藏列表
   */
  const loadFavorites = async () => {
    const list = await getFavorites();
    setFavoriteApps(list);
  };

  /**
   * v2.2.0 处理收藏点击
   */
  const handleFavoriteClick = async (e, appId) => {
    e.stopPropagation();  // 阻止冒泡，避免触发卡片点击
    
    setFavoriteLoading(prev => ({ ...prev, [appId]: true }));
    
    const newStatus = await toggleFavorite(appId);
    
    // 如果当前在收藏列表且取消收藏，需要从列表移除
    if (selectedCategoryId === 'favorites' && !newStatus) {
      setFavoriteApps(prev => prev.filter(app => app.id !== appId));
    }
    
    setFavoriteLoading(prev => ({ ...prev, [appId]: false }));
  };

  /**
   * 过滤应用列表
   * v2.2.0 支持收藏筛选
   */
  const filteredApps = useMemo(() => {
    // 如果选择"我的收藏"，显示收藏列表
    if (selectedCategoryId === 'favorites') {
      let result = favoriteApps;
      if (searchKeyword.trim()) {
        const keyword = searchKeyword.toLowerCase();
        result = result.filter(app => 
          app.name.toLowerCase().includes(keyword) ||
          (app.description && app.description.toLowerCase().includes(keyword))
        );
      }
      return result;
    }
    
    let result = apps;
    
    // 分类过滤
    if (selectedCategoryId && selectedCategoryId !== 'all') {
      const catId = parseInt(selectedCategoryId);
      result = result.filter(app => 
        app.category_ids && app.category_ids.includes(catId)
      );
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
  }, [apps, favoriteApps, selectedCategoryId, searchKeyword]);

  /**
   * 构建分类选项（从数据库动态加载）
   * v2.2.0 新增"我的收藏"选项
   */
  const categoryOptions = useMemo(() => {
    const options = [
      { label: '全部', value: 'all' },
      // v2.2.0 "我的收藏"选项
      { 
        label: (
          <Space size={4}>
            <HeartFilled style={{ color: '#ff4d4f' }} />
            <span>我的收藏</span>
            {favoriteCount > 0 && (
              <Badge count={favoriteCount} style={{ backgroundColor: '#ff4d4f' }} />
            )}
          </Space>
        ), 
        value: 'favorites' 
      }
    ];
    
    // 从categoryStats获取每个分类的应用数量
    const statsMap = new Map(categoryStats.map(s => [s.id, s.count]));
    
    // 添加有应用的分类
    categories.forEach(cat => {
      const count = statsMap.get(cat.id) || 0;
      if (count > 0) {
        options.push({
          label: (
            <Space size={4}>
              <span style={{ 
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: cat.color
              }} />
              <span>{cat.name}</span>
              <Badge count={count} style={{ backgroundColor: cat.color }} />
            </Space>
          ),
          value: cat.id.toString()
        });
      }
    });
    
    return options;
  }, [categories, categoryStats, favoriteCount]);

  /**
   * 点击应用卡片 - 打开弹窗对话
   */
  const handleAppClick = (app) => {
    setSelectedApp(app);
    setChatModalVisible(true);
  };

  /**
   * 关闭对话弹窗
   */
  const handleCloseChat = () => {
    setChatModalVisible(false);
    setTimeout(() => setSelectedApp(null), 300);
  };

  /**
   * 获取应用的主分类样式（第一个分类）
   */
  const getPrimaryCategoryStyle = (app) => {
    if (app.categories && app.categories.length > 0) {
      const primaryCat = app.categories[0];
      return {
        bg: `${primaryCat.color}15`,
        color: primaryCat.color,
        border: `${primaryCat.color}50`
      };
    }
    return {
      bg: '#f5f5f5',
      color: '#8c8c8c',
      border: '#d9d9d9'
    };
  };

  /**
   * 渲染应用卡片
   * v2.2.0 增加收藏按钮
   */
  const renderAppCard = (app) => {
    const categoryStyle = getPrimaryCategoryStyle(app);
    const isFavorited = app.is_favorited;
    const isLoadingFavorite = favoriteLoading[app.id];
    
    return (
      <Col xs={24} sm={12} md={8} lg={6} key={app.id}>
        <Card
          className="smart-app-card"
          hoverable
          onClick={() => handleAppClick(app)}
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
              {/* 显示多个分类标签 */}
              <div style={{ marginTop: 4 }}>
                {app.categories && app.categories.length > 0 ? (
                  app.categories.slice(0, 2).map(cat => (
                    <Tag 
                      key={cat.id}
                      color={cat.color}
                      style={{ marginRight: 4, marginBottom: 2 }}
                    >
                      {cat.name}
                    </Tag>
                  ))
                ) : (
                  <Tag color="default">未分类</Tag>
                )}
                {app.categories && app.categories.length > 2 && (
                  <Tooltip title={app.categories.slice(2).map(c => c.name).join('、')}>
                    <Tag>+{app.categories.length - 2}</Tag>
                  </Tooltip>
                )}
              </div>
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
          
          {/* 应用信息 - v2.2.0 增加收藏按钮 */}
          <div className="app-footer">
            <Space size="small">
              {/* 显示积分消耗 */}
              {app.credits_per_use > 0 && (
                <Tooltip title="每次使用消耗积分">
                  <Tag icon={<DollarOutlined />} color="gold">
                    {app.credits_per_use}积分
                  </Tag>
                </Tooltip>
              )}
            </Space>
            
            <Space size="small">
              {/* 使用次数 */}
              <Text type="secondary" className="use-count">
                <StarFilled style={{ color: '#faad14', marginRight: 4 }} />
                {app.use_count || 0}次
              </Text>
              
              {/* v2.2.0 收藏按钮 */}
              <Tooltip title={isFavorited ? '取消收藏' : '收藏'}>
                <span 
                  className={`favorite-btn ${isFavorited ? 'favorited' : ''} ${isLoadingFavorite ? 'loading' : ''}`}
                  onClick={(e) => handleFavoriteClick(e, app.id)}
                >
                  {isFavorited ? (
                    <HeartFilled style={{ color: '#ff4d4f' }} />
                  ) : (
                    <HeartOutlined style={{ color: '#8c8c8c' }} />
                  )}
                </span>
              </Tooltip>
            </Space>
          </div>
        </Card>
      </Col>
    );
  };

  return (
    <div className="smart-apps-container">
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
            value={selectedCategoryId}
            onChange={setSelectedCategoryId}
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
              selectedCategoryId === 'favorites'
                ? '暂无收藏的应用'
                : searchKeyword || selectedCategoryId !== 'all'
                  ? '没有找到匹配的应用'
                  : '暂无可用应用'
            }
          />
        )}
      </div>

      {/* 对话弹窗 */}
      <SmartAppChatModal
        visible={chatModalVisible}
        onClose={handleCloseChat}
        app={selectedApp}
      />
    </div>
  );
};

export default SmartApps;
