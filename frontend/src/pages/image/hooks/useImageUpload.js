/**
 * 图片上传Hook
 */

import { useState, useCallback } from 'react';
import { message } from 'antd';
import { fileToBase64, validateImageFile } from '../utils/imageHelpers';
import { UPLOAD_CONFIG } from '../utils/constants';

export const useImageUpload = () => {
  const [referenceImages, setReferenceImages] = useState([]);
  const [uploadLoading, setUploadLoading] = useState(false);

  // 处理参考图片上传
  const handleReferenceUpload = useCallback(async ({ file, onSuccess, onError }) => {
    try {
      setUploadLoading(true);
      
      // 验证文件
      if (!validateImageFile(file)) {
        onError(new Error('Invalid file'));
        return false;
      }

      // 检查数量限制
      if (referenceImages.length >= UPLOAD_CONFIG.maxReferenceImages) {
        message.warning(`最多只能上传${UPLOAD_CONFIG.maxReferenceImages}张参考图片`);
        onError(new Error('Max files exceeded'));
        return false;
      }

      // 转换为base64
      const base64 = await fileToBase64(file);
      
      // 创建预览URL
      const previewUrl = URL.createObjectURL(file);
      
      // 添加到参考图片列表
      const newImage = {
        uid: file.uid,
        name: file.name,
        status: 'done',
        url: previewUrl,
        base64: base64,
        size: file.size
      };
      
      setReferenceImages(prev => [...prev, newImage]);
      onSuccess();
      
      return false; // 阻止默认上传
    } catch (error) {
      console.error('处理参考图片失败:', error);
      message.error('处理图片失败');
      onError(error);
      return false;
    } finally {
      setUploadLoading(false);
    }
  }, [referenceImages.length]);

  // 移除参考图片
  const handleRemoveReference = useCallback((uid) => {
    setReferenceImages(prev => {
      const removed = prev.find(img => img.uid === uid);
      if (removed && removed.url) {
        URL.revokeObjectURL(removed.url);
      }
      return prev.filter(img => img.uid !== uid);
    });
  }, []);

  // 清空所有参考图片
  const clearReferenceImages = useCallback(() => {
    // 释放所有URL
    referenceImages.forEach(img => {
      if (img.url) {
        URL.revokeObjectURL(img.url);
      }
    });
    setReferenceImages([]);
  }, [referenceImages]);

  return {
    referenceImages,
    uploadLoading,
    handleReferenceUpload,
    handleRemoveReference,
    clearReferenceImages
  };
};
