/**
 * 节点标签国际化解析工具
 *
 * ============ 背景问题 ============
 * 工作流的节点数据（flow_data）以 JSON 形式持久化在数据库 agent_workflows 表中，
 * 其中每个节点的 data.label 字段保存的是"创建那一刻的默认标签文本"。
 *
 * 由于历史版本在创建节点时直接写入了中文常量（如 '开始'、'AI对话'、'知识检索'），
 * 这些中文字符串已经落库。如果渲染节点时直接使用 data.label，
 * 那么无论界面语言怎么切换，节点标题永远是当初存进去的中文。
 *
 * ============ 解决思路 ============
 * 区分两种 label：
 *   1. 系统默认标签（用户从未手动改过）
 *      → 忽略数据库中的存储值，改用 i18n 实时翻译，节点标题随语言切换；
 *   2. 用户自定义名称（用户在配置面板里改过）
 *      → 原样显示，绝不翻译，尊重用户输入。
 *
 * 判定方式：为每种节点类型维护一份"历史默认标签白名单"（中英文全部列出），
 * label 命中白名单即判定为系统默认标签。
 *
 * ============ 维护须知 ============
 * 新增节点类型时，必须同时：
 *   1. 在 DEFAULT_LABEL_MAP 中登记该类型的默认标签（含各语言版本）；
 *   2. 确保语言包中存在 agent.node.{type} 翻译键。
 */

/**
 * 各节点类型的历史默认标签白名单
 *
 * 说明：同一节点类型在不同版本迭代中可能使用过不同的默认名
 * （例如 AI 对话节点历史上先后用过 'AI对话' 与 'LLM对话'），
 * 因此这里需要把所有历史值都列进来，否则老数据无法被识别为默认标签。
 */
const DEFAULT_LABEL_MAP = {
  // 开始节点
  start: ['开始', 'Start', 'START'],

  // AI 对话节点（历史默认名：AI对话 / LLM对话）
  llm: ['AI对话', 'LLM对话', 'LLM', 'AI Chat', 'LLM Chat', 'AI Dialogue'],

  // 知识检索节点（历史默认名：知识检索 / 知识库检索）
  knowledge: [
    '知识检索',
    '知识库检索',
    'Knowledge Retrieval',
    'Knowledge Search',
    'KNOWLEDGE'
  ],

  // 问题分类节点
  classifier: ['问题分类', 'Question Classifier', 'Classifier', 'CLASSIFIER'],

  // 结束节点
  end: ['结束', 'End', 'END']
}

/**
 * 判断给定标签是否为该节点类型的"系统默认标签"
 *
 * @param {string} label - 节点上存储的 label 值
 * @param {string} nodeType - 节点类型，如 'start' / 'llm' / 'knowledge'
 * @returns {boolean} true 表示是默认标签，可以安全地替换为 i18n 翻译文本
 */
export const isDefaultNodeLabel = (label, nodeType) => {
  // 空标签视为默认，交给 i18n 兜底显示
  if (!label) return true

  const whitelist = DEFAULT_LABEL_MAP[nodeType] || []
  const normalized = String(label).trim()

  // 命中白名单，或 label 直接等于节点类型本身（如存了 'llm' / 'LLM'）
  return (
    whitelist.includes(normalized) ||
    normalized.toLowerCase() === String(nodeType).toLowerCase()
  )
}

/**
 * 解析节点最终显示标签
 * 各节点组件渲染标题时统一调用本方法，而不是直接用 data.label
 *
 * @param {string} label - 节点上存储的 label 值
 * @param {string} nodeType - 节点类型
 * @param {Function} t - react-i18next 的翻译函数
 * @returns {string} 最终用于展示的标签文本
 */
export const resolveNodeLabel = (label, nodeType, t) => {
  if (isDefaultNodeLabel(label, nodeType)) {
    // 默认标签：走 i18n，随界面语言切换
    return t(`agent.node.${nodeType}`)
  }
  // 用户自定义标签：原样返回，不做任何翻译
  return label
}

/**
 * 获取某节点类型在当前语言下的默认标签
 * 用于新建节点时写入 flow_data 的初始 label 值
 *
 * @param {string} nodeType - 节点类型
 * @param {Function} t - react-i18next 的翻译函数
 * @returns {string} 默认标签文本
 */
export const getDefaultNodeLabel = (nodeType, t) => {
  return t(`agent.node.${nodeType}`, nodeType.toUpperCase())
}

export default {
  isDefaultNodeLabel,
  resolveNodeLabel,
  getDefaultNodeLabel
}
