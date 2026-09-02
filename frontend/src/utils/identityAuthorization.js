/**
 * PKU AI Lab Identity Center前端Authorization URL第二层校验。
 *
 * 后端负责真正生成OAuth参数，本工具只负责在浏览器跳转前进行防御性核验。
 *
 * 浏览器不能通过返回URL：
 * - 改client_id；
 * - 改redirect_uri；
 * - 改scope；
 * - 注入client_secret/code_verifier；
 * - 跳往其他Origin。
 */

const IDENTITY_ORIGIN =
  'https://id.pkuailab.com'

const IDENTITY_AUTHORIZE_PATH =
  '/oauth/authorize'

const IDENTITY_CLIENT_ID =
  'ai-platform-client'

const IDENTITY_BIND_REDIRECT_URI =
  'https://ai.xingyuncl.com/api/auth/identity/callback'

const REQUIRED_SCOPES = [
  'openid',
  'profile',
  'platform_link'
]

const ALLOWED_PARAMETERS =
  new Set([
    'response_type',
    'response_mode',
    'client_id',
    'redirect_uri',
    'scope',
    'state',
    'nonce',
    'code_challenge',
    'code_challenge_method'
  ])

const SINGLE_VALUE_PARAMETERS =
  [
    'response_type',
    'response_mode',
    'client_id',
    'redirect_uri',
    'scope',
    'state',
    'nonce',
    'code_challenge',
    'code_challenge_method'
  ]

const isOpaque43 = (
  value
) => (
  typeof value === 'string' &&
  /^[A-Za-z0-9_-]{43}$/
    .test(value)
)

const hasExactScopes = (
  value
) => {
  if (
    typeof value !== 'string'
  ) {
    return false
  }

  const scopes =
    value
      .trim()
      .split(/\s+/)

  if (
    scopes.length !==
      REQUIRED_SCOPES.length
  ) {
    return false
  }

  const unique =
    new Set(scopes)

  if (
    unique.size !==
      REQUIRED_SCOPES.length
  ) {
    return false
  }

  return REQUIRED_SCOPES.every(
    scope =>
      unique.has(scope)
  )
}

/**
 * 校验后返回规范URL字符串。
 * 任一协议字段异常都直接抛错，不进行跳转。
 */
export const validateIdentityAuthorizationURL = (
  rawURL
) => {
  if (
    typeof rawURL !== 'string' ||
    rawURL.length < 1 ||
    rawURL.length > 4096
  ) {
    throw new Error(
      'Identity authorization URL invalid'
    )
  }

  let parsed

  try {
    parsed =
      new URL(rawURL)
  } catch {
    throw new Error(
      'Identity authorization URL parse failed'
    )
  }

  if (
    parsed.origin !==
      IDENTITY_ORIGIN ||
    parsed.pathname !==
      IDENTITY_AUTHORIZE_PATH ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  ) {
    throw new Error(
      'Identity authorization target invalid'
    )
  }

  for (
    const key
    of parsed.searchParams.keys()
  ) {
    if (
      !ALLOWED_PARAMETERS.has(
        key
      )
    ) {
      throw new Error(
        'Identity authorization parameter invalid'
      )
    }
  }

  for (
    const key
    of SINGLE_VALUE_PARAMETERS
  ) {
    if (
      parsed.searchParams
        .getAll(key)
        .length !== 1
    ) {
      throw new Error(
        'Identity authorization parameter cardinality invalid'
      )
    }
  }

  if (
    parsed.searchParams.get(
      'response_type'
    ) !== 'code' ||
    parsed.searchParams.get(
      'response_mode'
    ) !== 'query' ||
    parsed.searchParams.get(
      'client_id'
    ) !== IDENTITY_CLIENT_ID ||
    parsed.searchParams.get(
      'redirect_uri'
    ) !==
      IDENTITY_BIND_REDIRECT_URI ||
    parsed.searchParams.get(
      'code_challenge_method'
    ) !== 'S256'
  ) {
    throw new Error(
      'Identity authorization contract mismatch'
    )
  }

  if (
    !hasExactScopes(
      parsed.searchParams.get(
        'scope'
      )
    )
  ) {
    throw new Error(
      'Identity authorization scopes invalid'
    )
  }

  for (
    const key
    of [
      'state',
      'nonce',
      'code_challenge'
    ]
  ) {
    if (
      !isOpaque43(
        parsed.searchParams.get(
          key
        )
      )
    ) {
      throw new Error(
        'Identity authorization security token invalid'
      )
    }
  }

  return parsed.toString()
}

export {
  IDENTITY_ORIGIN,
  IDENTITY_CLIENT_ID,
  IDENTITY_BIND_REDIRECT_URI
}
