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

  useEffect(() => {
    if (seekTo == null || !audioRef.current) return
    audioRef.current.currentTime = seekTo
    audioRef.current.play()
  }, [seekTo])

  const pct = duration ? (current / duration) * 100 : 0
  const speeds = [0.75, 1, 1.25, 1.5, 2]

  return (
    <div className="bg-gradient-to-r from-slate-900 to-slate-800 rounded-2xl p-5 text-white space-y-4">
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
        className="w-full h-2 bg-white/20 rounded-full cursor-pointer group relative"
        onClick={seek}
      >
        <div
          className="h-full bg-indigo-400 rounded-full relative"
          style={{ width: `${pct}%` }}
        >
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        {/* Play / pause */}
        <button
          onClick={toggle}
          className="w-10 h-10 rounded-full bg-indigo-500 hover:bg-indigo-400 flex items-center justify-center transition-colors shrink-0"
        >
          {playing ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="white">
              <rect x="2" y="1" width="4" height="12" rx="1" />
              <rect x="8" y="1" width="4" height="12" rx="1" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="white">
              <path d="M3 1.5l10 5.5-10 5.5V1.5z" />
            </svg>
          )}
        </button>

        {/* Time */}
        <span className="text-xs font-mono text-white/70 tabular-nums">
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
              className={`text-xs px-1.5 py-0.5 rounded transition-colors ${speed === s ? 'bg-indigo-500 text-white' : 'text-white/50 hover:text-white/80'}`}
            >
              {s}×
            </button>
          ))}
        </div>

        {/* Volume */}
        <div className="flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className="text-white/50">
            <path d="M1 4h2l3-3v10L3 8H1V4z" />
            {volume > 0 && <path d="M8 2a5 5 0 010 8M9.5.5a7 7 0 010 11" stroke="currentColor" strokeWidth="1" fill="none" />}
          </svg>
          <input
            type="range" min="0" max="1" step="0.05" value={volume}
            className="w-16 accent-indigo-400"
            onChange={e => {
              const v = Number(e.target.value)
              setVolume(v)
              if (audioRef.current) audioRef.current.volume = v
            }}
          />
        </div>
      </div>
    </div>
  )
}
