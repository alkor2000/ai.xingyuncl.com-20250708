/**
 * 智能日历 - 最终优化版
 * 
 * 最新优化：
 * 1. 设置按钮改为中等大小（无文字）
 * 2. 今日高优先级事项（>=7）前添加小红色竖条标识
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Button, 
  Modal, 
  Form, 
  Input, 
  InputNumber, 
  Select, 
  DatePicker, 
  Slider, 
  message,
  Spin,
  Tag,
  Popconfirm,
  Row,
  Col,
  Empty,
  Divider,
  Badge
} from 'antd';
import {
  PlusOutlined,
  SettingOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  EditOutlined,
  DeleteOutlined,
  ThunderboltOutlined,
  FileTextOutlined,
  LeftOutlined,
  RightOutlined,
  RobotOutlined,
  HistoryOutlined,
  ReloadOutlined,
  DownOutlined,
  RightOutlined as RightExpandOutlined,
  UnorderedListOutlined,
  BookOutlined,
  ToolOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
import ReactMarkdown from 'react-markdown';
import useCalendarStore from '../../stores/calendarStore';
import useAuthStore from '../../stores/authStore';
import BackgroundKnowledgeManager from '../../components/calendar/BackgroundKnowledgeManager';
import './Calendar.less';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const { TextArea } = Input;
const { Option } = Select;

// 重要度颜色映射
const IMPORTANCE_COLORS = {
  1: '#C7C7CC', 2: '#C7C7CC', 3: '#8E8E93', 4: '#8E8E93',
  5: '#007AFF', 6: '#007AFF', 7: '#FF9500', 8: '#FF9500',
  9: '#FF3B30', 10: '#FF3B30'
};

const CalendarPage = () => {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  
  const {
    events,
    categories,
    latestAnalysis,
    eventsLoading,
    analysisLoading,
    aiModels,
    aiModelsLoading,
    promptTemplates,
    configLoading,
    fetchEvents,
    fetchCategories,
    fetchAvailableModels,
    fetchCalendarConfig,
    fetchLatestAnalysis,
    autoPerformAnalysis,
    createEvent,
    updateEvent,
    deleteEvent,
    markEventComplete,
    performAnalysis,
    fetchAnalysisHistory
  } = useCalendarStore();
  
  const [form] = Form.useForm();
  const [settingsForm] = Form.useForm();
  
  // 日历状态
  const [baseDate, setBaseDate] = useState(dayjs());
  const [selectedDate, setSelectedDate] = useState(dayjs());
  
  // 模态框状态
  const [eventModalVisible, setEventModalVisible] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [settingsModalVisible, setSettingsModalVisible] = useState(false);
  const [knowledgeModalVisible, setKnowledgeModalVisible] = useState(false);
  const [historyModalVisible, setHistoryModalVisible] = useState(false);
  const [analysisHistory, setAnalysisHistory] = useState([]);
  const [expandedHistoryId, setExpandedHistoryId] = useState(null);
  
  // 移动端Tab状态
  const [mobileTab, setMobileTab] = useState('calendar');
  
  // 检测是否为移动端
  const [isMobile, setIsMobile] = useState(false);
  
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  
  // 计算日期范围
  const dateRange = useMemo(() => {
    const dates = [];
    
    if (isMobile) {
      for (let i = -1; i <= 7; i++) {
        dates.push(baseDate.add(i, 'day'));
      }
    } else {
      for (let i = -2; i <= 13; i++) {
        dates.push(baseDate.add(i, 'day'));
      }
    }
    
    return dates;
  }, [baseDate, isMobile]);
  
  // 转换为网格
  const gridDates = useMemo(() => {
    const grid = [];
    const cols = isMobile ? 3 : 4;
    const rows = Math.ceil(dateRange.length / cols);
    
    for (let i = 0; i < rows; i++) {
      grid.push(dateRange.slice(i * cols, (i + 1) * cols));
    }
    
    return grid;
  }, [dateRange, isMobile]);
  
  // 获取日期范围的事项数据
  const dateEvents = useMemo(() => {
    const eventMap = {};
    events.forEach(event => {
      const dateKey = dayjs(event.event_date).format('YYYY-MM-DD');
      if (!eventMap[dateKey]) {
        eventMap[dateKey] = [];
      }
      eventMap[dateKey].push(event);
    });
    return eventMap;
  }, [events]);
  
  // 选中日期的事项
  const selectedDateEvents = useMemo(() => {
    const dateKey = selectedDate.format('YYYY-MM-DD');
    return dateEvents[dateKey] || [];
  }, [dateEvents, selectedDate]);
  
  // 初始化数据
  useEffect(() => {
    loadInitialData();
  }, []);
  
  useEffect(() => {
    loadDateRangeEvents();
  }, [baseDate, isMobile]);
  
  const loadInitialData = async () => {
    try {
      await Promise.all([
        fetchCategories(),
        fetchAvailableModels(),
        fetchCalendarConfig(),
        loadDateRangeEvents()
      ]);
      
      const latest = await fetchLatestAnalysis();
      if (!latest) {
        setTimeout(() => {
          autoPerformAnalysis();
        }, 2000);
      }
    } catch (error) {
      console.error('加载数据失败:', error);
    }
  };
  
  const loadDateRangeEvents = async () => {
    const offset = isMobile ? 1 : 2;
    const endOffset = isMobile ? 7 : 13;
    const startDate = baseDate.add(-offset, 'day').format('YYYY-MM-DD');
    const endDate = baseDate.add(endOffset, 'day').format('YYYY-MM-DD');
    await fetchEvents(startDate, endDate);
  };
  
  // 配置持久化
  const getDefaultSettings = () => {
    const defaultModel = aiModels.find(m => m.is_active) || aiModels[0];
    return {
      model_id: defaultModel?.id || null,
      template_id: null,
      scan_days_before: 15,
      scan_days_after: 15
    };
  };
  
  const loadSettings = () => {
    const key = `calendar_ai_settings_${user?.id || 'default'}`;
    const saved = localStorage.getItem(key);
    
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('解析配置失败:', e);
      }
    }
    
    return getDefaultSettings();
  };
  
  const saveSettings = (settings) => {
    const key = `calendar_ai_settings_${user?.id || 'default'}`;
    localStorage.setItem(key, JSON.stringify(settings));
  };
  
  // 日历操作
  const handlePrevPeriod = () => {
    const days = isMobile ? 9 : 16;
    setBaseDate(prev => prev.add(-days, 'day'));
  };
  
  const handleNextPeriod = () => {
    const days = isMobile ? 9 : 16;
    setBaseDate(prev => prev.add(days, 'day'));
  };
  
  const handleToday = () => {
    setBaseDate(dayjs());
    setSelectedDate(dayjs());
  };
  
  const handleSelectDate = (date) => {
    setSelectedDate(date);
    if (isMobile) {
      setMobileTab('events');
    }
  };
  
  // 事项操作
  const handleCreateEvent = () => {
    setEditingEvent(null);
    form.resetFields();
    form.setFieldsValue({
      event_date: selectedDate,
      importance: 5,
      status: 'not_started',
      recurrence_type: 'none',
      category: categories.length > 0 ? categories[0].name : '其他'
    });
    setEventModalVisible(true);
  };
  
  const handleEditEvent = (event) => {
    setEditingEvent(event);
    form.setFieldsValue({
      ...event,
      event_date: dayjs(event.event_date)
    });
    setEventModalVisible(true);
  };
  
  const handleEventSubmit = async () => {
    try {
      const values = await form.validateFields();
      const eventData = {
        ...values,
        event_date: values.event_date.format('YYYY-MM-DD'),
        recurrence_end_date: values.recurrence_end_date ? 
          values.recurrence_end_date.format('YYYY-MM-DD') : null
      };
      
      if (editingEvent) {
        await updateEvent(editingEvent.id, eventData);
      } else {
        await createEvent(eventData);
      }
      
      setEventModalVisible(false);
      await loadDateRangeEvents();
    } catch (error) {
      console.error('提交失败:', error);
    }
  };
  
  const handleDeleteEvent = async (eventId) => {
    try {
      await deleteEvent(eventId);
      await loadDateRangeEvents();
    } catch (error) {
      console.error('删除失败:', error);
    }
  };
  
  const handleMarkComplete = async (eventId) => {
    try {
      await markEventComplete(eventId);
      await loadDateRangeEvents();
    } catch (error) {
      console.error('标记失败:', error);
    }
  };
  
  // AI分析操作
  const handleOpenSettings = () => {
    const settings = loadSettings();
    settingsForm.setFieldsValue(settings);
    setSettingsModalVisible(true);
  };
  
  const handleSaveSettings = async () => {
    try {
      const values = await settingsForm.validateFields();
      saveSettings(values);
      message.success('设置已保存');
      setSettingsModalVisible(false);
    } catch (error) {
      console.error('保存设置失败:', error);
    }
  };
  
  const handleNewAnalysis = async () => {
    const settings = loadSettings();
    
    if (!settings.model_id) {
      message.warning('请先设置AI模型');
      handleOpenSettings();
      return;
    }
    
    try {
      const totalDays = settings.scan_days_before + settings.scan_days_after;
      
      await performAnalysis({
        model_id: settings.model_id,
        template_id: settings.template_id,
        scan_days: totalDays
      });
      
      if (isMobile) {
        setTimeout(() => {
          setMobileTab('ai');
        }, 500);
      }
      
      message.success('分析完成！');
    } catch (error) {
      console.error('分析失败:', error);
    }
  };
  
  const handleViewHistory = async () => {
    try {
      const history = await fetchAnalysisHistory();
      setAnalysisHistory(history);
      setExpandedHistoryId(null);
      setHistoryModalVisible(true);
    } catch (error) {
      console.error('获取历史失败:', error);
    }
  };
  
  const handleToggleHistory = (itemId) => {
    setExpandedHistoryId(expandedHistoryId === itemId ? null : itemId);
  };
  
  const handleOpenKnowledge = () => {
    setKnowledgeModalVisible(true);
  };
  
  // 获取日期的前3个事项（按重要度排序）
  const getTopEvents = (date) => {
    const dateKey = date.format('YYYY-MM-DD');
    const dayEvents = dateEvents[dateKey] || [];
    
    return dayEvents
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 3);
  };
  
  // 工具方法
  const getDateStats = (date) => {
    const dateKey = date.format('YYYY-MM-DD');
    const dayEvents = dateEvents[dateKey] || [];
    return {
      count: dayEvents.length,
      highPriority: dayEvents.filter(e => e.importance >= 8).length
    };
  };
  
  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed':
        return <CheckCircleOutlined style={{ color: '#34C759' }} />;
      case 'in_progress':
        return <ClockCircleOutlined style={{ color: '#FF9500' }} />;
      default:
        return <ExclamationCircleOutlined style={{ color: '#8E8E93' }} />;
    }
  };
  
  const getImportanceBadge = (importance) => {
    if (importance >= 8) return { text: t('calendar.importance.high'), class: 'high' };
    if (importance >= 5) return { text: t('calendar.importance.medium'), class: 'medium' };
    return { text: t('calendar.importance.low'), class: 'low' };
  };

  return (
    <div className="calendar-page calendar-grid-view">
      {/* 移动端底部Tab导航 */}
      <div className="mobile-bottom-tabs">
        <div 
          className={`tab-item ${mobileTab === 'calendar' ? 'active' : ''}`}
          onClick={() => setMobileTab('calendar')}
        >
          <CalendarOutlined />
          <span>日历</span>
        </div>
        <div 
          className={`tab-item ${mobileTab === 'ai' ? 'active' : ''}`}
          onClick={() => setMobileTab('ai')}
        >
          <RobotOutlined />
          <span>AI分析</span>
        </div>
        <div 
          className={`tab-item ${mobileTab === 'events' ? 'active' : ''}`}
          onClick={() => setMobileTab('events')}
        >
          <UnorderedListOutlined />
          <span>事项</span>
        </div>
        <div 
          className={`tab-item ${mobileTab === 'settings' ? 'active' : ''}`}
          onClick={() => setMobileTab('settings')}
        >
          <SettingOutlined />
          <span>设置</span>
        </div>
      </div>

      {/* 主内容区域 */}
      <div className="calendar-content">
        {/* 左侧AI分析面板 */}
        <div className={`calendar-left-panel ai-analysis-panel ${mobileTab === 'ai' ? 'mobile-active' : ''}`}>
          <div className="panel-header">
            <div className="header-title">
              <RobotOutlined /> AI分析
            </div>
            {isMobile && (
              <Button 
                size="small"
                icon={<HistoryOutlined />}
                onClick={handleViewHistory}
              >
                历史
              </Button>
            )}
          </div>
          
          <Spin spinning={analysisLoading}>
            {latestAnalysis ? (
              <div className="analysis-content">
                <div className="analysis-result-scroll">
                  <div className="analysis-result">
                    <ReactMarkdown>
                      {latestAnalysis.analysis_result?.raw_text || '暂无分析内容'}
                    </ReactMarkdown>
                  </div>
                </div>
                
                <div className="analysis-meta-card">
                  <div className="meta-row">
                    <span className="meta-label">🤖 模型</span>
                    <span className="meta-value">{latestAnalysis.model_name}</span>
                  </div>
                  <div className="meta-row">
                    <span className="meta-label">⏱️ 时间</span>
                    <span className="meta-value">{dayjs(latestAnalysis.created_at).fromNow()}</span>
                  </div>
                  <div className="meta-row">
                    <span className="meta-label">📋 事项</span>
                    <span className="meta-value">{latestAnalysis.events_count}个</span>
                  </div>
                </div>
                
                <div className="analysis-actions">
                  <Button 
                    type="primary"
                    icon={<ThunderboltOutlined />}
                    onClick={handleNewAnalysis}
                    loading={analysisLoading}
                    block
                  >
                    一键分析
                  </Button>
                </div>
              </div>
            ) : (
              <div className="analysis-empty">
                <Empty
                  image={<RobotOutlined style={{ fontSize: 64, color: '#d9d9d9' }} />}
                  description="暂无分析记录"
                >
                  <p className="empty-tip">让AI帮你分析时间管理，发现优化空间！</p>
                  <Button 
                    type="primary" 
                    icon={<ThunderboltOutlined />}
                    onClick={handleNewAnalysis}
                    loading={analysisLoading}
                  >
                    一键分析
                  </Button>
                </Empty>
              </div>
            )}
          </Spin>
        </div>
        
        {/* 中间日历面板 */}
        <div className={`calendar-main-panel calendar-grid-panel ${mobileTab === 'calendar' ? 'mobile-active' : ''}`}>
          <div className="calendar-controls">
            {/* 🔥 优化1：设置按钮改为中等大小（无文字）*/}
            {!isMobile && (
              <Button 
                icon={<SettingOutlined style={{ fontSize: 16 }} />} 
                onClick={handleOpenSettings}
                size="middle"
                className="settings-btn"
                title="AI分析设置"
              />
            )}
            
            <Button 
              icon={<LeftOutlined />} 
              onClick={handlePrevPeriod}
              size={isMobile ? 'middle' : 'small'}
              className="nav-btn"
            />
            <span className="month-display">
              {baseDate.format(isMobile ? 'M月' : 'YYYY年M月')}
            </span>
            <Button 
              icon={<RightOutlined />} 
              onClick={handleNextPeriod}
              size={isMobile ? 'middle' : 'small'}
              className="nav-btn"
            />
            <Button 
              onClick={handleToday}
              size={isMobile ? 'middle' : 'small'}
              className="today-btn"
            >
              {isMobile ? '今天' : '返回今天'}
            </Button>
          </div>
          
          <Spin spinning={eventsLoading}>
            <div className="calendar-grid">
              {gridDates.map((row, rowIndex) => (
                <div key={rowIndex} className="calendar-grid-row">
                  {row.map((date, colIndex) => {
                    const stats = getDateStats(date);
                    const topEvents = getTopEvents(date);
                    const isToday = date.isSame(dayjs(), 'day');
                    const isSelected = date.isSame(selectedDate, 'day');
                    
                    return (
                      <div
                        key={colIndex}
                        className={`calendar-grid-cell ${isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''}`}
                        onClick={() => handleSelectDate(date)}
                      >
                        <div className="cell-header">
                          <span className="cell-weekday">{date.format('ddd')}</span>
                          <span className="cell-date">{date.format('DD')}</span>
                          
                          {stats.highPriority > 0 && topEvents.length === 0 && (
                            <Badge 
                              count={stats.highPriority} 
                              className="high-priority-badge"
                              style={{ 
                                backgroundColor: '#FF3B30',
                                fontSize: '10px',
                                height: '18px',
                                lineHeight: '18px'
                              }}
                            />
                          )}
                        </div>
                        
                        {isToday && <div className="today-badge">今日</div>}
                        
                        {/* 🔥 优化2：今日高优先级事项（>=7）添加红色竖条 */}
                        {topEvents.length > 0 && (
                          <div className="cell-events-list">
                            {topEvents.map((event, idx) => (
                              <div 
                                key={idx}
                                className={`event-title-item ${isToday && event.importance >= 7 ? 'today-high-priority' : ''}`}
                                style={{ 
                                  borderLeftColor: IMPORTANCE_COLORS[event.importance],
                                  backgroundColor: `${IMPORTANCE_COLORS[event.importance]}15`
                                }}
                              >
                                {event.title.length > 7 
                                  ? `${event.title.substring(0, 7)}...` 
                                  : event.title
                                }
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </Spin>
          
          {isMobile && (
            <div className="mobile-quick-analysis">
              <Button 
                type="primary"
                icon={<ThunderboltOutlined />}
                onClick={handleNewAnalysis}
                loading={analysisLoading}
                block
                size="large"
              >
                一键分析
              </Button>
            </div>
          )}
        </div>
        
        {/* 右侧事项列表 */}
        <div className={`calendar-right-panel events-panel ${mobileTab === 'events' ? 'mobile-active' : ''}`}>
          <div className="events-header">
            <div className="date-info">
              <CalendarOutlined className="date-icon" />
              <div className="date-text">
                <div className="date-main">{selectedDate.format('M月D日')}</div>
                <div className="date-sub">{selectedDate.format('dddd')}</div>
              </div>
            </div>
            
            <Button 
              type="primary" 
              icon={<PlusOutlined />}
              onClick={handleCreateEvent}
              className="create-event-btn"
            >
              创建事项
            </Button>
          </div>
          
          <div className="events-list-container">
            {selectedDateEvents.length === 0 ? (
              <div className="events-empty-state">
                <CalendarOutlined className="empty-icon" />
                <p className="empty-text">这一天还没有事项</p>
                <p className="empty-hint">点击上方按钮创建新事项</p>
              </div>
            ) : (
              <div className="events-list">
                {selectedDateEvents.map(event => {
                  const badge = getImportanceBadge(event.importance);
                  return (
                    <div 
                      key={event.id} 
                      className={`event-card status-${event.status}`}
                      style={{ borderLeftColor: IMPORTANCE_COLORS[event.importance] }}
                    >
                      <div className="event-header">
                        <div className="event-title">{event.title}</div>
                        <span className={`importance-badge ${badge.class}`}>
                          {badge.text}
                        </span>
                      </div>
                      
                      {event.content && (
                        <div className="event-content">
                          {event.content}
                        </div>
                      )}
                      
                      <div className="event-meta">
                        <div className="meta-item">
                          {getStatusIcon(event.status)}
                          <span>{t(`calendar.event.status.${event.status}`)}</span>
                        </div>
                        <div className="meta-item">
                          <Tag color={event.color || '#007AFF'}>{event.category}</Tag>
                        </div>
                      </div>
                      
                      <div className="event-actions">
                        <Button 
                          className="btn-edit"
                          size="small"
                          icon={<EditOutlined />}
                          onClick={() => handleEditEvent(event)}
                        >
                          编辑
                        </Button>
                        <Popconfirm
                          title="确认删除此事项？"
                          onConfirm={() => handleDeleteEvent(event.id)}
                          okText="确认"
                          cancelText="取消"
                        >
                          <Button 
                            className="btn-delete"
                            size="small"
                            icon={<DeleteOutlined />}
                          >
                            删除
                          </Button>
                        </Popconfirm>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* 移动端扁平化设置面板 */}
        <div className={`calendar-settings-panel ${mobileTab === 'settings' ? 'mobile-active' : ''}`}>
          <div className="panel-header">
            <h3>设置中心</h3>
          </div>
          
          <div className="settings-menu-grid">
            <div className="settings-menu-item" onClick={handleOpenSettings}>
              <div className="menu-icon">
                <RobotOutlined />
              </div>
              <div className="menu-text">
                <div className="menu-title">AI分析设置</div>
                <div className="menu-desc">模型、模板、扫描天数</div>
              </div>
              <RightOutlined className="menu-arrow" />
            </div>
            
            <div className="settings-menu-item" onClick={handleOpenKnowledge}>
              <div className="menu-icon">
                <BookOutlined />
              </div>
              <div className="menu-text">
                <div className="menu-title">背景知识管理</div>
                <div className="menu-desc">添加、编辑背景知识</div>
              </div>
              <RightOutlined className="menu-arrow" />
            </div>
            
            <div className="settings-menu-item" onClick={handleViewHistory}>
              <div className="menu-icon">
                <HistoryOutlined />
              </div>
              <div className="menu-text">
                <div className="menu-title">查看分析历史</div>
                <div className="menu-desc">浏览历史分析记录</div>
              </div>
              <RightOutlined className="menu-arrow" />
            </div>
            
            <div className="settings-menu-item" style={{ opacity: 0.5, cursor: 'not-allowed' }}>
              <div className="menu-icon">
                <ToolOutlined />
              </div>
              <div className="menu-text">
                <div className="menu-title">其他设置</div>
                <div className="menu-desc">敬请期待</div>
              </div>
              <RightOutlined className="menu-arrow" />
            </div>
          </div>
        </div>
      </div>
      
      {/* 事项表单Modal */}
      <Modal
        title={editingEvent ? '编辑事项' : '创建事项'}
        open={eventModalVisible}
        onOk={handleEventSubmit}
        onCancel={() => setEventModalVisible(false)}
        width={600}
        okText="确认"
        cancelText="取消"
        className="event-form-modal mobile-fullscreen-modal"
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="title"
            label="事项标题"
            rules={[
              { required: true, message: '请输入事项标题' },
              { max: 100, message: '标题不能超过100个字符' }
            ]}
          >
            <Input 
              placeholder="请输入事项标题（必填，最多100字）" 
              maxLength={100}
              showCount
            />
          </Form.Item>
          
          <Form.Item
            name="content"
            label="事项内容（可选）"
          >
            <TextArea 
              rows={isMobile ? 6 : 8}
              placeholder="可选：输入事项详细内容" 
            />
          </Form.Item>
          
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="event_date"
                label="日期"
                rules={[{ required: true, message: '请选择日期' }]}
              >
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="category"
                label="分类"
                rules={[{ required: true, message: '请选择分类' }]}
              >
                <Select placeholder="请选择分类">
                  {categories.map(cat => (
                    <Option key={cat.id} value={cat.name}>{cat.name}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          
          <Form.Item name="importance" label="重要度">
            <Slider 
              min={1} 
              max={10} 
              marks={{ 1: '1', 5: '5', 10: '10' }}
              className="importance-slider"
            />
          </Form.Item>
          
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="status" label="状态">
                <Select>
                  <Option value="not_started">未开始</Option>
                  <Option value="in_progress">进行中</Option>
                  <Option value="completed">已完成</Option>
                  <Option value="daily">日常</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="recurrence_type" label="重复">
                <Select>
                  <Option value="none">不重复</Option>
                  <Option value="daily">每天</Option>
                  <Option value="weekly">每周</Option>
                  <Option value="monthly">每月</Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>
          
          <Form.Item name="file_link" label="文件链接">
            <Input placeholder="可选：相关文件链接" />
          </Form.Item>
        </Form>
      </Modal>
      
      {/* AI分析设置Modal */}
      <Modal
        title={<><SettingOutlined /> AI分析设置</>}
        open={settingsModalVisible}
        onOk={handleSaveSettings}
        onCancel={() => setSettingsModalVisible(false)}
        width={900}
        okText="保存设置"
        cancelText="取消"
        className="ai-analysis-modal mobile-fullscreen-modal"
        style={{ top: 20 }}
      >
        <Spin spinning={aiModelsLoading || configLoading}>
          <Form form={settingsForm} layout="vertical">
            <Form.Item
              name="model_id"
              label="选择AI模型"
              rules={[{ required: true, message: '请选择AI模型' }]}
            >
              <Select placeholder="请选择AI模型">
                {aiModels.filter(m => m.is_active).map(model => (
                  <Option key={model.id} value={model.id}>
                    {model.display_name} ({model.credits_per_chat} 积分/次)
                  </Option>
                ))}
              </Select>
            </Form.Item>
            
            <Form.Item
              name="template_id"
              label="分析模板"
              tooltip="选择分析模板，不选则使用默认模板"
            >
              <Select placeholder="请选择模板（可选）" allowClear>
                {promptTemplates.map(template => (
                  <Option key={template.id} value={template.id}>
                    {template.name}
                    {template.is_default && ' (默认)'}
                  </Option>
                ))}
              </Select>
            </Form.Item>
            
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="scan_days_before"
                  label="今日前"
                  rules={[
                    { required: true, message: '请输入天数' },
                    { type: 'number', min: 1, max: 365, message: '范围1-365天' }
                  ]}
                >
                  <InputNumber 
                    min={1} 
                    max={365} 
                    style={{ width: '100%' }}
                    addonAfter="天"
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="scan_days_after"
                  label="今日后"
                  rules={[
                    { required: true, message: '请输入天数' },
                    { type: 'number', min: 1, max: 365, message: '范围1-365天' }
                  ]}
                >
                  <InputNumber 
                    min={1} 
                    max={365} 
                    style={{ width: '100%' }}
                    addonAfter="天"
                  />
                </Form.Item>
              </Col>
            </Row>
          </Form>
          
          {!isMobile && (
            <>
              <Divider />
              <BackgroundKnowledgeManager />
              <Divider />
              <Button 
                icon={<HistoryOutlined />}
                onClick={() => {
                  setSettingsModalVisible(false);
                  handleViewHistory();
                }}
                block
                size="large"
                style={{ 
                  marginTop: 16,
                  height: 48,
                  fontSize: 15,
                  fontWeight: 600
                }}
              >
                查看分析历史
              </Button>
            </>
          )}
        </Spin>
      </Modal>
      
      {/* 背景知识管理独立Modal */}
      <Modal
        title={<><BookOutlined /> 背景知识管理</>}
        open={knowledgeModalVisible}
        onCancel={() => setKnowledgeModalVisible(false)}
        footer={null}
        width={900}
        className="knowledge-modal mobile-fullscreen-modal"
      >
        <BackgroundKnowledgeManager />
      </Modal>
      
      {/* 历史记录Modal */}
      <Modal
        title={<><HistoryOutlined /> 分析历史</>}
        open={historyModalVisible}
        onCancel={() => {
          setHistoryModalVisible(false);
          setExpandedHistoryId(null);
        }}
        footer={null}
        width={900}
        className="history-modal mobile-fullscreen-modal"
      >
        <div className="history-list">
          {analysisHistory.length === 0 ? (
            <Empty description="暂无历史记录" />
          ) : (
            analysisHistory.map(item => (
              <div 
                key={item.id} 
                className={`history-item ${expandedHistoryId === item.id ? 'expanded' : ''}`}
              >
                <div 
                  className="item-header clickable"
                  onClick={() => handleToggleHistory(item.id)}
                >
                  <div className="header-left">
                    <span className="item-time">
                      {dayjs(item.created_at).format('YYYY-MM-DD HH:mm')}
                    </span>
                    <Tag color="blue">{item.model_name}</Tag>
                  </div>
                  <div className="header-right">
                    {expandedHistoryId === item.id ? 
                      <DownOutlined style={{ color: '#667eea' }} /> : 
                      <RightExpandOutlined style={{ color: '#8e8e93' }} />
                    }
                  </div>
                </div>
                
                <div className="item-info">
                  分析了 {item.events_count} 个事项 | 消耗 {item.credits_consumed} 积分
                </div>
                
                {expandedHistoryId === item.id && (
                  <div className="item-detail">
                    <ReactMarkdown>
                      {item.analysis_result?.raw_text || '暂无分析内容'}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </Modal>
    </div>
  );
};

export default CalendarPage;
