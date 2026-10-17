import './BrandLogo.css';

type BrandLogoProps = {
  inverse?: boolean;
  compact?: boolean;
  className?: string;
};

export default function BrandLogo({ inverse = false, compact = false, className = '' }: BrandLogoProps) {
  return (
    <div className={`unitech-brand ${inverse ? 'inverse' : ''} ${compact ? 'compact' : ''} ${className}`.trim()}>
      <svg className="unitech-mark" viewBox="0 0 88 88" aria-hidden="true">
        <defs>
          <linearGradient id="unitech-logo-gradient" x1="12" y1="8" x2="75" y2="78" gradientUnits="userSpaceOnUse">
            <stop stopColor="#0aa7ff" />
            <stop offset=".5" stopColor="#0879f7" />
            <stop offset="1" stopColor="#00d9e8" />
          </linearGradient>
          <linearGradient id="unitech-swoosh" x1="7" y1="70" x2="70" y2="30" gradientUnits="userSpaceOnUse">
            <stop stopColor="#ffffff" />
            <stop offset=".7" stopColor="#eefaff" />
            <stop offset="1" stopColor="#9ee8ff" />
          </linearGradient>
        </defs>
        <path fill="url(#unitech-logo-gradient)" d="M13 9h19v42.5c0 11 5.1 17.2 14 17.2s14-6.2 14-17.2V9h19v43.4C79 75 65.4 86 46 86S13 75 13 52.4V9Z" />
        <path fill="#032d76" d="M17 66.5c17.8-3.6 34.7-14 49.6-34.1-3 22.7-17.6 39.7-42.9 47.3Z" opacity=".92" />
        <path fill="url(#unitech-swoosh)" d="M3.5 69.4c14.8-1 27.7-6.1 39.2-15.7 10.1-8.3 18.8-20 28-35.3-2.9 18.4-10.3 33.7-22.5 45.6C37.4 74.7 23.7 80.5 7.6 81.7c4.6-4.5 8.2-9 10.7-13.6-5.5 2-10.4 2.5-14.8 1.3Z" />
        <path fill="#dff7ff" d="M18.4 68.2c9.8-2.4 18.7-6.5 27-12.7-7 8.1-14.9 13.6-24 16.7Z" opacity=".88" />
      </svg>
      <div className="unitech-wordmark">
        <strong><span>UNITECH</span><b>-EHR</b></strong>
        {!compact && <small>Electronic Health Record</small>}
      </div>
    </div>
  );
}
