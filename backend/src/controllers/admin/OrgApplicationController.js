/**
 * 机构申请控制器
 */

const dbConnection = require('../../database/connection');
const ResponseHelper = require('../../utils/response');
const logger = require('../../utils/logger');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

class OrgApplicationController {
  /**
   * 获取申请表单配置（公开接口）
   */
  static async getFormConfig(req, res) {
    try {
      const sql = `
        SELECT 
          button_text,
          button_visible,
          field_4_label,
          field_4_required,
          field_4_type,
          field_4_options,
          field_5_label,
          field_5_required,
          field_5_type,
          field_5_options,
          field_6_label,
          field_6_required,
          field_6_type,
          field_6_options,
          invitation_code_required
        FROM application_form_config
        LIMIT 1
      `;
      
      const { rows } = await dbConnection.query(sql);
      
      if (rows.length === 0) {
        return ResponseHelper.success(res, {
          button_text: '申请企业账号',
          button_visible: true,
          fields: []
        });
      }
      
      const config = rows[0];
      const fields = [];
      
      // 构建动态字段配置
      for (let i = 4; i <= 6; i++) {
        if (config[`field_${i}_label`]) {
          fields.push({
            name: `custom_field_${i}`,
            label: config[`field_${i}_label`],
            required: config[`field_${i}_required`] === 1,
            type: config[`field_${i}_type`] || 'text',
            options: config[`field_${i}_options`] || null
          });
        }
      }
      
      return ResponseHelper.success(res, {
        button_text: config.button_text,
        button_visible: config.button_visible === 1,
        invitation_code_required: config.invitation_code_required === 1,
        fields
      });
    } catch (error) {
      logger.error('获取申请表单配置失败:', error);
      return ResponseHelper.error(res, '获取配置失败');
    }
  }
  
  /**
   * 提交机构申请（公开接口）
   */
  static async submitApplication(req, res) {
    try {
      const {
        org_name,
        applicant_email,
        business_license,
        custom_field_4,
        custom_field_5,
        custom_field_6,
        invitation_code
      } = req.body;
      
      // 验证必填字段
      if (!org_name || !applicant_email) {
        return ResponseHelper.validation(res, '组织名称和申请人邮箱为必填项');
      }
      
      // 验证邮箱格式
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(applicant_email)) {
        return ResponseHelper.validation(res, '邮箱格式不正确');
      }
      
      // 检查邮箱是否已被使用
      const emailCheckSql = 'SELECT id FROM users WHERE email = ?';
      const { rows: existingUsers } = await dbConnection.query(emailCheckSql, [applicant_email]);
      
      if (existingUsers.length > 0) {
        return ResponseHelper.validation(res, '该邮箱已被注册');
      }
      
      // 检查是否有未处理的申请
      const pendingCheckSql = `
        SELECT id FROM org_applications 
        WHERE applicant_email = ? AND status = 'pending'
      `;
      const { rows: pendingApps } = await dbConnection.query(pendingCheckSql, [applicant_email]);
      
      if (pendingApps.length > 0) {
        return ResponseHelper.validation(res, '您已有待处理的申请，请耐心等待审批');
      }
      
      let invitationCodeId = null;
      let referrerInfo = null;
      
      // 验证邀请码
      if (invitation_code) {
        const codeSql = `
          SELECT id, description, is_active, usage_limit, used_count, expires_at
          FROM invitation_codes
          WHERE code = ?
        `;
        const { rows: codes } = await dbConnection.query(codeSql, [invitation_code]);
        
        if (codes.length === 0) {
          return ResponseHelper.validation(res, '邀请码无效');
        }
        
        const codeData = codes[0];
        
        // 检查邀请码状态
        if (!codeData.is_active) {
          return ResponseHelper.validation(res, '邀请码已停用');
        }
        
        // 检查使用次数
        if (codeData.usage_limit !== -1 && codeData.used_count >= codeData.usage_limit) {
          return ResponseHelper.validation(res, '邀请码使用次数已达上限');
        }
        
        // 检查是否过期
        if (codeData.expires_at && new Date(codeData.expires_at) < new Date()) {
          return ResponseHelper.validation(res, '邀请码已过期');
        }
        
        invitationCodeId = codeData.id;
        referrerInfo = codeData.description;
        
        // 更新使用次数
        await dbConnection.query(
          'UPDATE invitation_codes SET used_count = used_count + 1 WHERE id = ?',
          [invitationCodeId]
        );
      } else {
        // 检查是否必须使用邀请码
        const configSql = 'SELECT invitation_code_required FROM application_form_config LIMIT 1';
        const { rows: configs } = await dbConnection.query(configSql);
        
        if (configs.length > 0 && configs[0].invitation_code_required === 1) {
          return ResponseHelper.validation(res, '请输入邀请码');
        }
      }
      
      // 创建申请记录
      const insertSql = `
        INSERT INTO org_applications (
          org_name,
          applicant_email,
          business_license,
          custom_field_4,
          custom_field_5,
          custom_field_6,
          invitation_code_id,
          referrer_info,
          status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
      `;
      
      const { rows } = await dbConnection.query(insertSql, [
        org_name,
        applicant_email,
        business_license,
        custom_field_4,
        custom_field_5,
        custom_field_6,
        invitationCodeId,
        referrerInfo
      ]);
      
      logger.info('机构申请提交成功', {
        applicationId: rows.insertId,
        org_name,
        applicant_email,
        referrer: referrerInfo
      });
      
      return ResponseHelper.success(res, {
        applicationId: rows.insertId,
        message: '申请已提交，我们会尽快处理'
      }, '申请提交成功');
    } catch (error) {
      logger.error('提交机构申请失败:', error);
      return ResponseHelper.error(res, '提交申请失败，请稍后重试');
    }
  }
  
  /**
   * 获取申请列表（管理员接口）
   */
  static async getApplicationList(req, res) {
    try {
      const { page = 1, limit = 20, status } = req.query;
      const offset = (page - 1) * limit;
      
      let whereClause = '';
      const params = [];
      
      if (status) {
        whereClause = 'WHERE oa.status = ?';
        params.push(status);
      }
      
      // 获取总数
      const countSql = `
        SELECT COUNT(*) as total 
        FROM org_applications oa
        ${whereClause}
      `;
      const { rows: countRows } = await dbConnection.query(countSql, params);
      const total = countRows[0].total;
      
      // 获取列表
      const listSql = `
        SELECT 
          oa.*,
          ic.code as invitation_code,
          ic.description as invitation_desc,
          u.username as approver_name,
          cu.username as created_username,
          cu.email as created_user_email
        FROM org_applications oa
        LEFT JOIN invitation_codes ic ON oa.invitation_code_id = ic.id
        LEFT JOIN users u ON oa.approved_by = u.id
        LEFT JOIN users cu ON oa.created_user_id = cu.id
        ${whereClause}
        ORDER BY oa.created_at DESC
        LIMIT ? OFFSET ?
      `;
      
      const { rows: applications } = await dbConnection.simpleQuery(
        listSql, 
        [...params, limit, offset]
      );
      
      return ResponseHelper.paginated(res, applications, {
        page: parseInt(page),
        limit: parseInt(limit),
        total
      });
    } catch (error) {
      logger.error('获取申请列表失败:', error);
      return ResponseHelper.error(res, '获取申请列表失败');
    }
  }
  
  /**
   * 审批申请（管理员接口）
   */
  static async approveApplication(req, res) {
    try {
      const { id } = req.params;
      const { action, rejection_reason, group_id, credits } = req.body;
      const approverId = req.user.id;
      
      // 验证action
      if (!['approve', 'reject'].includes(action)) {
        return ResponseHelper.validation(res, '无效的操作');
      }
      
      // 获取申请信息
      const appSql = 'SELECT * FROM org_applications WHERE id = ?';
      const { rows: apps } = await dbConnection.query(appSql, [id]);
      
      if (apps.length === 0) {
        return ResponseHelper.notFound(res, '申请不存在');
      }
      
      const application = apps[0];
      
      if (application.status !== 'pending') {
        return ResponseHelper.validation(res, '该申请已处理');
      }
      
      if (action === 'approve') {
        // 获取配置
        const configSql = `
          SELECT default_group_id, default_credits 
          FROM application_form_config LIMIT 1
        `;
        const { rows: configs } = await dbConnection.query(configSql);
        
        const config = configs[0] || {};
        const finalGroupId = group_id || config.default_group_id || 1;
        const finalCredits = credits !== undefined ? credits : (config.default_credits || 0);
        
        // 生成随机密码
        const randomPassword = crypto.randomBytes(8).toString('hex');
        const hashedPassword = await bcrypt.hash(randomPassword, 10);
        
        // 生成用户名（使用邮箱前缀）
        const username = application.applicant_email.split('@')[0] + '_' + Date.now();
        
        // 使用事务创建用户
        await dbConnection.transaction(async (query) => {
          // 创建用户
          const userSql = `
            INSERT INTO users (
              email,
              username,
              password_hash,
              role,
              group_id,
              status,
              credits_quota,
              remark
            ) VALUES (?, ?, ?, 'user', ?, 'active', ?, ?)
          `;
          
          const userResult = await query(userSql, [
            application.applicant_email,
            username,
            hashedPassword,
            finalGroupId,
            finalCredits,
            `机构用户 - ${application.org_name}`
          ]);
          
          const userId = userResult.rows.insertId;
          
          // 更新申请状态
          const updateSql = `
            UPDATE org_applications 
            SET 
              status = 'approved',
              approved_at = NOW(),
              approved_by = ?,
              created_user_id = ?
            WHERE id = ?
          `;
          
          await query(updateSql, [approverId, userId, id]);
        });
        
        logger.info('机构申请已批准', {
          applicationId: id,
          approverId,
          email: application.applicant_email,
          org: application.org_name
        });
        
        // TODO: 发送邮件通知，包含临时密码
        
        return ResponseHelper.success(res, {
          message: '申请已批准，账号创建成功',
          email: application.applicant_email,
          tempPassword: randomPassword // 仅用于测试，生产环境应通过邮件发送
        });
      } else {
        // 拒绝申请
        if (!rejection_reason) {
          return ResponseHelper.validation(res, '请填写拒绝原因');
        }
        
        const updateSql = `
          UPDATE org_applications 
          SET 
            status = 'rejected',
            approved_at = NOW(),
            approved_by = ?,
            rejection_reason = ?
          WHERE id = ?
        `;
        
        await dbConnection.query(updateSql, [approverId, rejection_reason, id]);
        
        logger.info('机构申请已拒绝', {
          applicationId: id,
          approverId,
          reason: rejection_reason
        });
        
        // TODO: 发送邮件通知
        
        return ResponseHelper.success(res, null, '申请已拒绝');
      }
    } catch (error) {
      logger.error('审批申请失败:', error);
      return ResponseHelper.error(res, '审批失败');
    }
  }
  
  /**
   * 更新表单配置（管理员接口）
   */
  static async updateFormConfig(req, res) {
    try {
      const updateData = req.body;
      const updaterId = req.user.id;
      
      // 构建更新语句
      const allowedFields = [
        'button_text',
        'button_visible',
        'field_4_label',
        'field_4_required',
        'field_4_type',
        'field_4_options',
        'field_5_label',
        'field_5_required',
        'field_5_type',
        'field_5_options',
        'field_6_label',
        'field_6_required',
        'field_6_type',
        'field_6_options',
        'invitation_code_required',
        'default_group_id',
        'default_credits',
        'auto_approve',
        'email_notification'
      ];
      
      const updates = [];
      const values = [];
      
      for (const field of allowedFields) {
        if (updateData.hasOwnProperty(field)) {
          updates.push(`${field} = ?`);
          values.push(updateData[field]);
        }
      }
      
      if (updates.length === 0) {
        return ResponseHelper.validation(res, '没有要更新的字段');
      }
      
      updates.push('updated_by = ?', 'updated_at = NOW()');
      values.push(updaterId);
      
      const sql = `UPDATE application_form_config SET ${updates.join(', ')} WHERE id = 1`;
      
      await dbConnection.query(sql, values);
      
      logger.info('申请表单配置已更新', { updaterId, fields: Object.keys(updateData) });
      
      return ResponseHelper.success(res, null, '配置更新成功');
    } catch (error) {
      logger.error('更新表单配置失败:', error);
      return ResponseHelper.error(res, '更新配置失败');
    }
  }
  
  /**
   * 邀请码管理 - 获取列表
   */
  static async getInvitationCodes(req, res) {
    try {
      const sql = `
        SELECT 
          ic.*,
          u.username as creator_name
        FROM invitation_codes ic
        LEFT JOIN users u ON ic.created_by = u.id
        ORDER BY ic.created_at DESC
      `;
      
      const { rows } = await dbConnection.query(sql);
      
      return ResponseHelper.success(res, rows);
    } catch (error) {
      logger.error('获取邀请码列表失败:', error);
      return ResponseHelper.error(res, '获取邀请码失败');
    }
  }
  
  /**
   * 创建邀请码
   */
  static async createInvitationCode(req, res) {
    try {
      const { code, description, usage_limit = -1, expires_at } = req.body;
      const creatorId = req.user.id;
      
      if (!code || code.length !== 6) {
        return ResponseHelper.validation(res, '邀请码必须为6位字符');
      }
      
      // 检查重复
      const checkSql = 'SELECT id FROM invitation_codes WHERE code = ?';
      const { rows: existing } = await dbConnection.query(checkSql, [code]);
      
      if (existing.length > 0) {
        return ResponseHelper.validation(res, '邀请码已存在');
      }
      
      const insertSql = `
        INSERT INTO invitation_codes (
          code, description, usage_limit, expires_at, created_by
        ) VALUES (?, ?, ?, ?, ?)
      `;
      
      const { rows } = await dbConnection.query(insertSql, [
        code,
        description,
        usage_limit,
        expires_at,
        creatorId
      ]);
      
      logger.info('邀请码创建成功', {
        codeId: rows.insertId,
        code,
        creatorId
      });
      
      return ResponseHelper.success(res, {
        id: rows.insertId,
        code
      }, '邀请码创建成功');
    } catch (error) {
      logger.error('创建邀请码失败:', error);
      return ResponseHelper.error(res, '创建邀请码失败');
    }
  }
  
  /**
   * 更新邀请码
   */
  static async updateInvitationCode(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;
      
      const allowedFields = ['description', 'is_active', 'usage_limit', 'expires_at'];
      const updates = [];
      const values = [];
      
      for (const field of allowedFields) {
        if (updateData.hasOwnProperty(field)) {
          updates.push(`${field} = ?`);
          values.push(updateData[field]);
        }
      }
      
      if (updates.length === 0) {
        return ResponseHelper.validation(res, '没有要更新的字段');
      }
      
      values.push(id);
      const sql = `UPDATE invitation_codes SET ${updates.join(', ')} WHERE id = ?`;
      
      await dbConnection.query(sql, values);
      
      return ResponseHelper.success(res, null, '邀请码更新成功');
    } catch (error) {
      logger.error('更新邀请码失败:', error);
      return ResponseHelper.error(res, '更新邀请码失败');
    }
  }
  
  /**
   * 删除邀请码
   */
  static async deleteInvitationCode(req, res) {
    try {
      const { id } = req.params;
      
      await dbConnection.query('DELETE FROM invitation_codes WHERE id = ?', [id]);
      
      return ResponseHelper.success(res, null, '邀请码删除成功');
    } catch (error) {
      logger.error('删除邀请码失败:', error);
      return ResponseHelper.error(res, '删除邀请码失败');
    }
  }
}

module.exports = OrgApplicationController;
