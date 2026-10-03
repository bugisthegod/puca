const result = await Bun.build({
	entrypoints: ["./index.html"],
	outdir: "./dist",
	env: "PUBLIC_*",
	define: {
		"process.env.PUBLIC_CARTO_API_KEY": JSON.stringify(
			process.env.PUBLIC_CARTO_API_KEY ?? "",
		),
	},
});

if (!result.success) {
	for (const message of result.logs) console.error(message);
	process.exit(1);
}
