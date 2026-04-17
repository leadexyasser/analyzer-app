'use client'

interface Props {
  src: string
}

export function AudioPlayer({ src }: Props) {
  return (
    <audio
      controls
      className="w-full"
      preload="metadata"
      src={src}
    >
      Your browser does not support the audio element.
    </audio>
  )
}
