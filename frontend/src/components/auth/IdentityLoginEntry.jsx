/**
 * PKU AI Lab统一身份登录入口。
 *
 * 本组件只负责：
 * 1. 展示统一身份登录入口；
 * 2. 从React Router恢复当前站内return_to；
 * 3. 跳转当前平台自己的后端Identity start端点；
 * 4. 展示callback失败后的普通用户提示。
 *
 * 浏览器绝不自行拼装Identity OAuth参数。
 */

import React, {
  useState
} from 'react'

import {
  Button,
  Divider,
  message,
  Typography
} from 'antd'

import {
  SafetyOutlined
} from '@ant-design/icons'

import {
  useLocation,
  useSearchParams
} from 'react-router-dom'

import {
  useTranslation
} from 'react-i18next'

import {
  buildReturnToFromLocation
} from '../../utils/identityNavigation'

const {
  Text
} = Typography

const IdentityLoginEntry = () => {
  const {
    t
  } = useTranslation()

  const location =
    useLocation()

  const [
    searchParams
  ] = useSearchParams()

  const [
    identityLoading,
    setIdentityLoading
  ] = useState(false)

  const identityError =
    searchParams.get(
      'identity_error'
    )

  const handleIdentityLogin = () => {
    try {
      setIdentityLoading(
        true
      )

      const returnTo =
        buildReturnToFromLocation(
          location
        )

      /**
       * 浏览器只进入本平台固定start端点。
       *
       * client_id、redirect_uri、state、nonce和PKCE
       * 全部由后端生成。
       */
      window.location.assign(
        '/api/auth/identity/login/start' +
        `?return_to=${encodeURIComponent(returnTo)}`
      )
    } catch (error) {
      console.error(
        'Identity login start failed:',
        error
      )

      setIdentityLoading(
        false
      )

      message.error(
        t(
          'auth.identity.loginFailed',
          {
            defaultValue:
              '统一身份登录暂时不可用，请使用原有登录方式。'
          }
        )
      )
    }
  }

  return (
    <>
      <Divider
        plain
        style={{
          margin:
            '8px 0 16px'
        }}
      >
        <Text
          type="secondary"
          style={{
            fontSize:
              '13px'
          }}
        >
          {t(
            'auth.identity.or',
            {
              defaultValue:
                '或'
            }
          )}
        </Text>
      </Divider>

      {identityError && (
        <div
          style={{
            marginBottom:
              '12px',
            padding:
              '10px 12px',
            borderRadius:
              '10px',
            background:
              '#fff2f0',
            color:
              '#cf1322',
            fontSize:
              '13px',
            lineHeight:
              1.5
          }}
        >
          {t(
            'auth.identity.loginFailed',
            {
              defaultValue:
                '统一身份登录未完成，请重试或使用原有登录方式。'
            }
          )}
        </div>
      )}

      <Button
        block
        loading={
          identityLoading
        }
        onClick={
          handleIdentityLogin
        }
        icon={
          <SafetyOutlined />
        }
        style={{
          height:
            '46px',
          borderRadius:
            '12px',
          fontSize:
            '16px',
          fontWeight:
            600,
          borderColor:
            '#1677ff',
          color:
            '#1677ff',
          background:
            '#ffffff'
        }}
      >
        {t(
          'auth.identity.login',
          {
            defaultValue:
              '统一身份登录'
          }
        )}
      </Button>

      <Text
        type="secondary"
        style={{
          display:
            'block',
          textAlign:
            'center',
          marginTop:
            '8px',
          fontSize:
            '12px'
        }}
      >
        {t(
          'auth.identity.loginHint',
          {
            defaultValue:
              '使用 PKU AI Lab 统一身份中心进入当前平台'
          }
        )}
      </Text>
    </>
  )
}

export default IdentityLoginEntry
