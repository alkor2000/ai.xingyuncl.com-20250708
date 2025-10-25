/**
 * 组织选择器组件
 * 用于权限管理中选择组织
 * 支持：显示组织信息、成员数、积分池状态
 */

import React, { useState, useEffect } from 'react';
import { Select, Tag, Spin, Empty } from 'antd';
import { TeamOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import api from '../../../utils/api';

const GroupSelector = ({ 
  value, 
  onChange, 
  mode = 'single',  // 'single' | 'multiple'
  placeholder,
  disabled = false,
  style = {},
  allowClear = true
}) => {
  const { t } = useTranslation();
  
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);

  // 加载组织列表
  useEffect(() => {
    fetchGroups();
  }, []);

  const fetchGroups = async () => {
    setLoading(true);
    try {
      const response = await api.get('/admin/user-groups');
      const data = response.data.data;
      setGroups(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('获取组织列表失败:', error);
      setGroups([]);
    } finally {
      setLoading(false);
    }
  };

  // 渲染组织选项
  const renderOption = (group) => ({
    value: group.id,
    label: (
      <div style={{ display: 'flex', alignItems: 'center', padding: '4px 0' }}>
        <TeamOutlined 
          style={{ 
            fontSize: 16, 
            color: '#1890ff', 
            marginRight: 8,
            flexShrink: 0
          }} 
        />
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <div style={{ 
            fontWeight: 500, 
            fontSize: 14,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
            {group.name}
          </div>
          <div style={{ 
            fontSize: 12, 
            color: '#999',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
            {group.user_count || 0} {t('admin.users.members')} 
            {group.credits_pool !== null && ` · ${t('admin.credits.pool')}: ${group.credits_pool}`}
          </div>
        </div>
        {group.id === 1 && (
          <Tag color="default" style={{ margin: 0, fontSize: 11, flexShrink: 0 }}>
            {t('admin.users.defaultGroup')}
          </Tag>
        )}
      </div>
    ),
    searchText: group.name.toLowerCase()
  });

  const options = groups.map(renderOption);

  return (
    <Select
      mode={mode === 'multiple' ? 'multiple' : undefined}
      value={value}
      onChange={onChange}
      placeholder={placeholder || t('teaching.selectGroup')}
      disabled={disabled}
      loading={loading}
      allowClear={allowClear}
      showSearch
      filterOption={(input, option) => 
        option.searchText.includes(input.toLowerCase())
      }
      style={{ width: '100%', ...style }}
      options={options}
      notFoundContent={
        loading ? (
          <div style={{ textAlign: 'center', padding: '20px' }}>
            <Spin size="small" />
          </div>
        ) : (
          <Empty 
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t('teaching.noGroupsFound')}
            style={{ padding: '20px' }}
          />
        )
      }
    />
  );
};

export default GroupSelector;
