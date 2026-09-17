import React, { useEffect, useState } from 'react';
import { Alert, Button, Empty, List, Pagination, Select, Space, Spin, Tag, Typography } from 'antd';
import { ArrowLeftOutlined, BellOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import useForumStore from '../../../stores/forumStore';

export default function NotificationsView({ onBack, onPostClick }) {
  const { t } = useTranslation();
  const { notifications, notificationsLoading, notificationsError, notificationsPagination,
    notificationQuery, unreadCount, fetchNotifications, markNotificationRead, markAllNotificationsRead } = useForumStore();
  const [marking, setMarking] = useState(false);
  useEffect(() => { fetchNotifications(notificationQuery); }, []);

  const openNotification = async (item) => {
    try {
      if (!item.is_read) await markNotificationRead(item.id);
      if (item.post_id) onPostClick({ id: item.post_id });
    } catch { /* Store reports the error; keep the notification available for retry. */ }
  };
  const markAll = async () => {
    setMarking(true);
    try { await markAllNotificationsRead(); } catch { /* Store reports the error. */ }
    finally { setMarking(false); }
  };

  return (
    <div className="notifications-view">
      <div className="view-header">
        <Button icon={<ArrowLeftOutlined />} onClick={onBack}>{t('forum.backToForum')}</Button>
        <Typography.Title level={4} style={{ margin: 0 }}><BellOutlined /> {t('forum.notification.title')}</Typography.Title>
      </div>
      <Space wrap style={{ marginBottom: 16 }}>
        <Select aria-label={t('forum.notification.filter')} style={{ minWidth: 160 }} value={notificationQuery.type || 'all'}
          disabled={notificationsLoading || marking}
          options={['all', 'mention', 'reply', 'like', 'system'].map(type => ({ value: type,
            label: t(type === 'all' ? 'forum.notification.all' : `forum.notification.type.${type}`) }))}
          onChange={type => fetchNotifications({ page: 1, type: type === 'all' ? undefined : type })} />
        <Button loading={marking} disabled={!unreadCount || notificationsLoading} onClick={markAll}>{t('forum.notification.markAllRead')}</Button>
      </Space>
      {notificationsError ? <Alert type="error" showIcon message={t('forum.notification.loadFailed')}
        action={<Button onClick={() => fetchNotifications(notificationQuery)}>{t('forum.notification.retry')}</Button>} /> :
        <Spin spinning={notificationsLoading}>
          <List dataSource={notifications} locale={{ emptyText: <Empty description={t('forum.notification.empty')} /> }}
            renderItem={item => (
              <List.Item actions={[
                <Button key="open" onClick={() => openNotification(item)} disabled={marking || (!item.post_id && Boolean(item.is_read))}>
                  {t(item.post_id ? 'forum.notification.viewPost' : 'forum.notification.markRead')}
                </Button>
              ]}>
                <List.Item.Meta title={<Space wrap>
                  <Tag>{['mention', 'reply', 'like', 'system'].includes(item.type) ? t(`forum.notification.type.${item.type}`) : item.type}</Tag>
                  {!item.is_read && <Tag color="blue">{t('forum.notification.unread')}</Tag>}
                  <span>{item.sender_name}</span>
                  <Typography.Text type="secondary">{dayjs(item.created_at).format('YYYY-MM-DD HH:mm')}</Typography.Text>
                </Space>} description={<>
                  <div>{item.content}</div>
                  {item.extra_data?.post_title && <Typography.Text>{item.extra_data.post_title}</Typography.Text>}
                </>} />
              </List.Item>
            )} />
          {notificationsPagination.total > notificationsPagination.limit &&
            <Pagination current={notificationsPagination.page} total={notificationsPagination.total}
              pageSize={notificationsPagination.limit} showSizeChanger={false} disabled={notificationsLoading || marking}
              onChange={page => fetchNotifications({ ...notificationQuery, page })} />}
        </Spin>}
    </div>
  );
}
