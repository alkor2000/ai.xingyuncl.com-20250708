/**
 * 数据库模拟
 */

class MockDatabase {
  constructor() {
    this.data = {
      users: [],
      conversations: [],
      messages: [],
      ai_models: []
    };
    this.queryCount = 0;
  }

  // 模拟查询
  async query(sql, params) {
    this.queryCount++;
    
    // 模拟不同的查询
    if (sql.includes('SELECT * FROM users WHERE email')) {
      const email = params[0];
      const user = this.data.users.find(u => u.email === email);
      return [user ? [user] : []];
    }
    
    if (sql.includes('SELECT * FROM users WHERE username')) {
      const username = params[0];
      const user = this.data.users.find(u => u.username === username);
      return [user ? [user] : []];
    }
    
    if (sql.includes('SELECT * FROM users WHERE id')) {
      const id = params[0];
      const user = this.data.users.find(u => u.id === id);
      return [user ? [user] : []];
    }
    
    if (sql.includes('INSERT INTO users')) {
      const newUser = {
        id: this.data.users.length + 1,
        created_at: new Date(),
        updated_at: new Date()
      };
      this.data.users.push(newUser);
      return [{ insertId: newUser.id }];
    }
    
    return [[]];
  }

  // 添加测试数据
  addUser(user) {
    this.data.users.push({
      id: this.data.users.length + 1,
      ...user,
      created_at: new Date(),
      updated_at: new Date()
    });
  }

  // 清空数据
  reset() {
    this.data = {
      users: [],
      conversations: [],
      messages: [],
      ai_models: []
    };
    this.queryCount = 0;
  }
}

module.exports = new MockDatabase();
