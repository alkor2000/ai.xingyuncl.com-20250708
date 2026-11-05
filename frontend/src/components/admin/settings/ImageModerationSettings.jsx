import React, { useEffect, useState } from 'react';
import { Alert, Button, Input, Modal, Select, Space, Table, Tag, message } from 'antd';
import { useTranslation } from 'react-i18next';
import api from '../../../utils/api';
import ProtectedImage from '../../common/ProtectedImage';

export default function ImageModerationSettings() {
  const { t } = useTranslation();
  const [state, setState] = useState('pending'), [page, setPage] = useState(1);
  const [data, setData] = useState({ data: [], total: 0 }), [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null), [reason, setReason] = useState('');
  const [events, setEvents] = useState(null), [busy, setBusy] = useState(false);
  const load = async () => {
    setLoading(true);
    try { setData((await api.get('/image/admin/moderation', { params: { state, page } })).data.data); }
    finally { setLoading(false); }
  };
  useEffect(() => { load().catch(() => {}); }, [state, page]);
  const act = async (path, body) => {
    setBusy(true);
    try {
      await api.post(`/image/admin/moderation/${path}`, body);
      message.success(t('image.moderation.saved'));
      setSelected(null); setReason(''); await load();
    } catch (e) { message.error(e.response?.data?.message || t('image.moderation.failed')); }
    finally { setBusy(false); }
  };
  return <Space direction="vertical" style={{ width: '100%' }}>
    <Alert showIcon type={data.providerConfigured ? 'info' : 'warning'} message={t(data.providerConfigured ? 'image.moderation.policy' : 'image.moderation.unconfigured')} />
    <Space>
      <Select value={state} style={{ width: 160 }} onChange={v => { setState(v); setPage(1); }} options={['pending', 'review', 'block', 'error', 'pass', 'reported'].map(value => ({ value, label: t(`image.moderation.${value}`) }))} />
      <Button onClick={load} loading={loading}>{t('image.moderation.refresh')}</Button>
    </Space>
    <Table rowKey="id" dataSource={data.data} loading={loading} pagination={{ current: page, total: data.total, pageSize: 30, showSizeChanger: false, onChange: setPage }} columns={[
      { title: 'ID', dataIndex: 'id', width: 90 },
      { title: t('image.moderation.user'), dataIndex: 'user_id', width: 100 },
      { title: t('image.moderation.prompt'), dataIndex: 'prompt', ellipsis: true },
      { title: t('image.moderation.status'), dataIndex: 'moderation_status', render: v => <Tag>{t(`image.moderation.${v}`)}</Tag> },
      { title: t('image.moderation.reports'), dataIndex: 'reports', width: 80 },
      { title: t('image.moderation.actions'), render: (_, row) => <Button onClick={() => { setSelected(row); setReason(''); }}>{t('image.moderation.reviewAction')}</Button> }
    ]} />
    <Modal title={t('image.moderation.reviewAction')} open={!!selected} onCancel={() => setSelected(null)} footer={null} width={760}>
      {selected && <Space direction="vertical" style={{ width: '100%' }}>
        <p>{selected.prompt}</p>
        {selected.has_asset ? <ProtectedImage src={`/api/image/admin/moderation/${selected.id}/asset`} alt={t('image.moderation.preview')} style={{ maxHeight: 360 }} /> :
          <Button loading={busy} onClick={() => act(`${selected.id}/import`, {})}>{t('image.moderation.import')}</Button>}
        <Input.TextArea value={reason} onChange={e => setReason(e.target.value)} maxLength={500} showCount placeholder={t('image.moderation.reason')} />
        <Space wrap>
          {['pass', 'block', 'review'].map(value => <Button key={value} danger={value === 'block'} disabled={!reason.trim() || busy || (value === 'pass' && !selected.has_asset)} onClick={() => act(`${selected.id}/decision`, { state: value, reason, revision: selected.revision })}>{t(`image.moderation.${value}`)}</Button>)}
          <Button disabled={!selected.has_asset || busy} onClick={() => act(`${selected.id}/recheck`, {})}>{t('image.moderation.recheck')}</Button>
          <Button danger={!selected.restricted} disabled={!reason.trim() || busy} onClick={() => act(`users/${selected.user_id}/restriction`, { restricted: !selected.restricted, reason })}>{t(selected.restricted ? 'image.moderation.restoreUser' : 'image.moderation.restrictUser')}</Button>
          <Button onClick={async () => setEvents((await api.get(`/image/admin/moderation/${selected.id}/events`)).data.data)}>{t('image.moderation.audit')}</Button>
        </Space>
      </Space>}
    </Modal>
    <Modal open={!!events} title={t('image.moderation.audit')} onCancel={() => setEvents(null)} footer={null}>
      {(events?.reports || []).map((r, i) => <p key={`r${i}`}>{r.user_id}: {r.reason}</p>)}
      {(events?.events || []).map(e => <p key={e.id}>{e.created_at} · {e.action} · {e.state} · {e.reason}</p>)}
    </Modal>
  </Space>;
}
