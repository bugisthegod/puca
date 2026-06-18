type FavStarProps = {
	active: boolean;
	onToggle: () => void;
	title?: string;
};

export default function FavStar({ active, onToggle, title }: FavStarProps) {
	const label =
		title ?? (active ? "Remove from favorites" : "Save to favorites");
	return (
		<button
			type="button"
			className="fav-star"
			aria-pressed={active}
			aria-label={label}
			title={label}
			onClick={(e) => {
				e.stopPropagation();
				onToggle();
			}}
		>
			<svg
				viewBox="0 0 24 24"
				width="18"
				height="18"
				fill={active ? "currentColor" : "none"}
				stroke="currentColor"
				strokeWidth="1.75"
				strokeLinecap="round"
				strokeLinejoin="round"
				aria-hidden="true"
			>
				<path d="M12 2.5l2.9 6.6 7.1.7-5.3 4.9 1.6 7.1L12 18l-6.3 3.8 1.6-7.1L2 9.8l7.1-.7z" />
			</svg>
		</button>
	);
}
