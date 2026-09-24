/**
 * 学校学生一次性登录落地页（C05，默认关闭）。
 *
 * 安全原则与Identity回调页一致：
 * 1. URL只接受一次性handoff，不接受JWT、签名载荷或任何外部回跳地址；
 * 2. handoff读取后立即从地址栏清理，失败也清理；
 * 3. 本平台会话只由后端consume返回；
 * 4. 落地页面只从后端返回的entry在本地白名单里解析，URL上的entry一律忽略；
 * 5. 失败固定回/login?error=sso_invalid，不显示服务端细节。
 *
 * 这一页还多做一件事，只做这一件：把 edu 放在片段里的**作业上下文**接力给本站编辑器，
 * 让学生点一次就能带着本次作业进到做网页的地方，不必回 edu 点第二个入口。
 * 它只是浏览器内的转交，不进登录协议：
 * - 取值在清理地址栏**之前**，取完地址栏照旧清空（片段也没了）；
 * - 只认一个规范的 p09_task，重复/畸形/无关片段一律当没有；
 * - 只有后端 consume 成功、且**后端给的 entry 正是本站编辑器**时才交出去；
 * - 登录失败、落点不是编辑器、或者又来了一次新的登录，上一次的上下文立刻作废；
 * - 上下文不进登录请求、不写任何存储、不打日志、不放回地址栏，也不决定落点。
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
  useLocation,
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

import {
  beginSchoolLogin,
  carryTaskContext,
  readTaskContextFromHash
} from '../../utils/taskContextHandoff'

const ERROR_REDIRECT_DELAY_MS =
  2500

const CONSUME_PATH =
  '/auth/sso/consume'

const DEFAULT_LANDING =
  '/dashboard'

const HANDOFF_PATTERN =
  /^[A-Za-z0-9_-]{43}$/

// 唯一允许接力作业上下文的落点：本站网页编辑器。别的能力键一律不带。
const EDITOR_ENTRY =
  'ai-practice.html'

const EDITOR_PATH =
  '/html-editor'

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
 * 同一张票，只判定一次"这次到达能带哪个作业上下文"。
 *
 * 和上面那张票一样的道理：StrictMode 与任何一次重新挂载都会把 effect 再跑一遍，而判定本身是**消耗性**的
 * ——第一次跑就把寄存的那个取走了，第二次再跑只会看到空手，于是学生刚点进来的作业凭空消失。
 * 按票记住第一次的结果，两次挂载得到同一个答案。
 */
const arrivals = new Map()

const arrivalOf = (
  handoff,
  fromUrl
) => {
  if (arrivals.size > 8) {
    arrivals.clear()
  }

  if (!arrivals.has(handoff)) {
    arrivals.set(
      handoff,
      beginSchoolLogin(fromUrl)
    )
  }

  return arrivals.get(handoff)
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

  const location =
    useLocation()

  // 片段属于**这一次到达**，不属于这个组件。同一条路由不卸载也可能换一张票再来一次
  // （学生在同一个标签页里又从作业页点了一次），那时 effect 会带着新票重跑：
  // 记死第一次的片段，就会把上一次的作业按到新票上，或者把新票自己带来的那份弄丢。
  const arrivalHash =
    location.hash ||
    window.location.hash

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

        // 这一次到达带来的作业上下文：地址里还看得到就自己读，否则取应用启动时寄存的那个
        // （凭据不该在地址栏多留一刻，所以启动时就取走了）。同一次调用把别的残留一并清掉——
        // 上一次登录留给编辑器的作业，不能被这一次接着用。读要在清理地址栏之前。
        const carried =
          arrivalOf(
            handoff,
            readTaskContextFromHash(
              arrivalHash
            )
          )

        // 无论成败，地址栏都不再保留handoff（片段里的上下文同样不留）。
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

          const landing =
            landingPathOf(
              result?.entry
            )

          // 交接的前提有两条，缺一不可：后端说登录成功，而且**后端给的 entry** 正是编辑器。
          // 落点从来不看 URL 上的 entry/return_to，这里也一样。
          if (
            carried &&
            result?.entry ===
              EDITOR_ENTRY &&
            landing === EDITOR_PATH
          ) {
            carryTaskContext(
              carried
            )
          }

          navigate(landing, {
            replace: true
          })
        } catch (error) {
          // 登录没成：这次到达带来的那个已经在上面被取走、也没有再寄存回去，什么都不留下。
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
    navigate,
    arrivalHash
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
