/**
 * 选择组织弹窗组件
 * 用于添加新的授权组织
 * 
 * @module components/GroupSelectModal
 */

import React, { useMemo } from 'react';
import { Modal, Checkbox, Card, Space, Tag, Empty, Input } from 'antd';
import { TeamOutlined, SearchOutlined } from '@ant-design/icons';
import { EMPTY_MESSAGES, TAG_TEXTS } from '../constants';

const { Search } = Input;

/**
 * 组织选择弹窗组件属性
 * @typedef {Object} GroupSelectModalProps
 * @property {boolean} visible - 是否显示
 * @property {Array} allGroups - 所有组织列表
 * @property {Array} selectedGroups - 已选组织ID列表
 * @property {Function} onSelectedChange - 选择变化回调
 * @property {Function} onOk - 确认回调
 * @property {Function} onCancel - 取消回调
 */

/**
 * 组织选择弹窗组件
 */
const GroupSelectModal = React.memo(({
  visible,
  allGroups,
  selectedGroups,
  onSelectedChange,
  onOk,
  onCancel
}) => {
  const [searchText, setSearchText] = React.useState('');

  // 过滤后的组织列表
  const filteredGroups = useMemo(() => {
    if (!searchText) return allGroups;
    
    const lowerSearch = searchText.toLowerCase();
    return allGroups.filter(group =>
      group.name?.toLowerCase().includes(lowerSearch)
    );
  }, [allGroups, searchText]);

  // 重置搜索
  const handleModalClose = () => {
    setSearchText('');
    onCancel();
  };

  return (
    <Modal
      title="选择要授权的用户组"
      open={visible}
      onOk={onOk}
      onCancel={handleModalClose}
      width={600}
      okText={`确认添加 (${selectedGroups.length})`}
      cancelText="取消"
      okButtonProps={{
        disabled: selectedGroups.length === 0
      }}
    >
      {/* 搜索框 */}
      <Search
        placeholder="搜索用户组..."
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        style={{ marginBottom: 16 }}
        allowClear
        prefix={<SearchOutlined />}
      />

      {/* 组织列表 */}
      {filteredGroups.length === 0 ? (
        <Empty
          description={
            searchText
              ? `未找到匹配"${searchText}"的用户组`
              : EMPTY_MESSAGES.NO_GROUPS_AVAILABLE
          }
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      ) : (
        <Checkbox.Group
          value={selectedGroups}
          onChange={onSelectedChange}
          style={{ width: '100%' }}
        >
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            {filteredGroups.map(group => (
              <Card
                key={group.id}
                size="small"
                hoverable
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  // 点击卡片切换选中状态
                  const isSelected = selectedGroups.includes(group.id);
                  const newSelected = isSelected
                    ? selectedGroups.filter(id => id !== group.id)
                    : [...selectedGroups, group.id];
                  onSelectedChange(newSelected);
                }}
              >
                <Checkbox
                  value={group.id}
                  style={{ width: '100%' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                    <Space>
                      <TeamOutlined style={{ color: '#1890ff' }} />
                      <strong>{group.name}</strong>
                      {group.id === 1 && (
                        <Tag color="default" style={{ fontSize: 11 }}>
                          {TAG_TEXTS.DEFAULT_GROUP}
                        </Tag>
                      )}
                    </Space>
                    <Tag>{group.user_count || 0} 人</Tag>
                  </Space>
                </Checkbox>
              </Card>
            ))}
          </Space>
        </Checkbox.Group>
      )}
    </Modal>
  );
});

GroupSelectModal.displayName = 'GroupSelectModal';

export default GroupSelectModal;
