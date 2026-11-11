import React, { useEffect, useState } from 'react';
import { Alert, Button, Modal, Select, Space, Table, Tag, message } from 'antd';
import { useTranslation } from 'react-i18next';
import api from '../../../utils/api';
import useAuthStore from '../../../stores/authStore';
export default function SharedWorkSettings() {
  const {t}=useTranslation(),{user}=useAuthStore();
  const [data,setData]=useState({data:[],total:0}),[page,setPage]=useState(1),[reported,setReported]=useState('false'),[group,setGroup]=useState(),[groups,setGroups]=useState([]),[busy,setBusy]=useState(false),[audit,setAudit]=useState(null);
  const load=async()=>{setBusy(true);try{setData((await api.get('/shared-works',{params:{page,reported,group_id:group}})).data.data);}catch(e){message.error(e.response?.data?.message||t('sharedWorks.failed'));}finally{setBusy(false);}};
  useEffect(()=>{load();},[page,reported,group]);
  useEffect(()=>{api.get('/shared-works/groups').then(r=>setGroups(r.data.data)).catch(()=>{});},[]);
  const act=async(row,action)=>{setBusy(true);try{await api.post(`/shared-works/${row.kind}/${row.id}/${action}`,{revision:row.revision});setAudit(null);await load();}catch(e){message.error(e.response?.data?.message||t('sharedWorks.failed'));setBusy(false);}};
  return <Space direction="vertical" style={{width:'100%'}}><Alert type="info" message={t('sharedWorks.policy')}/><Space wrap>
    <Select aria-label={t('image.galleryReview.classFilter')} allowClear placeholder={t('image.galleryReview.classFilter')} value={group} style={{width:180}} options={groups.map(g=>({value:g.id,label:g.name}))} onChange={v=>{setGroup(v);setPage(1);}}/>
    {user?.role==='super_admin'&&<Select value={reported} style={{width:180}} options={[{value:'false',label:t('sharedWorks.all')},{value:'true',label:t('sharedWorks.reported')}]} onChange={v=>{setReported(v);setPage(1);}}/>}<Button onClick={load}>{t('image.moderation.refresh')}</Button></Space>
    <Table rowKey={r=>`${r.kind}-${r.id}`} dataSource={data.data} loading={busy} scroll={{x:850}} pagination={{current:page,pageSize:30,total:data.total,showSizeChanger:false,onChange:setPage}} columns={[
      {title:t('sharedWorks.title'),dataIndex:'title'}, {title:t('sharedWorks.type'),dataIndex:'kind',render:v=>t(`sharedWorks.${v}`)},
      {title:t('image.moderation.user'),dataIndex:'username'}, {title:t('image.galleryReview.classFilter'),dataIndex:'group_name'},
      {title:t('sharedWorks.status'),dataIndex:'state',render:v=><Tag>{t(`sharedWorks.${v}`)}</Tag>},
      {title:t('image.moderation.reports'),dataIndex:'reports'},
      {title:t('image.moderation.actions'),render:(_,row)=><Space wrap>
        {row.state==='published'&&<><a href={row.link} target="_blank" rel="noopener noreferrer">{t('sharedWorks.view')}</a><Button danger disabled={busy} onClick={()=>act(row,'withdraw')}>{t('sharedWorks.withdraw')}</Button></>}
        {user?.role==='super_admin'&&<Button onClick={async()=>{try{setAudit({row,reports:(await api.get(`/shared-works/${row.kind}/${row.id}/reports`)).data.data});}catch{message.error(t('sharedWorks.failed'));}}}>{t('sharedWorks.reports')}</Button>}
      </Space>}
    ]}/>
    <Modal open={!!audit} title={t('sharedWorks.reports')} onCancel={()=>setAudit(null)} footer={audit&&<Button loading={busy} onClick={()=>act(audit.row,'resolve')}>{t('sharedWorks.resolve')}</Button>}>
      {audit?.reports.map((r,i)=><p key={i}>{r.reason} — {r.created_at} {r.resolved_at&&t('sharedWorks.resolved')}</p>)}
    </Modal>
  </Space>;
}
