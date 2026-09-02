/**
 * Identity Center进入AI平台具体能力的唯一语义入口。
 *
 * 浏览器收到的只有stable portal_capability。
 * 本页在AI平台内部把它翻译成真实landing，
 * 再进入既有Identity Login安全链。
 */

import React, {
  useEffect,
  useRef,
  useState
} from 'react'

import {
  Alert,
  Spin
} from 'antd'

import {
  useLocation
} from 'react-router-dom'

import {
  buildPortalCapabilityIdentityStartPath,
  readStandalonePortalCapability
} from '../../utils/portalCapabilityEntry'

const PortalCapabilityEntry = () => {
  const location =
    useLocation()

  const startedRef =
    useRef(false)

  const [
    error,
    setError
  ] = useState(false)

  useEffect(() => {
    if (startedRef.current) {
      return
    }

    const entryKey =
      readStandalonePortalCapability(
        location.search
      )

    if (!entryKey) {
      setError(true)
      return
    }

    try {
      const target =
        buildPortalCapabilityIdentityStartPath(
          entryKey
        )

      startedRef.current = true

      window.location.assign(
        target
      )
    } catch (startError) {
      console.error(
        '[PortalCapabilityEntry] start failed:',
        startError
      )

      setError(true)
    }
  }, [
    location.search
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
            message="教学能力入口无效"
            description="这个入口已经失效或尚未开放，请返回统一工作台重新选择。"
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
        正在进入对应的AI能力...
      </div>
    </div>
  )
}

export default PortalCapabilityEntry
