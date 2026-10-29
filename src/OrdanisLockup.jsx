// The ORDANIS stacked lockup, drawn exactly as the portal draws it (App.jsx BrandLockupSVG, cropped viewBox): same
// wordmark, rule and tagline, same proportions. Used by the native app's opening, lock screen and access-code card,
// so the tagline is the same size everywhere (the old logo image had a smaller, lighter tagline).
// `reversed` is the white / gold version for navy backgrounds.
import React from "react";

export default function OrdanisLockup({ reversed = false, style }) {
  const word = reversed ? "#FFFFFF" : "#0A2540";
  const tag = reversed ? "#E6EAF0" : "#3F5470";
  return (
    <svg viewBox="162 45 436 123" style={{ display: "block", height: "auto", ...style }} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="ORDANIS">
      <text x="380" y="105" textAnchor="middle" fontFamily="Georgia, 'Times New Roman', serif" fontWeight="bold" fontSize="70" letterSpacing="9" fill={word}>ORDANIS</text>
      <line x1="195.8" y1="133" x2="564.2" y2="133" stroke="#C9A961" strokeWidth="2" />
      <text x="380" y="160" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontSize="15.5" letterSpacing="3.35" fill={tag} fontWeight="bold">PRIVATE WEALTH ADMINISTRATION</text>
    </svg>
  );
}
