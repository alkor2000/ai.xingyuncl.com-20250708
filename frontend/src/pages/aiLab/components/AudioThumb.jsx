/**
 * 声音样本缩略图：懒算频谱图画成小图，可选带播放按钮
 */
import React, { useEffect, useRef, useState } from 'react'
import { Button } from 'antd'
import { PlayCircleOutlined, PauseCircleOutlined } from '@ant-design/icons'
import { thumbnailForSample } from '../engine/modalities'
import useAiLabStore from '../../../stores/aiLabStore'

const AudioThumb = ({ sample, size, withPlayer = false, onPlay }) => {
  const [src, setSrc] = useState(sample.thumb_url || null)
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef(null)
  const { recordEvent } = useAiLabStore()

  useEffect(() => {
    let cancelled = false
    if (!src && sample.file_url) {
      thumbnailForSample(sample).then((url) => { if (!cancelled) setSrc(url) }).catch(() => {})
    }
    return () => { cancelled = true }
  }, [sample.id, sample.file_url]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (e) => {
    e.stopPropagation()
    const el = audioRef.current
    if (!el) return
    if (playing) { el.pause(); setPlaying(false); return }
    el.currentTime = 0
    el.play().then(() => {
      setPlaying(true)
      if (onPlay) onPlay(sample)
      else if (sample.id && typeof sample.id === 'number') recordEvent('audio.play', { sample_id: sample.id, class_key: sample.class_key, split: sample.split })
    }).catch(() => setPlaying(false))
  }

  const style = size ? { width: size, height: Math.round(size * 0.68) } : undefined
  return (
    <div className="ailab-audio-thumb" style={style}>
      {src ? <img src={src} alt="" /> : <div className="ailab-audio-thumb-loading" />}
      {(withPlayer || sample.file_url) && (
        <>
          <audio ref={audioRef} src={sample.file_url} preload="none" onEnded={() => setPlaying(false)} />
          <Button size="small" type="text" className="ailab-audio-play" icon={playing ? <PauseCircleOutlined /> : <PlayCircleOutlined />} onClick={toggle} />
        </>
      )}
    </div>
  )
}

export default AudioThumb
