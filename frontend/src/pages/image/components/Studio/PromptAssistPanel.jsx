import React, { useCallback, useState } from 'react';
import { Alert, Button, Drawer, Input, List, Space, Typography, message } from 'antd';
import { BulbOutlined, RedoOutlined } from '@ant-design/icons';
import api from '../../../../utils/api';

/**
 * 「帮我写提示词」。
 *
 * 学生写了半句、或者一个字都没写，都可以按这里：把当前草稿和一句话诉求交给模型，
 * 拿回两三条能直接用的写法，再由**学生自己**决定替换还是接在后面——这里从不自动改输入框，
 * 也从不自动去生成。花了多少积分当场写出来，不让人事后才发现被扣了。
 *
 * 模型范围、权限与计费全在后端（/api/prompt-assist）判定，这一层不做任何放宽。
 */
export default function PromptAssistPanel({ open, onClose, t, target = 'image', draft = '', onUse }) {
  const [request, setRequest] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [charged, setCharged] = useState(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(null);

  const ask = useCallback(async () => {
    if (busy) return;                                  // 连点只发一次
    setBusy(true); setFailed(null);
    try {
      const { data } = await api.post('/prompt-assist', {
        target, draft: draft || '', request: request.trim(), count: 3
      });
      const list = data?.data?.candidates || [];
      if (list.length === 0) throw new Error('empty');
      setCandidates(list);
      setCharged(data?.data?.credits_charged ?? null);
    } catch (error) {
      // 后端把"没写出来"和"积分不够"分成不同的码，这里照它的话说，不自己编。
      setFailed(error?.response?.data?.error?.message || t('image.assist.failed'));
    } finally {
      setBusy(false);
    }
  }, [busy, target, draft, request, t]);

  const use = (text, mode) => {
    onUse(text, mode);
    message.success(t(mode === 'append' ? 'image.assist.appended' : 'image.assist.replaced'));
  };

  return (
    <Drawer open={open} onClose={onClose} placement="bottom" height="min(520px, 85dvh)"
      title={<Space><BulbOutlined />{t('image.assist.title')}</Space>} rootClassName="prompt-assist-drawer">
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Typography.Text type="secondary">{t('image.assist.hint')}</Typography.Text>
        <Input.TextArea value={request} onChange={e => setRequest(e.target.value)} maxLength={300} rows={2}
          placeholder={t('image.assist.requestPlaceholder')} data-testid="assist-request" />
        <Button type="primary" icon={busy ? <RedoOutlined spin /> : <BulbOutlined />} loading={busy}
          onClick={ask} data-testid="assist-ask">
          {candidates.length ? t('image.assist.again') : t('image.assist.ask')}
        </Button>

        {failed && <Alert type="warning" showIcon message={failed} data-testid="assist-failed" />}

        {candidates.length > 0 && (
          <>
            {charged !== null && (
              <Typography.Text type="secondary" data-testid="assist-charged">
                {t('image.assist.charged', { credits: charged })}
              </Typography.Text>
            )}
            <List
              dataSource={candidates}
              renderItem={(text, index) => (
                <List.Item
                  data-testid={`assist-candidate-${index}`}
                  actions={[
                    <Button key="replace" size="small" type="link" onClick={() => use(text, 'replace')}>
                      {t('image.assist.replace')}
                    </Button>,
                    <Button key="append" size="small" type="link" onClick={() => use(text, 'append')}>
                      {t('image.assist.append')}
                    </Button>
                  ]}
                >
                  <Typography.Text>{text}</Typography.Text>
                </List.Item>
              )}
            />
          </>
        )}
      </Space>
    </Drawer>
  );
}
