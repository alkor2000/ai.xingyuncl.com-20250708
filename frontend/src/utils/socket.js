/**
 * WebSocket 连接管理（已禁用）
 * 保留此文件以保持代码兼容性
 */

class SocketManager {
  constructor() {
    this.socket = null;
    this.connected = false;
  }

  // 空的连接方法
  connect() {
    console.log('WebSocket 功能已禁用');
    return null;
  }

  // 空的断开方法
  disconnect() {
    this.connected = false;
  }

  // 空的事件监听
  on(event, callback) {
    // 不做任何操作
  }

  // 空的事件移除
  off(event, callback) {
    // 不做任何操作
  }

  // 空的事件发送
  emit(event, data) {
    // 不做任何操作
  }

  // 返回 null
  getSocket() {
    return null;
  }

  // 返回 false
  isConnected() {
    return false;
  }
}

// 创建单例实例
const socketManager = new SocketManager();

export default socketManager;
