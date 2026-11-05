import React, { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Input, Modal, Select, Space, Table, Tag, message } from 'antd';
import { useTranslation } from 'react-i18next';
import api from '../../../utils/api';
import ProtectedImage from '../../common/ProtectedImage';

export default function GalleryReviewSettings() {
  const { t } = useTranslation();
  const [state, setState] = useState('pending'), [page, setPage] = useState(1);
  const [data, setData] = useState({ data: [], total: 0 }), [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null), [reason, setReason] = useState('');
  const [seen, setSeen] = useState(false), [checked, setChecked] = useState(false), [busy, setBusy] = useState(false);
  const load = async () => {
    setLoading(true);
    try { setData((await api.get('/image/gallery-review', { params: { state, page } })).data.data); }
    catch (e) { message.error(e.response?.data?.message || t('image.moderation.failed')); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [state, page]);
  const act = async (action, body) => {
    setBusy(true);
    try {
      await api.post(`/image/gallery-review/${selected.id}/${action}`, body);
      message.success(t('image.moderation.saved')); setSelected(null); await load();
    } catch (e) { message.error(e.response?.data?.message || t('image.moderation.failed')); }
    finally { setBusy(false); }
  };
  return <Space direction="vertical" style={{ width: '100%' }}>
    <Alert showIcon type="warning" message={t('image.galleryReview.policy')} />
    <Space>
      <Select value={state} style={{ width: 180 }} options={['pending', 'approved', 'rejected'].map(value => ({ value, label: t(`image.galleryReview.${value}`) }))} onChange={v => { setState(v); setPage(1); }} />
      <Button onClick={load} loading={loading}>{t('image.moderation.refresh')}</Button>
    </Space>
    <Table rowKey="id" dataSource={data.data} loading={loading} pagination={{ current: page, total: data.total, pageSize: 30, showSizeChanger: false, onChange: setPage }} columns={[
      { title: 'ID', dataIndex: 'id', width: 90 },
      { title: t('image.moderation.user'), dataIndex: 'username' },
      { title: t('image.moderation.prompt'), dataIndex: 'prompt', ellipsis: true },
      { title: t('image.moderation.status'), dataIndex: 'gallery_state', render: v => <Tag>{t(`image.galleryReview.${v}`)}</Tag> },
      { title: t('image.moderation.actions'), render: (_, row) => <Button onClick={() => { setSelected(row); setReason(''); setSeen(false); setChecked(false); }}>{t('image.moderation.reviewAction')}</Button> }
    ]} />
    <Modal title={t('image.galleryReview.title')} open={!!selected} onCancel={() => { if (!busy) setSelected(null); }} footer={null} width={800}>
      {selected && <Space direction="vertical" style={{ width: '100%' }}>
        <p>{selected.prompt}</p>
        {selected.negative_prompt && <p>{selected.negative_prompt}</p>}
        {selected.has_asset ? <ProtectedImage native src={`/api/image/gallery-review/${selected.id}/asset`} alt={t('image.moderation.preview')} style={{ maxWidth: '100%', maxHeight: 480 }} onLoad={() => setSeen(true)} onError={() => setSeen(false)} /> :
          <Button loading={busy} onClick={() => act('import', {})}>{t('image.moderation.import')}</Button>}
        <Checkbox checked={checked} disabled={!seen || busy} onChange={e => setChecked(e.target.checked)}>{t('image.galleryReview.confirm')}</Checkbox>
        <Input.TextArea value={reason} onChange={e => setReason(e.target.value)} maxLength={500} showCount placeholder={t('image.moderation.reason')} />
        <Space>
          <Button type="primary" disabled={busy || !seen || !checked || !reason.trim() || selected.gallery_state !== 'pending' || selected.moderation_status === 'block'} onClick={() => act('decision', { state: 'approved', reason, revision: selected.revision })}>{t('image.galleryReview.approve')}</Button>
          <Button danger disabled={busy || !reason.trim() || selected.gallery_state === 'rejected'} onClick={() => act('decision', { state: 'rejected', reason, revision: selected.revision })}>{t('image.galleryReview.reject')}</Button>
        </Space>
      </Space>}
    </Modal>
  </Space>;
}
