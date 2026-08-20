/**
 * 智能应用广场页面
 * 功能：展示已发布的预设AI应用，点击打开弹窗对话
 *
 * ===== v2.4.0 国际化改造要点（务必理解，勿回退）=====
 *
 * 1. 【最关键】categoryOptions 的 useMemo 依赖数组必须包含 t
 *    该数组内含"全部""我的收藏"两处界面文案。
 *    useMemo 会缓存计算结果，若依赖数组不含 t，
 *    语言切换后 t 变了但 useMemo 不重算 → 分类筛选器仍显示旧语言。
 *    这类"缓存住已翻译文案"的问题在中文环境下完全看不出来。
 *
 * 2. 分类分隔符走 i18n：
 *    原 join('、') 使用中文顿号，英文环境应为 ", "。
 *    这类 CJK 标点问题极易漏检（只查汉字的正则扫不到），
 *    故单独定义 smartApps.card.categorySeparator 键。
 *
 * 3. 不翻译的内容（遵循翻译边界原则）：
 *    - app.name / app.description：后台录入的应用信息
 *    - cat.name / cat.color：后台录入的分类名称与配色
 *    - app.use_count / credits_per_use：纯数值
 *
 * 4. 本组件此前已 import useTranslation 并解构出 t，
 *    但一个 t() 都没调用（13 处全是硬编码中文），属"改了一半"的状态。
 *
 * ===== 版本历史 =====
 * v2.3.0 优化卡片尺寸：PC端4列紧凑卡片，移动端六宫格2列布局，分类横向滚动
 * v2.2.0 新增用户收藏功能，卡片底部心形按钮
 * v2.0.1 去掉应用卡片上的模型名称
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

/* 移动端判定阈值，与 SmartApps.less 的媒体查询断点保持一致 */
const MOBILE_BREAKPOINT = 768;

/* 使用次数超过该值显示"热门"标识 */
const HOT_THRESHOLD = 10;

/* 卡片上最多展示的分类标签数，超出的合并为 +N 并在 Tooltip 中列出 */
const MAX_VISIBLE_CATEGORIES = 2;

/* 关闭弹窗后延迟清空 selectedApp，等待关闭动画播完避免内容闪烁 */
const MODAL_CLEAR_DELAY_MS = 300;

/* 无分类时的兜底配色（与语言无关，属视觉常量） */
const FALLBACK_CATEGORY_STYLE = {
  bg: '#f5f5f5',
  color: '#8c8c8c',
  border: '#d9d9d9'
};

const SmartApps = () => {
  const { t } = useTranslation();

  // ============ Store 状态 ============
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

  // ============ 本地状态 ============
  const [searchKeyword, setSearchKeyword] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('all');
  const [favoriteApps, setFavoriteApps] = useState([]);
  /* 按 appId 记录收藏按钮的加载态，避免重复点击 */
  const [favoriteLoading, setFavoriteLoading] = useState({});

  // ============ 弹窗对话状态 ============
  const [chatModalVisible, setChatModalVisible] = useState(false);
  const [selectedApp, setSelectedApp] = useState(null);

  /* 响应式检测：移动端卡片简化显示（隐藏分类标签、描述改单行） */
  const [isMobile, setIsMobile] = useState(window.innerWidth <= MOBILE_BREAKPOINT);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= MOBILE_BREAKPOINT);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  /* 初始化加载应用列表与分类 */
  useEffect(() => {
    getPublishedApps();
    getCategories();
  }, []);

  /* 切换到"我的收藏"时按需加载收藏列表 */
  useEffect(() => {
    if (selectedCategoryId === 'favorites') {
      loadFavorites();
    }
  }, [selectedCategoryId]);

  const loadFavorites = async () => {
    const list = await getFavorites();
    setFavoriteApps(list);
  };

  /**
   * 处理收藏点击
   * stopPropagation 防止冒泡触发卡片点击进入对话
   */
  const handleFavoriteClick = async (e, appId) => {
    e.stopPropagation();

    setFavoriteLoading(prev => ({ ...prev, [appId]: true }));

    const newStatus = await toggleFavorite(appId);

    /* 在收藏列表中取消收藏时，需从当前列表移除该项 */
    if (selectedCategoryId === 'favorites' && !newStatus) {
      setFavoriteApps(prev => prev.filter(app => app.id !== appId));
    }

    setFavoriteLoading(prev => ({ ...prev, [appId]: false }));
  };

  /**
   * 过滤应用列表
   * 支持"我的收藏"独立数据源 + 分类过滤 + 关键词搜索
   */
  const filteredApps = useMemo(() => {
    /* 收藏视图使用独立的 favoriteApps 数据源 */
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

    /* 分类过滤：一个应用可属于多个分类，用 category_ids 数组判断 */
    if (selectedCategoryId && selectedCategoryId !== 'all') {
      const catId = parseInt(selectedCategoryId);
      result = result.filter(app =>
        app.category_ids && app.category_ids.includes(catId)
      );
    }

    /* 关键词搜索：匹配应用名与描述 */
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
   * 构建分类筛选选项（分类数据来自数据库）
   *
   * 【关键】依赖数组必须包含 t：
   * 本数组内含"全部""我的收藏"两处界面文案。
   * useMemo 会缓存结果，若依赖不含 t，语言切换后 t 变了但缓存不失效，
   * 筛选器会一直显示切换前的语言。
   * 这类问题在中文环境下完全无法察觉，必须靠依赖数组保证正确性。
   */
  const categoryOptions = useMemo(() => {
    const options = [
      { label: t('smartApps.filter.all'), value: 'all' },
      {
        label: (
          <Space size={4}>
            <HeartFilled style={{ color: '#ff4d4f' }} />
            <span>{t('smartApps.filter.favorites')}</span>
            {favoriteCount > 0 && (
              <Badge count={favoriteCount} style={{ backgroundColor: '#ff4d4f' }} />
            )}
          </Space>
        ),
        value: 'favorites'
      }
    ];

    /* 从 categoryStats 取每个分类下的应用数量 */
    const statsMap = new Map(categoryStats.map(s => [s.id, s.count]));

    /* 只展示有应用的分类，避免空分类占据横向空间 */
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
              {/* 分类名与配色均为后台录入的业务数据，不翻译 */}
              <span>{cat.name}</span>
              <Badge count={count} style={{ backgroundColor: cat.color }} />
            </Space>
          ),
          value: cat.id.toString()
        });
      }
    });

    return options;
  }, [categories, categoryStats, favoriteCount, t]);

  /* 点击应用卡片打开对话弹窗 */
  const handleAppClick = (app) => {
    setSelectedApp(app);
    setChatModalVisible(true);
  };

  /* 关闭对话弹窗，延迟清空数据等待动画播完 */
  const handleCloseChat = () => {
    setChatModalVisible(false);
    setTimeout(() => setSelectedApp(null), MODAL_CLEAR_DELAY_MS);
  };

  /**
   * 取应用主分类（第一个分类）的配色，用于卡片边框与背景
   * 颜色值来自后台配置，与语言无关
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
    return FALLBACK_CATEGORY_STYLE;
  };

  /**
   * 渲染应用卡片
   * 移动端简化显示：隐藏分类标签、描述改单行、"热门"与"积分"只留图标
   *
   * 本函数为普通函数（非 useMemo/useCallback），每次渲染都会重新执行，
   * 因此内部的 t() 调用天然跟随语言切换，无需处理缓存问题。
   */
  const renderAppCard = (app) => {
    const categoryStyle = getPrimaryCategoryStyle(app);
    const isFavorited = app.is_favorited;
    const isLoadingFavorite = favoriteLoading[app.id];

    /* 超出展示上限的分类，在 Tooltip 中用 i18n 分隔符连接 */
    const hiddenCategoryNames = (app.categories || [])
      .slice(MAX_VISIBLE_CATEGORIES)
      .map(c => c.name)
      .join(t('smartApps.card.categorySeparator'));

    return (
      /* 移动端 2 列实现六宫格布局 */
      <Col xs={12} sm={12} md={8} lg={6} key={app.id}>
        <Card
          className={`smart-app-card ${isMobile ? 'mobile-card' : ''}`}
          hoverable
          onClick={() => handleAppClick(app)}
          style={{
            borderColor: categoryStyle.border,
            backgroundColor: categoryStyle.bg
          }}
        >
          {/* 热门标识：移动端只留火焰图标不显示文字 */}
          {app.use_count > HOT_THRESHOLD && (
            <div className="hot-badge">
              <FireOutlined /> {!isMobile && t('smartApps.card.hot')}
            </div>
          )}

          {/* 应用图标与名称 */}
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
              {/* 应用名为后台录入的业务数据，不翻译 */}
              <Text strong className="app-name" ellipsis={{ tooltip: app.name }}>
                {app.name}
              </Text>
              {/* 移动端隐藏分类标签以节省空间 */}
              {!isMobile && (
                <div style={{ marginTop: 4 }}>
                  {app.categories && app.categories.length > 0 ? (
                    app.categories.slice(0, MAX_VISIBLE_CATEGORIES).map(cat => (
                      <Tag
                        key={cat.id}
                        color={cat.color}
                        style={{ marginRight: 4, marginBottom: 2 }}
                      >
                        {cat.name}
                      </Tag>
                    ))
                  ) : (
                    <Tag color="default">{t('smartApps.card.uncategorized')}</Tag>
                  )}
                  {app.categories && app.categories.length > MAX_VISIBLE_CATEGORIES && (
                    <Tooltip title={hiddenCategoryNames}>
                      <Tag>+{app.categories.length - MAX_VISIBLE_CATEGORIES}</Tag>
                    </Tooltip>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 应用描述：为空时显示占位文案 */}
          <Paragraph
            className="app-description"
            ellipsis={{ rows: isMobile ? 1 : 2 }}
            style={{ color: categoryStyle.color }}
          >
            {app.description || t('smartApps.card.noDescription')}
          </Paragraph>

          {/* 卡片底部：积分消耗 + 使用次数 + 收藏按钮 */}
          <div className="app-footer">
            <Space size="small">
              {app.credits_per_use > 0 && (
                <Tooltip title={t('smartApps.card.creditsTooltip')}>
                  <Tag icon={<DollarOutlined />} color="gold" className="credits-tag">
                    {/* 移动端只显示数字，省略"积分"单位 */}
                    {app.credits_per_use}{!isMobile && t('smartApps.card.creditsUnit')}
                  </Tag>
                </Tooltip>
              )}
            </Space>

            <Space size="small">
              {/* 使用次数为纯数值，无需 i18n */}
              <Text type="secondary" className="use-count">
                <StarFilled style={{ color: '#faad14', marginRight: 2 }} />
                {app.use_count || 0}
              </Text>

              <Tooltip
                title={isFavorited
                  ? t('smartApps.favorite.remove')
                  : t('smartApps.favorite.add')}
              >
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

  /**
   * 空状态文案：按当前上下文区分三种场景
   * 提取为函数便于阅读，且每次渲染重新求值故能跟随语言切换
   */
  const renderEmptyDescription = () => {
    if (selectedCategoryId === 'favorites') {
      return t('smartApps.empty.favorites');
    }
    if (searchKeyword || selectedCategoryId !== 'all') {
      return t('smartApps.empty.search');
    }
    return t('smartApps.empty.default');
  };

  return (
    <div className="smart-apps-container">
      {/* 搜索与筛选区 */}
      <div className="filter-section">
        <Input
          placeholder={t('smartApps.searchPlaceholder')}
          prefix={<SearchOutlined />}
          value={searchKeyword}
          onChange={(e) => setSearchKeyword(e.target.value)}
          allowClear
          className="search-input"
        />

        {/* 分类筛选器：外层容器提供横向滚动能力 */}
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
            <Spin size="large" tip={t('smartApps.loading')} />
          </div>
        ) : filteredApps.length > 0 ? (
          <Row gutter={isMobile ? [8, 8] : [12, 12]}>
            {filteredApps.map(renderAppCard)}
          </Row>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={renderEmptyDescription()}
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
