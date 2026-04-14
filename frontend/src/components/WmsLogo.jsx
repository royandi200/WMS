export default function WmsLogo({ size = 40 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="WMS Logo"
    >
      <rect x="2" y="18" width="36" height="20" rx="1" fill="#1c2333" stroke="#f0883e" strokeWidth="1.5" />
      <path d="M1 19 L20 6 L39 19" stroke="#f0883e" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
      <rect x="15" y="26" width="10" height="12" rx="0.5" fill="#f0883e" opacity="0.9" />
      <rect x="5"  y="22" width="7" height="5" rx="0.5" fill="#f0883e" opacity="0.3" />
      <rect x="28" y="22" width="7" height="5" rx="0.5" fill="#f0883e" opacity="0.3" />
    </svg>
  )
}
