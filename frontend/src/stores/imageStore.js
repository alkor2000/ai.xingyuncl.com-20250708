/**
 * 图像生成状态管理
 *
 * v1.1 新增 keyword 关键词搜索能力
 *   - 新增 keyword state 和 setKeyword action
 *   - keyword 仅作为状态存储，由页面层在调用 getUserHistory/getPublicGallery 时传入参数
 *   - 行为完全向后兼容
 *
 * v1.2 国际化：
 *   本文件为非React模块（Zustand store），无法使用useTranslation hook，
 *   改为直接import i18n实例调用i18n.t()。
 *   全部console日志属开发者诊断信息，统一改英文不进语言包；
 *   message.*用户可见文案改i18n.t()，优先复用image.json已有键（如generateFailed/deleteSuccess/deleteFailed）
 *   与common.json通用键（message.error/message.success），无匹配项新建20个store专属键
 */

import { create } from 'zustand';
import api from '../utils/api';
import { message } from 'antd';
import i18n from '../utils/i18n';

const useImageStore = create((set, get) => ({
  // ========== 状态 ==========
  models: [],
  selectedModel: null,
  generating: false,
  generationProgress: null,
  generationHistory: [],
  historyPagination: {
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0
  },
  publicGallery: [],
  galleryPagination: {
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0
  },
  userStats: null,
  loading: false,
  
  // v1.1 关键词搜索状态（页面切换Tab时保留）
  keyword: '',
  
  // Midjourney相关状态
  midjourneyTasks: [], // 进行中的Midjourney任务
  pollingTimers: {}, // 轮询定时器
  processingTasks: {}, // 正在处理的任务状态

  // v1.1 设置关键词（仅更新状态，不触发查询，由页面决定何时查询）
  setKeyword: (keyword) => {
    set({ keyword: keyword || '' });
  },

  // 获取可用模型列表
  getModels: async () => {
    try {
      set({ loading: true });
      const response = await api.get('/image/models');
      if (response.data.success) {
        set({ 
          models: response.data.data,
          selectedModel: response.data.data[0] || null
        });
      }
    } catch (error) {
      console.error('Failed to get model list:', error);
      message.error(i18n.t('image.modelsLoadFailed'));
    } finally {
      set({ loading: false });
    }
  },

  // 选择模型
  selectModel: (model) => {
    set({ selectedModel: model });
  },
  
  // 检查是否为Midjourney模型
  isMidjourneyModel: (model) => {
    return model && model.provider === 'midjourney' && model.generation_type === 'async';
  },

  // 批量生成图片（支持Midjourney和base64Array）
  generateImages: async (params) => {
    const { selectedModel } = get();
    if (!selectedModel) {
      message.error(i18n.t('image.pleaseSelectModelFirst'));
      return null;
    }

    try {
      set({ generating: true, generationProgress: null });
      
      // 判断是否为Midjourney模型
      if (get().isMidjourneyModel(selectedModel)) {
        // Midjourney生成（异步）
        message.loading(i18n.t('image.submittingMjTask'), 0);
        
        const requestData = {
          model_id: selectedModel.id,
          prompt: params.prompt,
          negative_prompt: params.negative_prompt,
          size: params.size
        };

        if (params.base64Array && params.base64Array.length > 0) {
          requestData.base64Array = params.base64Array;
        }
        
        const response = await api.post('/image/generate', requestData);
        
        message.destroy();
        
        if (response.data.success) {
          const result = response.data.data;
          message.success(result.message || i18n.t('image.taskSubmitted'));
          
          set(state => ({
            processingTasks: { ...state.processingTasks, [result.taskId]: true }
          }));
          
          get().pollMidjourneyTask(result.taskId, result.generationId);
          
          // 生成后刷新历史（不带搜索关键词，因为是想看新生成的）
          get().getUserHistory();
          
          return result;
        } else {
          message.error(response.data.message || i18n.t('image.submitFailed'));
          return null;
        }
      } else {
        // 普通模型生成（同步）
        const quantity = params.quantity || 1;
        if (quantity > 1) {
          set({ generationProgress: `0/${quantity}` });
          message.loading(i18n.t('image.generatingCount', { count: quantity }), 0);
        }

        const response = await api.post('/image/generate', {
          model_id: selectedModel.id,
          ...params
        });

        if (response.data.success) {
          const result = response.data.data;
          
          message.destroy();
          
          if (quantity > 1) {
            if (result.succeeded === result.requested) {
              message.success(i18n.t('image.batchGenerateSuccess', { count: result.succeeded, credits: result.creditsConsumed }));
            } else if (result.succeeded > 0) {
              message.warning(i18n.t('image.batchGeneratePartial', { succeeded: result.succeeded, requested: result.requested, credits: result.creditsConsumed }));
            } else {
              message.error(i18n.t('image.allGenerationFailed'));
            }
          } else {
            message.success(i18n.t('image.generateSuccess'));
          }
          
          get().getUserHistory();
          return result;
        } else {
          message.destroy();
          message.error(response.data.message || i18n.t('image.generateFailed'));
          return null;
        }
      }
    } catch (error) {
      message.destroy();
      console.error('Failed to generate image:', error);
      if (error.response?.data?.message) {
        message.error(error.response.data.message);
      } else {
        message.error(i18n.t('image.generateFailedRetry'));
      }
      return null;
    } finally {
      set({ generating: false, generationProgress: null });
    }
  },
  
  // 轮询Midjourney任务状态
  pollMidjourneyTask: (taskId, generationId) => {
    const pollInterval = 2000;
    const maxPollingTime = 300000;
    const startTime = Date.now();
    
    const poll = async () => {
      try {
        const response = await api.get(`/image/midjourney/task/${taskId}`);
        
        if (response.data.success) {
          const task = response.data.data;
          
          if (task.progress) {
            set({ generationProgress: task.progress });
          }
          
          if (task.task_status === 'SUCCESS' || task.status === 'success') {
            message.success(i18n.t('image.mjGenerateComplete'));
            
            get().clearPollingTimer(taskId);
            
            set({ generationProgress: null });
            
            console.log('Task succeeded, waiting for backend to save image...');
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            let retryCount = 0;
            let dataReady = false;
            
            while (retryCount < 3 && !dataReady) {
              const historyResponse = await api.get('/image/history', { 
                params: { page: 1, limit: 20 } 
              });
              
              if (historyResponse.data.success) {
                const historyData = historyResponse.data.data.data;
                const targetItem = historyData.find(item => item.task_id === taskId);
                
                if (targetItem && (targetItem.local_path || targetItem.thumbnail_path || targetItem.image_url)) {
                  dataReady = true;
                  console.log('Image data ready:', targetItem);
                  
                  set({
                    generationHistory: historyData,
                    historyPagination: historyResponse.data.data.pagination
                  });
                }
              }
              
              if (!dataReady) {
                retryCount++;
                if (retryCount < 3) {
                  console.log(`Image data not ready, retrying after wait... (${retryCount}/3)`);
                  await new Promise(resolve => setTimeout(resolve, 1500));
                }
              }
            }
            
            set(state => {
              const newProcessingTasks = { ...state.processingTasks };
              delete newProcessingTasks[taskId];
              return { processingTasks: newProcessingTasks };
            });
            
            if (!dataReady) {
              console.log('Data may not be fully ready, refreshing one last time');
              get().getUserHistory();
            }
            
          } else if (task.task_status === 'FAILURE' || task.status === 'failed') {
            message.error(task.fail_reason || task.error_message || i18n.t('image.generateFailed'));
            
            get().clearPollingTimer(taskId);
            
            set(state => {
              const newProcessingTasks = { ...state.processingTasks };
              delete newProcessingTasks[taskId];
              return { 
                processingTasks: newProcessingTasks,
                generationProgress: null 
              };
            });
            
            setTimeout(() => {
              get().getUserHistory();
            }, 500);
            
          } else if (Date.now() - startTime > maxPollingTime) {
            message.error(i18n.t('image.taskTimeout'));
            
            get().clearPollingTimer(taskId);
            
            set(state => {
              const newProcessingTasks = { ...state.processingTasks };
              delete newProcessingTasks[taskId];
              return { processingTasks: newProcessingTasks, generationProgress: null };
            });
            
            get().getUserHistory();
            
          } else {
            const timerId = setTimeout(poll, pollInterval);
            set(state => ({
              pollingTimers: { ...state.pollingTimers, [taskId]: timerId }
            }));
          }
        }
      } catch (error) {
        console.error('Failed to poll task status:', error);
        const timerId = setTimeout(poll, pollInterval * 2);
        set(state => ({
          pollingTimers: { ...state.pollingTimers, [taskId]: timerId }
        }));
      }
    };
    
    poll();
  },
  
  // 清除轮询定时器
  clearPollingTimer: (taskId) => {
    const { pollingTimers } = get();
    if (pollingTimers[taskId]) {
      clearTimeout(pollingTimers[taskId]);
      const newTimers = { ...pollingTimers };
      delete newTimers[taskId];
      set({ pollingTimers: newTimers });
    }
  },
  
  // 清理所有失败任务的处理状态
  cleanupFailedTasks: () => {
    const { generationHistory, processingTasks } = get();
    const newProcessingTasks = { ...processingTasks };
    let hasChanges = false;
    
    generationHistory.forEach(item => {
      if (item.task_id && newProcessingTasks[item.task_id]) {
        if (item.status === 'failed' || item.status === 'success' || 
            item.task_status === 'FAILURE' || item.task_status === 'SUCCESS') {
          delete newProcessingTasks[item.task_id];
          hasChanges = true;
        }
      }
    });
    
    if (hasChanges) {
      set({ processingTasks: newProcessingTasks });
      console.log('Cleared processing state of failed tasks');
    }
  },
  
  // Midjourney操作（U/V/Reroll）
  midjourneyAction: async (generationId, action, index) => {
    try {
      set({ generating: true });
      message.loading(i18n.t('image.submittingAction'), 0);
      
      const response = await api.post('/image/midjourney/action', {
        generation_id: generationId,
        action,
        index
      });
      
      message.destroy();
      
      if (response.data.success) {
        const result = response.data.data;
        message.success(result.message || i18n.t('image.actionSubmitted'));
        
        set(state => ({
          processingTasks: { ...state.processingTasks, [result.taskId]: true }
        }));
        
        get().pollMidjourneyTask(result.taskId, result.generationId);
        
        get().getUserHistory();
        
        return result;
      } else {
        message.error(response.data.message || i18n.t('message.error'));
        return null;
      }
    } catch (error) {
      message.destroy();
      console.error('Midjourney action failed:', error);
      if (error.response?.data?.message) {
        message.error(error.response.data.message);
      } else {
        message.error(i18n.t('image.actionFailedRetry'));
      }
      return null;
    } finally {
      set({ generating: false });
    }
  },
  
  // 获取Midjourney任务列表
  getMidjourneyTasks: async (params = {}) => {
    try {
      const response = await api.get('/image/midjourney/tasks', { params });
      if (response.data.success) {
        set({ midjourneyTasks: response.data.data.data });
        return response.data.data;
      }
    } catch (error) {
      console.error('Failed to get task list:', error);
      message.error(i18n.t('image.tasksLoadFailed'));
    }
  },

  // 生成单张图片（保持兼容性）
  generateImage: async (params) => {
    return get().generateImages({ ...params, quantity: 1 });
  },

  /**
   * 获取用户生成历史
   *
   * v1.1 由调用方在 params 中传入 keyword（可选）
   */
  getUserHistory: async (params = {}, skipLoading = false) => {
    try {
      if (!skipLoading) {
        set({ loading: true });
      }
      
      const response = await api.get('/image/history', { params });
      if (response.data.success) {
        set({
          generationHistory: response.data.data.data,
          historyPagination: response.data.data.pagination,
          loading: false
        });
        
        get().cleanupFailedTasks();
        
        return response.data.data;
      }
    } catch (error) {
      console.error('Failed to get history:', error);
      if (!skipLoading) {
        message.error(i18n.t('image.historyLoadFailed'));
      }
      set({ loading: false });
    }
  },

  // 删除生成记录
  deleteGeneration: async (id) => {
    try {
      const response = await api.delete(`/image/generation/${id}`);
      if (response.data.success) {
        message.success(i18n.t('image.deleteSuccess'));
        get().getUserHistory();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to delete:', error);
      message.error(i18n.t('image.deleteFailed'));
      return false;
    }
  },

  // 批量删除
  batchDeleteGenerations: async (ids) => {
    try {
      const response = await api.post('/image/generations/batch-delete', { ids });
      if (response.data.success) {
        message.success(response.data.message);
        get().getUserHistory();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Batch delete failed:', error);
      message.error(i18n.t('image.batchDeleteFailed'));
      return false;
    }
  },

  // 切换收藏状态
  toggleFavorite: async (id) => {
    try {
      const response = await api.post(`/image/generation/${id}/favorite`);
      if (response.data.success) {
        set(state => ({
          generationHistory: state.generationHistory.map(item => 
            item.id === id ? { ...item, is_favorite: !item.is_favorite } : item
          )
        }));
        message.success(i18n.t('message.success'));
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to toggle favorite:', error);
      message.error(i18n.t('message.error'));
      return false;
    }
  },

  // 切换公开状态
  togglePublic: async (id) => {
    try {
      const response = await api.post(`/image/generation/${id}/public`);
      if (response.data.success) {
        set(state => ({
          generationHistory: state.generationHistory.map(item => 
            item.id === id ? { ...item, is_public: !item.is_public } : item
          )
        }));
        message.success(i18n.t('message.success'));
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to toggle public status:', error);
      message.error(i18n.t('message.error'));
      return false;
    }
  },

  /**
   * 获取公开画廊
   *
   * v1.1 由调用方在 params 中传入 keyword（可选）
   */
  getPublicGallery: async (params = {}) => {
    try {
      set({ loading: true });
      const response = await api.get('/image/gallery', { params });
      if (response.data.success) {
        set({
          publicGallery: response.data.data.data,
          galleryPagination: response.data.data.pagination
        });
      }
    } catch (error) {
      console.error('Failed to get gallery:', error);
      message.error(i18n.t('image.galleryLoadFailed'));
    } finally {
      set({ loading: false });
    }
  },

  // 获取用户统计
  getUserStats: async () => {
    try {
      const response = await api.get('/image/stats');
      if (response.data.success) {
        set({ userStats: response.data.data });
      }
    } catch (error) {
      console.error('Failed to get stats:', error);
    }
  },

  // 重置状态
  reset: () => {
    const { pollingTimers } = get();
    Object.values(pollingTimers).forEach(timerId => clearTimeout(timerId));
    
    set({
      models: [],
      selectedModel: null,
      generating: false,
      generationProgress: null,
      generationHistory: [],
      historyPagination: {
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0
      },
      publicGallery: [],
      galleryPagination: {
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0
      },
      userStats: null,
      loading: false,
      keyword: '',
      midjourneyTasks: [],
      pollingTimers: {},
      processingTasks: {}
    });
  }
}));

export default useImageStore;
