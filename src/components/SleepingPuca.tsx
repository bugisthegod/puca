import React from "react";

type Props = {
  size?: number;
};

export default function SleepingPuca({ size = 56 }: Props) {
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} fill="none" aria-hidden="true">
      <g transform="translate(56 52) scale(0.78)">
        <path
          d="M 112 152 C 112 88, 168 72, 220 72 L 292 72 C 344 72, 400 88, 400 152 L 400 392 Q 376 444, 340 416 Q 304 390, 272 416 Q 240 442, 210 416 Q 180 390, 148 416 Q 118 442, 112 396 Z"
          fill="#ffffff"
          stroke="#16161c"
          strokeWidth="16"
          strokeLinejoin="round"
        />
        <path
          d="M 110 260 C 70 256, 54 292, 64 324 C 74 348, 104 346, 116 330 Z"
          fill="#ffffff"
          stroke="#16161c"
          strokeWidth="16"
          strokeLinejoin="round"
        />
        <path
          d="M 402 260 C 442 256, 458 292, 448 324 C 438 348, 408 346, 396 330 Z"
          fill="#ffffff"
          stroke="#16161c"
          strokeWidth="16"
          strokeLinejoin="round"
        />
        <path
          d="M 172 234 Q 199 272, 226 234"
          fill="none"
          stroke="#16161c"
          strokeWidth="16"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M 286 234 Q 313 272, 340 234"
          fill="none"
          stroke="#16161c"
          strokeWidth="16"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M 240 318 L 272 318"
          stroke="#16161c"
          strokeWidth="14"
          strokeLinecap="round"
        />
      </g>
      <g fill="currentColor" fontFamily="system-ui, -apple-system, 'Helvetica Neue', sans-serif" fontWeight="700">
        <text x="372" y="158" fontSize="40">z</text>
        <text x="408" y="112" fontSize="56">Z</text>
        <text x="448" y="64" fontSize="72">Z</text>
      </g>
    </svg>
  );
}
