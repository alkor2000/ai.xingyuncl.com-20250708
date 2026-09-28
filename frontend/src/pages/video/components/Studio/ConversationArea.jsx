import React from 'react';
import { Button, Empty, Progress, Space, Spin, Tag, Typography } from 'antd';
import { ExpandOutlined, RedoOutlined } from '@ant-design/icons';

/**
 * 对话区：**只放这一次打开以来做的**，一轮一条。
 *
 * 视频跟图片不一样的地方在于"等"：提交之后要排队、要渲染，几十秒到几分钟都有可能。
 * 所以这里把每一轮当前到哪一步明明白白写出来（排队中 / 生成中＋进度 / 好了 / 失败＋原因），
 * 而不是让人对着一个转圈猜。状态取自轮次自己那份快照，由页面按真实任务 id 更新。
 *
 * 收藏、公开、删除都不在这儿——那是"整理我的视频"，去右边的图库抽屉做。
 */
const PROCESSING = new Set(['pending', 'submitted', 'queued', 'running', 'processing']);

export default function ConversationArea({ t, turns, itemById, onRerun, onOpen }) {
  if (turns.length === 0) {
    return (
      <div className="studio-conversation empty" data-testid="studio-conversation">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('video.studio.emptyConversation')} />
      </div>
    );
  }

  return (
    <div className="studio-conversation" data-testid="studio-conversation">
      {turns.map(turn => {
        const items = turn.ids.map(itemById).filter(Boolean);     // 被删掉的就不再显示
        return (
          <div className="studio-turn" key={turn.key} data-testid="studio-turn">
            <div className="studio-turn-prompt">
              <Typography.Text>{turn.prompt}</Typography.Text>
              <Button size="small" type="text" icon={<RedoOutlined />} data-testid="studio-rerun"
                onClick={() => onRerun(turn.prompt)}>{t('video.studio.rerun')}</Button>
            </div>

            <div className="studio-turn-videos">
              {items.map(item => {
                if (PROCESSING.has(item.status)) {
                  return (
                    <div className="studio-turn-pending" key={item.id} data-testid="studio-turn-pending">
                      <Space>
                        <Spin size="small" />
                        <Tag color="processing">
                          {item.status === 'queued' || item.status === 'pending' || item.status === 'submitted'
                            ? t('video.studio.queued') : t('video.studio.rendering')}
                        </Tag>
                      </Space>
                      {item.progress > 0 && (
                        <Progress percent={item.progress} size="small" showInfo={false} />
                      )}
                    </div>
                  );
                }
                if (item.status === 'failed') {
                  return (
                    <div className="studio-turn-failed" key={item.id} data-testid="studio-turn-failed">
                      <Tag color="error">{t('video.studio.failed')}</Tag>
                      {/* 失败原因照后端原话写，不自己编，也不拿上一条旧视频顶上 */}
                      {item.error_message && (
                        <Typography.Text type="secondary">{item.error_message}</Typography.Text>
                      )}
                    </div>
                  );
                }
                return item.local_path ? (
                  <div className="studio-turn-video" key={item.id} data-testid="studio-turn-video">
                    <video src={item.local_path} poster={item.thumbnail_path} controls preload="metadata" />
                    <Button size="small" type="text" icon={<ExpandOutlined />} className="studio-turn-expand"
                      data-testid="studio-turn-expand" onClick={() => onOpen(item)}>
                      {t('video.studio.fullscreen')}
                    </Button>
                  </div>
                ) : (
                  <div className="studio-turn-pending" key={item.id}>
                    <Tag>{t('video.studio.noVideoYet')}</Tag>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
