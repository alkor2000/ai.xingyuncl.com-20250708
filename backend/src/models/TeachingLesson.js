/**
 * 教学课程模型
 * 管理课程页面的创建、查询、更新和内容类型权限
 */

const dbConnection = require('../database/connection');
const { DatabaseError, ValidationError } = require('../utils/errors');
const logger = require('../utils/logger');

// 内容类型常量
const CONTENT_TYPES = {
  // 所有授权用户可见
  COURSE: 'course',           // 课程内容
  EXPERIMENT: 'experiment',   // 实验说明
  EXERCISE: 'exercise',       // 练习题目
  REFERENCE: 'reference',     // 参考资料
  
  // 仅教师及以上可见
  TEACHING_PLAN: 'teaching_plan', // 教案
  ANSWER: 'answer',               // 答案解析
  GUIDE: 'guide',                 // 教学指南
  ASSESSMENT: 'assessment'        // 评测标准
};

// 教师专属内容类型
const TEACHER_ONLY_TYPES = [
  CONTENT_TYPES.TEACHING_PLAN,
  CONTENT_TYPES.ANSWER,
  CONTENT_TYPES.GUIDE,
  CONTENT_TYPES.ASSESSMENT
];

class TeachingLesson {
  constructor(data = {}) {
    this.id = data.id || null;
    this.module_id = data.module_id || null;
    this.title = data.title || '';
    this.description = data.description || null;
    this.content_type = data.content_type || CONTENT_TYPES.COURSE;
    this.content = data.content || null;
    this.page_count = data.page_count || 1;
    this.creator_id = data.creator_id || null;
    this.status = data.status || 'draft';
    this.order_index = data.order_index || 0;
    this.view_count = data.view_count || 0;
    this.created_at = data.created_at || null;
    this.updated_at = data.updated_at || null;
    this.published_at = data.published_at || null;
    this.is_deleted = data.is_deleted || false;
    this.deleted_at = data.deleted_at || null;
    this.deleted_by = data.deleted_by || null;
  }

  /**
   * 创建课程
   */
  static async create(lessonData) {
    try {
      const {
        module_id,
        title,
        description = null,
        content_type = CONTENT_TYPES.COURSE,
        content,
        creator_id,
        status = 'draft',
        order_index = 0
      } = lessonData;

      if (!module_id || !title || !content || !creator_id) {
        throw new ValidationError('模块ID、标题、内容和创建者为必填项');
      }

      // 解析页面数量
      let pageCount = 1;
      try {
        const contentObj = typeof content === 'string' ? JSON.parse(content) : content;
        pageCount = contentObj.pages ? contentObj.pages.length : 1;
      } catch (e) {
        logger.warn('解析课程内容页数失败', { error: e.message });
      }

      const sql = `
        INSERT INTO teaching_lessons (
          module_id, title, description, content_type, content,
          page_count, creator_id, status, order_index, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
      `;

      const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
      const params = [
        module_id, title, description, content_type, contentStr,
        pageCount, creator_id, status, order_index
      ];

      const { rows } = await dbConnection.query(sql, params);
      const lessonId = rows.insertId;

      logger.info('教学课程创建成功', {
        lessonId,
        module_id,
        title,
        content_type,
        pageCount
      });

      return await TeachingLesson.findById(lessonId);
    } catch (error) {
      logger.error('创建教学课程失败:', error);
      throw new DatabaseError('创建教学课程失败', error);
    }
  }

  /**
   * 根据ID查找课程
   */
  static async findById(id) {
    try {
      const sql = `
        SELECT tl.*,
               u.username as creator_name,
               tm.name as module_name
        FROM teaching_lessons tl
        LEFT JOIN users u ON tl.creator_id = u.id
        LEFT JOIN teaching_modules tm ON tl.module_id = tm.id
        WHERE tl.id = ? AND tl.is_deleted = 0
      `;

      const { rows } = await dbConnection.query(sql, [id]);

      if (rows.length === 0) {
        return null;
      }

      const lesson = new TeachingLesson(rows[0]);
      
      // 解析JSON内容
      if (typeof lesson.content === 'string') {
        try {
          lesson.content = JSON.parse(lesson.content);
        } catch (e) {
          logger.warn('解析课程内容JSON失败', { lessonId: id });
        }
      }

      return lesson;
    } catch (error) {
      logger.error('查找教学课程失败:', error);
      throw new DatabaseError('查找教学课程失败', error);
    }
  }

  /**
   * 获取模块的课程列表（根据用户标签过滤内容类型）
   */
  static async getModuleLessons(moduleId, userId, userRole, userTags = [], options = {}) {
    try {
      const {
        status = null,
        include_teacher_content = false // 是否包含教师专属内容
      } = options;

      let whereConditions = ['tl.module_id = ?', 'tl.is_deleted = 0'];
      let params = [moduleId];

      // 状态过滤
      if (status) {
        whereConditions.push('tl.status = ?');
        params.push(status);
      }

      // 内容类型过滤（核心权限逻辑）
      const hasTeacherTag = userTags.some(t => t.name === 'teacher');
      const isAdmin = userRole === 'super_admin' || userRole === 'admin';
      
      if (!include_teacher_content && !hasTeacherTag && !isAdmin) {
        // 普通用户只能看到非教师专属内容
        whereConditions.push('tl.content_type NOT IN (?, ?, ?, ?)');
        params.push(...TEACHER_ONLY_TYPES);
      }

      const whereClause = whereConditions.join(' AND ');

      const sql = `
        SELECT tl.*,
               u.username as creator_name
        FROM teaching_lessons tl
        LEFT JOIN users u ON tl.creator_id = u.id
        WHERE ${whereClause}
        ORDER BY tl.order_index ASC, tl.created_at ASC
      `;

      const { rows: lessons } = await dbConnection.query(sql, params);

      return lessons.map(l => {
        const lesson = new TeachingLesson(l);
        // 解析JSON内容
        if (typeof lesson.content === 'string') {
          try {
            lesson.content = JSON.parse(lesson.content);
          } catch (e) {
            logger.warn('解析课程内容JSON失败', { lessonId: lesson.id });
          }
        }
        return lesson;
      });
    } catch (error) {
      logger.error('获取模块课程列表失败:', error);
      throw new DatabaseError('获取课程列表失败', error);
    }
  }

  /**
   * 更新课程信息
   */
  async update(updateData) {
    try {
      const allowedFields = [
        'title', 'description', 'content_type', 'content',
        'status', 'order_index'
      ];

      const updateFields = Object.keys(updateData).filter(field =>
        allowedFields.includes(field)
      );

      if (updateFields.length === 0) {
        return this;
      }

      // 如果更新了content，重新计算页数
      if (updateData.content) {
        try {
          const contentObj = typeof updateData.content === 'string' 
            ? JSON.parse(updateData.content) 
            : updateData.content;
          updateData.page_count = contentObj.pages ? contentObj.pages.length : 1;
          updateFields.push('page_count');
        } catch (e) {
          logger.warn('解析课程内容页数失败', { error: e.message });
        }
      }

      // 如果状态变为published，设置发布时间
      if (updateData.status === 'published' && this.status !== 'published') {
        updateFields.push('published_at');
        updateData.published_at = new Date();
      }

      const setClause = updateFields.map(field => `${field} = ?`).join(', ');
      const values = updateFields.map(field => {
        if (field === 'content' && typeof updateData[field] !== 'string') {
          return JSON.stringify(updateData[field]);
        }
        return updateData[field];
      });
      values.push(this.id);

      const sql = `UPDATE teaching_lessons SET ${setClause}, updated_at = NOW() WHERE id = ? AND is_deleted = 0`;
      await dbConnection.query(sql, values);

      // 更新实例属性
      updateFields.forEach(field => {
        this[field] = updateData[field];
      });

      logger.info('教学课程更新成功', { lessonId: this.id, updatedFields: updateFields });

      return this;
    } catch (error) {
      logger.error('更新教学课程失败:', error);
      throw new DatabaseError('更新教学课程失败', error);
    }
  }

  /**
   * 软删除课程
   */
  async softDelete(deletedBy) {
    try {
      const sql = `
        UPDATE teaching_lessons 
        SET is_deleted = 1, deleted_at = NOW(), deleted_by = ?, status = 'archived'
        WHERE id = ? AND is_deleted = 0
      `;

      await dbConnection.query(sql, [deletedBy, this.id]);

      this.is_deleted = true;
      this.deleted_at = new Date();
      this.deleted_by = deletedBy;
      this.status = 'archived';

      logger.info('教学课程软删除成功', { lessonId: this.id, deletedBy });

      return true;
    } catch (error) {
      logger.error('软删除教学课程失败:', error);
      throw new DatabaseError('删除教学课程失败', error);
    }
  }

  /**
   * 增加查看次数
   */
  async incrementViewCount() {
    try {
      const sql = 'UPDATE teaching_lessons SET view_count = view_count + 1 WHERE id = ?';
      await dbConnection.query(sql, [this.id]);
      this.view_count += 1;
    } catch (error) {
      logger.error('增加查看次数失败:', error);
    }
  }

  /**
   * 检查用户是否可以查看该课程（基于content_type）
   */
  static canUserViewLesson(lesson, userRole, userTags = []) {
    // 管理员可以看所有内容
    if (userRole === 'super_admin' || userRole === 'admin') {
      return true;
    }

    // 检查是否是教师专属内容
    if (TEACHER_ONLY_TYPES.includes(lesson.content_type)) {
      // 需要有teacher标签
      return userTags.some(t => t.name === 'teacher');
    }

    // 普通课程内容所有人可见
    return true;
  }

  /**
   * 转换为JSON
   */
  toJSON() {
    return {
      id: this.id,
      module_id: this.module_id,
      module_name: this.module_name,
      title: this.title,
      description: this.description,
      content_type: this.content_type,
      content: this.content,
      page_count: this.page_count,
      creator_id: this.creator_id,
      creator_name: this.creator_name,
      status: this.status,
      order_index: this.order_index,
      view_count: this.view_count,
      created_at: this.created_at,
      updated_at: this.updated_at,
      published_at: this.published_at
    };
  }
}

// 导出内容类型常量供外部使用
TeachingLesson.CONTENT_TYPES = CONTENT_TYPES;
TeachingLesson.TEACHER_ONLY_TYPES = TEACHER_ONLY_TYPES;

module.exports = TeachingLesson;
