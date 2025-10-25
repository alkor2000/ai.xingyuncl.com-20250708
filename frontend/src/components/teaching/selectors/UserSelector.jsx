/**
 * 用户选择器组件
 * 用于权限管理中选择用户
 * 支持：搜索、分页、显示用户详细信息
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Select, Avatar, Tag, Spin, Empty } from 'antd';
import { UserOutlined, SearchOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import api from '../../../utils/api';
import debounce from 'lodash/debounce';

const UserSelector = ({ 
  value, 
  onChange, 
  mode = 'single',  // 'single' | 'multiple'
  placeholder,
  disabled = false,
  groupId = null,   // 限制只显示某个组的用户
  style = {},
  allowClear = true
}) => {
  const { t } = useTranslation();
  
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(1);

  // 加载用户列表
  const fetchUsers = useCallback(async (search = '', pageNum = 1, append = false) => {
    setLoading(true);
    try {
      const params = {
        page: pageNum,
        limit: 20,
        search: search.trim(),
        include_tags: false
      };
      
      if (groupId) {
        params.group_id = groupId;
      }

      const response = await api.get('/admin/users', { params });
      const data = response.data.data;
      
      const newUsers = data.users || [];
      
      if (append) {
        setUsers(prev => [...prev, ...newUsers]);
      } else {
        setUsers(newUsers);
      }
      
      setHasMore(data.pagination.page < data.pagination.pages);
    } catch (error) {
      console.error('获取用户列表失败:', error);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  // 初始加载
  useEffect(() => {
    fetchUsers('', 1, false);
  }, [fetchUsers]);

  // 搜索处理（防抖）
  const handleSearch = useCallback(
    debounce((value) => {
      setSearchValue(value);
      setPage(1);
      fetchUsers(value, 1, false);
    }, 500),
    [fetchUsers]
  );

  // 滚动加载更多
  const handlePopupScroll = (e) => {
    const { target } = e;
    if (
      target.scrollTop + target.offsetHeight === target.scrollHeight &&
      !loading &&
      hasMore
    ) {
      const nextPage = page + 1;
      setPage(nextPage);
      fetchUsers(searchValue, nextPage, true);
    }
  };

  // 渲染用户选项
  const renderOption = (user) => ({
    value: user.id,
    label: (
      <div style={{ display: 'flex', alignItems: 'center', padding: '4px 0' }}>
        <Avatar 
          size="small" 
          icon={<UserOutlined />}
          src={user.avatar}
          style={{ marginRight: 8, flexShrink: 0 }}
        />
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <div style={{ 
            fontWeight: 500, 
            fontSize: 14,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
            {user.real_name || user.username}
          </div>
          <div style={{ 
            fontSize: 12, 
            color: '#999',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
            {user.email}
          </div>
        </div>
        <div style={{ marginLeft: 8, flexShrink: 0 }}>
          <Tag 
            color={
              user.role === 'super_admin' ? 'red' :
              user.role === 'admin' ? 'blue' :
              'default'
            }
            style={{ margin: 0, fontSize: 11 }}
          >
            {user.role === 'super_admin' ? t('admin.superAdmin') :
             user.role === 'admin' ? t('admin.admin') :
             t('admin.user')}
          </Tag>
        </div>
      </div>
    ),
    searchText: `${user.username} ${user.real_name || ''} ${user.email}`.toLowerCase()
  });

  const options = users.map(renderOption);

  return (
    <Select
      mode={mode === 'multiple' ? 'multiple' : undefined}
      value={value}
      onChange={onChange}
      placeholder={placeholder || t('teaching.selectUser')}
      disabled={disabled}
      loading={loading}
      allowClear={allowClear}
      showSearch
      filterOption={false}
      onSearch={handleSearch}
      onPopupScroll={handlePopupScroll}
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
            description={t('teaching.noUsersFound')}
            style={{ padding: '20px' }}
          />
        )
      }
      dropdownRender={(menu) => (
        <>
          {menu}
          {loading && hasMore && (
            <div style={{ textAlign: 'center', padding: '8px' }}>
              <Spin size="small" />
            </div>
          )}
        </>
      )}
    />
  );
};

export default UserSelector;
