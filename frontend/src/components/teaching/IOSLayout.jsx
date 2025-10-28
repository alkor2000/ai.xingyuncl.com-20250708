/**
 * iOS风格统一布局组件
 * 提供统一的导航栏、面包屑和页面容器
 */

import React from 'react';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

// 导航栏组件
export const IOSNavBar = ({ 
  title, 
  onBack, 
  backText = '返回',
  actions = null,
  transparent = false 
}) => {
  const navigate = useNavigate();
  
  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      navigate(-1);
    }
  };
  
  return (
    <div className={`ios-nav-bar ${transparent ? 'transparent' : ''}`}>
      <button className="ios-nav-back-button" onClick={handleBack}>
        <ArrowLeftOutlined style={{ fontSize: 16 }} />
        <span>{backText}</span>
      </button>
      <div className="ios-nav-title">{title}</div>
      <div className="ios-nav-actions">{actions}</div>
    </div>
  );
};

// 面包屑组件
export const IOSBreadcrumb = ({ items = [] }) => {
  const navigate = useNavigate();
  
  return (
    <div className="ios-breadcrumb">
      {items.map((item, index) => (
        <React.Fragment key={index}>
          <span
            className={`ios-breadcrumb-item ${index === items.length - 1 ? 'active' : ''}`}
            onClick={() => item.path && index < items.length - 1 && navigate(item.path)}
          >
            {item.label}
          </span>
          {index < items.length - 1 && (
            <span className="ios-breadcrumb-separator">/</span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

// 页面容器组件
export const IOSPageContainer = ({ children, className = '' }) => {
  return (
    <div className={`ios-teaching-container ${className}`}>
      {children}
    </div>
  );
};

// 卡片组件
export const IOSCard = ({ 
  title, 
  children, 
  actions = null,
  className = '',
  hoverable = false 
}) => {
  return (
    <div className={`ios-card ${hoverable ? 'hoverable' : ''} ${className}`}>
      {title && (
        <div className="ios-card-header">
          <h3 className="ios-card-title">{title}</h3>
          {actions && <div className="ios-card-actions">{actions}</div>}
        </div>
      )}
      <div className="ios-card-body">
        {children}
      </div>
    </div>
  );
};

// 按钮组件
export const IOSButton = ({ 
  children, 
  variant = 'primary', 
  size = 'medium',
  icon = null,
  onClick,
  className = '',
  ...props 
}) => {
  const sizeClass = {
    small: 'ios-button-sm',
    medium: 'ios-button-md',
    large: 'ios-button-lg'
  }[size] || 'ios-button-md';
  
  return (
    <button
      className={`ios-button ios-button-${variant} ${sizeClass} ${className}`}
      onClick={onClick}
      {...props}
    >
      {icon && <span className="ios-button-icon">{icon}</span>}
      {children}
    </button>
  );
};

// 标签组件
export const IOSTag = ({ children, color = 'blue', icon = null }) => {
  return (
    <span className={`ios-tag ios-tag-${color}`}>
      {icon && <span className="ios-tag-icon">{icon}</span>}
      {children}
    </span>
  );
};

// 空状态组件
export const IOSEmpty = ({ 
  icon = null,
  text = '暂无数据',
  action = null 
}) => {
  return (
    <div className="ios-empty">
      {icon && <div className="ios-empty-icon">{icon}</div>}
      <div className="ios-empty-text">{text}</div>
      {action && <div className="ios-empty-action">{action}</div>}
    </div>
  );
};

// 加载组件
export const IOSLoading = ({ text = '加载中...' }) => {
  return (
    <div className="ios-loading">
      <div className="ios-spinner"></div>
      {text && <div style={{ marginTop: 16, color: '#666' }}>{text}</div>}
    </div>
  );
};
