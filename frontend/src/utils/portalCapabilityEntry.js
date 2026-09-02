/**
 * AI应用与实践平台 Portal Capability Adapter。
 *
 * Identity Center只允许知道稳定entry_key；
 * /chat、/image等真实页面路径始终由本平台自己维护。
 *
 * 产品边界：
 * - 不自动创建业务对象；
 * - 不自动选择最近对象；
 * - 不携带账号ID、JWT、OAuth参数或外部URL；
 * - capability只决定“进入哪个能力工作区”；
 * - 页面自己的权限、积分和业务规则继续保持原状。
 */

export const PORTAL_CAPABILITY_QUERY_KEY =
  'portal_capability'

export const PORTAL_CAPABILITY_ENTRY_PATH =
  '/portal-capability'

const PORTAL_CAPABILITY_LANDINGS =
  Object.freeze({
    'ai-practice.chat':
      '/chat',

    'ai-practice.image':
      '/image',

    'ai-practice.video':
      '/video',

    'ai-practice.agent':
      '/agent',

    'ai-practice.knowledge':
      '/knowledge',

    'ai-practice.html':
      '/html-editor',

    'ai-practice.mindmap':
      '/mindmap',

    'ai-practice.storage':
      '/storage'
  })

export const PORTAL_CAPABILITY_ENTRY_KEYS =
  Object.freeze(
    Object.keys(
      PORTAL_CAPABILITY_LANDINGS
    )
  )

export function isPortalCapabilityEntryKey(
  value
) {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(
      PORTAL_CAPABILITY_LANDINGS,
      value
    )
  )
}

export function getPortalCapabilityLandingPath(
  entryKey
) {
  if (
    !isPortalCapabilityEntryKey(
      entryKey
    )
  ) {
    return null
  }

  return PORTAL_CAPABILITY_LANDINGS[
    entryKey
  ]
}

/**
 * 读取只有portal_capability一个参数的独立能力入口。
 *
 * 重复参数、额外参数、未知能力全部拒绝。
 */
export function readStandalonePortalCapability(
  search
) {
  const params =
    new URLSearchParams(
      search || ''
    )

  const values =
    params.getAll(
      PORTAL_CAPABILITY_QUERY_KEY
    )

  if (
    values.length !== 1 ||
    !isPortalCapabilityEntryKey(
      values[0]
    )
  ) {
    return null
  }

  for (const key of params.keys()) {
    if (
      key !==
      PORTAL_CAPABILITY_QUERY_KEY
    ) {
      return null
    }
  }

  return values[0]
}

export function buildPortalCapabilityEntryPath(
  entryKey
) {
  if (
    !isPortalCapabilityEntryKey(
      entryKey
    )
  ) {
    throw new Error(
      'Portal Capability entry_key无效'
    )
  }

  return (
    PORTAL_CAPABILITY_ENTRY_PATH +
    '?' +
    PORTAL_CAPABILITY_QUERY_KEY +
    '=' +
    encodeURIComponent(
      entryKey
    )
  )
}

/**
 * 只生成本平台Identity login/start的站内return_to。
 *
 * entryKey先经过本平台固定白名单翻译成landing，
 * 因而调用方无法把任意URL或任意站内路径带入Identity Flow。
 */
export function buildPortalCapabilityIdentityStartPath(
  entryKey
) {
  const landing =
    getPortalCapabilityLandingPath(
      entryKey
    )

  if (!landing) {
    throw new Error(
      'Portal Capability landing不存在'
    )
  }

  return (
    '/api/auth/identity/login/start' +
    '?return_to=' +
    encodeURIComponent(
      landing
    )
  )
}
