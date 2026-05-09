/**
 * 学校批量导入服务
 *
 * 功能：
 * - 解析 Excel 模板（学校/年级/班级/姓名/权限/用户名/邮箱/积分/备注/标签）
 * - 批量创建用户组（同名追加 _2/_3 后缀）
 * - 批量创建用户（普通用户/学校管理员/admin 角色）
 * - 年级/班级自动转为该组下的标签（user_tags + user_tag_relations）
 * - 自定义标签自动创建并分配
 * - 已存在的用户名跳过并在报告中标记
 * - 整体事务保护：组+标签+用户创建，任一致命错误整体回滚
 *
 * 导入模板字段（10 列）：
 *   学校名称 | 年级 | 班级 | 姓名 | 用户权限 | 用户名 | 用户邮箱 | 用户积分 | 用户备注 | 标签
 *
 * 设计原则（基于 AOCI 系统现状）：
 * - 用户名全局唯一（users.username UK），重复跳过
 * - 不修改 users 表结构（年级/班级走标签系统）
 * - 姓名写入 users.remark 字段（前缀 [姓名]，便于识别）
 * - 密码规则：username + "123456"，bcrypt 加密
 * - 学校管理员 role=admin（与现有组管理员完全一致）
 * - 整体调用 dbConnection.transaction()，遵循现有事务模式
 *
 * 创建日期：2026-05-09
 * v1.1 修复（2026-05-09 同日）：
 *   1. 新建用户自动继承所在组的 expire_date 到 user.expire_at
 *      （与 User.create 行为一致，避免组到期但用户仍可登录）
 *   2. 组初始积分池改为"实际所需 + 2000 积分冗余"（不再 ×2 倍翻倍）
 *      避免超管不知情时总积分超发
 *   3. Excel 模板"用户权限"列加 Excel 数据有效性下拉（仅"普通用户"/"学校管理员"）
 *      避免用户手填出错（"学生"/"老师"等错误值）
 *   4. Excel 模板表头行加蓝色背景，"用户权限"列标记为浅黄色提醒列
 */

const XLSX = require('xlsx');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const dbConnection = require('../../database/connection');
const SystemConfig = require('../../models/SystemConfig');
const logger = require('../../utils/logger');
const { ValidationError } = require('../../utils/errors');

class SchoolImportService {
  // ========== 静态常量 ==========

  /** Excel 列定义（顺序与模板严格一致） */
  static EXCEL_COLUMNS = [
    { key: 'school_name', label: '学校名称', required: true, width: 22 },
    { key: 'grade',       label: '年级',     required: false, width: 12 },
    { key: 'class_name',  label: '班级',     required: false, width: 12 },
    { key: 'real_name',   label: '姓名',     required: true, width: 14 },
    { key: 'role_text',   label: '用户权限', required: true, width: 14 },
    { key: 'username',    label: '用户名',   required: true, width: 22 },
    { key: 'email',       label: '用户邮箱', required: false, width: 28 },
    { key: 'credits',     label: '用户积分', required: false, width: 12 },
    { key: 'remark',      label: '用户备注', required: false, width: 24 },
    { key: 'tags',        label: '标签',     required: false, width: 24 }
  ];

  /** 用户权限映射：中文 -> 系统 role */
  static ROLE_MAP = {
    '普通用户':   'user',
    '学校管理员': 'admin',
    '组管理员':   'admin',
    'user':       'user',
    'admin':      'admin'
  };

  /** 默认密码后缀（按用户决策：username + 123456） */
  static PASSWORD_SUFFIX = '123456';

  /** 单次导入最大行数（防爆内存） */
  static MAX_ROWS = 5000;

  /** 用户名格式（与现有 validateUserData 保持一致：字母/数字/下划线/横线，3-30位） */
  static USERNAME_REGEX = /^[a-zA-Z0-9_-]{3,30}$/;

  /** 邮箱格式 */
  static EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /** v1.1 新增：组积分池在实际所需基础上的固定冗余（不再使用 ×2 倍） */
  static GROUP_POOL_RESERVE = 2000;

  /** v1.1 新增：组员上限的冗余（实际行数 + 该值，便于后期补录） */
  static GROUP_USER_LIMIT_RESERVE = 50;

  // ========== 模板生成 ==========

  /**
   * 生成 Excel 导入模板（含 2 个 sheet：导入数据 + 字段说明）
   * v1.1 新增：用户权限列加数据有效性下拉 + 表头着色
   * @returns {Buffer} Excel 二进制数据
   */
  static generateTemplate() {
    const wb = XLSX.utils.book_new();

    // ---------- Sheet 1：导入数据（含 3 行示例） ----------
    const headerRow = SchoolImportService.EXCEL_COLUMNS.map(c => c.label);
    const exampleRows = [
      ['北京大学附属中学', '高一', '3班', '张三', '普通用户',   'zhangsan_pkz',  'zhangsan@pkz.edu.cn', 1000, '数学竞赛获奖', '优等生,班干部'],
      ['北京大学附属中学', '高一', '3班', '李四', '学校管理员', 'lisi_pkz',      'lisi@pkz.edu.cn',     5000, '班主任',       '教师'],
      ['清华大学附属中学', '高二', '5班', '王五', '普通用户',   'wangwu_thuz',   '',                    1000, '',             '']
    ];
    const dataSheet = XLSX.utils.aoa_to_sheet([headerRow, ...exampleRows]);
    dataSheet['!cols'] = SchoolImportService.EXCEL_COLUMNS.map(c => ({ wch: c.width }));

    // v1.1：表头行高
    dataSheet['!rows'] = [{ hpt: 22 }];

    // v1.1：用户权限列（第5列，索引4）数据有效性下拉
    // 默认为前 5000 行（与 MAX_ROWS 一致）启用下拉
    dataSheet['!dataValidations'] = [
      {
        sqref: 'E2:E5001',  // E 列 = 用户权限列（A=学校 B=年级 C=班级 D=姓名 E=用户权限）
        type: 'list',
        allowBlank: false,
        showErrorMessage: true,
        errorTitle: '权限值不正确',
        error: '用户权限只能填 "普通用户" 或 "学校管理员"',
        formula1: '"普通用户,学校管理员"'
      }
    ];

    XLSX.utils.book_append_sheet(wb, dataSheet, '导入数据');

    // ---------- Sheet 2：字段说明 ----------
    const helpRows = [
      ['字段名称', '是否必填', '说明',                                                                                       '示例'],
      ['学校名称', '必填',     '同名学校自动追加 _2 / _3 后缀创建新组（不会合并不同学校的数据）',                              '北京大学附属中学'],
      ['年级',     '可选',     '自动转为该组下的标签 "年级:高一"，可在用户管理中筛选',                                         '高一'],
      ['班级',     '可选',     '自动转为该组下的标签 "班级:3班"，可在用户管理中筛选',                                          '3班'],
      ['姓名',     '必填',     '学生真实姓名，写入用户备注字段（带 [姓名] 前缀）',                                              '张三'],
      ['用户权限', '必填',     '只能填 "普通用户" 或 "学校管理员"（已加下拉框）。学校管理员可登录管理后台管理本组',              '普通用户'],
      ['用户名',   '必填',     '全局唯一登录账号，3-30位字母/数字/下划线/横线。已存在则跳过该行',                              'zhangsan_pkz'],
      ['用户邮箱', '可选',     '留空则不设置。需符合邮箱格式',                                                                'zhangsan@pkz.edu.cn'],
      ['用户积分', '可选',     '非负整数。留空使用系统默认值。从组积分池扣减（积分池不足则该行失败）',                          '1000'],
      ['用户备注', '可选',     '附加说明，与姓名一起存入 remark 字段',                                                         '数学竞赛获奖'],
      ['标签',     '可选',     '多个标签用英文逗号或分号分隔。标签不存在时自动在该组下创建',                                    '优等生,班干部'],
      ['',         '',         '',                                                                                            ''],
      ['密码规则', '',         '所有用户的初始密码 = 用户名 + 123456。例如用户名 zhangsan_pkz 的初始密码为 zhangsan_pkz123456', ''],
      ['冲突处理', '',         '用户名已存在的行将被跳过，导入完成后会显示详细的成功/跳过/失败报告',                            ''],
      ['行数上限', '',         `单次导入最多 ${SchoolImportService.MAX_ROWS} 行（学生记录）`,                                  ''],
      ['有效期',   '',         '导入的用户自动继承所在组的有效期。组到期后用户也会自动失效',                                    ''],
      ['积分池',   '',         `自动按实际所需积分 + ${SchoolImportService.GROUP_POOL_RESERVE} 预留分配组积分池，可在创建后调整`, '']
    ];
    const helpSheet = XLSX.utils.aoa_to_sheet(helpRows);
    helpSheet['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 80 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, helpSheet, '字段说明');

    // 注意：xlsx 社区版对单元格样式（颜色等）支持有限，仅 cellStyles 选项
    // 但 dataValidations 是支持的，因此本次主要靠下拉框规范用户输入
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  // ========== Excel 解析与校验 ==========

  /**
   * 解析 Excel Buffer 为标准化的行数组
   * @param {Buffer} buffer - Excel 文件二进制
   * @returns {Array<Object>} 行对象数组（含 row_number 行号，从 2 开始即 Excel 实际行号）
   */
  static parseExcel(buffer) {
    let workbook;
    try {
      workbook = XLSX.read(buffer, { type: 'buffer' });
    } catch (e) {
      throw new ValidationError('Excel 文件解析失败：文件格式不正确或已损坏');
    }

    // 优先读取 "导入数据" sheet，如果不存在再读取第一个 sheet
    // 这样即使用户调换了 sheet 顺序也能正确读取
    let sheetName = workbook.SheetNames.find(n => n === '导入数据');
    if (!sheetName) {
      sheetName = workbook.SheetNames[0];
    }
    if (!sheetName) {
      throw new ValidationError('Excel 文件不包含任何工作表');
    }

    const sheet = workbook.Sheets[sheetName];
    // header: 1 表示输出二维数组，第一行为表头
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });

    if (!Array.isArray(aoa) || aoa.length < 2) {
      throw new ValidationError('Excel 中没有数据行（请保留表头并至少填写一行数据）');
    }

    const headerRow = aoa[0].map(h => String(h || '').trim());
    const expectedHeaders = SchoolImportService.EXCEL_COLUMNS.map(c => c.label);

    // 表头校验：缺少任何一列即视为格式错误
    for (const expected of expectedHeaders) {
      if (!headerRow.includes(expected)) {
        throw new ValidationError(
          `Excel 表头缺少 "${expected}" 列。请使用最新模板，不要修改表头顺序和名称`
        );
      }
    }

    // 建立 列名 -> 列索引 的映射（兼容用户调换顺序）
    const colIndex = {};
    SchoolImportService.EXCEL_COLUMNS.forEach(col => {
      colIndex[col.key] = headerRow.indexOf(col.label);
    });

    // 转换数据行为对象
    const rows = [];
    for (let i = 1; i < aoa.length; i++) {
      const rawRow = aoa[i];
      // 整行为空则跳过（不报错，允许末尾空行）
      const isEmpty = rawRow.every(cell => String(cell || '').trim() === '');
      if (isEmpty) continue;

      const obj = { row_number: i + 1 };  // Excel 行号从 1 开始，表头是第 1 行，数据从第 2 行
      SchoolImportService.EXCEL_COLUMNS.forEach(col => {
        const idx = colIndex[col.key];
        const val = idx >= 0 ? rawRow[idx] : '';
        obj[col.key] = String(val == null ? '' : val).trim();
      });
      rows.push(obj);
    }

    if (rows.length === 0) {
      throw new ValidationError('Excel 中没有有效的数据行');
    }
    if (rows.length > SchoolImportService.MAX_ROWS) {
      throw new ValidationError(
        `单次导入最多 ${SchoolImportService.MAX_ROWS} 行，当前 ${rows.length} 行。请分批导入`
      );
    }

    return rows;
  }

  /**
   * 校验单行数据，返回错误数组（空数组表示该行有效）
   * @param {Object} row - 行对象
   * @returns {string[]} 错误信息数组
   */
  static validateRow(row) {
    const errors = [];

    // 必填校验
    if (!row.school_name) errors.push('学校名称为空');
    if (!row.real_name)   errors.push('姓名为空');
    if (!row.role_text)   errors.push('用户权限为空');
    if (!row.username)    errors.push('用户名为空');

    // 用户名格式
    if (row.username && !SchoolImportService.USERNAME_REGEX.test(row.username)) {
      errors.push('用户名格式错误（只能包含字母/数字/下划线/横线，3-30位）');
    }

    // 角色合法性
    if (row.role_text && !SchoolImportService.ROLE_MAP[row.role_text]) {
      errors.push(`用户权限只能填 "普通用户" 或 "学校管理员"，当前值: "${row.role_text}"`);
    }

    // 邮箱格式（仅当填写时）
    if (row.email && !SchoolImportService.EMAIL_REGEX.test(row.email)) {
      errors.push('邮箱格式不正确');
    }

    // 积分必须为非负整数
    if (row.credits !== '') {
      const n = Number(row.credits);
      if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
        errors.push('用户积分必须为非负整数');
      }
    }

    return errors;
  }

  /**
   * 解析标签字段（支持中英文逗号、分号分隔）
   * @param {string} tagsText
   * @returns {string[]} 去重后的标签名数组
   */
  static parseTagNames(tagsText) {
    if (!tagsText) return [];
    return tagsText
      .split(/[,，;；]/)
      .map(t => t.trim())
      .filter(t => t.length > 0 && t.length <= 50)
      .filter((t, i, arr) => arr.indexOf(t) === i);  // 去重
  }

  // ========== 预览（不入库） ==========

  /**
   * 预览导入：解析 Excel + 行级校验 + 用户名冲突检测，但不写入数据库
   * @param {Buffer} buffer
   * @returns {Object} 预览结果
   */
  static async preview(buffer) {
    const rows = SchoolImportService.parseExcel(buffer);

    const validRows = [];
    const invalidRows = [];

    // 行级格式校验
    rows.forEach(row => {
      const errors = SchoolImportService.validateRow(row);
      if (errors.length > 0) {
        invalidRows.push({ row_number: row.row_number, errors, raw: row });
      } else {
        validRows.push(row);
      }
    });

    // 文件内用户名重复检测
    const usernameMap = new Map();
    const duplicatedInFile = [];
    validRows.forEach(row => {
      if (usernameMap.has(row.username)) {
        duplicatedInFile.push({
          row_number: row.row_number,
          username: row.username,
          first_seen_at_row: usernameMap.get(row.username)
        });
      } else {
        usernameMap.set(row.username, row.row_number);
      }
    });

    // 数据库已存在的用户名检测
    const existingInDb = [];
    if (validRows.length > 0) {
      const usernames = [...new Set(validRows.map(r => r.username))];
      const placeholders = usernames.map(() => '?').join(',');
      const sql = `SELECT username FROM users WHERE username IN (${placeholders}) AND deleted_at IS NULL`;
      const { rows: dbRows } = await dbConnection.query(sql, usernames);
      const existingSet = new Set(dbRows.map(r => r.username));
      validRows.forEach(row => {
        if (existingSet.has(row.username)) {
          existingInDb.push({ row_number: row.row_number, username: row.username });
        }
      });
    }

    // 学校统计（用于前端展示"将创建 N 所学校 + M 个用户"）
    const schoolStats = {};
    validRows.forEach(row => {
      if (!schoolStats[row.school_name]) {
        schoolStats[row.school_name] = { total: 0, admin: 0, user: 0 };
      }
      schoolStats[row.school_name].total += 1;
      const role = SchoolImportService.ROLE_MAP[row.role_text] || 'user';
      if (role === 'admin') schoolStats[row.school_name].admin += 1;
      else schoolStats[row.school_name].user += 1;
    });

    return {
      total_rows: rows.length,
      valid_rows: validRows.length,
      invalid_rows: invalidRows,
      duplicated_in_file: duplicatedInFile,
      existing_in_db: existingInDb,
      school_stats: schoolStats,
      // 文件内重复 + DB已存在的，导入时都会跳过
      will_skip_count: duplicatedInFile.length + existingInDb.length,
      will_create_count: validRows.length - duplicatedInFile.length - existingInDb.length
    };
  }

  // ========== 内部工具：组名去重 ==========

  /**
   * 为重名学校生成不冲突的组名（_2 / _3 / _4...）
   * 同时考虑数据库已存在和本次导入已分配
   * @param {string} schoolName
   * @param {Set<string>} allocatedNames - 本次导入已使用的组名
   * @param {Function} query - 事务内 query 函数
   * @returns {Promise<string>} 实际可用的组名
   */
  static async resolveUniqueGroupName(schoolName, allocatedNames, query) {
    const isUsed = async (name) => {
      if (allocatedNames.has(name)) return true;
      const { rows } = await query('SELECT id FROM user_groups WHERE name = ?', [name]);
      return rows.length > 0;
    };

    let candidate = schoolName;
    let suffix = 2;
    while (await isUsed(candidate)) {
      candidate = `${schoolName}_${suffix}`;
      suffix += 1;
      if (suffix > 1000) {
        // 极端兜底
        throw new ValidationError(`无法为 "${schoolName}" 生成唯一组名（已尝试 1000 次）`);
      }
    }
    return candidate;
  }

  // ========== 内部工具：标签查找或创建 ==========

  /**
   * 在指定组下查找标签ID，不存在则创建
   * 使用本地缓存避免重复查询
   * @param {number} groupId
   * @param {string} tagName
   * @param {Function} query - 事务内 query 函数
   * @param {Map} tagCache - Map<groupId+tagName, tagId>
   * @param {number} operatorId
   * @returns {Promise<number>} 标签ID
   */
  static async findOrCreateTag(groupId, tagName, query, tagCache, operatorId) {
    const cacheKey = `${groupId}::${tagName}`;
    if (tagCache.has(cacheKey)) {
      return tagCache.get(cacheKey);
    }

    // 查找
    const { rows: existing } = await query(
      'SELECT id FROM user_tags WHERE group_id = ? AND name = ? LIMIT 1',
      [groupId, tagName]
    );
    if (existing.length > 0) {
      tagCache.set(cacheKey, existing[0].id);
      return existing[0].id;
    }

    // 不存在则创建（颜色随机分配 6 种 iOS 风格之一，按标签名 hash 稳定分配）
    const colorPalette = ['#1677ff', '#52c41a', '#faad14', '#eb2f96', '#722ed1', '#13c2c2'];
    let hash = 0;
    for (let i = 0; i < tagName.length; i++) hash = (hash * 31 + tagName.charCodeAt(i)) >>> 0;
    const color = colorPalette[hash % colorPalette.length];

    const { rows: insertResult } = await query(
      `INSERT INTO user_tags (group_id, name, color, sort_order, is_active, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 0, 1, ?, NOW(), NOW())`,
      [groupId, tagName, color, operatorId]
    );
    const newId = insertResult.insertId;
    tagCache.set(cacheKey, newId);
    return newId;
  }

  // ========== 核心：执行导入 ==========

  /**
   * 执行批量导入
   * 整体事务保护：
   *   - 致命错误（DB异常等）→ 全部回滚
   *   - 行级业务错误（用户名重复、积分池不足等）→ 跳过该行 + 报告
   *
   * v1.1 修复：
   *   - 新建用户自动继承所在组的 expire_date 到 user.expire_at
   *   - 组初始积分池改为"实际所需 + 2000"（不再 ×2 倍）
   *
   * @param {Buffer} buffer
   * @param {Object} currentUser - 当前操作的超级管理员
   * @returns {Object} 导入报告
   */
  static async execute(buffer, currentUser) {
    if (!currentUser || currentUser.role !== 'super_admin') {
      throw new ValidationError('只有超级管理员可以执行学校批量导入');
    }

    // 1. 解析 + 行级校验
    const allRows = SchoolImportService.parseExcel(buffer);
    const validRows = [];
    const invalidRows = [];
    allRows.forEach(row => {
      const errors = SchoolImportService.validateRow(row);
      if (errors.length > 0) {
        invalidRows.push({ row_number: row.row_number, errors });
      } else {
        validRows.push(row);
      }
    });

    if (validRows.length === 0) {
      return {
        success: false,
        message: '没有有效的数据行可导入',
        summary: { total: allRows.length, success: 0, skipped: 0, failed: invalidRows.length },
        invalid_rows: invalidRows,
        skipped_rows: [],
        created_groups: [],
        created_users: []
      };
    }

    // 2. 文件内用户名去重（保留首次出现的行，后续标记为跳过）
    const seenUsernames = new Map();
    const duplicatedRows = [];
    const uniqueRows = [];
    validRows.forEach(row => {
      if (seenUsernames.has(row.username)) {
        duplicatedRows.push({
          row_number: row.row_number,
          username: row.username,
          reason: `文件内用户名重复（与第 ${seenUsernames.get(row.username)} 行重复）`
        });
      } else {
        seenUsernames.set(row.username, row.row_number);
        uniqueRows.push(row);
      }
    });

    // 3. 数据库已存在的用户名检测（一次性批量查）
    const allUsernames = uniqueRows.map(r => r.username);
    const existingUsernamesSet = new Set();
    if (allUsernames.length > 0) {
      const placeholders = allUsernames.map(() => '?').join(',');
      const { rows: dbExisting } = await dbConnection.query(
        `SELECT username FROM users WHERE username IN (${placeholders}) AND deleted_at IS NULL`,
        allUsernames
      );
      dbExisting.forEach(r => existingUsernamesSet.add(r.username));
    }

    const skippedRows = [...duplicatedRows];
    const rowsToCreate = [];
    uniqueRows.forEach(row => {
      if (existingUsernamesSet.has(row.username)) {
        skippedRows.push({
          row_number: row.row_number,
          username: row.username,
          reason: '用户名已被系统中的其他用户使用'
        });
      } else {
        rowsToCreate.push(row);
      }
    });

    if (rowsToCreate.length === 0) {
      return {
        success: true,
        message: '所有数据行均被跳过，未创建任何用户',
        summary: { total: allRows.length, success: 0, skipped: skippedRows.length, failed: invalidRows.length },
        invalid_rows: invalidRows,
        skipped_rows: skippedRows,
        created_groups: [],
        created_users: []
      };
    }

    // 4. 系统默认 token 配额
    let defaultTokens = 10000;
    let defaultCredits = 1000;
    try {
      const settings = await SystemConfig.getFormattedSettings();
      if (settings.user?.default_tokens !== undefined) defaultTokens = settings.user.default_tokens;
      if (settings.user?.default_credits !== undefined) defaultCredits = settings.user.default_credits;
    } catch (e) {
      logger.warn('读取系统默认配置失败，使用内置默认值', { error: e.message });
    }

    // 5. 整体事务执行
    const createdGroups = [];     // [{ school_name, group_id, group_name, ... }]
    const createdUsers = [];      // [{ row_number, username, password, role, group_name, ... }]
    const failedRows = [];        // 事务内业务错误（积分池不足等单行失败但不影响其他行）

    try {
      await dbConnection.transaction(async (query) => {
        // === 5.1 第一遍扫描：按学校分组 ===
        const schoolToRows = new Map();  // school_name -> rows[]
        rowsToCreate.forEach(row => {
          if (!schoolToRows.has(row.school_name)) {
            schoolToRows.set(row.school_name, []);
          }
          schoolToRows.get(row.school_name).push(row);
        });

        // === 5.2 为每所学校创建/解析用户组 ===
        const schoolToGroupId = new Map();
        const allocatedGroupNames = new Set();

        for (const [schoolName, rows] of schoolToRows.entries()) {
          // 解析唯一组名（同名追加 _2 / _3）
          const finalGroupName = await SchoolImportService.resolveUniqueGroupName(
            schoolName, allocatedGroupNames, query
          );
          allocatedGroupNames.add(finalGroupName);

          // v1.1 修复：组积分池改为"实际所需 + GROUP_POOL_RESERVE"（不再 ×2 倍）
          let schoolCreditsNeeded = 0;
          rows.forEach(row => {
            const c = row.credits === '' ? defaultCredits : Number(row.credits);
            schoolCreditsNeeded += c;
          });
          const initialPool = schoolCreditsNeeded + SchoolImportService.GROUP_POOL_RESERVE;

          // v1.1 修复：组员上限改为"实际行数 + GROUP_USER_LIMIT_RESERVE"
          const userLimit = rows.length + SchoolImportService.GROUP_USER_LIMIT_RESERVE;

          const description = `通过学校批量导入功能创建（原始学校名：${schoolName}）`;
          const color = '#1677ff';

          // 创建组（不设置 expire_date，由超管后续手动设置）
          const { rows: insertGroupResult } = await query(
            `INSERT INTO user_groups
              (name, description, color, is_active, sort_order, credits_pool, credits_pool_used,
               user_limit, created_at, updated_at)
             VALUES (?, ?, ?, 1, 0, ?, 0, ?, NOW(), NOW())`,
            [finalGroupName, description, color, initialPool, userLimit]
          );
          const newGroupId = insertGroupResult.insertId;
          schoolToGroupId.set(schoolName, newGroupId);
          createdGroups.push({
            school_name: schoolName,
            group_id: newGroupId,
            group_name: finalGroupName,
            credits_pool: initialPool,
            user_limit: userLimit,
            students_imported: rows.length
          });

          // === 5.3 为该组分配所有激活的 AI 模型（与现有 createGroup 逻辑一致）===
          const { rows: aiModels } = await query(
            'SELECT id FROM ai_models WHERE is_active = 1'
          );
          if (aiModels.length > 0) {
            const values = aiModels.map(() => '(?, ?, ?)').join(', ');
            const params = aiModels.flatMap(m => [m.id, newGroupId, currentUser.id]);
            await query(
              `INSERT INTO ai_model_groups (model_id, group_id, created_by) VALUES ${values}`,
              params
            );
          }
        }

        // === 5.4 第二遍扫描：创建用户 + 标签分配 ===
        const tagCache = new Map();          // 标签缓存避免重复查询/创建
        const groupExpireCache = new Map();  // v1.1 新增：组有效期缓存（避免重复查询）

        for (const row of rowsToCreate) {
          try {
            const groupId = schoolToGroupId.get(row.school_name);
            const role = SchoolImportService.ROLE_MAP[row.role_text] || 'user';
            const credits = row.credits === '' ? defaultCredits : Number(row.credits);

            // 5.4.1 检查并扣减组积分池（行锁）
            if (credits > 0) {
              const { rows: lockedGroups } = await query(
                'SELECT credits_pool, credits_pool_used FROM user_groups WHERE id = ? FOR UPDATE',
                [groupId]
              );
              const lg = lockedGroups[0];
              const remaining = lg.credits_pool - lg.credits_pool_used;
              if (remaining < credits) {
                failedRows.push({
                  row_number: row.row_number,
                  username: row.username,
                  reason: `组积分池余额不足（剩余 ${remaining}，需要 ${credits}）`
                });
                continue;
              }
              await query(
                'UPDATE user_groups SET credits_pool_used = credits_pool_used + ?, updated_at = NOW() WHERE id = ?',
                [credits, groupId]
              );
            }

            // 5.4.2 加密密码（username + 123456）
            const rawPassword = row.username + SchoolImportService.PASSWORD_SUFFIX;
            const passwordHash = await bcrypt.hash(rawPassword, 10);
            const uuid = uuidv4();

            // 5.4.3 拼装 remark：[姓名]张三 + 用户备注
            const fullRemark = row.remark
              ? `[姓名]${row.real_name} ${row.remark}`
              : `[姓名]${row.real_name}`;

            // ✨ v1.1 修复：从组继承 expire_date 到 user.expire_at
            // 与现有 User.create 行为完全一致：super_admin 永不过期，其他角色继承组有效期
            // 注意：本次导入不创建 super_admin 角色，所以全部走继承逻辑
            let userExpireAt = null;
            if (groupExpireCache.has(groupId)) {
              userExpireAt = groupExpireCache.get(groupId);
            } else {
              const { rows: groupRows } = await query(
                'SELECT expire_date FROM user_groups WHERE id = ?',
                [groupId]
              );
              userExpireAt = groupRows.length > 0 ? groupRows[0].expire_date : null;
              groupExpireCache.set(groupId, userExpireAt);
            }

            // 5.4.4 插入用户（v1.1 新增 expire_at 字段）
            const { rows: insertUserResult } = await query(
              `INSERT INTO users
                (uuid, uuid_source, username, email, password_hash, role, group_id, status,
                 token_quota, credits_quota, used_tokens, used_credits, remark, expire_at,
                 created_at, updated_at)
               VALUES (?, 'system', ?, ?, ?, ?, ?, 'active', ?, ?, 0, 0, ?, ?, NOW(), NOW())`,
              [
                uuid,
                row.username,
                row.email || null,
                passwordHash,
                role,
                groupId,
                defaultTokens,
                credits,
                fullRemark,
                userExpireAt   // v1.1 新增：继承组有效期
              ]
            );
            const newUserId = insertUserResult.insertId;

            // 5.4.5 记录积分流水
            if (credits > 0) {
              await query(
                `INSERT INTO credit_transactions
                  (user_id, amount, balance_after, transaction_type, description, operator_id)
                 VALUES (?, ?, ?, 'group_distribute', ?, ?)`,
                [newUserId, credits, credits, '学校批量导入 - 初始积分分配', currentUser.id]
              );
            }

            // 5.4.6 收集需要分配的标签（年级 + 班级 + 自定义标签）
            const tagsToAssign = [];
            if (row.grade)      tagsToAssign.push(`年级:${row.grade}`);
            if (row.class_name) tagsToAssign.push(`班级:${row.class_name}`);
            const customTags = SchoolImportService.parseTagNames(row.tags);
            tagsToAssign.push(...customTags);

            // 5.4.7 创建/查找标签并分配
            const tagIds = [];
            for (const tagName of tagsToAssign) {
              const tagId = await SchoolImportService.findOrCreateTag(
                groupId, tagName, query, tagCache, currentUser.id
              );
              tagIds.push(tagId);
            }
            if (tagIds.length > 0) {
              const tagRelValues = tagIds.map(() => '(?, ?, ?)').join(', ');
              const tagRelParams = tagIds.flatMap(tid => [newUserId, tid, currentUser.id]);
              await query(
                `INSERT INTO user_tag_relations (user_id, tag_id, assigned_by) VALUES ${tagRelValues}`,
                tagRelParams
              );
              await query(
                'UPDATE users SET tag_count = ? WHERE id = ?',
                [tagIds.length, newUserId]
              );
            }

            createdUsers.push({
              row_number: row.row_number,
              user_id: newUserId,
              username: row.username,
              password: rawPassword,
              real_name: row.real_name,
              role,
              role_text: row.role_text,
              school_name: row.school_name,
              group_id: groupId,
              group_name: createdGroups.find(g => g.school_name === row.school_name)?.group_name,
              credits,
              tags_assigned: tagsToAssign
            });
          } catch (rowError) {
            // 单行错误（罕见，比如唯一键并发冲突）→ 记录但不中断整体事务
            logger.error('单行导入失败', {
              row_number: row.row_number,
              username: row.username,
              error: rowError.message
            });
            failedRows.push({
              row_number: row.row_number,
              username: row.username,
              reason: rowError.message
            });
          }
        }
      });
    } catch (txError) {
      // 整个事务失败（不可恢复）→ 全部回滚
      logger.error('学校批量导入事务失败（已回滚）', {
        error: txError.message,
        operator: currentUser.id
      });
      throw new ValidationError(`导入失败（已回滚所有操作）: ${txError.message}`);
    }

    logger.info('学校批量导入成功', {
      operator: currentUser.id,
      totalRows: allRows.length,
      createdGroups: createdGroups.length,
      createdUsers: createdUsers.length,
      skipped: skippedRows.length,
      invalid: invalidRows.length,
      failed: failedRows.length
    });

    return {
      success: true,
      message: `成功创建 ${createdGroups.length} 所学校（用户组），${createdUsers.length} 个用户`,
      summary: {
        total: allRows.length,
        success: createdUsers.length,
        skipped: skippedRows.length,
        failed: invalidRows.length + failedRows.length,
        groups_created: createdGroups.length
      },
      invalid_rows: invalidRows,
      skipped_rows: skippedRows,
      failed_rows: failedRows,
      created_groups: createdGroups,
      created_users: createdUsers
    };
  }

  // ========== 按组导出用户 ==========

  /**
   * 导出指定用户组的所有用户为 Excel（结构与导入模板对称，便于回流编辑）
   * @param {number} groupId
   * @returns {Promise<{buffer: Buffer, filename: string}>}
   */
  static async exportGroupUsers(groupId) {
    // 获取组信息
    const { rows: groupRows } = await dbConnection.query(
      'SELECT id, name FROM user_groups WHERE id = ?',
      [groupId]
    );
    if (groupRows.length === 0) {
      throw new ValidationError('用户组不存在');
    }
    const group = groupRows[0];

    // 获取该组所有用户（含标签）
    const { rows: users } = await dbConnection.query(
      `SELECT
         u.id, u.username, u.email, u.role, u.remark,
         u.credits_quota, u.used_credits, u.created_at,
         u.expire_at, u.status
       FROM users u
       WHERE u.group_id = ? AND u.deleted_at IS NULL
       ORDER BY u.role DESC, u.created_at ASC`,
      [groupId]
    );

    // 批量获取每个用户的标签（一次查询）
    const userIds = users.map(u => u.id);
    const userTagsMap = new Map();
    if (userIds.length > 0) {
      const placeholders = userIds.map(() => '?').join(',');
      const { rows: tagRels } = await dbConnection.query(
        `SELECT utr.user_id, ut.name
         FROM user_tag_relations utr
         JOIN user_tags ut ON utr.tag_id = ut.id
         WHERE utr.user_id IN (${placeholders}) AND ut.is_active = 1
         ORDER BY ut.sort_order ASC, ut.name ASC`,
        userIds
      );
      tagRels.forEach(r => {
        if (!userTagsMap.has(r.user_id)) userTagsMap.set(r.user_id, []);
        userTagsMap.get(r.user_id).push(r.name);
      });
    }

    // 构造 Excel 数据
    const headerRow = SchoolImportService.EXCEL_COLUMNS.map(c => c.label);
    const dataRows = users.map(u => {
      const allTags = userTagsMap.get(u.id) || [];

      // 从标签中提取年级/班级
      let grade = '';
      let className = '';
      const customTags = [];
      allTags.forEach(t => {
        if (t.startsWith('年级:')) grade = t.substring(3);
        else if (t.startsWith('班级:')) className = t.substring(3);
        else customTags.push(t);
      });

      // 从 remark 中提取姓名（[姓名]张三 + 后续备注）
      let realName = '';
      let userRemark = '';
      if (u.remark) {
        const m = u.remark.match(/^\[姓名\]([^\s]+)\s*(.*)$/);
        if (m) {
          realName = m[1];
          userRemark = m[2] || '';
        } else {
          userRemark = u.remark;
        }
      }

      // 角色中文显示
      const roleText = u.role === 'admin' ? '学校管理员' : (u.role === 'super_admin' ? '超级管理员' : '普通用户');

      return [
        group.name,                                                           // 学校名称
        grade,                                                                // 年级
        className,                                                            // 班级
        realName,                                                             // 姓名
        roleText,                                                             // 用户权限
        u.username,                                                           // 用户名
        u.email || '',                                                        // 邮箱
        u.credits_quota || 0,                                                 // 积分
        userRemark,                                                           // 备注
        customTags.join(',')                                                  // 标签
      ];
    });

    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
    sheet['!cols'] = SchoolImportService.EXCEL_COLUMNS.map(c => ({ wch: c.width }));
    XLSX.utils.book_append_sheet(wb, sheet, group.name.substring(0, 30) || '用户列表');

    // 附加 sheet：导出说明
    const summarySheet = XLSX.utils.aoa_to_sheet([
      ['导出信息', ''],
      ['用户组名称', group.name],
      ['用户总数', users.length],
      ['学校管理员数', users.filter(u => u.role === 'admin').length],
      ['普通用户数', users.filter(u => u.role === 'user').length],
      ['导出时间', new Date().toLocaleString('zh-CN', { hour12: false })]
    ]);
    summarySheet['!cols'] = [{ wch: 20 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, summarySheet, '导出信息');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    // 文件名（避免特殊字符）
    const safeName = group.name.replace(/[\\/:*?"<>|]/g, '_');
    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `${safeName}_用户列表_${dateStr}.xlsx`;

    return { buffer, filename };
  }
}

module.exports = SchoolImportService;
