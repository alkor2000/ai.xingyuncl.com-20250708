/**
 * 学校学生一次性登录落地页（C05，默认关闭）。
 *
 * 安全原则与Identity回调页一致：
 * 1. URL只接受一次性handoff，不接受JWT、签名载荷或任何外部回跳地址；
 * 2. handoff读取后立即从地址栏清理，失败也清理；
 * 3. 本平台会话只由后端consume返回；
 * 4. 落地页面只从后端返回的entry在本地白名单里解析，URL上的entry一律忽略；
 * 5. 失败固定回/login?error=sso_invalid，不显示服务端细节。
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

import {
  getPortalCapabilityLandingPath
} from '../../utils/portalCapabilityEntry'

const ERROR_REDIRECT_DELAY_MS =
  2500

const CONSUME_PATH =
  '/auth/sso/consume'

const DEFAULT_LANDING =
  '/dashboard'

const HANDOFF_PATTERN =
  /^[A-Za-z0-9_-]{43}$/

/**
 * 一张handoff只能花一次，所以这里必须保证"每张票只发一次请求"。
 *
 * React 18在开发环境的StrictMode下会把effect跑两遍；即使在生产环境，
 * 任何一次重新挂载（路由重渲染、热更新、用户快速返回）都会再跑一次。
 * 第二次请求必然拿到handoff_invalid，把一次成功的登录显示成失败。
 * 用模块级Map按票据共享同一个Promise：两次挂载只有一次POST，结果相同。
 */
const attempts = new Map()

const spend = (
  handoff
) => {
  // 一个标签页只会落地一两次，这里只是防重复，不是缓存。
  if (attempts.size > 8) {
    attempts.clear()
  }

  if (!attempts.has(handoff)) {
    attempts.set(
      handoff,
      useAuthStore
        .getState()
        .loginWithStudentHandoff(
          handoff
        )
    )
  }

  return attempts.get(handoff)
}

/**
 * entry → 站内路径。
 *
 * 只认后端返回的稳定能力键，未知键回dashboard；
 * 任何以http、//或\开头的值都不是能力键，天然落不到这里。
 */
const landingPathOf = (
  entry
) => {
  if (
    entry === 'dashboard' ||
    !entry
  ) {
    return DEFAULT_LANDING
  }

  return (
    getPortalCapabilityLandingPath(
      entry
    ) || DEFAULT_LANDING
  )
}

const StudentEntryConsume = () => {
  const [searchParams] =
    useSearchParams()

  const navigate =
    useNavigate()

  const { t } =
    useTranslation()

  const [failed, setFailed] =
    useState(false)

  useEffect(() => {
    let redirectTimer = null
    let cancelled = false

    const consumeHandoff =
      async () => {
        const handoff =
          searchParams.get(
            'handoff'
          )

        // 无论成败，地址栏都不再保留handoff。
        window.history.replaceState(
          null,
          '',
          CONSUME_PATH
        )

        try {
          if (
            !handoff ||
            !HANDOFF_PATTERN.test(
              handoff
            )
          ) {
            throw new Error(
              'handoff_invalid'
            )
          }

          const result =
            await spend(handoff)

          if (cancelled) {
            return
          }

          navigate(
            landingPathOf(
              result?.entry
            ),
            {
              replace: true
            }
          )
        } catch (error) {
          console.error(
            '[StudentEntryConsume] handoff consume failed'
          )

          if (cancelled) {
            return
          }

          setFailed(true)

          redirectTimer =
            window.setTimeout(
              () => {
                navigate(
                  '/login?error=sso_invalid',
                  {
                    replace: true
                  }
                )
              },
              ERROR_REDIRECT_DELAY_MS
            )
        }
      }

    consumeHandoff()

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
          maxWidth: 420,
          textAlign: 'center'
        }}
      >
        {failed ? (
          <Alert
            type="error"
            showIcon
            message={t(
              'auth.studentEntry.failed',
              {
                defaultValue:
                  '学校账号登录未完成'
              }
            )}
            description={t(
              'auth.studentEntry.retry',
              {
                defaultValue:
                  '请回到作业页面重新点击进入，或使用原有登录方式。'
              }
            )}
          />
        ) : (
          <Spin
            size="large"
            tip={t(
              'auth.studentEntry.loading',
              {
                defaultValue:
                  '正在进入实践平台…'
              }
            )}
          >
            <div
              style={{
                height: 80
              }}
            />
          </Spin>
        )}
      </div>
    </div>
  )
}

export default StudentEntryConsume
