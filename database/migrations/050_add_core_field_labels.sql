-- 添加核心字段的标签配置
ALTER TABLE application_form_config 
ADD COLUMN org_name_label VARCHAR(100) DEFAULT '企业/组织/学校名称' COMMENT '组织名称字段标签' AFTER application_rules,
ADD COLUMN applicant_email_label VARCHAR(100) DEFAULT '申请人邮箱' COMMENT '申请人邮箱字段标签' AFTER org_name_label,
ADD COLUMN business_license_label VARCHAR(100) DEFAULT '营业执照' COMMENT '营业执照字段标签' AFTER applicant_email_label,
ADD COLUMN invitation_code_label VARCHAR(100) DEFAULT '邀请码' COMMENT '邀请码字段标签' AFTER business_license_label;

-- 更新现有记录的默认值
UPDATE application_form_config 
SET org_name_label = '企业/组织/学校名称',
    applicant_email_label = '申请人邮箱',
    business_license_label = '营业执照',
    invitation_code_label = '邀请码'
WHERE id IN (1, 2);

-- 为了更好的管理，将field_4/5/6重命名为更有意义的名称
ALTER TABLE application_form_config 
CHANGE COLUMN field_4_label contact_name_label VARCHAR(100) DEFAULT '联系人姓名' COMMENT '联系人姓名字段标签',
CHANGE COLUMN field_4_required contact_name_required TINYINT(1) DEFAULT 0,
CHANGE COLUMN field_4_type contact_name_type VARCHAR(20) DEFAULT 'text',
CHANGE COLUMN field_4_options contact_name_options JSON DEFAULT NULL,
CHANGE COLUMN field_5_label contact_phone_label VARCHAR(100) DEFAULT '联系电话' COMMENT '联系电话字段标签',
CHANGE COLUMN field_5_required contact_phone_required TINYINT(1) DEFAULT 0,
CHANGE COLUMN field_5_type contact_phone_type VARCHAR(20) DEFAULT 'text',
CHANGE COLUMN field_5_options contact_phone_options JSON DEFAULT NULL,
CHANGE COLUMN field_6_label application_reason_label VARCHAR(100) DEFAULT '申请说明' COMMENT '申请说明字段标签',
CHANGE COLUMN field_6_required application_reason_required TINYINT(1) DEFAULT 0,
CHANGE COLUMN field_6_type application_reason_type VARCHAR(20) DEFAULT 'text',
CHANGE COLUMN field_6_options application_reason_options JSON DEFAULT NULL;

-- 更新现有记录的值
UPDATE application_form_config SET
contact_name_label = '联系人姓名',
contact_phone_label = '联系电话', 
application_reason_label = '申请说明'
WHERE id IN (1, 2);
