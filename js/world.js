// Loads the world map and builds the country graph (land borders + sea lanes).
window.WD = window.WD || {};

WD.World = (() => {
  const ATLAS_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json";
  const EARTH_KM = 6371;
  const rad = Math.PI / 180;

  function haversine(a, b) {
    const dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  function largestPolygon(feature) {
    if (feature.geometry.type !== "MultiPolygon") return feature;
    let best = null, bestArea = -1;
    for (const coords of feature.geometry.coordinates) {
      const poly = { type: "Feature", geometry: { type: "Polygon", coordinates: coords } };
      const area = d3.geoArea(poly);
      if (area > bestArea) { bestArea = area; best = poly; }
    }
    return best;
  }

  function makeEdge(from, to, waypoints, sea) {
    const segKm = [];
    for (let i = 1; i < waypoints.length; i++) segKm.push(haversine(waypoints[i - 1], waypoints[i]));
    const km = segKm.reduce((a, b) => a + b, 0);
    return { from, to, sea, waypoints, segKm, km };
  }

  function build(topo) {
    const geoms0 = topo.objects.countries.geometries;
    const features = topojson.feature(topo, topo.objects.countries).features;
    const neighbors = topojson.neighbors(geoms0);
    const coastal = new Set(window.WD_COASTAL || []);

    const keep = [];
    const remap = new Map();
    features.forEach((f, i) => {
      if (WD.EXCLUDE.has(f.properties.name)) return;
      remap.set(i, keep.length);
      keep.push(i);
    });

    const countries = keep.map((gi, id) => {
      const feature = features[gi];
      const name = feature.properties.name;
      const anchor = d3.geoCentroid(largestPolygon(feature));
      const areaKm = d3.geoArea(feature) * EARTH_KM * EARTH_KM;
      const gdp = WD.GDP[name] ?? 4;
      const value = Math.max(0.5, Math.round((Math.sqrt(gdp) / 10 + Math.min(areaKm / 1e6, 17) * 0.3) * 10) / 10);
      return {
        id, name, feature, anchor, areaKm, value,
        mil: WD.MILITARY[name] || 1,
        coastal: coastal.has(name),
        edges: new Map(),
      };
    });
    const byName = new Map(countries.map(c => [c.name, c]));

    keep.forEach((gi, id) => {
      for (const nGi of neighbors[gi]) {
        const n = remap.get(nGi);
        if (n === undefined || countries[id].edges.has(n)) continue;
        const a = countries[id], b = countries[n];
        a.edges.set(n, makeEdge(id, n, [a.anchor, b.anchor], false));
        b.edges.set(id, makeEdge(n, id, [b.anchor, a.anchor], false));
      }
    });

    let lanes = [];
    for (const [na, nb, , lonA, latA, lonB, latB] of window.WD_SEA_LANES || []) {
      const a = byName.get(na), b = byName.get(nb);
      if (!a || !b || a.edges.has(b.id)) continue;
      const pa = [lonA, latA], pb = [lonB, latB];
      a.edges.set(b.id, makeEdge(a.id, b.id, [a.anchor, pa, pb, b.anchor], true));
      b.edges.set(a.id, makeEdge(b.id, a.id, [b.anchor, pb, pa, a.anchor], true));
      lanes.push({ a: a.id, b: b.id, line: { type: "LineString", coordinates: [pa, pb] } });
    }

    // Ships may sail a land border only when both countries have a coastline.
    for (const c of countries) for (const e of c.edges.values()) {
      e.shipOk = e.sea || (c.coastal && countries[e.to].coastal);
    }
    // Each nation's superpower (content.js), picked by hand or from its geography.
    for (const c of countries) c.perk = WD.perkFor(c);

    const totalValue = countries.reduce((s, c) => s + c.value, 0);
    // Raw topology pieces for drawing: merged empire territories, the coastline and the title globe.
    const geoms = keep.map(gi => geoms0[gi]);
    const collection = { type: "GeometryCollection", geometries: geoms };
    const coast = topojson.mesh(topo, collection, (a, b) => a === b);
    // Lighter copies of the map for zoomed-out views. keep = share of the detail to keep (0..1).
    let pre = null;
    const simplified = new Map();
    function simplify(keepShare) {
      if (!simplified.has(keepShare)) {
        pre ||= topojson.presimplify(topo);
        const t = topojson.simplify(pre, topojson.quantile(pre, keepShare));
        simplified.set(keepShare, {
          topo: t,
          features: geoms.map(g => topojson.feature(t, g)),
          coast: topojson.mesh(t, collection, (a, b) => a === b),
        });
      }
      return simplified.get(keepShare);
    }
    return { countries, byName, lanes, totalValue, topo, geoms, coast, simplify };
  }

  async function load() {
    const res = await fetch(ATLAS_URL);
    if (!res.ok) throw new Error("Map download failed (" + res.status + ")");
    return build(await res.json());
  }

  return { load, build, haversine };
})();
