/**
 * 用户标签筛选组件
 */

import React, { useState, useEffect } from 'react';
import { Select, Tag } from 'antd';
import { TagsOutlined } from '@ant-design/icons';
import useTagStore from '../../../stores/tagStore';

const { Option } = Select;

const UserTagFilter = ({ groupId, onChange }) => {
  const [tags, setTags] = useState([]);
  const [selectedTags, setSelectedTags] = useState([]);
  const { getGroupTags } = useTagStore();

  useEffect(() => {
    if (groupId) {
      loadTags();
    }
  }, [groupId]);

  const loadTags = async () => {
    try {
      const data = await getGroupTags(groupId);
      setTags(data);
    } catch (error) {
      console.error('加载标签失败:', error);
    }
  };

  const handleChange = (values) => {
    setSelectedTags(values);
    onChange(values);
  };

  return (
    <Select
      mode="multiple"
      style={{ minWidth: 200 }}
      placeholder={
        <>
          <TagsOutlined /> 按标签筛选
        </>
      }
      value={selectedTags}
      onChange={handleChange}
      allowClear
    >
      {tags.map(tag => (
        <Option key={tag.id} value={tag.id}>
          <Tag color={tag.color}>{tag.name}</Tag>
        </Option>
      ))}
    </Select>
  );
};

export default UserTagFilter;
