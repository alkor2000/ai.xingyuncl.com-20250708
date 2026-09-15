/**
 * 每个实验步骤的图标与颜色：步骤栏、步骤卡标题、向导进度条共用，让孩子一眼认出"现在在哪一步"。
 * 颜色按步骤的性质分组：准备（紫/橙）、锁定（蓝）、训练（玫红）、测试（青绿）、分析（琥珀）、改进（靛）、写作（绿）。
 */
import React from 'react'
import {
  BulbOutlined, CameraOutlined, AudioOutlined, TableOutlined, EditOutlined, InboxOutlined, IdcardOutlined, LockOutlined,
  ControlOutlined, RocketOutlined, ClusterOutlined, TagsOutlined, TeamOutlined, SafetyOutlined, ExperimentOutlined,
  CloudOutlined, CompassOutlined, SearchOutlined, WarningOutlined, MedicineBoxOutlined, SyncOutlined, TrophyOutlined,
  ProfileOutlined, FileTextOutlined, ScissorOutlined, CheckSquareOutlined, FormOutlined, CommentOutlined
} from '@ant-design/icons'

const META = {
  predict: { icon: BulbOutlined, color: '#7c5cff' },
  collect: { icon: CameraOutlined, color: '#f28c28' },
  import_preset: { icon: InboxOutlined, color: '#f28c28' },
  data_card: { icon: IdcardOutlined, color: '#e8a317' },
  lock: { icon: LockOutlined, color: '#4c6ef5' },
  rules: { icon: ControlOutlined, color: '#0ca678' },
  train: { icon: RocketOutlined, color: '#e64980' },
  train_mlp: { icon: ClusterOutlined, color: '#e64980' },
  annotate: { icon: TagsOutlined, color: '#f28c28' },
  agreement: { icon: TeamOutlined, color: '#0ca678' },
  fairness: { icon: SafetyOutlined, color: '#f59f00' },
  test_holdout: { icon: ExperimentOutlined, color: '#12b886' },
  test_shift: { icon: CloudOutlined, color: '#15aabf' },
  condition_design: { icon: CompassOutlined, color: '#15aabf' },
  errors: { icon: SearchOutlined, color: '#f59f00' },
  mislabel: { icon: WarningOutlined, color: '#fa5252' },
  restore: { icon: MedicineBoxOutlined, color: '#40c057' },
  iterate: { icon: SyncOutlined, color: '#5f3dc4' },
  compare: { icon: TrophyOutlined, color: '#5f3dc4' },
  model_card: { icon: ProfileOutlined, color: '#40c057' },
  material: { icon: FileTextOutlined, color: '#7c5cff' },
  claims: { icon: ScissorOutlined, color: '#f28c28' },
  verdicts: { icon: CheckSquareOutlined, color: '#12b886' },
  revise: { icon: FormOutlined, color: '#5f3dc4' },
  reflection: { icon: CommentOutlined, color: '#40c057' }
}
const KIND_COLLECT_ICON = { audio: AudioOutlined, table: TableOutlined, text: EditOutlined }

/** 数据类型的图标与颜色（实验列表、新建弹窗、页头） */
const KIND_META = {
  image: { icon: CameraOutlined, color: '#f28c28' },
  audio: { icon: AudioOutlined, color: '#7c5cff' },
  table: { icon: TableOutlined, color: '#12b886' },
  text: { icon: EditOutlined, color: '#4c6ef5' }
}
export const kindMeta = (kind) => KIND_META[kind] || KIND_META.image
/** 学段颜色：小学橙、初中绿、高中蓝、高阶紫 */
export const GRADE_COLORS = { L: '#f28c28', P: '#12b886', M: '#4c6ef5', H: '#7c5cff' }

export const stepMeta = (key, kind = 'image') => {
  const m = META[key] || { icon: ExperimentOutlined, color: '#868e96' }
  if (key === 'collect' && KIND_COLLECT_ICON[kind]) return { ...m, icon: KIND_COLLECT_ICON[kind] }
  return m
}

/** 圆形图标徽章：size 像素；done 时换成绿色对勾底色 */
export const StepBadge = ({ stepKey, kind, size = 28, done = false, active = false, index }) => {
  const { icon: Icon, color } = stepMeta(stepKey, kind)
  const bg = done ? '#2c7a5a' : color
  return (
    <span className={`ailab-step-badge ${active ? 'active' : ''} ${done ? 'done' : ''}`} style={{ width: size, height: size, background: bg, boxShadow: active ? `0 0 0 4px ${color}33` : 'none' }} aria-hidden="true">
      <Icon style={{ fontSize: Math.round(size * 0.52) }} />
      {typeof index === 'number' && <i className="ailab-step-badge-no">{index}</i>}
    </span>
  )
}
