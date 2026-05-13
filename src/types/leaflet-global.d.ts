// Expose Leaflet types globally so module files can write `L.Foo` without each
// importing "leaflet" themselves. The runtime global exists because App.tsx
// imports the package and Leaflet's UMD wrapper ends with
// `window.L = exports;` (see upstream issue #2364) — so `declare const L`
// resolves at runtime to that window-attached export. Leaflet is bundled from
// node_modules; nothing is loaded from a CDN.
//
// The two declarations below MERGE:
// - `declare namespace L` makes L.Map, L.Marker etc. usable as TYPES
// - `declare const L` makes L.map(), L.tileLayer() etc. usable as VALUES
// Both are erased at compile time; the runtime L is set up by the bundle.

import type * as LeafletNS from "leaflet";
import "leaflet.markercluster"; // augments LeafletNS with markerClusterGroup etc.

declare global {
	namespace L {
		// Re-export everything from @types/leaflet into the global L namespace.
		// This lets module files write `L.Map`, `L.Marker` etc. in type positions.
		// biome-ignore lint/suspicious/noShadowRestrictedNames: intentional re-export of Leaflet.Map
		export import Map = LeafletNS.Map;
		export import Marker = LeafletNS.Marker;
		export import CircleMarker = LeafletNS.CircleMarker;
		export import Polyline = LeafletNS.Polyline;
		export import TileLayer = LeafletNS.TileLayer;
		export import Popup = LeafletNS.Popup;
		export import Layer = LeafletNS.Layer;
		export import LatLngBounds = LeafletNS.LatLngBounds;
		export import LayerGroup = LeafletNS.LayerGroup;
		export import MarkerClusterGroup = LeafletNS.MarkerClusterGroup;
		export import MarkerCluster = LeafletNS.MarkerCluster;
		export import DivIcon = LeafletNS.DivIcon;
		export import Icon = LeafletNS.Icon;
		export import Point = LeafletNS.PointExpression;
	}
	// The runtime global L object (from CDN) — value usage: L.map(), L.tileLayer() etc.
	const L: typeof LeafletNS;
}
