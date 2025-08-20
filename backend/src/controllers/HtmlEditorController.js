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
   * 获取用户的项目列表（自动创建默认项目）
   */
  static async getProjects(req, res) {
    try {
      const userId = req.user.id;
      let projects = await HtmlProject.getUserProjects(userId);
      
      // 如果用户没有任何项目，自动创建一个默认项目
      if (!projects || projects.length === 0) {
        const defaultProjectId = await HtmlProject.create({
          user_id: userId,
          parent_id: null,
          name: '默认项目',
          path: '/默认项目',
          type: 'folder',
          description: '系统自动创建的默认项目',
          tags: ['默认'],
          is_default: 1 // 标记为默认项目
        });
        
        logger.info('为用户创建默认项目', { userId, projectId: defaultProjectId });
        
        // 重新获取项目列表
        projects = await HtmlProject.getUserProjects(userId);
      }
      
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
        tags,
        is_default: 0 // 用户创建的都不是默认项目
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
   * 删除项目（增强版：检查是否为默认项目和是否为空）
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

      // 获取项目详情
      const project = await HtmlProject.findById(id);
      if (!project) {
        return ResponseHelper.notFound(res, '项目不存在');
      }

      // 检查是否为默认项目
      if (project.is_default === 1) {
        return ResponseHelper.forbidden(res, '默认项目不能删除');
      }

      // 检查文件夹是否为空（只对文件夹类型进行检查）
      if (project.type === 'folder') {
        const checkEmptyQuery = `
          SELECT COUNT(*) as count 
          FROM html_pages 
          WHERE project_id = ?
        `;
        const result = await dbConnection.query(checkEmptyQuery, [id]);
        const pageCount = result.rows[0].count;
        
        if (pageCount > 0) {
          return ResponseHelper.forbidden(res, '文件夹不为空，请先删除文件夹内的所有页面');
        }

        // 检查是否有子文件夹
        const checkSubFoldersQuery = `
          SELECT COUNT(*) as count 
          FROM html_projects 
          WHERE parent_id = ?
        `;
        const subResult = await dbConnection.query(checkSubFoldersQuery, [id]);
        const subFolderCount = subResult.rows[0].count;
        
        if (subFolderCount > 0) {
          return ResponseHelper.forbidden(res, '文件夹包含子文件夹，请先删除所有子文件夹');
        }
      }

      // 执行删除
      const success = await HtmlProject.delete(id);
      
      if (!success) {
        return ResponseHelper.error(res, '删除失败');
      }

      logger.info('删除HTML项目成功', { userId, projectId: id, projectName: project.name });

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
      let { project_id, title, slug, html_content, css_content, js_content } = req.body;

      // 如果没有指定项目，自动使用或创建默认项目
      if (!project_id) {
        const projects = await HtmlProject.getUserProjects(userId);
        const defaultProject = projects.find(p => p.name === '默认项目' || p.is_default === 1);
        
        if (defaultProject) {
          project_id = defaultProject.id;
        } else {
          // 创建默认项目
          project_id = await HtmlProject.create({
            user_id: userId,
            parent_id: null,
            name: '默认项目',
            path: '/默认项目',
            type: 'folder',
            description: '系统自动创建的默认项目',
            tags: ['默认'],
            is_default: 1
          });
        }
      }

      if (!title) {
        return ResponseHelper.validation(res, {
          title: '页面标题不能为空'
        });
      }

      // 检查项目权限
      const hasPermission = await HtmlProject.checkOwnership(project_id, userId);
      if (!hasPermission) {
        return ResponseHelper.forbidden(res, '无权在此项目下创建页面');
      }

      // 获取积分配置
      const settingQuery = `
        SELECT setting_value, setting_type FROM system_settings 
        WHERE setting_key = 'html_editor.credits_per_page'
      `;
      const settingResult = await dbConnection.query(settingQuery);
      const creditsRequired = parseInt(settingResult.rows[0]?.setting_value || 10);

      // 只有当积分大于0时才检查和扣除积分
      if (creditsRequired > 0) {
        // 检查用户积分
        const user = await User.findById(userId);
        if (!user.hasCredits(creditsRequired)) {
          return ResponseHelper.forbidden(res, 
            `积分不足，需要 ${creditsRequired} 积分，当前余额 ${user.getCredits()} 积分`
          );
        }
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

      // 只有当积分大于0时才扣除积分
      if (creditsRequired > 0) {
        const user = await User.findById(userId);
        await user.consumeCredits(creditsRequired, null, null, 'HTML页面创建', 'html_create');
      }

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
      const { html_content, css_content, js_content, title, ...otherData } = req.body;

      // 检查权限
      const hasPermission = await HtmlPage.checkOwnership(id, userId);
      if (!hasPermission) {
        return ResponseHelper.forbidden(res, '无权修改此页面');
      }

      // 如果只是更新标题，不扣除积分
      const isOnlyUpdatingTitle = title && !html_content && !css_content && !js_content && Object.keys(otherData).length === 0;
      
      let creditsRequired = 0;
      if (!isOnlyUpdatingTitle) {
        // 获取积分配置
        const settingQuery = `
          SELECT setting_value, setting_type FROM system_settings 
          WHERE setting_key = 'html_editor.credits_per_update'
        `;
        const settingResult = await dbConnection.query(settingQuery);
        creditsRequired = parseInt(settingResult.rows[0]?.setting_value || 2);

        // 只有当积分大于0时才检查积分
        if (creditsRequired > 0) {
          const user = await User.findById(userId);
          if (!user.hasCredits(creditsRequired)) {
            return ResponseHelper.forbidden(res, 
              `积分不足，需要 ${creditsRequired} 积分，当前余额 ${user.getCredits()} 积分`
            );
          }
        }
      }

      // 准备更新数据
      const updateData = { ...otherData };
      if (title) updateData.title = title;
      
      // 如果有内容更新，编译内容
      if (html_content !== undefined || css_content !== undefined || js_content !== undefined) {
        const compiledContent = HtmlPage.compileContent(
          html_content || '', 
          css_content || '', 
          js_content || ''
        );
        updateData.html_content = html_content;
        updateData.css_content = css_content;
        updateData.js_content = js_content;
        updateData.compiled_content = compiledContent;
      }

      // 更新页面
      const success = await HtmlPage.update(id, updateData);

      if (!success) {
        return ResponseHelper.error(res, '更新失败');
      }

      // 只有当积分大于0时才扣除积分
      if (creditsRequired > 0) {
        const user = await User.findById(userId);
        await user.consumeCredits(creditsRequired, null, null, 'HTML页面更新', 'html_update');
      }

      const updatedPage = await HtmlPage.findById(id);
      
      logger.info('更新HTML页面成功', { 
        userId, 
        pageId: id, 
        creditsConsumed: creditsRequired,
        isOnlyUpdatingTitle 
      });
      
      return ResponseHelper.success(res, updatedPage, '页面更新成功');
    } catch (error) {
      logger.error('更新页面失败:', error);
      return ResponseHelper.error(res, error.message || '更新页面失败');
    }
  }

  /**
   * 发布/取消发布页面（生成永久链接）
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

      // 如果是要发布页面（生成永久链接）
      if (!page.is_published) {
        // 获取发布积分配置
        const settingQuery = `
          SELECT setting_value, setting_type FROM system_settings 
          WHERE setting_key = 'html_editor.credits_per_publish'
        `;
        const settingResult = await dbConnection.query(settingQuery);
        const creditsRequired = parseInt(settingResult.rows[0]?.setting_value || 5);

        // 只有当积分大于0时才检查和扣除积分
        if (creditsRequired > 0) {
          const user = await User.findById(userId);
          if (!user.hasCredits(creditsRequired)) {
            return ResponseHelper.forbidden(res, 
              `积分不足，需要 ${creditsRequired} 积分生成永久链接，当前余额 ${user.getCredits()} 积分`
            );
          }

          // 扣除积分
          await user.consumeCredits(creditsRequired, null, null, 'HTML页面发布（生成永久链接）', 'html_publish');
          
          logger.info('HTML页面发布扣除积分', { 
            userId, 
            pageId: id, 
            creditsConsumed: creditsRequired 
          });
        }
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
      
      const message = newStatus ? '页面已发布，永久链接已生成' : '页面已取消发布';
      
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
   * 获取HTML编辑器积分配置
   */
  static async getCreditsConfig(req, res) {
    try {
      const query = `
        SELECT setting_key, setting_value 
        FROM system_settings 
        WHERE setting_key IN (
          'html_editor.credits_per_page',
          'html_editor.credits_per_update',
          'html_editor.credits_per_publish'
        )
      `;
      const result = await dbConnection.query(query);
      
      const config = {};
      result.rows.forEach(row => {
        const key = row.setting_key.replace('html_editor.', '');
        config[key] = parseInt(row.setting_value) || 0;
      });

      // 设置默认值，允许为0
      config.credits_per_page = config.credits_per_page ?? 10;
      config.credits_per_update = config.credits_per_update ?? 2;
      config.credits_per_publish = config.credits_per_publish ?? 5;

      return ResponseHelper.success(res, config);
    } catch (error) {
      logger.error('获取积分配置失败:', error);
      return ResponseHelper.error(res, '获取积分配置失败');
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
