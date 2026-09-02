/**
 * PKU AI Lab Identity Center登录回调页。
 *
 * 安全原则：
 * 1. URL只接受一次性handoff。
 * 2. 不接受Identity Access Token、ID Token或本平台JWT。
 * 3. handoff读取后立即从浏览器地址栏清理。
 * 4. 本地JWT只通过后端consume返回。
 * 5. 深链接只采用后端Handoff返回的可信returnTo。
 */

import React, {
  useEffect,
  useState
} from 'react'

import {
  Alert,
  Spin
} from 'antd'

import {
  useNavigate,
  useSearchParams
} from 'react-router-dom'

import {
  useTranslation
} from 'react-i18next'

import useAuthStore from '../../stores/authStore'

const ERROR_REDIRECT_DELAY_MS =
  2500

const DEFAULT_RETURN_TO =
  '/dashboard'

const normalizeReturnTo = (
  value
) => {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\')
  ) {
    return DEFAULT_RETURN_TO
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
      return DEFAULT_RETURN_TO
    }
  }

  return value
}

const IdentityCallback = () => {
  const [searchParams] =
    useSearchParams()

  const navigate =
    useNavigate()

  const { t } =
    useTranslation()

  const [error, setError] =
    useState(null)

  useEffect(() => {
    let redirectTimer = null
    let cancelled = false

    const consumeIdentityHandoff =
      async () => {
        try {
          const handoff =
            searchParams.get(
              'handoff'
            )

          if (
            !handoff ||
            !/^[A-Za-z0-9_-]{43}$/
              .test(handoff)
          ) {
            const callbackError =
              new Error(
                'Identity callback handoff invalid'
              )

            callbackError.code =
              'IDENTITY_HANDOFF_INVALID'

            throw callbackError
          }

          // handoff读取后立即从地址栏清除。
          window.history.replaceState(
            null,
            '',
            '/auth/identity/callback'
          )

          const result =
            await useAuthStore
              .getState()
              .loginWithIdentityHandoff(
                handoff
              )

          if (cancelled) {
            return
          }

          const returnTo =
            normalizeReturnTo(
              result?.returnTo
            )

          navigate(
            returnTo,
            {
              replace: true
            }
          )
        } catch (callbackError) {
          console.error(
            '[IdentityCallback] handoff consume failed:',
            callbackError
          )

          if (cancelled) {
            return
          }

          setError({
            code:
              callbackError?.code ||
              'IDENTITY_LOGIN_FAILED'
          })

          redirectTimer =
            window.setTimeout(
              () => {
                navigate(
                  '/login?identity_error=consume_failed',
                  {
                    replace: true
                  }
                )
              },
              ERROR_REDIRECT_DELAY_MS
            )
        }
      }

    consumeIdentityHandoff()

    return () => {
      cancelled = true

      if (redirectTimer) {
        window.clearTimeout(
          redirectTimer
        )
      }
    }
  }, [
    searchParams,
    navigate
  ])

  if (error) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: '#f5f7fb'
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 420
          }}
        >
          <Alert
            type="error"
            showIcon
            message={t(
              'auth.identity.loginFailed',
              {
                defaultValue:
                  '统一身份登录未完成'
              }
            )}
            description={t(
              'auth.identity.redirecting',
              {
                defaultValue:
                  '正在返回登录页，你也可以使用原有登录方式继续。'
              }
            )}
          />
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        background: '#f5f7fb'
      }}
    >
      <Spin size="large" />

      <div
        style={{
          color: '#666',
          fontSize: 14
        }}
      >
        {t(
          'auth.identity.loggingIn',
          {
            defaultValue:
              '正在完成统一身份登录...'
          }
        )}
      </div>
    </div>
  )
}

export default IdentityCallback
