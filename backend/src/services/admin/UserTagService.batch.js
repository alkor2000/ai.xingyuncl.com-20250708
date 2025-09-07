// 批量操作扩展方法（添加到UserTagService.js）

/**
 * 批量给多个用户添加标签
 */
static async batchAssignTags(userIds, tagIds, operatorId) {
  const connection = await dbConnection.getConnection();
  try {
    await connection.beginTransaction();
    
    const values = [];
    for (const userId of userIds) {
      for (const tagId of tagIds) {
        values.push([userId, tagId, operatorId]);
      }
    }
    
    // 批量插入，忽略已存在的关系
    const sql = `
      INSERT IGNORE INTO user_tag_relations (user_id, tag_id, assigned_by)
      VALUES ?
    `;
    
    await connection.query(sql, [values]);
    
    // 记录历史
    const historySql = `
      INSERT INTO user_tag_history (user_id, tag_id, action, operator_id)
      VALUES ?
    `;
    const historyValues = values.map(v => [...v.slice(0, 2), 'add', v[2]]);
    await connection.query(historySql, [historyValues]);
    
    await connection.commit();
    
    return {
      success: true,
      affected: values.length,
      message: `成功为${userIds.length}个用户添加${tagIds.length}个标签`
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * 按标签筛选用户
 */
static async getUsersByTags(tagIds, groupId = null) {
  let sql = `
    SELECT DISTINCT u.id, u.username, u.email, u.role, u.status,
           GROUP_CONCAT(ut.name) as tags
    FROM users u
    JOIN user_tag_relations utr ON u.id = utr.user_id
    JOIN user_tags ut ON utr.tag_id = ut.id
    WHERE utr.tag_id IN (?)
  `;
  
  const params = [tagIds];
  
  if (groupId) {
    sql += ' AND u.group_id = ?';
    params.push(groupId);
  }
  
  sql += ' GROUP BY u.id';
  
  const { rows } = await dbConnection.query(sql, params);
  return rows;
}
