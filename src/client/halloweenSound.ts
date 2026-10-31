let audioContext: AudioContext | undefined;
type RecordedSound = "witch" | "puca" | "train" | "bat";
const recordingBuffers: Partial<Record<RecordedSound, Promise<AudioBuffer>>> =
	{};
let playing = false;
let generation = 0;

export function stopHalloweenSound() {
	generation++;
	playing = false;
	const context = audioContext;
	audioContext = undefined;
	if (context && context.state !== "closed")
		void context.close().catch(() => {});
}

type Tone = {
	at: number;
	length: number;
	frequency: number;
	type?: OscillatorType;
	volume?: number;
};

// Two steady, paired horn notes: "toot, toot". No pitch sweep or extra chime.
const PUMPKIN_HORN: Tone[] = [
	{ at: 0, length: 0.17, frequency: 349, type: "sawtooth", volume: 0.04 },
	{ at: 0, length: 0.17, frequency: 440, type: "triangle", volume: 0.05 },
	{
		at: 0.27,
		length: 0.19,
		frequency: 349,
		type: "sawtooth",
		volume: 0.04,
	},
	{
		at: 0.27,
		length: 0.19,
		frequency: 440,
		type: "triangle",
		volume: 0.05,
	},
];

function playTone(context: AudioContext, start: number, tone: Tone) {
	const voice = context.createOscillator();
	const volume = context.createGain();
	const at = start + tone.at;
	voice.type = tone.type ?? "sine";
	voice.frequency.setValueAtTime(tone.frequency, at);
	volume.gain.setValueAtTime(0, at);
	volume.gain.linearRampToValueAtTime(tone.volume ?? 0.1, at + 0.015);
	volume.gain.setValueAtTime(tone.volume ?? 0.1, at + tone.length * 0.7);
	volume.gain.exponentialRampToValueAtTime(0.001, at + tone.length);
	voice.connect(volume);
	volume.connect(context.destination);
	voice.onended = () => {
		voice.disconnect();
		volume.disconnect();
	};
	voice.start(at);
	voice.stop(at + tone.length + 0.01);
	return voice;
}

async function playRecording(
	context: AudioContext,
	sound: RecordedSound,
	token: number,
) {
	// On-demand clips; sources documented in public/events/halloween-2026/README.md.
	recordingBuffers[sound] ??= (async () => {
		const url =
			sound === "witch"
				? "/events/halloween-2026/witch-laugh.mp3?v=cackle-1"
				: sound === "train"
					? "/events/halloween-2026/train-whistle.mp3?v=foley-3320-1"
					: sound === "bat"
						? "/events/halloween-2026/bat-wings.wav?v=flap-546823-1"
						: "/events/halloween-2026/puca-ghost.wav?v=cute-1";
		const response = await fetch(url, {
			signal: AbortSignal.timeout(8000),
		});
		if (!response.ok) throw new Error(`Vehicle audio: ${response.status}`);
		return context.decodeAudioData(await response.arrayBuffer());
	})();
	let buffer: AudioBuffer;
	try {
		buffer = await recordingBuffers[sound];
	} catch (error) {
		delete recordingBuffers[sound]; // Allow another click to retry after a network failure.
		throw error;
	}
	if (token !== generation) return;
	const source = context.createBufferSource();
	const volume = context.createGain();
	source.buffer = buffer;
	volume.gain.value = sound === "witch" ? 0.45 : sound === "train" ? 0.6 : 1;
	source.connect(volume);
	volume.connect(context.destination);
	source.onended = () => {
		source.disconnect();
		volume.disconnect();
	};
	source.start();
	return source;
}

export async function playHalloweenSound(
	character: string = "puca",
): Promise<void> {
	if (playing) return;
	playing = true;
	const token = generation;
	try {
		if (!audioContext || audioContext.state === "closed") {
			audioContext = new AudioContext();
		}
		if (audioContext.state === "suspended") await audioContext.resume();
		if (token !== generation || audioContext?.state !== "running") return;
		const sound =
			character === "pumpkin" ||
			character === "bat" ||
			character === "witch" ||
			character === "train"
				? character
				: "puca";
		const context = audioContext;
		const start = context.currentTime;
		const playback =
			sound !== "pumpkin"
				? await playRecording(context, sound, token)
				: PUMPKIN_HORN.map((tone) => playTone(context, start, tone)).at(-1);
		if (playback) {
			playback.addEventListener(
				"ended",
				() => {
					if (token === generation) playing = false;
				},
				{ once: true },
			);
		} else {
			if (token === generation) playing = false;
		}
	} catch {
		// Audio may be unavailable or blocked; keep the popup usable.
		if (token === generation) playing = false;
	} finally {
		if (token === generation && audioContext?.state !== "running")
			playing = false;
	}
}
