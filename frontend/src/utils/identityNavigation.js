/**
 * PKU AI Lab统一身份前端站内导航工具。
 *
 * 安全原则：
 * - 只接受以单个 / 开头的本平台路径；
 * - 拒绝 // 协议相对地址；
 * - 拒绝反斜杠和控制字符；
 * - React Router来源不存在或异常时回退/dashboard。
 */

export const DEFAULT_IDENTITY_RETURN_TO =
  '/dashboard'

export const normalizeLocalReturnTo = (
  value,
  fallback = DEFAULT_IDENTITY_RETURN_TO
) => {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\')
  ) {
    return fallback
  }

  for (
    let index = 0;
    index < value.length;
    index++
  ) {
    const code =
      value.charCodeAt(index)

    if (
      code < 0x20 ||
      code === 0x7F
    ) {
      return fallback
    }
  }

  return value
}

/**
 * 从ProtectedRoute保存在location.state.from里的来源恢复站内深链接。
 */
export const buildReturnToFromLocation = (
  location
) => {
  const from =
    location?.state?.from

  if (
    !from?.pathname
  ) {
    return DEFAULT_IDENTITY_RETURN_TO
  }

  const candidate =
    `${from.pathname}` +
    `${from.search || ''}` +
    `${from.hash || ''}`

  return normalizeLocalReturnTo(
    candidate
  )
}
