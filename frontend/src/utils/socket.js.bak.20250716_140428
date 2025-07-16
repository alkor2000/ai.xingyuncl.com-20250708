/**
 * WebSocket 连接管理
 */

import io from 'socket.io-client';
import useAuthStore from '../stores/authStore';

class SocketManager {
  constructor() {
    this.socket = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.heartbeatInterval = null;
  }

  /**
   * 连接到WebSocket服务器
   */
  connect() {
    const authState = useAuthStore.getState();
    const token = authState.accessToken;

    if (!token) {
      console.error('无法连接WebSocket：缺少认证令牌');
      return;
    }

    // 如果已连接，先断开
    if (this.socket && this.connected) {
      this.disconnect();
    }

    // 创建Socket连接
    this.socket = io('/', {
      path: '/socket.io/',
      transports: ['websocket', 'polling'],
      auth: {
        token: token
      },
      reconnection: true,
      reconnectionAttempts: this.maxReconnectAttempts,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000
    });

    // 连接成功
    this.socket.on('connect', () => {
      console.log('✅ WebSocket连接成功');
      this.connected = true;
      this.reconnectAttempts = 0;
      this.startHeartbeat();
    });

    // 连接断开
    this.socket.on('disconnect', (reason) => {
      console.log('❌ WebSocket连接断开:', reason);
      this.connected = false;
      this.stopHeartbeat();
    });

    // 连接错误
    this.socket.on('connect_error', (error) => {
      console.error('WebSocket连接错误:', error);
      this.reconnectAttempts++;
      
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        console.error('WebSocket重连失败，已达最大重试次数');
        this.disconnect();
      }
    });

    // 重连尝试
    this.socket.on('reconnect_attempt', (attemptNumber) => {
      console.log(`WebSocket重连尝试 ${attemptNumber}/${this.maxReconnectAttempts}`);
    });

    // 重连成功
    this.socket.on('reconnect', () => {
      console.log('✅ WebSocket重连成功');
      this.reconnectAttempts = 0;
    });

    return this.socket;
  }

  /**
   * 断开连接
   */
  disconnect() {
    this.stopHeartbeat();
    
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    
    this.connected = false;
    console.log('WebSocket已断开连接');
  }

  /**
   * 开始心跳
   */
  startHeartbeat() {
    this.stopHeartbeat();
    
    // 立即发送一次心跳
    this.sendHeartbeat();
    
    // 每30秒发送一次心跳
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, 30000);
  }

  /**
   * 停止心跳
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * 发送心跳
   */
  sendHeartbeat() {
    if (this.socket && this.connected) {
      this.socket.emit('heartbeat');
    }
  }

  /**
   * 监听事件
   */
  on(event, callback) {
    if (this.socket) {
      this.socket.on(event, callback);
    }
  }

  /**
   * 移除事件监听
   */
  off(event, callback) {
    if (this.socket) {
      this.socket.off(event, callback);
    }
  }

  /**
   * 发送事件
   */
  emit(event, data) {
    if (this.socket && this.connected) {
      this.socket.emit(event, data);
    }
  }

  /**
   * 获取Socket实例
   */
  getSocket() {
    return this.socket;
  }

  /**
   * 是否已连接
   */
  isConnected() {
    return this.connected;
  }
}

// 创建单例实例
const socketManager = new SocketManager();

export default socketManager;
