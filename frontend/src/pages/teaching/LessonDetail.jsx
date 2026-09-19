/**
 * 课程详情页面（简洁版 - 纵向列表布局）
 * 
 * 【设计目标】
 * 1. 显示课程基本信息（通过导航栏标题展示）
 * 2. 展示课程资料（MaterialsDisplay组件）
 * 3. 列出课程页面列表（纵向单列布局，便于教师上课使用）
 * 
 * 【布局说明】
 * - 删除了紫色渐变横幅：过于占用空间，信息重复，影响内容聚焦
 * - 采用纵向列表布局：每个页面占一行，左侧序号+中间标题+右侧进入按钮
 * - 删除了底部编辑按钮：减少干扰，编辑功能通过顶部按钮触发即可
 * 
 * 【页面结构】
 * ┌─────────────────────────────────┐
 * │ 导航栏（包含课程标题）           │
 * ├─────────────────────────────────┤
 * │ 面包屑导航                       │
 * ├─────────────────────────────────┤
 * │ 课程资料展示（如果有）           │
 * ├─────────────────────────────────┤
 * │ 课程页面列表（纵向单列）         │
 * │ ┌─────────────────────────────┐ │
 * │ │ 01  11111        进入页面 › │ │
 * │ └─────────────────────────────┘ │
 * │ ┌─────────────────────────────┐ │
 * │ │ 02   22          进入页面 › │ │
 * │ └─────────────────────────────┘ │
 * └─────────────────────────────────┘
 * 
 * 功能：支持教师上课展示、学生浏览学习
 * 优化：完整i18n支持、iOS风格、流畅动画
 */

import React, { useEffect, useState } from 'react';
import {
  Modal,
  Form,
  Input,
  Select,
  message,
  Divider
} from 'antd';
import {
  RightOutlined,
  FileTextOutlined,
  EditOutlined
} from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import useTeachingStore from '../../stores/teachingStore';
import useAuthStore from '../../stores/authStore';
import MaterialsDisplay from '../../components/teaching/MaterialsDisplay';
import MaterialsManager from '../../components/teaching/MaterialsManager';
import {
  IOSPageContainer,
  IOSNavBar,
  IOSBreadcrumb,
  IOSCard,
  IOSButton,
  IOSEmpty,
  IOSLoading
} from '../../components/teaching/IOSLayout';
import '../../styles/ios-unified-theme.css';

const { TextArea } = Input;

const LessonDetail = () => {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const {
    currentLesson,
    currentLessonLoading,
    currentModule,
    fetchLesson,
    fetchModule,
    updateLesson
  } = useTeachingStore();

  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editForm] = Form.useForm();

  // ==================== 生命周期 ====================
  
  useEffect(() => {
    if (id) {
      loadLesson();
    }
  }, [id]);

  // ==================== 数据加载 ====================
  
  /**
   * 加载课程和模块信息
   * 先加载课程详情，再根据module_id加载所属模块信息
   */
  const loadLesson = async () => {
    try {
      const lesson = await fetchLesson(id);
      if (lesson?.module_id) {
        await fetchModule(lesson.module_id);
      }
    } catch (error) {
      console.error('加载课程失败:', error);
      message.error(t('teaching.loadFailed'));
    }
  };

  // ==================== 权限控制 ====================
  
  /**
   * 检查当前用户是否有编辑权限
   * 权限规则：
   * 1. 超级管理员 - 全部权限
   * 2. 课程创建者 - 可编辑
   * 3. 模块创建者 - 可编辑
   * 4. 拥有模块编辑权限的用户 - 可编辑
   */
  const hasEditPermission = () => {
    if (!user) return false;
    if (user.role === 'super_admin') return true;
    if (currentLesson?.creator_id === user.id) return true;
    if (currentModule?.creator_id === user.id) return true;
    if (currentModule?.user_permission === 'edit') return true;
    return false;
  };

  // ==================== 导航操作 ====================
  
  /**
   * 返回上一级（模块详情页或教学首页）
   */
  const handleBack = () => {
    if (currentLesson?.module_id) {
      navigate(`/teaching/modules/${currentLesson.module_id}`);
    } else {
      navigate('/teaching');
    }
  };

  /**
   * 查看指定页面
   * @param {number} pageNumber - 页面序号（从1开始）
   */
  const handleViewPage = (pageNumber) => {
    navigate(`/teaching/lessons/${id}/pages/${pageNumber}`);
  };

  /**
   * 跳转到课程内容编辑页面（Monaco编辑器）
   */
  const handleEditContent = () => {
    if (!hasEditPermission()) {
      message.warning(t('teaching.noEditPermission'));
      return;
    }
    navigate(`/teaching/lessons/${id}/edit`);
  };

  // ==================== 课程信息编辑 ====================
  
  /**
   * 打开编辑课程信息模态框
   * 包含：标题、描述、封面、资料、内容类型、状态
   */
  const handleEditInfo = () => {
    if (!hasEditPermission()) {
      message.warning(t('teaching.noEditPermission'));
      return;
    }
    
    editForm.setFieldsValue({
      title: currentLesson.title,
      description: currentLesson.description,
      cover_image: currentLesson.cover_image,
      materials: currentLesson.materials || [],
      content_type: currentLesson.content_type,
      status: currentLesson.status
    });
    setEditModalVisible(true);
  };

  /**
   * 提交课程信息编辑
   * 特别处理：清理materials中的临时ID，只保留有效数据
   */
  const handleEditSubmit = async () => {
    try {
      const values = await editForm.validateFields();
      
      // 验证并过滤资料：只保留有标题和链接的有效资料
      const materials = values.materials || [];
      const validMaterials = materials.filter(m => m && m.title && m.url);
      
      // 移除临时ID（_tempId用于React key，不应保存到数据库）
      const cleanMaterials = validMaterials.map(m => ({
        title: m.title,
        url: m.url,
        description: m.description || ''
      }));
      
      await updateLesson(id, {
        ...values,
        materials: cleanMaterials
      });
      
      setEditModalVisible(false);
      editForm.resetFields();
      message.success(t('teaching.updateSuccess'));
      
      // 重新加载课程信息以显示最新数据
      await fetchLesson(id);
    } catch (error) {
      console.error('更新课程失败:', error);
      message.error(t('teaching.updateFailed'));
    }
  };

  // ==================== 辅助函数 ====================
  
  /**
   * 解析课程内容，提取页面列表
   * 课程内容是JSON格式：{ pages: [{ id, title, html }] }
   * @returns {Array} 页面数组
   */
  const getPages = () => {
    if (!currentLesson?.content) return [];
    
    try {
      const content = typeof currentLesson.content === 'string'
        ? JSON.parse(currentLesson.content)
        : currentLesson.content;
      
      return content.pages || [];
    } catch (error) {
      console.error('解析课程内容失败:', error);
      return [];
    }
  };

  // ==================== 渲染逻辑 ====================
  
  // 加载状态
  if (currentLessonLoading || !currentLesson) {
    return (
      <IOSPageContainer>
        <IOSLoading text={t('common.loading')} />
      </IOSPageContainer>
    );
  }

  const pages = getPages();
  const totalPages = pages.length;
  const canEdit = hasEditPermission();

  return (
    <IOSPageContainer>
      {/* 
        导航栏：显示课程标题，提供返回和编辑按钮
        注意：删除了下方的紫色横幅，标题只在导航栏显示
      */}
      <IOSNavBar
        title={currentLesson.title}
        onBack={handleBack}
        backText={t('common.back')}
        actions={
          canEdit && (
            <IOSButton variant="secondary" icon={<EditOutlined />} onClick={handleEditInfo}>
              {t('teaching.editLessonInfo')}
            </IOSButton>
          )
        }
      />

      <div style={{ padding: '0 24px 40px' }}>
        {/* 面包屑导航：智能教学 > 模块名 > 课程名 */}
        <IOSBreadcrumb
          items={[
            { label: t('teaching.teaching'), path: '/teaching' },
            { 
              label: currentModule?.name || t('teaching.module'), 
              path: currentLesson?.module_id ? `/teaching/modules/${currentLesson.module_id}` : null 
            },
            { label: currentLesson.title }
          ]}
        />

        {/* 
          课程资料展示区域
          只在有资料时显示，使用MaterialsDisplay组件
          显示格式：卡片网格，支持打开链接和复制链接
        */}
        {currentLesson.materials && currentLesson.materials.length > 0 && (
          <MaterialsDisplay materials={currentLesson.materials} />
        )}

        {/* 
          课程页面列表（纵向布局）
          设计说明：
          1. 采用单列纵向布局，每个页面占一行
          2. 卡片内部：左侧序号徽章 + 中间标题 + 右侧进入按钮
          3. 保留iOS风格的圆角和间距
          4. 悬停时有动画效果（上移+阴影）
          5. 删除了底部的"编辑页面内容"按钮，减少视觉干扰
        */}
        <IOSCard
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: 'var(--primary-color)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <FileTextOutlined style={{ fontSize: 18, color: 'var(--brand-on-primary)' }} />
              </div>
              <span style={{ fontSize: 20, fontWeight: 600 }}>
                {t('teaching.coursePageList')}
              </span>
              <span style={{
                marginLeft: 'auto',
                padding: '4px 12px',
                background: 'var(--primary-color)',
                borderRadius: 20,
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--brand-on-primary)'
              }}>
                {totalPages} {t('teaching.pages')}
              </span>
            </div>
          }
          style={{ 
            marginBottom: 24,
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.08)'
          }}
        >
          {totalPages === 0 ? (
            /* 空状态：无页面时的提示和操作入口 */
            <IOSEmpty 
              icon={<FileTextOutlined style={{ fontSize: 48, color: '#bbb' }} />}
              text={t('teaching.noPages')}
              action={
                canEdit && (
                  <IOSButton 
                    variant="primary"
                    icon={<EditOutlined />}
                    onClick={handleEditContent}
                    style={{ marginTop: 24 }}
                  >
                    {t('teaching.addPages')}
                  </IOSButton>
                )
              }
            />
          ) : (
            /* 
              页面列表：纵向单列布局
              每个卡片包含：
              - 左侧：渐变序号徽章（40x40）
              - 中间：页面标题（flex:1 自适应宽度）
              - 右侧：进入按钮（带箭头图标）
              
              交互效果：
              - 点击整个卡片可进入页面
              - 悬停时卡片上移4px并添加阴影
              - 悬停时进入按钮文字变色
            */
            <div style={{ 
              display: 'flex',
              flexDirection: 'column',
              gap: 12  // 卡片之间12px间距
            }}>
              {pages.map((page, index) => {
                const pageNumber = index + 1;
                
                return (
                  <div
                    key={pageNumber}
                    onClick={() => handleViewPage(pageNumber)}
                    style={{
                      padding: '16px 20px',
                      background: 'white',
                      border: '1px solid var(--border-color)',
                      borderRadius: 12,
                      cursor: 'pointer',
                      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 16
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateY(-4px)';
                      e.currentTarget.style.boxShadow = '0 4px 16px rgba(48, 37, 28, 0.08)';
                      e.currentTarget.style.borderColor = 'var(--primary-color)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = 'none';
                      e.currentTarget.style.borderColor = 'var(--border-color)';
                    }}
                  >
                    {/* 左侧：渐变序号徽章 */}
                    <div style={{
                      width: 40,
                      height: 40,
                      borderRadius: 10,
                      background: 'var(--primary-color)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 16,
                      fontWeight: 700,
                      color: 'var(--brand-on-primary)',
                      flexShrink: 0,  // 固定宽度，不缩小
                      boxShadow: 'none'
                    }}>
                      {pageNumber < 10 ? `0${pageNumber}` : pageNumber}
                    </div>
                    
                    {/* 中间：页面标题（自适应宽度） */}
                    <div style={{
                      flex: 1,  // 占据剩余空间
                      fontSize: 16,
                      color: '#262626',
                      fontWeight: 500,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'  // 标题过长时显示省略号
                    }}>
                      {page.title || `${t('teaching.page')} ${pageNumber}`}
                    </div>

                    {/* 右侧：进入按钮 */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      color: 'var(--primary-color)',
                      fontSize: 14,
                      fontWeight: 500,
                      flexShrink: 0  // 固定宽度，不缩小
                    }}>
                      {t('teaching.enterPage')}
                      <RightOutlined style={{ fontSize: 12 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 
            注意：已删除底部的"编辑页面内容"按钮
            理由：
            1. 顶部已有"编辑课程信息"按钮，可以触发编辑
            2. 底部按钮容易造成视觉干扰
            3. 教师上课时不需要频繁编辑，简化界面更好
          */}
        </IOSCard>

        {/* 
          编辑课程信息模态框
          包含字段：
          - 标题（必填）
          - 描述
          - 封面图片URL
          - 课程资料（使用MaterialsManager组件，最多5个）
          - 内容类型（课程/实验/练习等8种类型）
          - 状态（草稿/已发布/已归档）
        */}
        <Modal
          title={
            <div style={{
              fontSize: 20,
              fontWeight: 600,
              color: '#262626',
              display: 'flex',
              alignItems: 'center',
              gap: 12
            }}>
              <EditOutlined style={{ color: 'var(--primary-color)' }} />
              {t('teaching.editLessonInfo')}
            </div>
          }
          open={editModalVisible}
          onOk={handleEditSubmit}
          onCancel={() => {
            setEditModalVisible(false);
            editForm.resetFields();
          }}
          width={700}
          okText={t('common.save')}
          cancelText={t('common.cancel')}
          destroyOnClose
          className="ios-modal"
          bodyStyle={{ 
            maxHeight: '70vh', 
            overflowY: 'auto',
            padding: '24px'
          }}
          okButtonProps={{
            style: {
              background: 'var(--primary-color)',
              border: 'none',
              height: 40,
              borderRadius: 10,
              fontWeight: 600
            }
          }}
          cancelButtonProps={{
            style: {
              height: 40,
              borderRadius: 10
            }
          }}
        >
          <Form form={editForm} layout="vertical">
            <Form.Item
              name="title"
              label={<span style={{ fontWeight: 500 }}>{t('teaching.lessonTitle')}</span>}
              rules={[{ required: true, message: t('teaching.lessonTitleRequired') }]}
            >
              <Input style={{ height: 40, borderRadius: 8 }} />
            </Form.Item>
            
            <Form.Item 
              name="description" 
              label={<span style={{ fontWeight: 500 }}>{t('teaching.lessonDescription')}</span>}
            >
              <TextArea rows={3} style={{ borderRadius: 8 }} />
            </Form.Item>
            
            <Form.Item 
              name="cover_image" 
              label={<span style={{ fontWeight: 500 }}>{t('teaching.coverImage')}</span>}
            >
              <Input 
                placeholder={t('teaching.coverImagePlaceholder')} 
                style={{ height: 40, borderRadius: 8 }}
              />
            </Form.Item>
            
            <Divider style={{ margin: '24px 0' }} />
            
            {/* 课程资料管理组件：支持添加、编辑、删除、排序资料 */}
            <Form.Item 
              name="materials" 
              label={null}
            >
              <MaterialsManager />
            </Form.Item>
            
            <Divider style={{ margin: '24px 0' }} />
            
            <Form.Item 
              name="content_type" 
              label={<span style={{ fontWeight: 500 }}>{t('teaching.contentType')}</span>}
            >
              <Select style={{ borderRadius: 8 }}>
                <Select.Option value="course">{t('teaching.contentTypes.course')}</Select.Option>
                <Select.Option value="experiment">{t('teaching.contentTypes.experiment')}</Select.Option>
                <Select.Option value="exercise">{t('teaching.contentTypes.exercise')}</Select.Option>
                <Select.Option value="reference">{t('teaching.contentTypes.reference')}</Select.Option>
                <Select.Option value="teaching_plan">{t('teaching.contentTypes.teaching_plan')}</Select.Option>
                <Select.Option value="answer">{t('teaching.contentTypes.answer')}</Select.Option>
                <Select.Option value="guide">{t('teaching.contentTypes.guide')}</Select.Option>
                <Select.Option value="assessment">{t('teaching.contentTypes.assessment')}</Select.Option>
              </Select>
            </Form.Item>
            
            <Form.Item 
              name="status" 
              label={<span style={{ fontWeight: 500 }}>{t('teaching.status.label')}</span>}
            >
              <Select style={{ borderRadius: 8 }}>
                <Select.Option value="draft">{t('teaching.status.draft')}</Select.Option>
                <Select.Option value="published">{t('teaching.status.published')}</Select.Option>
                <Select.Option value="archived">{t('teaching.status.archived')}</Select.Option>
              </Select>
            </Form.Item>
          </Form>
        </Modal>
      </div>
    </IOSPageContainer>
  );
};

export default LessonDetail;
