/**
 * AI应用与实践平台 Portal首次连接固定入口。
 *
 * 产品顺序固定：
 *
 *   Portal
 *   -> AI平台本地账号认证
 *   -> /profile统一身份Tab
 *   -> 既有Identity强认证
 *   -> 既有Backchannel Link
 *
 * 若Portal同时带入stable portal_capability：
 *
 *   Portal
 *   -> 本地账号认证
 *   -> Identity Link
 *   -> 对应AI能力工作区
 *
 * 本模块只处理站内产品导航，不实现任何Identity协议。
 *
 * 安全边界：
 * - 不接受任意return_to；
 * - 不接受完整URL；
 * - 不接受local_account_id/global_person_id；
 * - 只允许固定portal_connect和白名单portal_capability；
 * - 不允许额外或重复Query；
 * - 不保存JWT、OAuth Code、Token或账号ID；
 * - Identity真正Link仍只走既有后端能力。
 */

import {
  PORTAL_CAPABILITY_QUERY_KEY,
  isPortalCapabilityEntryKey
} from './portalCapabilityEntry'

export const PORTAL_CONNECT_QUERY_KEY =
  'portal_connect'

export const PORTAL_CONNECT_PROFILE_VALUE =
  'identity'

export const PORTAL_CONNECT_LOGIN_VALUE =
  'account'

export const PORTAL_CONNECT_PROFILE_ENTRY_PATH =
  '/profile?portal_connect=identity'

export const PORTAL_CONNECT_LOGIN_RECOVERY_PATH =
  '/login?portal_connect=account'

function readExactPortalConnectQuery(
  search,
  expectedValue
) {
  const params =
    new URLSearchParams(
      search || ''
    )

  const connectValues =
    params.getAll(
      PORTAL_CONNECT_QUERY_KEY
    )

  if (
    connectValues.length !== 1 ||
    connectValues[0] !== expectedValue
  ) {
    return null
  }

  const capabilityValues =
    params.getAll(
      PORTAL_CAPABILITY_QUERY_KEY
    )

  if (
    capabilityValues.length > 1
  ) {
    return null
  }

  let capability = null

  if (
    capabilityValues.length === 1
  ) {
    capability =
      capabilityValues[0]

    if (
      !isPortalCapabilityEntryKey(
        capability
      )
    ) {
      return null
    }
  }

  for (const key of params.keys()) {
    if (
      key !==
        PORTAL_CONNECT_QUERY_KEY &&
      key !==
        PORTAL_CAPABILITY_QUERY_KEY
    ) {
      return null
    }
  }

  return {
    capability
  }
}

export function isPortalConnectProfileSearch(
  search
) {
  return Boolean(
    readExactPortalConnectQuery(
      search,
      PORTAL_CONNECT_PROFILE_VALUE
    )
  )
}

export function isPortalConnectLoginSearch(
  search
) {
  return Boolean(
    readExactPortalConnectQuery(
      search,
      PORTAL_CONNECT_LOGIN_VALUE
    )
  )
}

export function getPortalConnectCapabilityFromProfileSearch(
  search
) {
  const result =
    readExactPortalConnectQuery(
      search,
      PORTAL_CONNECT_PROFILE_VALUE
    )

  return result?.capability || null
}

function getPortalConnectCapabilityFromLoginLocation(
  location
) {
  if (!location) {
    return null
  }

  if (
    location.pathname === '/login'
  ) {
    const direct =
      readExactPortalConnectQuery(
        location.search,
        PORTAL_CONNECT_LOGIN_VALUE
      )

    if (direct) {
      return direct.capability
    }
  }

  const from =
    location.state?.from

  if (
    from?.pathname === '/profile'
  ) {
    const indirect =
      readExactPortalConnectQuery(
        from.search || '',
        PORTAL_CONNECT_PROFILE_VALUE
      )

    if (
      indirect &&
      !(from.hash || '')
    ) {
      return indirect.capability
    }
  }

  return null
}

/**
 * 判断当前Login是否来自Portal首次连接。
 *
 * 两种合法来源：
 *
 * 1. ProtectedRoute把固定/profile Connect入口保存到state.from；
 * 2. 本地旧认证失效后，authStore进入固定/login恢复入口。
 */
export function isPortalConnectLoginLocation(
  location
) {
  if (!location) {
    return false
  }

  if (
    location.pathname === '/login' &&
    isPortalConnectLoginSearch(
      location.search
    ) &&
    !location.hash
  ) {
    return true
  }

  const from =
    location.state?.from

  return Boolean(
    from &&
    from.pathname === '/profile' &&
    isPortalConnectProfileSearch(
      from.search || ''
    ) &&
    !(from.hash || '')
  )
}

/**
 * Portal首次连接本地认证完成后的PublicRoute过渡保护。
 *
 * 本地认证成功会先建立isAuthenticated，
 * 随后Login才异步请求既有connect/start并跳往Identity。
 *
 * 如果PublicRoute此时按普通已登录规则恢复state.from，
 * 会先渲染/profile一帧，形成视觉闪屏。
 *
 * 这里只允许已经通过严格Portal Connect来源校验的Login保持挂载：
 * - 普通Login不受影响；
 * - 污染、重复、未知Query仍然fail closed；
 * - 不启动Identity协议；
 * - 不改变Profile失败回退。
 */
export function shouldHoldPortalConnectLoginRoute(
  location,
  isAuthenticated
) {
  return Boolean(
    isAuthenticated &&
    isPortalConnectLoginLocation(
      location
    )
  )
}

function buildPortalConnectPath(
  pathname,
  connectValue,
  capability
) {
  const params =
    new URLSearchParams()

  params.set(
    PORTAL_CONNECT_QUERY_KEY,
    connectValue
  )

  if (capability) {
    params.set(
      PORTAL_CAPABILITY_QUERY_KEY,
      capability
    )
  }

  return (
    pathname +
    '?' +
    params.toString()
  )
}

/**
 * Portal Connect本地登录成功后的唯一目标。
 *
 * capability存在时只保留stable entry_key，
 * 不在这里翻译成真实业务页面。
 */
export function buildPortalConnectPostLoginTarget(
  location
) {
  if (
    !isPortalConnectLoginLocation(
      location
    )
  ) {
    return null
  }

  const capability =
    getPortalConnectCapabilityFromLoginLocation(
      location
    )

  return buildPortalConnectPath(
    '/profile',
    PORTAL_CONNECT_PROFILE_VALUE,
    capability
  )
}

/**
 * 当当前浏览器正处于精确Portal Connect Profile入口时，
 * 本地JWT失效不得把用户丢回普通首页。
 */
export function getPortalConnectAuthFailureRedirect() {
  if (
    typeof window === 'undefined'
  ) {
    return '/'
  }

  if (
    window.location.pathname !==
      '/profile' ||
    window.location.hash !== ''
  ) {
    return '/'
  }

  const result =
    readExactPortalConnectQuery(
      window.location.search,
      PORTAL_CONNECT_PROFILE_VALUE
    )

  if (!result) {
    return '/'
  }

  return buildPortalConnectPath(
    '/login',
    PORTAL_CONNECT_LOGIN_VALUE,
    result.capability
  )
}
