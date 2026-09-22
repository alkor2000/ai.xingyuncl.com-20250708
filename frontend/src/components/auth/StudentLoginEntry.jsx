/**
 * 学校学生登录入口（C05，默认关闭）。
 *
 * 本组件只负责：
 * 1. 向本平台后端问一句"这个入口开了吗"；
 * 2. 开了才显示按钮，没开时什么都不渲染、不发第二次请求；
 * 3. 点击后跳到后端配置的固定launch地址，不带任何来源参数、账号或回跳地址。
 *
 * 浏览器不拼装任何SSO参数，也不知道学校映射、密钥或积分策略。
 */

import React, {
  useEffect,
  useState
} from 'react'

import {
  Button,
  Divider,
  Typography
} from 'antd'

import {
  TeamOutlined
} from '@ant-design/icons'

import {
  useSearchParams
} from 'react-router-dom'

import {
  useTranslation
} from 'react-i18next'

import apiClient from '../../utils/api'

const {
  Text
} = Typography

const StudentLoginEntry = () => {
  const {
    t
  } = useTranslation()

  const [
    searchParams
  ] = useSearchParams()

  const [
    launchUrl,
    setLaunchUrl
  ] = useState(null)

  const entryError =
    searchParams.get('error') ===
    'sso_invalid'

  useEffect(() => {
    let cancelled = false

    apiClient
      .get('/auth/sso/capability')
      .then(response => {
        const data =
          response.data?.data ||
          response.data

        if (
          cancelled ||
          !data?.available ||
          typeof data.launch_url !==
            'string' ||
          !data.launch_url.startsWith(
            'https://'
          )
        ) {
          return
        }

        setLaunchUrl(
          data.launch_url
        )
      })
      .catch(() => {
        // 入口关闭或后端暂不可用时保持安静：登录页与开关打开前完全一致。
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (!launchUrl) {
    return null
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

      {entryError && (
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
            'auth.studentEntry.failed',
            {
              defaultValue:
                '学校账号登录未完成，请回到作业页面重新进入。'
            }
          )}
        </div>
      )}

      <Button
        block
        href={launchUrl}
        icon={
          <TeamOutlined />
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
          'auth.studentEntry.login',
          {
            defaultValue:
              '学校学生登录'
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
          'auth.studentEntry.hint',
          {
            defaultValue:
              '使用学校账号从作业页面进入本平台'
          }
        )}
      </Text>
    </>
  )
}

export default StudentLoginEntry
