/**
 * 智能日历主页面 - 修复版
 * 修复：使用正确的用户可用AI模型接口
 */

import React, { useState, useEffect } from 'react';
import { 
  Calendar as AntCalendar, 
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
  Col
} from 'antd';
import {
  PlusOutlined,
  RobotOutlined,
  SettingOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  EditOutlined,
  DeleteOutlined,
  BarChartOutlined,
  ThunderboltOutlined,
  FileTextOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import ReactMarkdown from 'react-markdown';
import useCalendarStore from '../../stores/calendarStore';
import useAuthStore from '../../stores/authStore';
import './Calendar.less';

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
  
  // 修复：使用 calendarStore 获取 AI 模型
  const {
    events,
    categories,
    overview,
    currentMonthStats,
    eventsLoading,
    analysisLoading,
    overviewLoading,
    aiModels,
    aiModelsLoading,
    fetchEvents,
    fetchCategories,
    fetchOverview,
    fetchMonthStats,
    fetchAvailableModels,
    createEvent,
    updateEvent,
    deleteEvent,
    markEventComplete,
    performAnalysis
  } = useCalendarStore();
  
  const [form] = Form.useForm();
  const [aiForm] = Form.useForm();
  const [selectedValue, setSelectedValue] = useState(dayjs());
  const [eventModalVisible, setEventModalVisible] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [aiModalVisible, setAiModalVisible] = useState(false);
  const [aiAnalysisResult, setAiAnalysisResult] = useState(null);
  
  const selectedDateEvents = events.filter(event => 
    dayjs(event.event_date).isSame(selectedValue, 'day')
  );
  
  useEffect(() => {
    loadInitialData();
  }, []);
  
  const loadInitialData = async () => {
    try {
      await Promise.all([
        fetchCategories(),
        fetchOverview(),
        fetchAvailableModels(), // 修复：使用正确的方法
        loadCurrentMonthEvents()
      ]);
    } catch (error) {
      console.error('加载数据失败:', error);
    }
  };
  
  const loadCurrentMonthEvents = async () => {
    const startDate = selectedValue.startOf('month').format('YYYY-MM-DD');
    const endDate = selectedValue.endOf('month').format('YYYY-MM-DD');
    await Promise.all([
      fetchEvents(startDate, endDate),
      fetchMonthStats(selectedValue.year(), selectedValue.month() + 1)
    ]);
  };
  
  const onPanelChange = (value) => {
    setSelectedValue(value);
    const startDate = value.startOf('month').format('YYYY-MM-DD');
    const endDate = value.endOf('month').format('YYYY-MM-DD');
    fetchEvents(startDate, endDate);
    fetchMonthStats(value.year(), value.month() + 1);
  };
  
  const onSelect = (value) => {
    setSelectedValue(value);
  };
  
  const handleCreateEvent = () => {
    setEditingEvent(null);
    form.resetFields();
    form.setFieldsValue({
      event_date: selectedValue,
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
      await loadCurrentMonthEvents();
      await fetchOverview();
    } catch (error) {
      console.error('提交失败:', error);
    }
  };
  
  const handleDeleteEvent = async (eventId) => {
    try {
      await deleteEvent(eventId);
      await loadCurrentMonthEvents();
      await fetchOverview();
    } catch (error) {
      console.error('删除失败:', error);
    }
  };
  
  const handleMarkComplete = async (eventId) => {
    try {
      await markEventComplete(eventId);
      await loadCurrentMonthEvents();
      await fetchOverview();
    } catch (error) {
      console.error('标记失败:', error);
    }
  };
  
  const handleAIAnalysis = async () => {
    try {
      const values = await aiForm.validateFields();
      const result = await performAnalysis(values);
      
      // 修复：正确访问分析结果路径
      if (result && result.analysis && result.analysis.analysis_result) {
        setAiAnalysisResult(result.analysis.analysis_result.raw_text);
        message.success(t('calendar.message.analysisSuccess'));
      } else {
        throw new Error('分析结果格式错误');
      }
    } catch (error) {
      console.error('AI分析失败:', error);
      message.error(error.message || t('calendar.message.analysisFailed'));
    }
  };
  
  // 修复：使用新版Ant Design Calendar API
  const cellRender = (current, info) => {
    if (info.type !== 'date') return info.originNode;
    
    const dateStr = current.format('YYYY-MM-DD');
    const dayStats = currentMonthStats.find(stat => stat.date === dateStr);
    
    if (!dayStats || dayStats.count === 0) return null;
    
    return (
      <div className="event-dots">
        {dayStats.count > 3 ? (
          <div className="event-count">{dayStats.count}</div>
        ) : (
          Array.from({ length: Math.min(dayStats.count, 3) }).map((_, i) => (
            <div 
              key={i} 
              className={`event-dot ${dayStats.high_priority > 0 ? 'high-priority' : ''}`}
            />
          ))
        )}
      </div>
    );
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
    <div className="calendar-page">
      {/* 顶部工具栏 */}
      <div className="calendar-header">
        <div className="header-title">
          <h1><CalendarOutlined /> {t('calendar.title')}</h1>
          <p>{t('calendar.subtitle')}</p>
        </div>
        
        <div className="header-actions">
          <Button 
            type="primary" 
            icon={<PlusOutlined />}
            onClick={handleCreateEvent}
          >
            {t('calendar.event.create')}
          </Button>
          
          <Button 
            icon={<RobotOutlined />}
            onClick={() => {
              setAiModalVisible(true);
              setAiAnalysisResult(null);
              aiForm.setFieldsValue({ scan_days: 15 });
            }}
          >
            {t('calendar.ai.analysis')}
          </Button>
        </div>
      </div>
      
      {/* 主内容区域 */}
      <div className="calendar-content">
        {/* 左侧统计面板 */}
        <div className="calendar-left-panel">
          <Spin spinning={overviewLoading}>
            <div className="overview-section">
              <div className="section-title">
                <CalendarOutlined /> {t('calendar.overview.today')}
              </div>
              
              {overview && (
                <div className="stats-grid">
                  <div className="stat-card">
                    <div className="stat-value">{overview.today?.total || 0}</div>
                    <div className="stat-label">{t('calendar.overview.total')}</div>
                  </div>
                  <div className="stat-card completed">
                    <div className="stat-value">{overview.today?.completed || 0}</div>
                    <div className="stat-label">{t('calendar.overview.completed')}</div>
                  </div>
                  <div className="stat-card in-progress">
                    <div className="stat-value">{overview.today?.in_progress || 0}</div>
                    <div className="stat-label">{t('calendar.overview.inProgress')}</div>
                  </div>
                  <div className="stat-card high-priority">
                    <div className="stat-value">{overview.today?.high_priority || 0}</div>
                    <div className="stat-label">{t('calendar.overview.highPriority')}</div>
                  </div>
                </div>
              )}
            </div>
            
            <div className="overview-section">
              <div className="section-title">
                <BarChartOutlined /> {t('calendar.overview.byCategory')}
              </div>
              
              {overview?.upcoming?.by_category && (
                <div className="category-list">
                  {Object.entries(overview.upcoming.by_category).map(([category, count]) => {
                    const categoryObj = categories.find(c => c.name === category);
                    return (
                      <div key={category} className="category-item">
                        <div className="category-info">
                          <div 
                            className="category-color" 
                            style={{ backgroundColor: categoryObj?.color || '#007AFF' }}
                          />
                          <span className="category-name">{category}</span>
                        </div>
                        <span className="category-count">{count}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Spin>
        </div>
        
        {/* 中间日历面板 */}
        <div className="calendar-main-panel">
          <Spin spinning={eventsLoading}>
            <AntCalendar
              value={selectedValue}
              onPanelChange={onPanelChange}
              onSelect={onSelect}
              cellRender={cellRender}
            />
          </Spin>
        </div>
        
        {/* 右侧事项列表 */}
        <div className="calendar-right-panel">
          <div className="panel-header">
            <h3>{t('calendar.event.detail')}</h3>
            <span className="date-display">
              {selectedValue.format('YYYY年MM月DD日')}
            </span>
          </div>
          
          <div className="events-list">
            {selectedDateEvents.length === 0 ? (
              <div className="empty-events">
                <CalendarOutlined />
                <p>{t('calendar.event.noEvents')}</p>
              </div>
            ) : (
              selectedDateEvents.map(event => {
                const badge = getImportanceBadge(event.importance);
                return (
                  <div 
                    key={event.id} 
                    className={`event-card status-${event.status}`}
                    style={{ borderLeftColor: IMPORTANCE_COLORS[event.importance] }}
                  >
                    <div className="event-header">
                      <div className="event-title">{event.content}</div>
                      <span className={`importance-badge ${badge.class}`}>
                        {badge.text}
                      </span>
                    </div>
                    
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
                      {event.status !== 'completed' && (
                        <Button 
                          className="btn-complete"
                          size="small"
                          icon={<CheckCircleOutlined />}
                          onClick={() => handleMarkComplete(event.id)}
                        >
                          {t('calendar.action.markComplete')}
                        </Button>
                      )}
                      <Button 
                        className="btn-edit"
                        size="small"
                        icon={<EditOutlined />}
                        onClick={() => handleEditEvent(event)}
                      >
                        {t('calendar.event.edit')}
                      </Button>
                      <Popconfirm
                        title={t('calendar.message.confirmDelete')}
                        onConfirm={() => handleDeleteEvent(event.id)}
                        okText={t('common.confirm')}
                        cancelText={t('common.cancel')}
                      >
                        <Button 
                          className="btn-delete"
                          size="small"
                          icon={<DeleteOutlined />}
                        >
                          {t('calendar.event.delete')}
                        </Button>
                      </Popconfirm>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
      
      {/* 事项表单模态框 */}
      <Modal
        title={editingEvent ? t('calendar.event.edit') : t('calendar.event.create')}
        open={eventModalVisible}
        onOk={handleEventSubmit}
        onCancel={() => setEventModalVisible(false)}
        width={600}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
        className="event-form-modal"
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="content"
            label={t('calendar.event.content')}
            rules={[{ required: true, message: t('calendar.placeholder.eventContent') }]}
          >
            <TextArea 
              rows={4} 
              placeholder={t('calendar.placeholder.eventContent')}
            />
          </Form.Item>
          
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="event_date"
                label={t('calendar.event.date')}
                rules={[{ required: true, message: t('calendar.event.selectDate') }]}
              >
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="category"
                label={t('calendar.event.category')}
                rules={[{ required: true, message: t('calendar.placeholder.selectCategory') }]}
              >
                <Select placeholder={t('calendar.placeholder.selectCategory')}>
                  {categories.map(cat => (
                    <Option key={cat.id} value={cat.name}>{cat.name}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          
          <Form.Item
            name="importance"
            label={t('calendar.event.importance')}
          >
            <Slider 
              min={1} 
              max={10} 
              marks={{ 1: '1', 5: '5', 10: '10' }}
              className="importance-slider"
            />
          </Form.Item>
          
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="status" label={t('common.status')}>
                <Select>
                  <Option value="not_started">{t('calendar.event.status.not_started')}</Option>
                  <Option value="in_progress">{t('calendar.event.status.in_progress')}</Option>
                  <Option value="completed">{t('calendar.event.status.completed')}</Option>
                  <Option value="daily">{t('calendar.event.status.daily')}</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="recurrence_type" label={t('calendar.event.recurrence')}>
                <Select>
                  <Option value="none">{t('calendar.event.recurrence.none')}</Option>
                  <Option value="daily">{t('calendar.event.recurrence.daily')}</Option>
                  <Option value="weekly">{t('calendar.event.recurrence.weekly')}</Option>
                  <Option value="monthly">{t('calendar.event.recurrence.monthly')}</Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>
          
          <Form.Item name="file_link" label={t('calendar.event.fileLink')}>
            <Input placeholder={t('calendar.placeholder.fileLink')} />
          </Form.Item>
        </Form>
      </Modal>
      
      {/* AI分析模态框 */}
      <Modal
        title={<><RobotOutlined /> {t('calendar.ai.analysis')}</>}
        open={aiModalVisible}
        onCancel={() => {
          setAiModalVisible(false);
          setAiAnalysisResult(null);
        }}
        footer={null}
        width={800}
        className="ai-analysis-modal"
      >
        <div className="ai-analysis-panel">
          {!aiAnalysisResult ? (
            <div className="analysis-form">
              <Spin spinning={aiModelsLoading}>
                <Form form={aiForm} layout="vertical">
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Item
                        name="model_id"
                        label={t('calendar.ai.selectModel')}
                        rules={[{ required: true, message: t('calendar.placeholder.selectModel') }]}
                      >
                        <Select placeholder={t('calendar.placeholder.selectModel')}>
                          {aiModels.filter(m => m.is_active).map(model => (
                            <Option key={model.id} value={model.id}>
                              {model.display_name} ({model.credits_per_chat} {t('common.credits')})
                            </Option>
                          ))}
                        </Select>
                      </Form.Item>
                    </Col>
                    
                    <Col span={12}>
                      <Form.Item
                        name="scan_days"
                        label={t('calendar.ai.scanRange')}
                        rules={[{ required: true }]}
                      >
                        <InputNumber 
                          min={1} 
                          max={180} 
                          style={{ width: '100%' }}
                          addonAfter={t('common.day')}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                  
                  <div className="info-box">
                    <div className="info-item">
                      <span className="label">{t('calendar.ai.creditsBalance')}</span>
                      <span className="value credits">{user?.credits || 0}</span>
                    </div>
                  </div>
                  
                  <Button
                    type="primary"
                    block
                    size="large"
                    icon={<ThunderboltOutlined />}
                    onClick={handleAIAnalysis}
                    loading={analysisLoading}
                  >
                    {t('calendar.ai.startAnalysis')}
                  </Button>
                </Form>
              </Spin>
            </div>
          ) : (
            <div className="analysis-result">
              <div className="result-content">
                <ReactMarkdown>{aiAnalysisResult}</ReactMarkdown>
              </div>
              
              <div className="result-actions">
                <Button onClick={() => setAiAnalysisResult(null)}>
                  {t('common.back')}
                </Button>
                <Button 
                  type="primary" 
                  icon={<FileTextOutlined />}
                >
                  {t('calendar.ai.exportResult')}
                </Button>
              </div>
            </div>
          )}
          
          {analysisLoading && (
            <div className="analysis-loading">
              <Spin size="large" />
              <p>{t('calendar.ai.analyzing')}</p>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};

export default CalendarPage;
