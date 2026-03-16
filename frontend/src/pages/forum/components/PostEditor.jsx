/**
 * 帖子编辑器组件 v2.1
 * 
 * 修复：removeImage/removeFile 调用后端 API 删除附件（数据库+磁盘）
 * 
 * @module pages/forum/components/PostEditor
 */

import React, { useState } from 'react';
import { Typography, Input, Select, Button, Space, Upload, message, Card } from 'antd';
import { ArrowLeftOutlined, PictureOutlined, PaperClipOutlined, SendOutlined, DeleteOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import useForumStore from '../../../stores/forumStore';

const { Title, Text } = Typography;
const { TextArea } = Input;

const PostEditor = ({ boards, defaultBoardId, editPost, onBack, onSuccess }) => {
  const { t } = useTranslation();
  const { createPost, updatePost, uploadImages, uploadFiles, deleteAttachment } = useForumStore();

  const isEditing = !!editPost;
  const [title, setTitle] = useState(editPost?.title || '');
  const [content, setContent] = useState(editPost?.content || '');
  const [boardId, setBoardId] = useState(defaultBoardId || editPost?.board_id || null);
  const [attachmentIds, setAttachmentIds] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [fileUploading, setFileUploading] = useState(false);
  const [uploadedImages, setUploadedImages] = useState([]);
  const [uploadedFiles, setUploadedFiles] = useState([]);

  /* 图片上传 */
  const handleImageUpload = async (info) => {
    const files = info.fileList.filter(f => f.status !== 'done' && f.originFileObj).map(f => f.originFileObj);
    if (files.length === 0) return;
    setImageUploading(true);
    try {
      const result = await uploadImages(files);
      const newImages = result.map(att => ({ id: att.id, name: att.file_name, path: att.file_path, url: `/uploads/${att.file_path}` }));
      setUploadedImages(prev => [...prev, ...newImages]);
      setAttachmentIds(prev => [...prev, ...result.map(a => a.id)]);
    } catch (e) { /* store处理 */ }
    setImageUploading(false);
  };

  /* 文件上传 */
  const handleFileUpload = async (info) => {
    const files = info.fileList.filter(f => f.status !== 'done' && f.originFileObj).map(f => f.originFileObj);
    if (files.length === 0) return;
    setFileUploading(true);
    try {
      const result = await uploadFiles(files);
      const newFiles = result.map(att => ({ id: att.id, name: att.file_name, size: att.file_size }));
      setUploadedFiles(prev => [...prev, ...newFiles]);
      setAttachmentIds(prev => [...prev, ...result.map(a => a.id)]);
    } catch (e) { /* store处理 */ }
    setFileUploading(false);
  };

  /**
   * v2.1 删除已上传图片 - 调用后端API删除数据库记录+磁盘文件
   */
  const removeImage = async (imgId) => {
    try {
      await deleteAttachment(imgId);
      setUploadedImages(prev => prev.filter(img => img.id !== imgId));
      setAttachmentIds(prev => prev.filter(id => id !== imgId));
    } catch (e) { /* store已处理提示 */ }
  };

  /**
   * v2.1 删除已上传文件 - 调用后端API
   */
  const removeFile = async (fileId) => {
    try {
      await deleteAttachment(fileId);
      setUploadedFiles(prev => prev.filter(f => f.id !== fileId));
      setAttachmentIds(prev => prev.filter(id => id !== fileId));
    } catch (e) { /* store已处理提示 */ }
  };

  /* 提交 */
  const handleSubmit = async () => {
    if (!title.trim()) return message.warning(t('forum.post.form.titleRequired'));
    if (!content.trim()) return message.warning(t('forum.post.form.contentRequired'));
    if (!isEditing && !boardId) return message.warning(t('forum.post.form.boardRequired'));

    setSubmitting(true);
    try {
      let result;
      if (isEditing) {
        result = await updatePost(editPost.id, { title: title.trim(), content: content.trim() });
      } else {
        result = await createPost({ title: title.trim(), content: content.trim(), board_id: boardId, attachment_ids: attachmentIds });
      }
      onSuccess(result);
    } catch (e) { /* store处理 */ }
    setSubmitting(false);
  };

  return (
    <div className="post-editor">
      <div className="editor-header">
        <Button icon={<ArrowLeftOutlined />} type="text" onClick={onBack} />
        <Title level={4} style={{ margin: 0 }}>{isEditing ? t('forum.post.edit') : t('forum.post.new')}</Title>
      </div>

      <Card className="editor-card">
        {/* 版块选择 */}
        {!isEditing && (
          <div className="editor-field">
            <Text strong>{t('forum.post.form.boardLabel')}</Text>
            <Select value={boardId} onChange={setBoardId} placeholder={t('forum.post.form.boardRequired')} style={{ width: '100%', marginTop: 8 }}
              options={boards.filter(b => b.is_active).map(b => ({ label: b.name, value: b.id }))} />
          </div>
        )}

        {/* 标题 */}
        <div className="editor-field">
          <Text strong>{t('forum.post.form.titleLabel')}</Text>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('forum.post.form.titlePlaceholder')} maxLength={200} showCount style={{ marginTop: 8 }} />
        </div>

        {/* 内容 */}
        <div className="editor-field">
          <Text strong>{t('forum.post.form.contentLabel')}</Text>
          <TextArea value={content} onChange={(e) => setContent(e.target.value)} placeholder={t('forum.post.form.contentPlaceholder')} autoSize={{ minRows: 10, maxRows: 30 }} maxLength={50000} showCount style={{ marginTop: 8 }} />
        </div>

        {/* 附件上传 */}
        {!isEditing && (
          <div className="editor-field">
            <Text strong>{t('forum.post.form.attachments')}</Text>
            <Space style={{ marginTop: 8 }}>
              <Upload multiple beforeUpload={() => false} onChange={handleImageUpload} showUploadList={false} accept="image/*">
                <Button icon={<PictureOutlined />} loading={imageUploading}>{t('forum.post.form.uploadImage')}</Button>
              </Upload>
              <Upload multiple beforeUpload={() => false} onChange={handleFileUpload} showUploadList={false}>
                <Button icon={<PaperClipOutlined />} loading={fileUploading}>{t('forum.post.form.uploadFile')}</Button>
              </Upload>
            </Space>

            {/* 已上传图片预览 - v2.1 点×调用后端删除 */}
            {uploadedImages.length > 0 && (
              <div className="uploaded-preview" style={{ marginTop: 12 }}>
                {uploadedImages.map(img => (
                  <div key={img.id} className="preview-item">
                    <img src={img.url} alt={img.name} />
                    <span className="preview-remove" onClick={() => removeImage(img.id)}><DeleteOutlined /></span>
                  </div>
                ))}
              </div>
            )}

            {/* 已上传文件列表 - v2.1 支持删除 */}
            {uploadedFiles.length > 0 && (
              <div style={{ marginTop: 8 }}>
                {uploadedFiles.map(f => (
                  <div key={f.id} style={{ fontSize: 12, color: '#666', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span>📎 {f.name} ({Math.round(f.size / 1024)}KB)</span>
                    <CloseCircleOutlined style={{ color: '#ff4d4f', cursor: 'pointer', fontSize: 14 }} onClick={() => removeFile(f.id)} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 提交按钮 */}
        <div className="editor-actions">
          <Button onClick={onBack}>{t('forum.post.form.cancel')}</Button>
          <Button type="primary" icon={<SendOutlined />} onClick={handleSubmit} loading={submitting}>{t('forum.post.form.submit')}</Button>
        </div>
      </Card>
    </div>
  );
};

export default PostEditor;
