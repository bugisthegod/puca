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
	delete require.cache[require.resolve("../src/client/vehicleSound.ts")];
	return import("../src/client/vehicleSound");
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
	test("train uses the selected whistle recording and allows replay after it ends", async () => {
		const urls: string[] = [];
		globalThis.fetch = (async (url: string) => {
			urls.push(url);
			return new Response(new Uint8Array([1, 2]));
		}) as unknown as typeof fetch;
		const { playVehicleSound } = await player();
		await playVehicleSound("train");
		const context = FakeContext.instances[0]!;
		expect(urls).toEqual(["/train-whistle.mp3?v=foley-3320-1"]);
		expect(context.oscillators).toHaveLength(0);
		expect(context.sources).toHaveLength(1);
		await playVehicleSound("train");
		expect(context.sources).toHaveLength(1);
		context.sources[0]!.finish();
		await playVehicleSound("train");
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

	test("bat uses only wing noise and repeat clicks wait for the entire sound to end", async () => {
		const { playVehicleSound } = await player();
		await playVehicleSound("bat");
		const context = FakeContext.instances[0]!;
		expect(context.sources.length).toBeGreaterThan(1);
		expect(context.oscillators).toHaveLength(0);
		context.sources[0]!.finish();
		await playVehicleSound("pumpkin");
		expect(context.oscillators).toHaveLength(0);
		context.sources.at(-1)!.finish();
		await playVehicleSound("pumpkin");
		expect(context.oscillators.length).toBeGreaterThan(0);
	});

	test("Púca plays the selected cute ghost clip on demand", async () => {
		const urls: string[] = [];
		globalThis.fetch = (async (url: string) => {
			urls.push(url);
			return new Response(new Uint8Array([1, 2]));
		}) as unknown as typeof fetch;
		const { playVehicleSound } = await player();
		await playVehicleSound("puca");
		const context = FakeContext.instances[0]!;
		expect(urls).toEqual(["/puca-ghost.wav?v=cute-1"]);
		expect(context.oscillators).toHaveLength(0);
		expect(context.sources).toHaveLength(1);
		context.sources[0]!.finish();
		await playVehicleSound("puca");
		expect(urls).toHaveLength(1);
		expect(context.sources).toHaveLength(2);
	});

	test("witch recording is requested on demand and reused after playback ends", async () => {
		let requests = 0;
		globalThis.fetch = (async () => {
			requests++;
			return new Response(new Uint8Array([1, 2]));
		}) as unknown as typeof fetch;
		const { playVehicleSound } = await player();
		const first = playVehicleSound("witch");
		await playVehicleSound("witch");
		await first;
		const context = FakeContext.instances[0]!;
		expect(requests).toBe(1);
		expect(context.sources).toHaveLength(1);
		expect(context.oscillators).toHaveLength(0);
		context.sources[0]!.finish();
		await playVehicleSound("witch");
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
		const { playVehicleSound } = await player();
		await playVehicleSound("witch");
		expect(signal).toBeInstanceOf(AbortSignal);
		await playVehicleSound("pumpkin");
		const context = FakeContext.instances[0]!;
		expect(context.oscillators.length).toBeGreaterThan(0);
		context.oscillators.at(-1)!.finish();
		globalThis.fetch = (async () =>
			new Response(new Uint8Array([1]))) as unknown as typeof fetch;
		await playVehicleSound("witch");
		expect(context.sources).toHaveLength(1);
	});

	test("a closed audio context is recreated for the next click", async () => {
		const { playVehicleSound } = await player();
		await playVehicleSound("pumpkin");
		const context = FakeContext.instances[0]!;
		context.oscillators.at(-1)!.finish();
		context.state = "closed";
		await playVehicleSound("pumpkin");
		expect(FakeContext.instances).toHaveLength(2);
		expect(FakeContext.instances[1]!.oscillators.length).toBeGreaterThan(0);
	});
});
