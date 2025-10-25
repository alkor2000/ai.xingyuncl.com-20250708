/**
 * 标签选择器组件
 * 用于权限管理中选择用户标签
 * 支持：颜色显示、用户数统计、搜索过滤
 */

import React, { useState, useEffect } from 'react';
import { Select, Tag, Spin, Empty } from 'antd';
import { TagOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import api from '../../../utils/api';

const TagSelector = ({ 
  value, 
  onChange, 
  mode = 'single',  // 'single' | 'multiple'
  placeholder,
  disabled = false,
  groupId = null,   // 指定组织ID，为空则使用当前用户所在组
  style = {},
  allowClear = true
}) => {
  const { t } = useTranslation();
  
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(false);

  // 加载标签列表
  useEffect(() => {
    if (groupId || groupId === null) {
      fetchTags();
    }
  }, [groupId]);

  const fetchTags = async () => {
    setLoading(true);
    try {
      // 如果没有指定groupId，获取当前用户信息
      let targetGroupId = groupId;
      if (!targetGroupId) {
        const userResponse = await api.get('/auth/profile');
        targetGroupId = userResponse.data.data.group_id;
      }

      const response = await api.get(`/admin/user-tags/group/${targetGroupId}`);
      const data = response.data.data;
      setTags(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('获取标签列表失败:', error);
      setTags([]);
    } finally {
      setLoading(false);
    }
  };

  // 渲染标签选项
  const renderOption = (tag) => ({
    value: tag.id,
    label: (
      <div style={{ display: 'flex', alignItems: 'center', padding: '4px 0' }}>
        <Tag 
          color={tag.color || 'default'}
          style={{ 
            margin: 0, 
            marginRight: 8,
            flexShrink: 0,
            borderRadius: 4
          }}
        >
          <TagOutlined style={{ marginRight: 4 }} />
          {tag.name}
        </Tag>
        <div style={{ 
          fontSize: 12, 
          color: '#999',
          marginLeft: 'auto',
          flexShrink: 0
        }}>
          {tag.user_count || 0} {t('admin.users.users')}
        </div>
      </div>
    ),
    searchText: tag.name.toLowerCase()
  });

  const options = tags
    .filter(tag => tag.is_active !== false)
    .map(renderOption);

  return (
    <Select
      mode={mode === 'multiple' ? 'multiple' : undefined}
      value={value}
      onChange={onChange}
      placeholder={placeholder || t('teaching.selectTag')}
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
            description={t('teaching.noTagsFound')}
            style={{ padding: '20px' }}
          />
        )
      }
    />
  );
};

export default TagSelector;
