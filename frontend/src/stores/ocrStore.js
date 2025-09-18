/**
 * OCR状态管理
 */

import { create } from 'zustand';
import apiClient from '../utils/api';
import { message } from 'antd';

const useOcrStore = create((set, get) => ({
  // 状态
  config: null,
  tasks: [],
  currentTask: null,
  loading: false,
  uploading: false,
  
  // 获取OCR配置
  getConfig: async () => {
    try {
      const response = await apiClient.get('/ocr/config');
      if (response.data.success) {
        set({ config: response.data.data });
        return response.data.data;
      }
    } catch (error) {
      console.error('获取OCR配置失败:', error);
      message.error('获取配置失败');
    }
  },
  
  // 处理图片OCR
  processImage: async (file) => {
    set({ uploading: true });
    try {
      const formData = new FormData();
      formData.append('image', file);
      
      const response = await apiClient.post('/ocr/process-image', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      
      if (response.data.success) {
        message.success('识别成功');
        // 刷新任务列表
        await get().getTasks();
        return response.data.data;
      }
    } catch (error) {
      console.error('图片OCR失败:', error);
      const errorMsg = error.response?.data?.message || '识别失败';
      message.error(errorMsg);
      throw error;
    } finally {
      set({ uploading: false });
    }
  },
  
  // 处理PDF OCR
  processPDF: async (file) => {
    set({ uploading: true });
    try {
      const formData = new FormData();
      formData.append('pdf', file);
      
      const response = await apiClient.post('/ocr/process-pdf', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      
      if (response.data.success) {
        message.success('识别成功');
        // 刷新任务列表
        await get().getTasks();
        return response.data.data;
      }
    } catch (error) {
      console.error('PDF OCR失败:', error);
      const errorMsg = error.response?.data?.message || '识别失败';
      message.error(errorMsg);
      throw error;
    } finally {
      set({ uploading: false });
    }
  },
  
  // 批量处理
  processBatch: async (files) => {
    set({ uploading: true });
    try {
      const formData = new FormData();
      files.forEach(file => {
        formData.append('files', file);
      });
      
      const response = await apiClient.post('/ocr/process-batch', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      
      if (response.data.success) {
        const { success, failed } = response.data.data;
        message.success(`成功处理 ${success} 个文件，失败 ${failed} 个`);
        // 刷新任务列表
        await get().getTasks();
        return response.data.data;
      }
    } catch (error) {
      console.error('批量OCR失败:', error);
      message.error('批量处理失败');
      throw error;
    } finally {
      set({ uploading: false });
    }
  },
  
  // 获取任务列表
  getTasks: async (params = {}) => {
    set({ loading: true });
    try {
      const response = await apiClient.get('/ocr/tasks', { params });
      if (response.data.success) {
        set({ tasks: response.data.data });
        return response.data;
      }
    } catch (error) {
      console.error('获取任务列表失败:', error);
      message.error('获取任务列表失败');
    } finally {
      set({ loading: false });
    }
  },
  
  // 获取任务详情
  getTask: async (taskId) => {
    try {
      const response = await apiClient.get(`/ocr/task/${taskId}`);
      if (response.data.success) {
        set({ currentTask: response.data.data });
        return response.data.data;
      }
    } catch (error) {
      console.error('获取任务详情失败:', error);
      message.error('获取任务详情失败');
    }
  },
  
  // 清理状态
  reset: () => {
    set({
      config: null,
      tasks: [],
      currentTask: null,
      loading: false,
      uploading: false
    });
  }
}));

export default useOcrStore;
