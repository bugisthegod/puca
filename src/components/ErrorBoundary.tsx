import { Component, type ErrorInfo, type ReactNode } from "react";
import { t } from "../i18n";
import PucaMark from "./PucaMark";

interface Props {
	children: ReactNode;
}

interface State {
	hasError: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
	override state: State = { hasError: false };

	static override getDerivedStateFromError(): State {
		return { hasError: true };
	}

	override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
		console.error("Púca fumbled:", error, errorInfo);
	}

	override render() {
		if (this.state.hasError) {
			return (
				<div className="error-fallback">
					<div className="error-fallback__inner">
						<PucaMark size={120} />
						<h1 className="error-fallback__title">{t("error.title")}</h1>
						<p className="error-fallback__text">{t("error.body")}</p>
						<button
							type="button"
							className="error-fallback__btn"
							onClick={() => window.location.reload()}
						>
							{t("error.btn")}
						</button>
					</div>
				</div>
			);
		}

		return this.props.children;
	}
}
