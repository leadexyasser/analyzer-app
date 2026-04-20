'use client'

import { useRef, useState, useCallback, useEffect } from 'react'

interface Props {
  src: string
  onTimeUpdate?: (t: number) => void
  seekTo?: number
}

function fmt(s: number) {
  const m = Math.floor(s / 60)
  const ss = Math.floor(s % 60)
  return `${m}:${String(ss).padStart(2, '0')}`
}

export function AudioPlayer({ src, onTimeUpdate, seekTo }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [speed, setSpeed] = useState(1)

  const toggle = () => {
    const a = audioRef.current
    if (!a) return
    if (playing) a.pause()
    else a.play()
  }

  const seek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current
    const bar = barRef.current
    if (!a || !bar || !duration) return
    const rect = bar.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    a.currentTime = ratio * duration
  }, [duration])

  const toggleMute = () => {
    const a = audioRef.current
    if (!a) return
    a.muted = !muted
    setMuted(m => !m)
  }

  useEffect(() => {
    if (seekTo == null || !audioRef.current) return
    audioRef.current.currentTime = seekTo
    audioRef.current.play()
  }, [seekTo])

  const pct = duration ? (current / duration) * 100 : 0
  const speeds = [0.75, 1, 1.25, 1.5, 2]

  return (
    <div
      className="rounded-xl p-5 space-y-4"
      style={{ background: 'var(--rb-surface)', border: '1px solid var(--rb-border)' }}
    >
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration ?? 0)}
        onTimeUpdate={() => {
          const t = audioRef.current?.currentTime ?? 0
          setCurrent(t)
          onTimeUpdate?.(t)
        }}
      />

      {/* Progress bar */}
      <div
        ref={barRef}
        className="w-full h-2 rounded-full cursor-pointer group relative"
        style={{ background: 'var(--rb-border-2)' }}
        onClick={seek}
        role="slider"
        aria-label="Seek"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full relative transition-all"
          style={{ width: `${pct}%`, background: 'var(--rb-accent)' }}
        >
          <div
            className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ background: '#fff' }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        {/* Play / pause */}
        <button
          onClick={toggle}
          aria-label={playing ? 'Pause' : 'Play'}
          className="w-10 h-10 rounded-full flex items-center justify-center transition-opacity hover:opacity-80 shrink-0"
          style={{ background: 'var(--rb-accent)' }}
        >
          {playing ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="#0d1117">
              <rect x="2" y="1" width="4" height="12" rx="1" />
              <rect x="8" y="1" width="4" height="12" rx="1" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="#0d1117">
              <path d="M3 1.5l10 5.5-10 5.5V1.5z" />
            </svg>
          )}
        </button>

        {/* Time */}
        <span className="text-xs font-mono tabular-nums" style={{ color: 'var(--rb-text-3)' }}>
          {fmt(current)} / {fmt(duration)}
        </span>

        {/* Speed */}
        <div className="flex items-center gap-1">
          {speeds.map(s => (
            <button
              key={s}
              onClick={() => {
                setSpeed(s)
                if (audioRef.current) audioRef.current.playbackRate = s
              }}
              className="text-xs px-1.5 py-0.5 rounded transition-colors"
              style={
                speed === s
                  ? { background: 'var(--rb-accent)22', color: 'var(--rb-accent)', border: '1px solid var(--rb-accent)44' }
                  : { background: 'var(--rb-surface-2)', color: 'var(--rb-text-3)', border: '1px solid transparent' }
              }
            >
              {s.toFixed(2).replace('.00', '.0')}×
            </button>
          ))}
        </div>

        {/* Mute + Volume */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={toggleMute}
            aria-label={muted ? 'Unmute' : 'Mute'}
            className="transition-opacity hover:opacity-70"
            style={{ color: muted ? 'var(--rb-text-3)' : 'var(--rb-text-2)' }}
          >
            {muted ? (
              <svg width="13" height="13" viewBox="0 0 13 13" fill="currentColor">
                <path d="M1 4h2l3-3v10L3 8H1V4z" />
                <line x1="9" y1="4" x2="12" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="12" y1="4" x2="9" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 13 13" fill="currentColor">
                <path d="M1 4h2l3-3v10L3 8H1V4z" />
                {volume > 0 && <path d="M8 2.5a4.5 4.5 0 010 8M9.5 1a7 7 0 010 11" stroke="currentColor" strokeWidth="1" fill="none" />}
              </svg>
            )}
          </button>
          <input
            type="range" min="0" max="1" step="0.05" value={muted ? 0 : volume}
            aria-label="Volume"
            className="w-16"
            style={{ accentColor: 'var(--rb-accent)' }}
            onChange={e => {
              const v = Number(e.target.value)
              setVolume(v)
              setMuted(false)
              if (audioRef.current) { audioRef.current.volume = v; audioRef.current.muted = false }
            }}
          />
        </div>
      </div>
    </div>
  )
}
