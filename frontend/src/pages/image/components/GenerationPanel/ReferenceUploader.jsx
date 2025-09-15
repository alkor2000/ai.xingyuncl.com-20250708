/**
 * 参考图片上传组件
 * 支持图生图功能的模型使用
 */

import React, { useState } from 'react';
import { Upload, message, Spin, Card, Button, Space, Tooltip } from 'antd';
import { PlusOutlined, DeleteOutlined, EyeOutlined, CloudUploadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import api from '../../../../utils/api';
import './ReferenceUploader.less';

const ReferenceUploader = ({ 
  referenceImages = [], 
  onUpload, 
  onRemove,
  maxCount = 2,
  modelConfig = {}
}) => {
  const { t } = useTranslation();
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);

  // 处理文件上传
  const handleUpload = async (file) => {
    try {
      // 验证文件类型
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
      if (!allowedTypes.includes(file.type)) {
        message.error(t('image.invalidFileType', '请上传JPG、PNG或WebP格式的图片'));
        return false;
      }

      // 验证文件大小（10MB）
      if (file.size > 10 * 1024 * 1024) {
        message.error(t('image.fileTooLarge', '图片大小不能超过10MB'));
        return false;
      }

      // 检查数量限制
      if (referenceImages.length >= maxCount) {
        message.error(t('image.maxImagesReached', '最多只能上传{{count}}张参考图片', { count: maxCount }));
        return false;
      }

      setUploading(true);

      // 创建FormData
      const formData = new FormData();
      formData.append('image', file);

      // 上传到服务器
      const response = await api.post('/image/upload-reference', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      if (response.data.success) {
        const uploadedImage = {
          uid: file.uid,
          name: file.name,
          status: 'done',
          url: response.data.data.url,  // 服务器返回的URL
          ossKey: response.data.data.ossKey,
          size: file.size,
          type: file.type
        };

        // 调用父组件的上传回调
        if (onUpload) {
          onUpload(uploadedImage);
        }

        message.success(t('image.uploadSuccess', '图片上传成功'));
      } else {
        throw new Error(response.data.message || '上传失败');
      }

      return false; // 阻止默认上传行为
    } catch (error) {
      console.error('上传参考图片失败:', error);
      message.error(error.message || t('image.uploadFailed', '图片上传失败'));
      return false;
    } finally {
      setUploading(false);
    }
  };

  // 处理图片预览
  const handlePreview = (image) => {
    setPreviewUrl(image.url);
  };

  // 关闭预览
  const handleClosePreview = () => {
    setPreviewUrl(null);
  };

  // 自定义上传列表项
  const uploadButton = (
    <div className="upload-button">
      {uploading ? <Spin /> : <PlusOutlined />}
      <div className="upload-text">
        {uploading 
          ? t('image.uploading', '上传中...') 
          : t('image.uploadReference', '上传参考图')}
      </div>
    </div>
  );

  return (
    <Card 
      title={
        <Space>
          <CloudUploadOutlined />
          <span>{t('image.referenceImages', '参考图片')}</span>
          <Tooltip title={t('image.referenceImagesTip', '上传参考图片进行图生图')}>
            <span className="info-icon">❓</span>
          </Tooltip>
        </Space>
      }
      className="reference-uploader"
      size="small"
    >
      <div className="upload-container">
        <Upload
          listType="picture-card"
          fileList={referenceImages}
          beforeUpload={handleUpload}
          onRemove={(file) => onRemove && onRemove(file.uid)}
          onPreview={handlePreview}
          accept="image/jpeg,image/jpg,image/png,image/webp"
          maxCount={maxCount}
          disabled={uploading}
        >
          {referenceImages.length < maxCount && uploadButton}
        </Upload>

        {referenceImages.length > 0 && (
          <div className="upload-tips">
            <p>{t('image.uploadedCount', '已上传 {{current}}/{{max}} 张', {
              current: referenceImages.length,
              max: maxCount
            })}</p>
            {modelConfig.sequential_image_generation && (
              <p className="sequential-tip">
                {t('image.sequentialTip', '支持连续图像生成，将按顺序使用参考图')}
              </p>
            )}
          </div>
        )}
      </div>

      {/* 图片预览Modal */}
      {previewUrl && (
        <div className="image-preview-modal" onClick={handleClosePreview}>
          <img src={previewUrl} alt="Preview" />
          <Button 
            className="close-button" 
            icon={<DeleteOutlined />} 
            onClick={handleClosePreview}
          />
        </div>
      )}
    </Card>
  );
};

export default ReferenceUploader;
