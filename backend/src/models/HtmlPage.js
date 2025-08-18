/**
 * HTML页面模型
 */

const dbConnection = require('../database/connection');
const logger = require('../utils/logger');
const crypto = require('crypto');

class HtmlPage {
  /**
   * 创建页面
   */
  static async create(data) {
    try {
      const {
        project_id,
        user_id,
        title,
        slug,
        html_content = '',
        css_content = '',
        js_content = '',
        compiled_content = '',
        credits_consumed = 0
      } = data;

      // 生成唯一的slug
      const finalSlug = slug || this.generateSlug(title);

      const query = `
        INSERT INTO html_pages 
        (project_id, user_id, title, slug, html_content, css_content, js_content, 
         compiled_content, credits_consumed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const result = await dbConnection.query(query, [
        project_id,
        user_id,
        title,
        finalSlug,
        html_content,
        css_content,
        js_content,
        compiled_content,
        credits_consumed
      ]);

      return result.rows.insertId;
    } catch (error) {
      logger.error('创建HTML页面失败:', error);
      throw error;
    }
  }

  /**
   * 获取用户的页面列表
   */
  static async getUserPages(userId, projectId = null, options = {}) {
    try {
      const { page = 1, limit = 20, is_published = null } = options;
      const offset = (page - 1) * limit;

      let conditions = ['hp.user_id = ?'];
      const params = [userId];

      if (projectId) {
        conditions.push('hp.project_id = ?');
        params.push(projectId);
      }

      if (is_published !== null) {
        conditions.push('hp.is_published = ?');
        params.push(is_published);
      }

      const whereClause = conditions.join(' AND ');

      // 获取总数
      const countQuery = `
        SELECT COUNT(*) as total 
        FROM html_pages hp 
        WHERE ${whereClause}
      `;
      const countResult = await dbConnection.query(countQuery, params);
      const total = countResult.rows[0].total;

      // 获取数据
      const query = `
        SELECT 
          hp.*,
          p.name as project_name
        FROM html_pages hp
        LEFT JOIN html_projects p ON hp.project_id = p.id
        WHERE ${whereClause}
        ORDER BY hp.created_at DESC
        LIMIT ? OFFSET ?
      `;

      const result = await dbConnection.simpleQuery(query, [...params, limit, offset]);

      return {
        data: result.rows,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('获取用户页面列表失败:', error);
      throw error;
    }
  }

  /**
   * 根据ID获取页面
   */
  static async findById(id) {
    try {
      const query = `
        SELECT hp.*, p.name as project_name 
        FROM html_pages hp
        LEFT JOIN html_projects p ON hp.project_id = p.id
        WHERE hp.id = ?
      `;
      const result = await dbConnection.query(query, [id]);
      
      if (result.rows.length === 0) {
        return null;
      }

      return result.rows[0];
    } catch (error) {
      logger.error('获取页面失败:', error);
      throw error;
    }
  }

  /**
   * 根据slug获取页面
   */
  static async findBySlug(userId, slug) {
    try {
      const query = `
        SELECT hp.*, p.name as project_name 
        FROM html_pages hp
        LEFT JOIN html_projects p ON hp.project_id = p.id
        WHERE hp.user_id = ? AND hp.slug = ? AND hp.is_published = 1
      `;
      const result = await dbConnection.query(query, [userId, slug]);
      
      if (result.rows.length === 0) {
        return null;
      }

      return result.rows[0];
    } catch (error) {
      logger.error('根据slug获取页面失败:', error);
      throw error;
    }
  }

  /**
   * 更新页面
   */
  static async update(id, data) {
    try {
      const allowedFields = [
        'title', 'slug', 'html_content', 'css_content', 'js_content', 
        'compiled_content', 'is_published', 'publish_url'
      ];
      
      const fields = [];
      const values = [];

      for (const field of allowedFields) {
        if (data.hasOwnProperty(field)) {
          fields.push(`${field} = ?`);
          values.push(data[field]);
        }
      }

      // 更新版本号
      fields.push('version = version + 1');

      // 如果是发布，更新发布时间
      if (data.is_published === 1) {
        fields.push('published_at = CURRENT_TIMESTAMP');
      }

      if (fields.length === 0) {
        return false;
      }

      values.push(id);
      const query = `UPDATE html_pages SET ${fields.join(', ')} WHERE id = ?`;
      const result = await dbConnection.query(query, values);

      return result.rows.affectedRows > 0;
    } catch (error) {
      logger.error('更新页面失败:', error);
      throw error;
    }
  }

  /**
   * 编译页面内容
   */
  static compileContent(htmlContent, cssContent, jsContent) {
    // 如果HTML内容已经包含完整的HTML结构
    if (htmlContent && (htmlContent.includes('<!DOCTYPE') || htmlContent.includes('<html'))) {
      // 找到</head>标签，插入CSS
      let compiledHtml = htmlContent;
      if (cssContent) {
        const headEndIndex = compiledHtml.toLowerCase().indexOf('</head>');
        if (headEndIndex > -1) {
          compiledHtml = compiledHtml.slice(0, headEndIndex) + 
            `\n<style>\n${cssContent}\n</style>\n` + 
            compiledHtml.slice(headEndIndex);
        }
      }
      
      // 找到</body>标签，插入JS
      if (jsContent) {
        const bodyEndIndex = compiledHtml.toLowerCase().lastIndexOf('</body>');
        if (bodyEndIndex > -1) {
          compiledHtml = compiledHtml.slice(0, bodyEndIndex) + 
            `\n<script>\n${jsContent}\n</script>\n` + 
            compiledHtml.slice(bodyEndIndex);
        }
      }
      
      return compiledHtml;
    } else {
      // 如果只有body内容，构建完整HTML
      return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>预览页面</title>
    <style>
${cssContent || '/* 无CSS样式 */'}
    </style>
</head>
<body>
${htmlContent || '<h1>空白页面</h1>'}
    <script>
${jsContent || '// 无JavaScript代码'}
    </script>
</body>
</html>`;
    }
  }

  /**
   * 生成唯一slug - 改进版：只使用英文和数字
   */
  static generateSlug(title) {
    // 移除所有非英文字母和数字的字符
    const baseSlug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')  // 只保留英文字母和数字
      .replace(/^-+|-+$/g, '')       // 移除首尾的连字符
      .substring(0, 30);             // 限制长度
    
    // 如果baseSlug为空或太短，使用默认值
    const finalBase = (baseSlug && baseSlug.length > 2) ? baseSlug : 'page';
    
    // 添加6位随机字符确保唯一性
    const randomSuffix = crypto.randomBytes(3).toString('hex');
    
    return `${finalBase}-${randomSuffix}`;
  }

  /**
   * 增加浏览量
   */
  static async incrementViewCount(id) {
    try {
      const query = 'UPDATE html_pages SET view_count = view_count + 1 WHERE id = ?';
      await dbConnection.query(query, [id]);
    } catch (error) {
      logger.error('增加浏览量失败:', error);
    }
  }

  /**
   * 检查用户是否拥有页面
   */
  static async checkOwnership(id, userId) {
    try {
      const query = 'SELECT user_id FROM html_pages WHERE id = ?';
      const result = await dbConnection.query(query, [id]);
      
      if (result.rows.length === 0) {
        return false;
      }

      return result.rows[0].user_id === userId;
    } catch (error) {
      logger.error('检查页面所有权失败:', error);
      return false;
    }
  }
}

module.exports = HtmlPage;
