/**
 * 公文模板的段落角色：键与后端 docxEngine.ROLES 一致；文案走 t('chat.docTemplate.role.<key>')
 */
export const ROLE_KEYS = ['fixed', 'title', 'recipient', 'body', 'h1', 'h2', 'h3', 'attachment', 'signer', 'date', 'delete']
export const ROLE_COLORS = {
  fixed: '#8c8c8c', title: '#7c5cff', recipient: '#4c6ef5', body: '#2c7a5a', h1: '#0ca678', h2: '#12b886', h3: '#20c997',
  attachment: '#f28c28', signer: '#5f3dc4', date: '#b0540e', delete: '#fa5252'
}
/** 可当原型的角色（同一角色第一个块是原型，其余是示例） */
export const PROTO_ROLES = ['title', 'recipient', 'body', 'h1', 'h2', 'h3', 'attachment', 'signer', 'date']
export const LAST_TEMPLATE_KEY = 'chat_doc_template_last'
