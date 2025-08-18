/**
 * HTML编辑器控制器
 */

const HtmlProject = require('../models/HtmlProject');
const HtmlPage = require('../models/HtmlPage');
const User = require('../models/User');
const ResponseHelper = require('../utils/response');
const logger = require('../utils/logger');
const dbConnection = require('../database/connection');

class HtmlEditorController {
  /**
   * 获取用户的项目列表
   */
  static async getProjects(req, res) {
    try {
      const userId = req.user.id;
      const projects = await HtmlProject.getUserProjects(userId);
      
      return ResponseHelper.success(res, projects);
    } catch (error) {
      logger.error('获取项目列表失败:', error);
      return ResponseHelper.error(res, '获取项目列表失败');
    }
  }

  /**
   * 创建项目或文件夹
   */
  static async createProject(req, res) {
    try {
      const userId = req.user.id;
      const { name, parent_id, type, description, tags } = req.body;

      if (!name) {
        return ResponseHelper.validation(res, { name: '项目名称不能为空' });
      }

      // 生成路径
      let path = '/' + name;
      if (parent_id) {
        const parent = await HtmlProject.findById(parent_id);
        if (!parent) {
          return ResponseHelper.notFound(res, '父文件夹不存在');
        }
        
        // 检查权限
        if (parent.user_id !== userId) {
          return ResponseHelper.forbidden(res, '无权在此文件夹下创建项目');
        }
        
        path = parent.path + '/' + name;
      }

      const projectId = await HtmlProject.create({
        user_id: userId,
        parent_id,
        name,
        path,
        type: type || 'folder',
        description,
        tags
      });

      const project = await HtmlProject.findById(projectId);
      
      logger.info('创建HTML项目成功', { userId, projectId, name });
      
      return ResponseHelper.success(res, project, '项目创建成功');
    } catch (error) {
      logger.error('创建项目失败:', error);
      return ResponseHelper.error(res, '创建项目失败');
    }
  }

  /**
   * 更新项目
   */
  static async updateProject(req, res) {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      const updateData = req.body;

      // 检查权限
      const hasPermission = await HtmlProject.checkOwnership(id, userId);
      if (!hasPermission) {
        return ResponseHelper.forbidden(res, '无权修改此项目');
      }

      const success = await HtmlProject.update(id, updateData);
      
      if (!success) {
        return ResponseHelper.error(res, '更新失败');
      }

      const project = await HtmlProject.findById(id);
      
      return ResponseHelper.success(res, project, '项目更新成功');
    } catch (error) {
      logger.error('更新项目失败:', error);
      return ResponseHelper.error(res, '更新项目失败');
    }
  }

  /**
   * 删除项目
   */
  static async deleteProject(req, res) {
    try {
      const userId = req.user.id;
      const { id } = req.params;

      // 检查权限
      const hasPermission = await HtmlProject.checkOwnership(id, userId);
      if (!hasPermission) {
        return ResponseHelper.forbidden(res, '无权删除此项目');
      }

      const success = await HtmlProject.delete(id);
      
      if (!success) {
        return ResponseHelper.error(res, '删除失败');
      }

      return ResponseHelper.success(res, null, '项目删除成功');
    } catch (error) {
      logger.error('删除项目失败:', error);
      return ResponseHelper.error(res, '删除项目失败');
    }
  }

  /**
   * 获取页面列表
   */
  static async getPages(req, res) {
    try {
      const userId = req.user.id;
      const { project_id, page = 1, limit = 20, is_published } = req.query;

      const result = await HtmlPage.getUserPages(userId, project_id, {
        page: parseInt(page),
        limit: parseInt(limit),
        is_published: is_published !== undefined ? parseInt(is_published) : null
      });

      return ResponseHelper.paginated(res, result.data, result.pagination);
    } catch (error) {
      logger.error('获取页面列表失败:', error);
      return ResponseHelper.error(res, '获取页面列表失败');
    }
  }

  /**
   * 创建页面
   */
  static async createPage(req, res) {
    try {
      const userId = req.user.id;
      const { project_id, title, slug, html_content, css_content, js_content } = req.body;

      if (!project_id || !title) {
        return ResponseHelper.validation(res, {
          project_id: !project_id ? '请选择项目' : null,
          title: !title ? '页面标题不能为空' : null
        });
      }

      // 检查项目权限
      const hasPermission = await HtmlProject.checkOwnership(project_id, userId);
      if (!hasPermission) {
        return ResponseHelper.forbidden(res, '无权在此项目下创建页面');
      }

      // 获取积分配置
      const settingQuery = `
        SELECT setting_value FROM system_settings 
        WHERE setting_key = 'html_editor.credits_per_page'
      `;
      const settingResult = await dbConnection.query(settingQuery);
      const creditsRequired = parseInt(settingResult.rows[0]?.setting_value || 10);

      // 检查用户积分
      const user = await User.findById(userId);
      if (!user.hasCredits(creditsRequired)) {
        return ResponseHelper.forbidden(res, 
          `积分不足，需要 ${creditsRequired} 积分，当前余额 ${user.getCredits()} 积分`
        );
      }

      // 编译内容
      const compiledContent = HtmlPage.compileContent(html_content, css_content, js_content);

      // 创建页面
      const pageId = await HtmlPage.create({
        project_id,
        user_id: userId,
        title,
        slug,
        html_content,
        css_content,
        js_content,
        compiled_content: compiledContent,
        credits_consumed: creditsRequired
      });

      // 扣除积分
      await user.consumeCredits(creditsRequired, null, null, 'HTML页面创建');

      const newPage = await HtmlPage.findById(pageId);
      
      logger.info('创建HTML页面成功', { userId, pageId, title, creditsConsumed: creditsRequired });
      
      return ResponseHelper.success(res, newPage, '页面创建成功');
    } catch (error) {
      logger.error('创建页面失败:', error);
      
      if (error.message.includes('Duplicate entry')) {
        return ResponseHelper.validation(res, { slug: '该URL已被使用，请更换' });
      }
      
      return ResponseHelper.error(res, error.message || '创建页面失败');
    }
  }

  /**
   * 获取页面详情
   */
  static async getPage(req, res) {
    try {
      const userId = req.user.id;
      const { id } = req.params;

      const page = await HtmlPage.findById(id);
      
      if (!page) {
        return ResponseHelper.notFound(res, '页面不存在');
      }

      // 检查权限
      if (page.user_id !== userId) {
        return ResponseHelper.forbidden(res, '无权访问此页面');
      }

      return ResponseHelper.success(res, page);
    } catch (error) {
      logger.error('获取页面详情失败:', error);
      return ResponseHelper.error(res, '获取页面详情失败');
    }
  }

  /**
   * 更新页面
   */
  static async updatePage(req, res) {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      const { html_content, css_content, js_content, ...otherData } = req.body;

      // 检查权限
      const hasPermission = await HtmlPage.checkOwnership(id, userId);
      if (!hasPermission) {
        return ResponseHelper.forbidden(res, '无权修改此页面');
      }

      // 获取积分配置
      const settingQuery = `
        SELECT setting_value FROM system_settings 
        WHERE setting_key = 'html_editor.credits_per_update'
      `;
      const settingResult = await dbConnection.query(settingQuery);
      const creditsRequired = parseInt(settingResult.rows[0]?.setting_value || 2);

      // 检查用户积分
      const user = await User.findById(userId);
      if (!user.hasCredits(creditsRequired)) {
        return ResponseHelper.forbidden(res, 
          `积分不足，需要 ${creditsRequired} 积分，当前余额 ${user.getCredits()} 积分`
        );
      }

      // 编译内容
      const compiledContent = HtmlPage.compileContent(html_content, css_content, js_content);

      // 更新页面
      const success = await HtmlPage.update(id, {
        ...otherData,
        html_content,
        css_content,
        js_content,
        compiled_content: compiledContent
      });

      if (!success) {
        return ResponseHelper.error(res, '更新失败');
      }

      // 扣除积分
      await user.consumeCredits(creditsRequired, null, null, 'HTML页面更新');

      const updatedPage = await HtmlPage.findById(id);
      
      logger.info('更新HTML页面成功', { userId, pageId: id, creditsConsumed: creditsRequired });
      
      return ResponseHelper.success(res, updatedPage, '页面更新成功');
    } catch (error) {
      logger.error('更新页面失败:', error);
      return ResponseHelper.error(res, error.message || '更新页面失败');
    }
  }

  /**
   * 发布/取消发布页面
   */
  static async togglePublish(req, res) {
    try {
      const userId = req.user.id;
      const { id } = req.params;

      // 检查权限
      const page = await HtmlPage.findById(id);
      if (!page) {
        return ResponseHelper.notFound(res, '页面不存在');
      }
      
      if (page.user_id !== userId) {
        return ResponseHelper.forbidden(res, '无权操作此页面');
      }

      // 切换发布状态
      const newStatus = page.is_published ? 0 : 1;
      const publishUrl = newStatus ? `/pages/${userId}/${page.slug}` : null;

      const success = await HtmlPage.update(id, {
        is_published: newStatus,
        publish_url: publishUrl
      });

      if (!success) {
        return ResponseHelper.error(res, '操作失败');
      }

      const updatedPage = await HtmlPage.findById(id);
      
      const message = newStatus ? '页面已发布' : '页面已取消发布';
      
      return ResponseHelper.success(res, updatedPage, message);
    } catch (error) {
      logger.error('切换发布状态失败:', error);
      return ResponseHelper.error(res, '操作失败');
    }
  }

  /**
   * 删除页面
   */
  static async deletePage(req, res) {
    try {
      const userId = req.user.id;
      const { id } = req.params;

      // 检查权限
      const hasPermission = await HtmlPage.checkOwnership(id, userId);
      if (!hasPermission) {
        return ResponseHelper.forbidden(res, '无权删除此页面');
      }

      const query = 'DELETE FROM html_pages WHERE id = ?';
      const result = await dbConnection.query(query, [id]);
      
      if (result.rows.affectedRows === 0) {
        return ResponseHelper.error(res, '删除失败');
      }

      return ResponseHelper.success(res, null, '页面删除成功');
    } catch (error) {
      logger.error('删除页面失败:', error);
      return ResponseHelper.error(res, '删除页面失败');
    }
  }

  /**
   * 获取模板列表
   */
  static async getTemplates(req, res) {
    try {
      const { category } = req.query;
      
      let query = 'SELECT * FROM html_templates';
      const params = [];
      
      if (category) {
        query += ' WHERE category = ?';
        params.push(category);
      }
      
      query += ' ORDER BY usage_count DESC, created_at DESC';
      
      const result = await dbConnection.query(query, params);
      
      return ResponseHelper.success(res, result.rows);
    } catch (error) {
      logger.error('获取模板列表失败:', error);
      return ResponseHelper.error(res, '获取模板列表失败');
    }
  }

  /**
   * 预览页面（公开访问）
   */
  static async previewPage(req, res) {
    try {
      const { userId, slug } = req.params;
      
      const page = await HtmlPage.findBySlug(userId, slug);
      
      if (!page) {
        return res.status(404).send('页面不存在');
      }

      // 增加浏览量
      await HtmlPage.incrementViewCount(page.id);

      // 返回编译后的HTML
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(page.compiled_content);
    } catch (error) {
      logger.error('预览页面失败:', error);
      res.status(500).send('页面加载失败');
    }
  }
}

module.exports = HtmlEditorController;
