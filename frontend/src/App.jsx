import React, { useEffect } from 'react'
import { RouterProvider } from 'react-router-dom'
import { App as AntdApp } from 'antd'
import router from './routes'
import useAuthStore from './stores/authStore'

function App() {
  const { initAuth } = useAuthStore()

  useEffect(() => {
    // 初始化认证状态
    initAuth()
  }, [initAuth])

  return (
    <AntdApp>
      <RouterProvider router={router} />
    </AntdApp>
  )
}

export default App
