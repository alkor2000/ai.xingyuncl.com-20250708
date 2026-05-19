/**
 * 视频生成状态管理
 *
 * v1.1 新增 keyword 关键词搜索能力
 *   - 新增 keyword state 和 setKeyword action
 *   - keyword 仅作为状态存储，由页面层在调用 getUserHistory/getPublicGallery 时传入参数
 */
import { create } from 'zustand';
import apiClient from '../utils/api';
import { message } from 'antd';

const useVideoStore = create((set, get) => ({
  // ========== 状态 ==========
  models: [],
  selectedModel: null,
  generating: false,
  generationProgress: 0,
  generationHistory: [],
  historyPagination: { total: 0, page: 1, limit: 20 },
  publicGallery: [],
  galleryPagination: { total: 0, page: 1, limit: 20 },
  loading: false,
  userStats: null,
  processingTasks: {}, // 正在处理的任务
  completedTasks: {}, // 已完成的任务（避免状态回退）
  
  // v1.1 关键词搜索状态（页面切换Tab时保留）
  keyword: '',

  // v1.1 设置关键词（仅更新状态，不触发查询）
  setKeyword: (keyword) => {
    set({ keyword: keyword || '' });
  },

  // 获取模型列表
  getModels: async () => {
    try {
      const response = await apiClient.get('/video/models');
      if (response.data.success) {
        const models = response.data.data;
        set({ 
          models,
          selectedModel: models.length > 0 ? models[0] : null
        });
      }
    } catch (error) {
      message.error('获取视频模型失败');
    }
  },

  // 选择模型
  selectModel: (model) => {
    set({ selectedModel: model });
  },

  // 提交视频生成任务
  generateVideo: async (params) => {
    const { selectedModel } = get();
    if (!selectedModel) {
      message.error('请选择视频模型');
      return null;
    }

    set({ generating: true, generationProgress: 0 });
    
    try {
      const response = await apiClient.post('/video/generate', {
        model_id: selectedModel.id,
        ...params
      });

      if (response.data.success) {
        const result = response.data.data;
        
        if (result.taskId) {
          set(state => ({
            processingTasks: {
              ...state.processingTasks,
              [result.taskId]: {
                generationId: result.generationId,
                startTime: Date.now()
              }
            }
          }));
          
          // 立即刷新历史记录，获取新创建的任务
          await get().getUserHistory({ page: 1, limit: 20 });
          
          get().pollTaskStatus(result.taskId, result.generationId);
        }
        
        message.success('视频生成任务已提交');
        return result;
      }
    } catch (error) {
      const errorMsg = error.response?.data?.message || '视频生成失败';
      message.error(errorMsg);
      return null;
    } finally {
      set({ generating: false });
    }
  },

  // 轮询任务状态
  pollTaskStatus: async (taskId, generationId) => {
    const pollInterval = 5000;
    const maxPollingTime = 600000;
    const startTime = Date.now();
    
    const poll = async () => {
      try {
        if (Date.now() - startTime > maxPollingTime) {
          message.error('任务查询超时');
          set(state => {
            const newTasks = { ...state.processingTasks };
            delete newTasks[taskId];
            return { processingTasks: newTasks };
          });
          return;
        }

        if (get().completedTasks[taskId]) {
          return;
        }

        const response = await apiClient.get(`/video/task/${taskId}`);
        
        if (response.data.success) {
          const taskData = response.data.data;
          
          set(state => ({
            generationHistory: state.generationHistory.map(item => {
              if (item.id === generationId || item.task_id === taskId) {
                return {
                  ...item,
                  status: taskData.status,
                  progress: taskData.progress || item.progress,
                  video_url: taskData.video_url || item.video_url,
                  local_path: taskData.local_path || item.local_path,
                  thumbnail_path: taskData.thumbnail_path || item.thumbnail_path,
                  error_message: taskData.error_message || item.error_message
                };
              }
              return item;
            })
          }));
          
          if (taskData.progress !== undefined) {
            set({ generationProgress: taskData.progress });
          }
          
          if (taskData.status === 'succeeded' || taskData.status === 'failed') {
            set(state => ({
              completedTasks: {
                ...state.completedTasks,
                [taskId]: {
                  generationId,
                  status: taskData.status,
                  completedAt: Date.now()
                }
              },
              processingTasks: (() => {
                const newTasks = { ...state.processingTasks };
                delete newTasks[taskId];
                return newTasks;
              })(),
              generationProgress: 0
            }));
            
            set(state => ({
              generationHistory: state.generationHistory.map(item => {
                if (item.id === generationId || item.task_id === taskId) {
                  return {
                    ...item,
                    status: taskData.status,
                    video_url: taskData.video_url,
                    local_path: taskData.local_path,
                    thumbnail_path: taskData.thumbnail_path,
                    error_message: taskData.error_message
                  };
                }
                return item;
              })
            }));
            
            if (taskData.status === 'succeeded') {
              message.success('视频生成完成！');
            } else {
              message.error(`视频生成失败: ${taskData.error_message || '未知错误'}`);
            }
            
            setTimeout(() => {
              set(state => {
                const newCompleted = { ...state.completedTasks };
                delete newCompleted[taskId];
                return { completedTasks: newCompleted };
              });
            }, 24 * 60 * 60 * 1000);
            
          } else {
            setTimeout(poll, pollInterval);
          }
        }
      } catch (error) {
        console.error('查询任务状态失败:', error);
        setTimeout(poll, pollInterval * 2);
      }
    };
    
    setTimeout(poll, pollInterval);
  },

  /**
   * 获取用户历史
   *
   * v1.1 由调用方在 params 中传入 keyword（可选）
   */
  getUserHistory: async (params = {}) => {
    set({ loading: true });
    try {
      const response = await apiClient.get('/video/history', { params });
      if (response.data.success) {
        const { data, pagination } = response.data.data;
        
        const completedTasks = get().completedTasks;
        const processingTasks = get().processingTasks;
        const currentHistory = get().generationHistory;
        
        // 智能合并数据
        const mergedData = data.map(newItem => {
          if (completedTasks[newItem.task_id]) {
            const currentItem = currentHistory.find(item => item.task_id === newItem.task_id);
            if (currentItem && (currentItem.status === 'succeeded' || currentItem.status === 'failed')) {
              return {
                ...newItem,
                status: currentItem.status,
                video_url: currentItem.video_url || newItem.video_url,
                local_path: currentItem.local_path || newItem.local_path,
                thumbnail_path: currentItem.thumbnail_path || newItem.thumbnail_path,
                error_message: currentItem.error_message || newItem.error_message
              };
            }
          }
          
          if (processingTasks[newItem.task_id]) {
            const currentItem = currentHistory.find(item => item.task_id === newItem.task_id);
            if (currentItem && currentItem.status !== 'submitted') {
              return {
                ...newItem,
                status: currentItem.status || newItem.status,
                progress: currentItem.progress !== undefined ? currentItem.progress : newItem.progress
              };
            }
          }
          
          return newItem;
        });
        
        set({ 
          generationHistory: mergedData,
          historyPagination: pagination
        });
        
        // 恢复未完成任务的轮询
        mergedData.forEach(item => {
          if (item.task_id && 
              (item.status === 'running' || item.status === 'queued' || item.status === 'submitted') &&
              !processingTasks[item.task_id] && 
              !completedTasks[item.task_id]) {
            set(state => ({
              processingTasks: {
                ...state.processingTasks,
                [item.task_id]: {
                  generationId: item.id,
                  startTime: Date.now()
                }
              }
            }));
            get().pollTaskStatus(item.task_id, item.id);
          }
        });
      }
    } catch (error) {
      console.error('获取历史记录失败:', error);
      set({ 
        generationHistory: [],
        historyPagination: { total: 0, page: 1, limit: 20 }
      });
    } finally {
      set({ loading: false });
    }
  },

  /**
   * 获取公开画廊
   *
   * v1.1 由调用方在 params 中传入 keyword（可选）
   */
  getPublicGallery: async (params = {}) => {
    set({ loading: true });
    try {
      const response = await apiClient.get('/video/gallery', { params });
      if (response.data.success) {
        const { data, pagination } = response.data.data;
        set({ 
          publicGallery: data,
          galleryPagination: pagination
        });
      }
    } catch (error) {
      message.error('获取公开画廊失败');
    } finally {
      set({ loading: false });
    }
  },

  // 删除视频
  deleteGeneration: async (id) => {
    try {
      const response = await apiClient.delete(`/video/generation/${id}`);
      if (response.data.success) {
        message.success('删除成功');
        
        const itemToDelete = get().generationHistory.find(item => item.id === id);
        
        set(state => {
          const newState = {
            generationHistory: state.generationHistory.filter(item => item.id !== id),
            historyPagination: {
              ...state.historyPagination,
              total: Math.max(0, state.historyPagination.total - 1)
            }
          };
          
          if (itemToDelete?.task_id) {
            const newProcessing = { ...state.processingTasks };
            delete newProcessing[itemToDelete.task_id];
            newState.processingTasks = newProcessing;
            
            const newCompleted = { ...state.completedTasks };
            delete newCompleted[itemToDelete.task_id];
            newState.completedTasks = newCompleted;
          }
          
          return newState;
        });
        
        return true;
      }
    } catch (error) {
      message.error('删除失败');
      return false;
    }
  },

  // 切换收藏
  toggleFavorite: async (id) => {
    try {
      const response = await apiClient.post(`/video/generation/${id}/favorite`);
      if (response.data.success) {
        set(state => ({
          generationHistory: state.generationHistory.map(item =>
            item.id === id ? { ...item, is_favorite: !item.is_favorite } : item
          )
        }));
        message.success(response.data.data?.is_favorite ? '已收藏' : '已取消收藏');
        return true;
      }
    } catch (error) {
      message.error('操作失败');
      return false;
    }
  },

  // 切换公开状态
  togglePublic: async (id) => {
    try {
      const response = await apiClient.post(`/video/generation/${id}/public`);
      if (response.data.success) {
        set(state => ({
          generationHistory: state.generationHistory.map(item =>
            item.id === id ? { ...item, is_public: !item.is_public } : item
          )
        }));
        message.success(response.data.data?.is_public ? '已设为公开' : '已设为私密');
        return true;
      }
    } catch (error) {
      message.error('操作失败');
      return false;
    }
  },

  // 获取用户统计
  getUserStats: async () => {
    try {
      const response = await apiClient.get('/video/stats');
      if (response.data.success) {
        set({ userStats: response.data.data });
      }
    } catch (error) {
      console.error('获取统计信息失败:', error);
    }
  },

  // 初始化时恢复未完成任务的轮询
  initializePolling: () => {
    const { generationHistory } = get();
    generationHistory.forEach(item => {
      if (item.task_id && (item.status === 'running' || item.status === 'queued' || item.status === 'submitted')) {
        set(state => ({
          processingTasks: {
            ...state.processingTasks,
            [item.task_id]: {
              generationId: item.id,
              startTime: Date.now()
            }
          }
        }));
        get().pollTaskStatus(item.task_id, item.id);
      }
    });
  }
}));

export default useVideoStore;
