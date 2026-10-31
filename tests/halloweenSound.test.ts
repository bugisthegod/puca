import { afterEach, beforeEach, describe, expect, test } from "bun:test";

class FakeSource extends EventTarget {
	buffer: unknown;
	type = "sine";
	onended?: () => void;
	frequency = parameter();
	connect() {}
	disconnect() {}
	start() {}
	stop() {}
	finish() {
		this.onended?.();
		this.dispatchEvent(new Event("ended"));
	}
}

function parameter() {
	return {
		value: 0,
		setValueAtTime() {},
		linearRampToValueAtTime() {},
		exponentialRampToValueAtTime() {},
	};
}

class FakeContext {
	static instances: FakeContext[] = [];
	state = "running";
	currentTime = 1;
	sampleRate = 48000;
	destination = {};
	sources: FakeSource[] = [];
	oscillators: FakeSource[] = [];
	constructor() {
		FakeContext.instances.push(this);
	}
	async close() {
		this.state = "closed";
	}
	async resume() {
		this.state = "running";
	}
	async decodeAudioData() {
		return { duration: 3.5 };
	}
	createBuffer(_channels: number, length: number) {
		return { getChannelData: () => new Float32Array(length) };
	}
	createBufferSource() {
		const source = new FakeSource();
		this.sources.push(source);
		return source;
	}
	createOscillator() {
		const source = new FakeSource();
		this.oscillators.push(source);
		return source;
	}
	createBiquadFilter() {
		return {
			type: "",
			Q: parameter(),
			frequency: parameter(),
			connect() {},
			disconnect() {},
		};
	}
	createGain() {
		return { gain: parameter(), connect() {}, disconnect() {} };
	}
}

async function player() {
	delete require.cache[require.resolve("../src/client/halloweenSound.ts")];
	return import("../src/client/halloweenSound");
}

const originalAudio = Object.getOwnPropertyDescriptor(
	globalThis,
	"AudioContext",
);
const originalFetch = globalThis.fetch;

beforeEach(() => {
	FakeContext.instances = [];
	Object.defineProperty(globalThis, "AudioContext", {
		configurable: true,
		writable: true,
		value: FakeContext,
	});
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	if (originalAudio)
		Object.defineProperty(globalThis, "AudioContext", originalAudio);
	else Reflect.deleteProperty(globalThis, "AudioContext");
});

describe("vehicle sound lifecycle", () => {
	test("closing the gallery stops playback and allows the next card to play", async () => {
		const { playHalloweenSound, stopHalloweenSound } = await player();
		await playHalloweenSound("pumpkin");
		const oldContext = FakeContext.instances[0]!;
		stopHalloweenSound();
		expect(oldContext.state).toBe("closed");
		await playHalloweenSound("pumpkin");
		const newContext = FakeContext.instances[1]!;
		expect(newContext.oscillators).toHaveLength(4);
		oldContext.oscillators.at(-1)!.finish();
		await playHalloweenSound("pumpkin");
		expect(newContext.oscillators).toHaveLength(4);
	});

	test("leaving a card during loading prevents delayed audio from starting", async () => {
		let resolveFetch!: (response: Response) => void;
		globalThis.fetch = (() =>
			new Promise<Response>((resolve) => {
				resolveFetch = resolve;
			})) as unknown as typeof fetch;
		const { playHalloweenSound, stopHalloweenSound } = await player();
		const pending = playHalloweenSound("witch");
		const context = FakeContext.instances[0]!;
		stopHalloweenSound();
		resolveFetch(new Response(new Uint8Array([1, 2])));
		await pending;
		expect(context.sources).toHaveLength(0);
		expect(context.state).toBe("closed");
	});

	test("train uses the selected whistle recording and allows replay after it ends", async () => {
		const urls: string[] = [];
		globalThis.fetch = (async (url: string) => {
			urls.push(url);
			return new Response(new Uint8Array([1, 2]));
		}) as unknown as typeof fetch;
		const { playHalloweenSound } = await player();
		await playHalloweenSound("train");
		const context = FakeContext.instances[0]!;
		expect(urls).toEqual([
			"/events/halloween-2026/train-whistle.mp3?v=foley-3320-1",
		]);
		expect(context.oscillators).toHaveLength(0);
		expect(context.sources).toHaveLength(1);
		await playHalloweenSound("train");
		expect(context.sources).toHaveLength(1);
		context.sources[0]!.finish();
		await playHalloweenSound("train");
		expect(context.sources).toHaveLength(2);
		expect(urls).toHaveLength(1);
	});

	test("loading the feature does not start audio or request a recording", async () => {
		let requests = 0;
		globalThis.fetch = (async () => {
			requests++;
			return new Response();
		}) as unknown as typeof fetch;
		await player();
		expect(FakeContext.instances).toHaveLength(0);
		expect(requests).toBe(0);
	});

	test("bat plays the selected wing recording and blocks overlap until it ends", async () => {
		const urls: string[] = [];
		globalThis.fetch = (async (url: string) => {
			urls.push(url);
			return new Response(new Uint8Array([1, 2]));
		}) as unknown as typeof fetch;
		const { playHalloweenSound } = await player();
		await playHalloweenSound("bat");
		const context = FakeContext.instances[0]!;
		expect(urls).toEqual([
			"/events/halloween-2026/bat-wings.wav?v=flap-546823-1",
		]);
		expect(context.sources).toHaveLength(1);
		expect(context.oscillators).toHaveLength(0);
		await playHalloweenSound("pumpkin");
		expect(context.oscillators).toHaveLength(0);
		context.sources[0]!.finish();
		await playHalloweenSound("bat");
		expect(urls).toHaveLength(1);
		expect(context.sources).toHaveLength(2);
		context.sources[1]!.finish();
		await playHalloweenSound("pumpkin");
		expect(context.oscillators.length).toBeGreaterThan(0);
	});

	test("Púca plays the selected cute ghost clip on demand", async () => {
		const urls: string[] = [];
		globalThis.fetch = (async (url: string) => {
			urls.push(url);
			return new Response(new Uint8Array([1, 2]));
		}) as unknown as typeof fetch;
		const { playHalloweenSound } = await player();
		await playHalloweenSound("puca");
		const context = FakeContext.instances[0]!;
		expect(urls).toEqual(["/events/halloween-2026/puca-ghost.wav?v=cute-1"]);
		expect(context.oscillators).toHaveLength(0);
		expect(context.sources).toHaveLength(1);
		context.sources[0]!.finish();
		await playHalloweenSound("puca");
		expect(urls).toHaveLength(1);
		expect(context.sources).toHaveLength(2);
	});

	test("witch recording is requested on demand and reused after playback ends", async () => {
		let requests = 0;
		globalThis.fetch = (async () => {
			requests++;
			return new Response(new Uint8Array([1, 2]));
		}) as unknown as typeof fetch;
		const { playHalloweenSound } = await player();
		const first = playHalloweenSound("witch");
		await playHalloweenSound("witch");
		await first;
		const context = FakeContext.instances[0]!;
		expect(requests).toBe(1);
		expect(context.sources).toHaveLength(1);
		expect(context.oscillators).toHaveLength(0);
		context.sources[0]!.finish();
		await playHalloweenSound("witch");
		expect(requests).toBe(1);
		expect(context.sources).toHaveLength(2);
	});

	test("an aborted recording request releases the playback lock and can be retried", async () => {
		let signal: AbortSignal | undefined;
		globalThis.fetch = (async (
			_input: RequestInfo | URL,
			options?: RequestInit,
		) => {
			signal = options?.signal ?? undefined;
			throw new DOMException("Timed out", "TimeoutError");
		}) as unknown as typeof fetch;
		const { playHalloweenSound } = await player();
		await playHalloweenSound("witch");
		expect(signal).toBeInstanceOf(AbortSignal);
		await playHalloweenSound("pumpkin");
		const context = FakeContext.instances[0]!;
		expect(context.oscillators.length).toBeGreaterThan(0);
		context.oscillators.at(-1)!.finish();
		globalThis.fetch = (async () =>
			new Response(new Uint8Array([1]))) as unknown as typeof fetch;
		await playHalloweenSound("witch");
		expect(context.sources).toHaveLength(1);
	});

	test("a closed audio context is recreated for the next click", async () => {
		const { playHalloweenSound } = await player();
		await playHalloweenSound("pumpkin");
		const context = FakeContext.instances[0]!;
		context.oscillators.at(-1)!.finish();
		context.state = "closed";
		await playHalloweenSound("pumpkin");
		expect(FakeContext.instances).toHaveLength(2);
		expect(FakeContext.instances[1]!.oscillators.length).toBeGreaterThan(0);
	});
});
