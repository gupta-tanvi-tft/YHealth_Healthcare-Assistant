import React from 'react'

export default function YHealthLogo({ size = 36, className = "" }) {
  return (
    <div
      className={className}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: `${Math.round(size * 0.22)}px`,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 50%, #94a3b8 100%)',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
        flexShrink: 0
      }}
    >
      <svg
        viewBox="0 0 512 512"
        width={Math.round(size * 0.85)}
        height={Math.round(size * 0.85)}
        style={{ display: 'block' }}
      >
        {/* Left diagonal chevron arm of Y */}
        <polygon
          points="142,130 216,130 262,250 192,250"
          fill="#000000"
        />
        {/* Right diagonal arm and vertical stem of Y */}
        <polygon
          points="300,130 370,130 286,382 218,382 258,258 290,165"
          fill="#000000"
        />
      </svg>
    </div>
  )
}
