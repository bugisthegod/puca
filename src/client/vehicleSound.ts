let audioContext: AudioContext | undefined;
const recordingBuffers: Partial<
	Record<"witch" | "puca" | "train", Promise<AudioBuffer>>
> = {};
let playing = false;

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

function playWingFlaps(context: AudioContext, start: number) {
	const buffer = context.createBuffer(
		1,
		Math.ceil(context.sampleRate * 0.12),
		context.sampleRate,
	);
	const samples = buffer.getChannelData(0);
	for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
	let lastFlap: AudioBufferSourceNode | undefined;
	for (let i = 0; i < 5; i++) {
		const flap = context.createBufferSource();
		const filter = context.createBiquadFilter();
		const volume = context.createGain();
		const at = start + i * 0.14;
		flap.buffer = buffer;
		filter.type = "bandpass";
		filter.Q.value = 0.55;
		filter.frequency.setValueAtTime(650, at);
		filter.frequency.linearRampToValueAtTime(1500, at + 0.035);
		filter.frequency.exponentialRampToValueAtTime(350, at + 0.12);
		volume.gain.setValueAtTime(0, at);
		volume.gain.linearRampToValueAtTime(0.22, at + 0.025);
		volume.gain.exponentialRampToValueAtTime(0.001, at + 0.12);
		flap.connect(filter);
		filter.connect(volume);
		volume.connect(context.destination);
		flap.onended = () => {
			flap.disconnect();
			filter.disconnect();
			volume.disconnect();
		};
		flap.start(at);
		flap.stop(at + 0.12);
		lastFlap = flap;
	}
	return lastFlap;
}

async function playRecording(
	context: AudioContext,
	sound: "witch" | "puca" | "train",
) {
	// On-demand clips; sources documented in assets/halloween/README.md.
	recordingBuffers[sound] ??= (async () => {
		const url =
			sound === "witch"
				? "/witch-laugh.mp3?v=cackle-1"
				: sound === "train"
					? "/train-whistle.mp3?v=foley-3320-1"
					: "/puca-ghost.wav?v=cute-1";
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

export async function playVehicleSound(
	character: string = "puca",
): Promise<void> {
	if (playing) return;
	playing = true;
	try {
		if (!audioContext || audioContext.state === "closed") {
			audioContext = new AudioContext();
		}
		if (audioContext.state === "suspended") await audioContext.resume();
		if (audioContext.state !== "running") return;
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
			sound === "witch" || sound === "puca" || sound === "train"
				? await playRecording(context, sound)
				: sound === "bat"
					? playWingFlaps(context, start)
					: PUMPKIN_HORN.map((tone) => playTone(context, start, tone)).at(-1);
		if (playback) {
			playback.addEventListener(
				"ended",
				() => {
					playing = false;
				},
				{ once: true },
			);
		} else {
			playing = false;
		}
	} catch {
		// Audio may be unavailable or blocked; keep the popup usable.
		playing = false;
	} finally {
		if (audioContext?.state !== "running") playing = false;
	}
}
