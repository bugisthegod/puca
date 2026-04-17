// Expose Leaflet types globally for module-context files that use the CDN-loaded L.
// This approach avoids bundling leaflet while providing full type safety.
// 
// The two declarations below MERGE:
// - `declare namespace L` makes L.Map, L.Marker etc. usable as TYPES
// - `declare const L` makes L.map(), L.tileLayer() etc. usable as VALUES
// Both are erased at compile time; the actual global L comes from the CDN script tag.

import type * as LeafletNS from "leaflet";
import "leaflet.markercluster"; // augments LeafletNS with markerClusterGroup etc.

declare global {
  namespace L {
    // Re-export everything from @types/leaflet into the global L namespace.
    // This lets module files write `L.Map`, `L.Marker` etc. in type positions.
    export import Map = LeafletNS.Map;
    export import Marker = LeafletNS.Marker;
    export import CircleMarker = LeafletNS.CircleMarker;
    export import Polyline = LeafletNS.Polyline;
    export import TileLayer = LeafletNS.TileLayer;
    export import Popup = LeafletNS.Popup;
    export import Layer = LeafletNS.Layer;
    export import LatLngBounds = LeafletNS.LatLngBounds;
    export import MarkerClusterGroup = LeafletNS.MarkerClusterGroup;
    export import MarkerCluster = LeafletNS.MarkerCluster;
    export import DivIcon = LeafletNS.DivIcon;
    export import Icon = LeafletNS.Icon;
    export import Point = LeafletNS.PointExpression;
  }
  // The runtime global L object (from CDN) — value usage: L.map(), L.tileLayer() etc.
  const L: typeof LeafletNS;
}
