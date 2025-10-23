/**
 * 智能教学系统主页面
 */

import React from 'react';
import { Tabs } from 'antd';
import { useTranslation } from 'react-i18next';
import { FileTextOutlined, BookOutlined } from '@ant-design/icons';
import ModuleList from '../../components/teaching/ModuleList';

const Teaching = () => {
  const { t } = useTranslation();
  
  const items = [
    {
      key: 'modules',
      label: (
        <span>
          <FileTextOutlined />
          {t('teaching.myModules')}
        </span>
      ),
      children: <ModuleList />
    }
  ];
  
  return (
    <div style={{ height: '100%', background: '#f0f2f5' }}>
      <Tabs 
        items={items} 
        style={{ padding: '0 24px' }}
        defaultActiveKey="modules"
      />
    </div>
  );
};

export default Teaching;
