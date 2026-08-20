/**
 * 中文（zh-CN）语言包统一入口
 *
 * 说明：
 * 1. 本文件必须与 en-US/index.js 的导入清单严格保持一致，
 *    否则英文环境下缺失的命名空间会回退（fallback）到中文，
 *    出现"切了英语仍显示中文"的问题。
 * 2. 各 json 文件内部为一级命名空间（如 wiki.xxx、agent.xxx），
 *    通过展开运算符合并为单一 translation 资源对象。
 * 3. 新增语言包文件时，务必同步在 zh-CN 与 en-US 两侧都注册。
 *
 * 【重要 - 展开顺序不可随意调整】
 *    下方 export default 中的展开顺序决定了同名键的最终生效值：
 *    后展开的会覆盖先展开的。
 *    目前 admin.json 与 common.json 存在 14 个同名键
 *    （如 role.admin、status.active、common.operation 等），
 *    由于 admin 在 common 之后展开，实际生效的是 admin.json 的值。
 *    这是当前系统的既有行为（例如 role.admin 显示为"组管理员"，
 *    与后端 groupAdminMiddleware 的语义一致）。
 *    若调整展开顺序，会导致这些文案发生意外变化，
 *    因此新增语言包一律追加到末尾，不要插入中间位置。
 */

// ===== 基础与通用 =====
import common from './common.json'          // 通用文案（按钮、状态、提示等）
import errors from './errors.json'          // 错误提示与 404 页面

// ===== 用户与认证 =====
import auth from './auth.json'              // 登录、注册、SSO 回调
import profile from './profile.json'        // 个人中心

// ===== 核心业务模块 =====
import chat from './chat.json'              // 对话系统
import knowledge from './knowledge.json'    // 万智魔方（知识模块）
import wiki from './wiki.json'              // 知识库 Wiki
import forum from './forum.json'            // 社区论坛
import agent from './agent.json'            // Agent 工作流
import smartApps from './smartApps.json'    // 智能应用广场

// ===== AI 生成类模块 =====
import image from './image.json'            // 图像生成
import video from './video.json'            // 视频生成

// ===== 工具类模块 =====
import htmlEditor from './htmlEditor.json'  // HTML 编辑器
import storage from './storage.json'        // 智能云盘
import calendar from './calendar.json'      // 智能日历（模块已停用，保留语言包）
import teaching from './teaching.json'      // 智能教学（模块已停用，保留语言包）

// ===== 管理后台 =====
import admin from './admin.json'            // 管理后台

export default {
  // 注意：以下展开顺序为既有行为，不可调整（详见文件头说明）
  ...common,
  ...profile,
  ...auth,
  ...chat,
  ...admin,
  ...errors,
  ...storage,
  ...knowledge,
  ...htmlEditor,
  ...image,
  ...video,
  ...calendar,
  ...agent,
  ...teaching,
  ...wiki,
  ...forum,
  // 新增语言包一律追加到末尾，避免影响上方同名键的覆盖关系
  ...smartApps
}
