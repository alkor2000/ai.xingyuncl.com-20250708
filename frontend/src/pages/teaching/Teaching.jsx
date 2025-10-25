/**
 * 智能教学系统主页面（简化版）
 * 优化：删除Tab标签，直接显示模块列表
 */
import React from 'react';
import ModuleList from '../../components/teaching/ModuleList';

const Teaching = () => {
  return (
    <div style={{ height: '100%', background: '#f0f2f5' }}>
      <ModuleList />
    </div>
  );
};

export default Teaching;
