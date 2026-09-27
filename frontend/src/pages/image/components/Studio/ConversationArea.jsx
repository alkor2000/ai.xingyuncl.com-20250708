import React from 'react';
import { Button, Empty, Image, Progress, Space, Spin, Tag, Typography } from 'antd';
import { RedoOutlined } from '@ant-design/icons';
import { getImageUrl } from '../../utils/imageHelpers';

/**
 * 对话区：**只放这一次打开以来生成的东西**，一轮一条，像聊天记录。
 *
 * 这里刻意不放收藏、公开、删除——那些是"管理我的图库"，不是"我现在在做什么"。
 * 想整理就去右边的图库抽屉，两边职责分开，页面才不会又变回一面墙。
 */
export default function ConversationArea({ t, turns, itemById, generating, progress, onView, onRerun }) {
  if (turns.length === 0 && !generating) {
    return (
      <div className="studio-conversation empty" data-testid="studio-conversation">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('image.studio.emptyConversation')} />
      </div>
    );
  }

  return (
    <div className="studio-conversation" data-testid="studio-conversation">
      {turns.map(turn => {
        const items = turn.ids.map(itemById).filter(Boolean);       // 被删掉的就不再显示
        return (
          <div className="studio-turn" key={turn.key} data-testid="studio-turn">
            <div className="studio-turn-prompt">
              <Typography.Text>{turn.prompt}</Typography.Text>
              <Button size="small" type="text" icon={<RedoOutlined />} data-testid="studio-rerun"
                onClick={() => onRerun(turn.prompt)}>{t('image.studio.rerun')}</Button>
            </div>
            <div className="studio-turn-images">
              {items.map(item => {
                const url = getImageUrl(item);
                return url ? (
                  <Image key={item.id} src={url} alt={turn.prompt} preview={false}
                    onClick={() => onView(item, turn)} placeholder={<Spin />} />
                ) : (
                  <div className="studio-turn-pending" key={item.id}>
                    <Spin size="small" />
                    <Tag>{t('image.studio.stillRunning')}</Tag>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {generating && (
        <div className="studio-turn generating" data-testid="studio-generating">
          <Space>
            <Spin />
            <Typography.Text type="secondary">{t('image.generating')}</Typography.Text>
          </Space>
          {typeof progress === 'number' && progress > 0 && <Progress percent={progress} size="small" showInfo={false} />}
        </div>
      )}
    </div>
  );
}
