type Props = {
	size?: number;
};

export default function PucaMark({ size = 72 }: Props) {
	return (
		<svg
			viewBox="0 0 512 512"
			width={size}
			height={size}
			fill="none"
			aria-hidden="true"
		>
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
				d="M 184 218 L 214 244 L 184 270"
				stroke="#16161c"
				strokeWidth="18"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<path
				d="M 328 218 L 298 244 L 328 270"
				stroke="#16161c"
				strokeWidth="18"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<path
				d="M 240 318 L 272 318"
				stroke="#16161c"
				strokeWidth="14"
				strokeLinecap="round"
			/>
		</svg>
	);
}
