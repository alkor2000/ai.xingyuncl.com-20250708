import React, { useState } from 'react'
import { Layout, Tooltip, Popover } from 'antd'
import * as Icons from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'

const { Sider } = Layout

const Sidebar = ({ menuItems, selectedKey, onMenuClick }) => {
  const navigate = useNavigate()
  const [popoverVisible, setPopoverVisible] = useState({})

  // 动态获取图标组件
  const getIcon = (iconName) => {
    const Icon = Icons[iconName]
    return Icon ? <Icon style={{ fontSize: '20px' }} /> : null
  }

  // 判断是否为当前选中项
  const isSelected = (key) => {
    return selectedKey === key
  }

  // 判断是否为当前选中项的父级
  const isParentSelected = (item) => {
    if (!item.children) return false
    return item.children.some(child => selectedKey === child.key)
  }

  // 渲染子菜单内容
  const renderSubMenu = (children) => {
    return (
      <div className="sidebar-submenu-content">
        {children.map(child => (
          <div
            key={child.key}
            className={`sidebar-submenu-item ${isSelected(child.key) ? 'active' : ''}`}
            onClick={() => {
              onMenuClick(child.key)
              setPopoverVisible({})
            }}
          >
            {child.label}
          </div>
        ))}
      </div>
    )
  }

  // 渲染菜单项
  const renderMenuItem = (item) => {
    const isActive = isSelected(item.key) || isParentSelected(item)
    
    // 如果有子菜单，使用Popover
    if (item.children && item.children.length > 0) {
      return (
        <Popover
          key={item.key}
          content={renderSubMenu(item.children)}
          title={item.label}
          placement="rightTop"
          trigger="click"
          open={popoverVisible[item.key]}
          onOpenChange={(visible) => {
            setPopoverVisible({ [item.key]: visible })
          }}
        >
          <div className={`sidebar-menu-item ${isActive ? 'active' : ''}`}>
            {item.icon && getIcon(item.icon)}
          </div>
        </Popover>
      )
    }

    // 普通菜单项使用Tooltip
    return (
      <Tooltip
        key={item.key}
        title={item.label}
        placement="right"
      >
        <div
          className={`sidebar-menu-item ${isActive ? 'active' : ''}`}
          onClick={() => onMenuClick(item.key)}
        >
          {item.icon && getIcon(item.icon)}
        </div>
      </Tooltip>
    )
  }

  return (
    <Sider 
      width={80} 
      className="basic-layout-sidebar"
      theme="light"
    >
      <div className="sidebar-menu-container">
        {menuItems.map(item => renderMenuItem(item))}
      </div>
    </Sider>
  )
}

export default Sidebar
