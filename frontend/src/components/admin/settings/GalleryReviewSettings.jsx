import React, { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Input, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import { useTranslation } from 'react-i18next';
import api from '../../../utils/api';
import ProtectedVideo from '../../common/ProtectedVideo';
import ProtectedImage from '../../common/ProtectedImage';
import GalleryMachineResult from '../../common/GalleryMachineResult';

export default function GalleryReviewSettings({ media = 'image' }) {
  const kind = media === 'video' ? 'video' : 'image';
  const reviewKey = `${kind}.galleryReview`;
  const { t } = useTranslation();
  const [state, setState] = useState('pending'), [page, setPage] = useState(1);
  const [machine, setMachine] = useState('all'), [groupId, setGroupId] = useState(), [from, setFrom] = useState(''), [to, setTo] = useState('');
  const [groups, setGroups] = useState([]), [selectedRows, setSelectedRows] = useState([]), [batchMode, setBatchMode] = useState(null), [batchReason, setBatchReason] = useState(''), [batchConfirmed, setBatchConfirmed] = useState(false), [batchOutcome, setBatchOutcome] = useState(null);
  const params = { state, page, machine, group_id: groupId, from, to };
  const [data, setData] = useState({ data: [], total: 0 }), [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null), [reason, setReason] = useState('');
  const [mapReview,setMapReview]=useState({source:'',approval:'',usage:''});
  const mapComplete=!selected?.machine_review?.mapDetected||Object.values(mapReview).every(x=>x.trim());
  const [audit, setAudit] = useState(null), [previewVersion, setPreviewVersion] = useState(0);
  const [seen, setSeen] = useState(false), [checked, setChecked] = useState(false), [busy, setBusy] = useState(false);
  const load = async () => {
    setLoading(true); setSelectedRows([]);
    try { setData((await api.get(`/${kind}/gallery-review`, { params })).data.data); }
    catch (e) { message.error(e.response?.data?.message || t('image.moderation.failed')); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [state, page, kind, machine, groupId, from, to]);
  useEffect(() => { api.get(`/${kind}/gallery-review/groups`).then(r => setGroups(r.data.data)).catch(() => setGroups([])); }, [kind]);
  const selectAll = async () => { try { setSelectedRows((await api.get(`/${kind}/gallery-review/selection`, { params })).data.data.items); } catch (e) { message.error(e.response?.data?.message || t('image.moderation.failed')); } };
  const runBatch = async () => {
    setBusy(true);
    try { const result=(await api.post(`/${kind}/gallery-review/batch`, { state:batchMode, reason:batchReason, confirmed:batchConfirmed, items:selectedRows.map(row=>({id:row.id,revision:row.revision})) })).data.data; setBatchOutcome(result);setBatchMode(null);await load(); }
    catch(e){message.error(e.response?.data?.message || t('image.moderation.failed'));}
    finally{setBusy(false);}
  };
  const act = async (action, body) => {
    setBusy(true);
    try {
      await api.post(`/${kind}/gallery-review/${selected.id}/${action}`, body);
      message.success(t('image.moderation.saved')); setSelected(null); await load();
    } catch (e) { message.error(e.response?.data?.message || t('image.moderation.failed')); }
    finally { setBusy(false); }
  };
  return <Space direction="vertical" style={{ width: '100%' }}>
    <Alert showIcon type="warning" message={t(`${reviewKey}.policy`)} />
    <Space wrap>
      <Select value={state} style={{ width: 180 }} options={['pending', 'approved', 'rejected', 'removed', 'reported'].map(value => ({ value, label: t(`${reviewKey}.${value}`) }))} onChange={v => { setState(v); setPage(1); }} />
      <Select aria-label={t('image.galleryReview.machineFilter')} value={machine} style={{width:180}} options={['all','allow','review','reject','map','unchecked'].map(value=>({value,label:t(`image.galleryReview.machine.${value}`)}))} onChange={v=>{setMachine(v);setPage(1);}}/>
      <Select aria-label={t('image.galleryReview.classFilter')} allowClear placeholder={t('image.galleryReview.classFilter')} value={groupId} style={{width:180}} options={groups.map(g=>({value:g.id,label:g.name}))} onChange={v=>{setGroupId(v);setPage(1);}}/>
      <Input aria-label={t('image.galleryReview.from')} type="date" value={from} style={{width:150}} onChange={e=>{setFrom(e.target.value);setPage(1);}}/>
      <Input aria-label={t('image.galleryReview.to')} type="date" value={to} style={{width:150}} onChange={e=>{setTo(e.target.value);setPage(1);}}/>
      <Button onClick={load} loading={loading}>{t('image.moderation.refresh')}</Button>
    </Space>
    <Space wrap>
      <Button disabled={loading||busy} onClick={selectAll}>{t('image.galleryReview.selectAll')}</Button>
      <Typography.Text>{t('image.galleryReview.selectedCount',{count:selectedRows.length})}</Typography.Text>
      <Button type="primary" disabled={busy||!selectedRows.length||selectedRows.some(x=>x.gallery_state!=='pending'||x.machine_decision!=='allow'||x.map_detected)} onClick={()=>{setBatchMode('approved');setBatchReason('');setBatchConfirmed(false);}}>{t('image.galleryReview.batchApprove')}</Button>
      <Button danger disabled={busy||!selectedRows.length} onClick={()=>{setBatchMode('rejected');setBatchReason('');setBatchConfirmed(false);}}>{t('image.galleryReview.batchReject')}</Button>
    </Space>
    <Typography.Text type="secondary">{t('image.galleryReview.batchNote')}</Typography.Text>
    {batchOutcome&&<Alert type={batchOutcome.failed?'warning':'success'} message={t('image.galleryReview.batchOutcome',{applied:batchOutcome.applied,failed:batchOutcome.failed})} description={batchOutcome.results.filter(x=>!x.success).map(x=><div key={x.id}>ID {x.id}: {x.message}</div>)}/>}
    <Table rowSelection={{selectedRowKeys:selectedRows.map(x=>x.id),onChange:(_,rows)=>setSelectedRows(rows)}} scroll={{ x: 850 }} rowKey="id" dataSource={data.data} loading={loading} pagination={{ current: page, total: data.total, pageSize: 30, showSizeChanger: false, onChange: setPage }} columns={[
      { title: 'ID', dataIndex: 'id', width: 90 },
      { title: t('image.moderation.user'), dataIndex: 'username' },
      { title: t('image.galleryReview.classFilter'), dataIndex: 'group_name' },
      { title: t('image.galleryReview.machineFilter'), dataIndex: 'machine_decision', render: v => <Tag>{t(`image.galleryReview.machine.${v||'unchecked'}`)}</Tag> },
      { title: t('image.moderation.prompt'), dataIndex: 'prompt', ellipsis: true },
      { title: t('image.moderation.status'), dataIndex: 'gallery_state', render: v => <Tag>{t(`${reviewKey}.${v}`)}</Tag> },
      { title: t('image.moderation.reports'), dataIndex: 'reports' },
      { title: t('image.moderation.actions'), render: (_, row) => <Button onClick={() => { setMapReview({source:'',approval:'',usage:''}); setPreviewVersion(v => v + 1); setSelected(row); setReason(''); setSeen(false); setChecked(false); setAudit(null); }}>{t('image.moderation.reviewAction')}</Button> }
    ]} />
    <Modal open={!!batchMode} title={t(batchMode==='approved'?'image.galleryReview.batchApprove':'image.galleryReview.batchReject')} onCancel={()=>{if(!busy)setBatchMode(null);}} onOk={runBatch} confirmLoading={busy} okButtonProps={{disabled:!batchReason.trim()||!batchConfirmed||busy}}>
      <Typography.Paragraph>{t('image.galleryReview.selectedCount',{count:selectedRows.length})}</Typography.Paragraph>
      <Input.TextArea aria-label={t('image.galleryReview.batchReason')} placeholder={t('image.galleryReview.batchReason')} maxLength={500} value={batchReason} onChange={e=>setBatchReason(e.target.value)}/>
      <Checkbox checked={batchConfirmed} onChange={e=>setBatchConfirmed(e.target.checked)}>{t('image.galleryReview.batchConfirm')}</Checkbox>
    </Modal>
    <Modal title={t(`${reviewKey}.title`)} open={!!selected} onCancel={() => { if (!busy) setSelected(null); }} footer={null} width={800}>
      {selected && <Space direction="vertical" style={{ width: '100%' }}>
        <p>{selected.prompt}</p>
        <GalleryMachineResult result={selected.machine_review}/>
        <Button loading={busy} onClick={()=>act('recheck',{})}>{t('image.galleryReview.recheck')}</Button>
        {selected.gallery_reason && <Alert type="info" message={selected.gallery_reason} />}
        {selected.negative_prompt && <p>{selected.negative_prompt}</p>}
        {selected.has_asset ? kind === 'video' ? <ProtectedVideo key={previewVersion} autoLoad controls src={`/api/video/gallery-review/${selected.id}/asset`} style={{ width: '100%', maxHeight: 480 }} onEnded={() => setSeen(true)} onError={() => setSeen(false)} /> : <ProtectedImage key={previewVersion} native src={`/api/image/gallery-review/${selected.id}/asset`} alt={t('image.moderation.preview')} style={{ maxWidth: '100%', maxHeight: 480 }} onLoad={() => setSeen(true)} onError={() => setSeen(false)} /> :
          <Button loading={busy} onClick={() => act('import', {})}>{t('image.moderation.import')}</Button>}
        {selected.machine_review?.mapDetected&&<Space direction="vertical" style={{width:'100%'}}>{[['source',300],['approval',120],['usage',200]].map(([key,max])=><Input key={key} aria-label={t(`image.galleryReview.map.${key}`)} placeholder={t(`image.galleryReview.map.${key}`)} maxLength={max} value={mapReview[key]} onChange={e=>setMapReview({...mapReview,[key]:e.target.value})}/>)}</Space>}
        <Checkbox checked={checked} disabled={!seen || busy} onChange={e => setChecked(e.target.checked)}>{t(`${reviewKey}.confirm`)}</Checkbox>
        <Input.TextArea value={reason} onChange={e => setReason(e.target.value)} maxLength={500} showCount placeholder={t('image.moderation.reason')} />
        <Space wrap>
          <Button type="primary" disabled={busy || !seen || !checked || !mapComplete || !reason.trim() || selected.gallery_state !== 'pending' || (selected.moderation_status === 'block' || !selected.machine_review || selected.machine_review.decision === 'reject')} onClick={() => act('decision', { state: 'approved', reason, revision: selected.revision, mapReview })}>{t(`${reviewKey}.approve`)}</Button>
          {selected.gallery_state === 'approved' && <Button danger disabled={busy || !reason.trim()} onClick={() => act('visibility', { action: 'down', reason, revision: selected.revision })}>{t(`${reviewKey}.takedown`)}</Button>}
          {['removed','reported'].includes(selected.gallery_state) && <Button type="primary" disabled={busy || !seen || !checked || !mapComplete || !reason.trim() || (selected.moderation_status !== 'pass' || !selected.machine_review || selected.machine_review.decision === 'reject')} onClick={() => act('visibility', { action: 'restore', reviewed: checked, reason, revision: selected.revision, mapReview })}>{t(`${reviewKey}.restore`)}</Button>}
          <Button danger disabled={busy || !reason.trim() || selected.gallery_state === 'rejected'} onClick={() => act('decision', { state: 'rejected', reason, revision: selected.revision })}>{t(`${reviewKey}.reject`)}</Button>
        </Space>
        <Button onClick={async () => { try { setAudit((await api.get(`/${kind}/gallery-review/${selected.id}/events`)).data.data); } catch { message.error(t('image.moderation.failed')); } }}>{t('image.moderation.audit')}</Button>
        {audit && <div>
          <Typography.Paragraph>{t('image.galleryReview.threshold', { count: audit.threshold })}</Typography.Paragraph>
          <Table scroll={{ x: 600 }} size="small" rowKey={(_, i) => `report-${i}`} pagination={false} dataSource={audit.reports} columns={[
            { title: t('image.galleryReview.selectReason'), dataIndex: 'category', render: v => t(`image.galleryReview.reportCategory.${v}`) },
            { title: t('image.moderation.reason'), dataIndex: 'reason' },
            { title: t('image.galleryReview.time'), dataIndex: 'created_at' }
          ]} />
          <Table scroll={{ x: 600 }} size="small" rowKey={(_, i) => `event-${i}`} pagination={false} dataSource={audit.events} columns={[
            { title: t('image.galleryReview.actor'), dataIndex: 'actor_id' },
            { title: t('image.moderation.status'), dataIndex: 'state' },
            { title: t('image.moderation.reason'), dataIndex: 'reason' },
            { title: t('image.galleryReview.time'), dataIndex: 'created_at' }
          ]} />
        </div>}
      </Space>}
    </Modal>
  </Space>;
}
