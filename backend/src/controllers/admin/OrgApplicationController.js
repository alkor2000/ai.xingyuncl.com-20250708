/**
 * 机构申请控制器 - 支持完整字段标签自定义
 * 修复：使用事务处理邀请码更新，避免申请失败时错误消耗邀请码
 */

const dbConnection = require('../../database/connection');
const ResponseHelper = require('../../utils/response');
const logger = require('../../utils/logger');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const EmailService = require('../../services/emailService');
const SystemConfig = require('../../models/SystemConfig');

class OrgApplicationController {
  /**
   * 辅助方法：检查字段是否为空
   * @param {any} value - 要检查的值
   * @returns {boolean} - 如果值为空返回true
   */
  static isEmpty(value) {
    // null、undefined、空字符串、仅包含空白字符的字符串都视为空
    return value === null || 
           value === undefined || 
           (typeof value === 'string' && value.trim() === '');
  }

  /**
   * 获取申请表单配置（公开接口）- 返回所有字段标签
   */
  static async getFormConfig(req, res) {
    try {
      const sql = `
        SELECT 
          button_text,
          button_visible,
          application_rules,
          org_name_label,
          applicant_email_label,
          business_license_label,
          invitation_code_label,
          contact_name_label,
          contact_name_required,
          contact_name_type,
          contact_name_options,
          contact_phone_label,
          contact_phone_required,
          contact_phone_type,
          contact_phone_options,
          application_reason_label,
          application_reason_required,
          application_reason_type,
          application_reason_options,
          invitation_code_required
        FROM application_form_config
        LIMIT 1
      `;
      
      const { rows } = await dbConnection.query(sql);
      
      if (rows.length === 0) {
        return ResponseHelper.success(res, {
          button_text: '申请企业账号',
          button_visible: true,
          application_rules: '',
          field_labels: {
            org_name: '企业/组织/学校名称',
            applicant_email: '申请人邮箱',
            business_license: '营业执照',
            invitation_code: '邀请码'
          },
          custom_fields: []
        });
      }
      
      const config = rows[0];
      const customFields = [];
      
      // 构建自定义字段配置（联系人姓名、联系电话、申请说明）
      if (config.contact_name_label) {
        customFields.push({
          name: 'custom_field_4',
          label: config.contact_name_label,
          required: config.contact_name_required === 1,
          type: config.contact_name_type || 'text',
          options: config.contact_name_options || null
        });
      }
      
      if (config.contact_phone_label) {
        customFields.push({
          name: 'custom_field_5',
          label: config.contact_phone_label,
          required: config.contact_phone_required === 1,
          type: config.contact_phone_type || 'text',
          options: config.contact_phone_options || null
        });
      }
      
      if (config.application_reason_label) {
        customFields.push({
          name: 'custom_field_6',
          label: config.application_reason_label,
          required: config.application_reason_required === 1,
          type: config.application_reason_type || 'text',
          options: config.application_reason_options || null
        });
      }
      
      return ResponseHelper.success(res, {
        button_text: config.button_text,
        button_visible: config.button_visible === 1,
        application_rules: config.application_rules || '',
        field_labels: {
          org_name: config.org_name_label || '企业/组织/学校名称',
          applicant_email: config.applicant_email_label || '申请人邮箱',
          business_license: config.business_license_label || '营业执照',
          invitation_code: config.invitation_code_label || '邀请码'
        },
        invitation_code_required: config.invitation_code_required === 1,
        custom_fields: customFields
      });
    } catch (error) {
      logger.error('获取申请表单配置失败:', error);
      return ResponseHelper.error(res, '获取配置失败');
    }
  }

  /**
   * 获取完整的申请表单配置（管理员接口）- 返回所有配置项
   */
  static async getAdminFormConfig(req, res) {
    try {
      const sql = `
        SELECT 
          button_text,
          button_visible,
          application_rules,
          org_name_label,
          applicant_email_label,
          business_license_label,
          invitation_code_label,
          contact_name_label,
          contact_name_required,
          contact_name_type,
          contact_name_options,
          contact_phone_label,
          contact_phone_required,
          contact_phone_type,
          contact_phone_options,
          application_reason_label,
          application_reason_required,
          application_reason_type,
          application_reason_options,
          invitation_code_required,
          default_group_id,
          default_credits,
          auto_approve,
          email_notification
        FROM application_form_config
        LIMIT 1
      `;
      
      const { rows } = await dbConnection.query(sql);
      
      if (rows.length === 0) {
        return ResponseHelper.success(res, {
          button_text: '申请企业账号',
          button_visible: true,
          application_rules: '',
          org_name_label: '企业/组织/学校名称',
          applicant_email_label: '申请人邮箱',
          business_license_label: '营业执照',
          invitation_code_label: '邀请码',
          contact_name_label: '联系人姓名',
          contact_name_required: false,
          contact_phone_label: '联系电话',
          contact_phone_required: false,
          application_reason_label: '申请说明',
          application_reason_required: false,
          invitation_code_required: false,
          default_group_id: 1,
          default_credits: 0,
          auto_approve: false,
          email_notification: false
        });
      }
      
      const config = rows[0];
      
      // 转换布尔值并返回完整配置
      const formattedConfig = {
        button_text: config.button_text,
        button_visible: config.button_visible === 1,
        application_rules: config.application_rules || '',
        // 核心字段标签
        org_name_label: config.org_name_label || '企业/组织/学校名称',
        applicant_email_label: config.applicant_email_label || '申请人邮箱',
        business_license_label: config.business_license_label || '营业执照',
        invitation_code_label: config.invitation_code_label || '邀请码',
        // 自定义字段配置
        contact_name_label: config.contact_name_label || '联系人姓名',
        contact_name_required: config.contact_name_required === 1,
        contact_name_type: config.contact_name_type || 'text',
        contact_name_options: config.contact_name_options,
        contact_phone_label: config.contact_phone_label || '联系电话',
        contact_phone_required: config.contact_phone_required === 1,
        contact_phone_type: config.contact_phone_type || 'text',
        contact_phone_options: config.contact_phone_options,
        application_reason_label: config.application_reason_label || '申请说明',
        application_reason_required: config.application_reason_required === 1,
        application_reason_type: config.application_reason_type || 'text',
        application_reason_options: config.application_reason_options,
        // 其他配置
        invitation_code_required: config.invitation_code_required === 1,
        default_group_id: config.default_group_id,
        default_credits: config.default_credits,
        auto_approve: config.auto_approve === 1,
        email_notification: config.email_notification === 1
      };
      
      return ResponseHelper.success(res, formattedConfig);
    } catch (error) {
      logger.error('获取管理表单配置失败:', error);
      return ResponseHelper.error(res, '获取配置失败');
    }
  }
  
  /**
   * 提交机构申请（公开接口）- 支持自动审批
   * 修复：使用事务处理，确保邀请码使用次数更新的原子性
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
      
      // ========== 第一阶段：所有验证（不修改数据） ==========
      
      // 验证必填字段
      if (!org_name || !applicant_email) {
        return ResponseHelper.validation(res, null, '组织名称和申请人邮箱为必填项');
      }
      
      // 验证邮箱格式
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(applicant_email)) {
        return ResponseHelper.validation(res, null, '邮箱格式不正确，请输入有效的邮箱地址');
      }
      
      // 检查邮箱是否已被使用
      const emailCheckSql = 'SELECT id FROM users WHERE email = ?';
      const { rows: existingUsers } = await dbConnection.query(emailCheckSql, [applicant_email]);
      
      if (existingUsers.length > 0) {
        return ResponseHelper.validation(res, null, '该邮箱已被注册，请使用其他邮箱');
      }
      
      // 检查是否有未处理的申请
      const pendingCheckSql = `
        SELECT id FROM org_applications 
        WHERE applicant_email = ? AND status = 'pending'
      `;
      const { rows: pendingApps } = await dbConnection.query(pendingCheckSql, [applicant_email]);
      
      if (pendingApps.length > 0) {
        return ResponseHelper.validation(res, null, '您已有待处理的申请，请耐心等待审批');
      }
      
      // 获取表单配置，检查必填字段和自动审批设置
      const configSql = `
        SELECT 
          contact_name_label, contact_name_required,
          contact_phone_label, contact_phone_required,
          application_reason_label, application_reason_required,
          invitation_code_required,
          default_group_id,
          default_credits,
          auto_approve,
          email_notification
        FROM application_form_config
        LIMIT 1
      `;
      const { rows: configs } = await dbConnection.query(configSql);
      
      let autoApprove = false;
      let emailNotification = false;
      let defaultGroupId = 1;
      let defaultCredits = 0;
      
      if (configs.length > 0) {
        const config = configs[0];
        
        // 检查自定义字段 - 使用改进的空值判断
        // 联系人姓名
        if (config.contact_name_required === 1 && OrgApplicationController.isEmpty(custom_field_4)) {
          return ResponseHelper.validation(res, null, `${config.contact_name_label || '联系人姓名'}为必填项`);
        }
        
        // 联系电话
        if (config.contact_phone_required === 1 && OrgApplicationController.isEmpty(custom_field_5)) {
          return ResponseHelper.validation(res, null, `${config.contact_phone_label || '联系电话'}为必填项`);
        }
        
        // 申请说明
        if (config.application_reason_required === 1 && OrgApplicationController.isEmpty(custom_field_6)) {
          return ResponseHelper.validation(res, null, `${config.application_reason_label || '申请说明'}为必填项`);
        }
        
        // 邀请码必填检查
        if (config.invitation_code_required === 1 && OrgApplicationController.isEmpty(invitation_code)) {
          return ResponseHelper.validation(res, null, '请输入邀请码');
        }
        
        autoApprove = config.auto_approve === 1;
        emailNotification = config.email_notification === 1;
        defaultGroupId = config.default_group_id || 1;
        defaultCredits = config.default_credits || 0;
      }
      
      let invitationCodeId = null;
      let referrerInfo = null;
      let codeData = null;
      
      // 验证邀请码（如果提供了邀请码）- 只验证，不更新
      if (invitation_code && !OrgApplicationController.isEmpty(invitation_code)) {
        const codeSql = `
          SELECT id, description, is_active, usage_limit, used_count, expires_at
          FROM invitation_codes
          WHERE code = ?
        `;
        const { rows: codes } = await dbConnection.query(codeSql, [invitation_code]);
        
        if (codes.length === 0) {
          return ResponseHelper.validation(res, null, '邀请码无效，请检查输入是否正确');
        }
        
        codeData = codes[0];
        
        if (!codeData.is_active) {
          return ResponseHelper.validation(res, null, '邀请码已停用，请联系管理员');
        }
        
        if (codeData.usage_limit !== -1 && codeData.used_count >= codeData.usage_limit) {
          return ResponseHelper.validation(res, null, '邀请码使用次数已达上限');
        }
        
        if (codeData.expires_at && new Date(codeData.expires_at) < new Date()) {
          return ResponseHelper.validation(res, null, '邀请码已过期，请联系管理员获取新的邀请码');
        }
        
        invitationCodeId = codeData.id;
        referrerInfo = codeData.description;
      }
      
      // 处理可能为空的字段，将空字符串转为null存入数据库
      const processedField4 = OrgApplicationController.isEmpty(custom_field_4) ? null : custom_field_4;
      const processedField5 = OrgApplicationController.isEmpty(custom_field_5) ? null : custom_field_5;
      const processedField6 = OrgApplicationController.isEmpty(custom_field_6) ? null : custom_field_6;
      
      // ========== 第二阶段：事务处理（创建申请记录 + 更新邀请码） ==========
      
      const initialStatus = autoApprove ? 'approved' : 'pending';
      let applicationId = null;
      let createdUserId = null;
      let username = null;
      let defaultPassword = null;
      
      try {
        // 开始事务
        await dbConnection.transaction(async (query) => {
          // 1. 创建申请记录
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
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `;
          
          const insertResult = await query(insertSql, [
            org_name,
            applicant_email,
            business_license,
            processedField4,
            processedField5,
            processedField6,
            invitationCodeId,
            referrerInfo,
            initialStatus
          ]);
          
          applicationId = insertResult.rows.insertId;
          
          // 2. 如果使用了邀请码，更新使用次数
          if (invitationCodeId) {
            const updateCodeSql = 'UPDATE invitation_codes SET used_count = used_count + 1 WHERE id = ?';
            await query(updateCodeSql, [invitationCodeId]);
            
            logger.info('邀请码使用次数已更新', {
              codeId: invitationCodeId,
              code: invitation_code,
              applicationId
            });
          }
          
          // 3. 如果启用自动审批，创建用户账号
          if (autoApprove) {
            // 生成UUID
            const userUuid = crypto.randomUUID();
            
            // 使用固定默认密码
            defaultPassword = '123456';
            const hashedPassword = await bcrypt.hash(defaultPassword, 10);
            
            // 生成用户名
            username = applicant_email.split('@')[0] + '_' + Date.now();
            
            const userSql = `
              INSERT INTO users (
                uuid,
                email,
                username,
                password_hash,
                role,
                group_id,
                status,
                credits_quota,
                remark
              ) VALUES (?, ?, ?, ?, 'user', ?, 'active', ?, ?)
            `;
            
            const userResult = await query(userSql, [
              userUuid,
              applicant_email,
              username,
              hashedPassword,
              defaultGroupId,
              defaultCredits,
              `机构用户 - ${org_name}（自动审批）`
            ]);
            
            createdUserId = userResult.rows.insertId;
            
            // 更新申请记录，关联创建的用户
            const updateAppSql = `
              UPDATE org_applications 
              SET 
                approved_at = NOW(),
                approved_by = 0,
                created_user_id = ?
              WHERE id = ?
            `;
            
            await query(updateAppSql, [createdUserId, applicationId]);
          }
        });
        
        // 事务成功完成
        logger.info('机构申请提交成功', {
          applicationId,
          org_name,
          applicant_email,
          referrer: referrerInfo,
          autoApproved: autoApprove
        });
        
        // 如果自动审批，发送邮件通知
        if (autoApprove && emailNotification) {
          // 异步发送邮件，不影响响应
          OrgApplicationController.sendApprovalEmail(
            applicant_email,
            org_name,
            username,
            defaultPassword
          ).catch(err => {
            logger.error('发送批准邮件失败，但申请已成功:', err);
          });
          
          return ResponseHelper.success(res, {
            applicationId,
            message: '申请已自动批准，账号信息已发送至您的邮箱'
          }, '申请提交成功');
        }
        
        return ResponseHelper.success(res, {
          applicationId,
          message: '申请已提交，我们会尽快处理'
        }, '申请提交成功');
        
      } catch (transactionError) {
        // 事务失败，所有操作自动回滚
        logger.error('提交机构申请事务失败:', transactionError);
        return ResponseHelper.error(res, '提交申请失败，请稍后重试');
      }
      
    } catch (error) {
      logger.error('提交机构申请失败:', error);
      return ResponseHelper.error(res, '提交申请失败，请稍后重试');
    }
  }
  
  /**
   * 发送批准邮件
   */
  static async sendApprovalEmail(email, orgName, username, password) {
    try {
      const settings = await SystemConfig.getFormattedSettings();
      const siteName = settings.site?.name || 'AI Platform';
      const siteUrl = settings.site?.url || 'https://ai.xingyuncl.com';
      
      // 检查邮件服务是否配置
      const emailConfig = settings.email || {};
      if (!emailConfig.smtp_host || !emailConfig.smtp_user || !emailConfig.smtp_pass) {
        logger.warn('邮件服务未配置，跳过发送批准邮件');
        return false;
      }
      
      const transporter = await EmailService.getTransporter();
      const fromName = emailConfig.smtp_from || siteName;
      
      const mailOptions = {
        from: `"${fromName}" <${emailConfig.smtp_user}>`,
        to: email,
        subject: `[${siteName}] 您的机构申请已批准`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">${siteName}</h2>
            <p>尊敬的用户：</p>
            <p>恭喜！您的机构申请已经批准。</p>
            
            <div style="background: #f0f2f5; padding: 20px; margin: 20px 0; border-radius: 8px;">
              <h3 style="margin-top: 0;">账号信息</h3>
              <p><strong>组织名称：</strong>${orgName}</p>
              <p><strong>登录邮箱：</strong>${email}</p>
              <p><strong>用户名：</strong>${username}</p>
              <p><strong>默认密码：</strong>${password}</p>
            </div>
            
            <p style="color: #ff4d4f;">
              <strong>重要提示：</strong>请登录后立即修改密码以确保账号安全。
            </p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${siteUrl}/login" 
                 style="display: inline-block; padding: 12px 30px; background: #1890ff; color: white; text-decoration: none; border-radius: 4px;">
                立即登录
              </a>
            </div>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
            <p style="color: #999; font-size: 12px; text-align: center;">
              ${siteName} - ${new Date().getFullYear()}
            </p>
          </div>
        `
      };
      
      await transporter.sendMail(mailOptions);
      logger.info('批准邮件发送成功', { to: email });
      return true;
    } catch (error) {
      logger.error('发送批准邮件失败:', error);
      return false;
    }
  }
  
  /**
   * 发送拒绝邮件
   */
  static async sendRejectionEmail(email, orgName, reason) {
    try {
      const settings = await SystemConfig.getFormattedSettings();
      const siteName = settings.site?.name || 'AI Platform';
      
      // 检查邮件服务是否配置
      const emailConfig = settings.email || {};
      if (!emailConfig.smtp_host || !emailConfig.smtp_user || !emailConfig.smtp_pass) {
        logger.warn('邮件服务未配置，跳过发送拒绝邮件');
        return false;
      }
      
      const transporter = await EmailService.getTransporter();
      const fromName = emailConfig.smtp_from || siteName;
      
      const mailOptions = {
        from: `"${fromName}" <${emailConfig.smtp_user}>`,
        to: email,
        subject: `[${siteName}] 关于您的机构申请`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">${siteName}</h2>
            <p>尊敬的用户：</p>
            <p>感谢您申请使用我们的服务。</p>
            
            <div style="background: #fff5f5; padding: 20px; margin: 20px 0; border-radius: 8px; border-left: 4px solid #ff4d4f;">
              <p>很遗憾，您的机构申请未能通过审核。</p>
              <p><strong>组织名称：</strong>${orgName}</p>
              ${reason ? `<p><strong>原因说明：</strong>${reason}</p>` : ''}
            </div>
            
            <p>如有疑问，请联系我们的客服团队。</p>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
            <p style="color: #999; font-size: 12px; text-align: center;">
              ${siteName} - ${new Date().getFullYear()}
            </p>
          </div>
        `
      };
      
      await transporter.sendMail(mailOptions);
      logger.info('拒绝邮件发送成功', { to: email });
      return true;
    } catch (error) {
      logger.error('发送拒绝邮件失败:', error);
      return false;
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
   * 审批申请（管理员接口）- 支持邮件通知
   */
  static async approveApplication(req, res) {
    try {
      const { id } = req.params;
      const { action, rejection_reason, group_id, credits } = req.body;
      const approverId = req.user.id;
      
      // 验证action
      if (!['approve', 'reject'].includes(action)) {
        return ResponseHelper.validation(res, null, '无效的操作类型');
      }
      
      // 获取申请信息
      const appSql = 'SELECT * FROM org_applications WHERE id = ?';
      const { rows: apps } = await dbConnection.query(appSql, [id]);
      
      if (apps.length === 0) {
        return ResponseHelper.notFound(res, '申请不存在');
      }
      
      const application = apps[0];
      
      if (application.status !== 'pending') {
        return ResponseHelper.validation(res, null, '该申请已处理，无需重复操作');
      }
      
      // 获取邮件通知配置
      const configSql = `
        SELECT email_notification, default_group_id, default_credits 
        FROM application_form_config LIMIT 1
      `;
      const { rows: configs } = await dbConnection.query(configSql);
      const config = configs[0] || {};
      const emailNotification = config.email_notification === 1;
      
      if (action === 'approve') {
        const finalGroupId = group_id || config.default_group_id || 1;
        const finalCredits = credits !== undefined ? credits : (config.default_credits || 0);
        
        // 生成UUID
        const userUuid = crypto.randomUUID();
        
        // 使用固定默认密码
        const defaultPassword = '123456';
        const hashedPassword = await bcrypt.hash(defaultPassword, 10);
        
        // 生成用户名
        const username = application.applicant_email.split('@')[0] + '_' + Date.now();
        
        // 使用事务创建用户
        await dbConnection.transaction(async (query) => {
          const userSql = `
            INSERT INTO users (
              uuid,
              email,
              username,
              password_hash,
              role,
              group_id,
              status,
              credits_quota,
              remark
            ) VALUES (?, ?, ?, ?, 'user', ?, 'active', ?, ?)
          `;
          
          const userResult = await query(userSql, [
            userUuid,
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
          org: application.org_name,
          uuid: userUuid
        });
        
        // 发送邮件通知
        if (emailNotification) {
          await OrgApplicationController.sendApprovalEmail(
            application.applicant_email,
            application.org_name,
            username,
            defaultPassword
          );
        }
        
        return ResponseHelper.success(res, {
          message: '申请已批准，账号创建成功',
          email: application.applicant_email,
          username: username,
          defaultPassword: defaultPassword,
          note: '请告知用户使用此密码登录，并建议首次登录后修改密码'
        });
      } else {
        // 拒绝申请
        if (!rejection_reason) {
          return ResponseHelper.validation(res, null, '请填写拒绝原因');
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
        
        // 发送邮件通知
        if (emailNotification) {
          await OrgApplicationController.sendRejectionEmail(
            application.applicant_email,
            application.org_name,
            rejection_reason
          );
        }
        
        return ResponseHelper.success(res, null, '申请已拒绝');
      }
    } catch (error) {
      logger.error('审批申请失败:', error);
      return ResponseHelper.error(res, '审批失败');
    }
  }
  
  /**
   * 更新表单配置（管理员接口）- 支持所有字段标签配置
   */
  static async updateFormConfig(req, res) {
    try {
      const updateData = req.body;
      const updaterId = req.user.id;
      
      // 构建更新语句 - 包括新的字段标签
      const allowedFields = [
        'button_text',
        'button_visible',
        'application_rules',
        // 核心字段标签
        'org_name_label',
        'applicant_email_label',
        'business_license_label',
        'invitation_code_label',
        // 自定义字段配置（原field_4/5/6）
        'contact_name_label',
        'contact_name_required',
        'contact_name_type',
        'contact_name_options',
        'contact_phone_label',
        'contact_phone_required',
        'contact_phone_type',
        'contact_phone_options',
        'application_reason_label',
        'application_reason_required',
        'application_reason_type',
        'application_reason_options',
        // 其他配置
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
        return ResponseHelper.validation(res, null, '没有要更新的字段');
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
        return ResponseHelper.validation(res, null, '邀请码必须为6位字符');
      }
      
      // 检查重复
      const checkSql = 'SELECT id FROM invitation_codes WHERE code = ?';
      const { rows: existing } = await dbConnection.query(checkSql, [code]);
      
      if (existing.length > 0) {
        return ResponseHelper.validation(res, null, '邀请码已存在，请使用其他邀请码');
      }
      
      // 处理日期格式
      let formattedExpiresAt = null;
      if (expires_at) {
        const date = new Date(expires_at);
        if (!isNaN(date.getTime())) {
          formattedExpiresAt = date.getFullYear() + '-' +
            String(date.getMonth() + 1).padStart(2, '0') + '-' +
            String(date.getDate()).padStart(2, '0') + ' ' +
            String(date.getHours()).padStart(2, '0') + ':' +
            String(date.getMinutes()).padStart(2, '0') + ':' +
            String(date.getSeconds()).padStart(2, '0');
        }
      }
      
      const insertSql = `
        INSERT INTO invitation_codes (
          code, description, usage_limit, expires_at, created_by
        ) VALUES (?, ?, ?, ?, ?)
      `;
      
      const { rows } = await dbConnection.query(insertSql, [
        code,
        description || null,
        usage_limit,
        formattedExpiresAt,
        creatorId
      ]);
      
      logger.info('邀请码创建成功', {
        codeId: rows.insertId,
        code,
        creatorId,
        expires_at: formattedExpiresAt
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
          
          // 特殊处理expires_at字段
          if (field === 'expires_at' && updateData[field]) {
            const date = new Date(updateData[field]);
            if (!isNaN(date.getTime())) {
              const formattedDate = date.getFullYear() + '-' +
                String(date.getMonth() + 1).padStart(2, '0') + '-' +
                String(date.getDate()).padStart(2, '0') + ' ' +
                String(date.getHours()).padStart(2, '0') + ':' +
                String(date.getMinutes()).padStart(2, '0') + ':' +
                String(date.getSeconds()).padStart(2, '0');
              values.push(formattedDate);
            } else {
              values.push(null);
            }
          } else if (field === 'expires_at' && !updateData[field]) {
            values.push(null);
          } else {
            values.push(updateData[field]);
          }
        }
      }
      
      if (updates.length === 0) {
        return ResponseHelper.validation(res, null, '没有要更新的字段');
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
