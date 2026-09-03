/**
 * Portal首次连接：本地账号登录成功后的自动续接。
 *
 * 边界：
 * - 只在portalIdentityConnect已经验证过的Portal登录来源生效；
 * - 继续复用现有/auth/identity/connect/start；
 * - 不实现OAuth/OIDC/PKCE；
 * - 不保存任何账号ID、JWT、OAuth Code或Identity Token；
 * - 普通Profile账号关联仍走原有显式确认流程。
 */

import apiClient from './api'

import {
  validateIdentityAuthorizationURL
} from './identityAuthorization'

import {
  getPortalCapabilityLandingPath
} from './portalCapabilityEntry'

import {
  buildPortalConnectPostLoginTarget,
  getPortalConnectCapabilityFromProfileSearch
} from './portalIdentityConnect'

export const PORTAL_CONNECT_START_PATH =
  '/auth/identity/connect/start'

export const PORTAL_CONNECT_DEFAULT_BIND_RETURN_TO =
  '/dashboard'

/**
 * 根据已经验证过的Portal登录来源，生成唯一允许的自动续接请求。
 *
 * buildPortalConnectPostLoginTarget负责：
 * - 判断是否真的是Portal首次连接登录；
 * - 拒绝重复、污染、未知Query；
 * - 保留合法stable capability。
 *
 * 这里再把stable capability翻译成本平台自己的业务landing。
 */
export function buildPortalConnectPostLoginContinuation(
  location
) {
  const fallbackTarget =
    buildPortalConnectPostLoginTarget(
      location
    )

  if (!fallbackTarget) {
    return null
  }

  const queryIndex =
    fallbackTarget.indexOf('?')

  const search =
    queryIndex >= 0
      ? fallbackTarget.slice(
          queryIndex
        )
      : ''

  const capability =
    getPortalConnectCapabilityFromProfileSearch(
      search
    )

  const capabilityLanding =
    getPortalCapabilityLandingPath(
      capability
    )

  return {
    endpoint:
      PORTAL_CONNECT_START_PATH,

    fallbackTarget,

    body: {
      // 用户刚刚主动完成本地账号登录，
      // 该动作即为本次Portal First Link中的当前账号确认。
      confirm_current_account:
        true,

      return_to:
        capabilityLanding ||
        PORTAL_CONNECT_DEFAULT_BIND_RETURN_TO
    }
  }
}

/**
 * 真正续接现有Identity Account Link。
 *
 * 成功时进行顶层Authorization跳转；
 * 失败时不吞异常，而是把错误交给Login统一展示并回退到原Profile入口。
 */
export async function continuePortalConnectAfterLocalLogin(
  location
) {
  const continuation =
    buildPortalConnectPostLoginContinuation(
      location
    )

  if (!continuation) {
    return {
      handled: false,
      error: null,
      fallbackTarget: null
    }
  }

  try {
    const response =
      await apiClient.post(
        continuation.endpoint,
        continuation.body
      )

    const authorizationURL =
      response?.data?.data
        ?.authorizationUrl

    const safeURL =
      validateIdentityAuthorizationURL(
        authorizationURL
      )

    window.location.assign(
      safeURL
    )

    return {
      handled: true,
      error: null,
      fallbackTarget:
        continuation.fallbackTarget
    }
  } catch (error) {
    return {
      handled: true,
      error,
      fallbackTarget:
        continuation.fallbackTarget
    }
  }
}
