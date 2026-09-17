// Observability contract probe.
//
// The harness refuses to invent SLO numbers from logs. Every load-derived SLO
// that is not directly observable on the request path (queue/outbox lag, DLQ
// depth, settlement throughput, webhook ingestion) must come from a metrics
// surface. This module reads the Prometheus text exposition from the API (and
// optionally the worker health port) and reports, per required signal, whether
// the family exists and what its samples say.
//
// A missing family is reported as NOT_MEASURED — never approximated.

export function parsePrometheusText(text) {
  const families = new Map();
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (line.startsWith("# TYPE")) {
      const match = /^# TYPE (\S+) (\S+)$/.exec(line);
      if (match) families.set(match[1], { name: match[1], type: match[2], samples: [] });
      continue;
    }
    if (line.startsWith("#")) continue;
    const match = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+([^\s]+)/.exec(line);
    if (!match) continue;
    const entry = families.get(match[1]) ?? { name: match[1], type: "untyped", samples: [] };
    entry.samples.push({ labels: match[2] ?? "", value: match[3] });
    families.set(match[1], entry);
  }
  return families;
}

export async function fetchMetrics(client, { path = "/metrics", label = "api" } = {}) {
  const response = await client.request({ method: "GET", path, headers: { accept: "text/plain" } });
  if (response.status !== 200) {
    return {
      label,
      path,
      status: response.status,
      available: false,
      error: response.error ?? `HTTP ${response.status}`,
      families: [],
    };
  }
  const parsed = parsePrometheusText(response.body);
  return {
    label,
    path,
    status: response.status,
    available: true,
    error: null,
    families: [...parsed.keys()].sort(),
    parsed,
  };
}

/**
 * Resolves each required signal family from the scenario against the observed
 * metric families. Returns one entry per required family with:
 *   available: true  -> matched family names + raw samples
 *   available: false -> the observed inventory (so the reader can see it truly is absent)
 */
export function resolveRequiredSignals(requiredObservability, surfaces) {
  const allFamilies = new Set();
  for (const surface of surfaces) {
    if (!surface.available) continue;
    for (const name of surface.families) allFamilies.add(name);
  }
  return requiredObservability.families.map((required) => {
    const matches = [...allFamilies].filter((family) =>
      required.match.some((needle) => family.toLowerCase().includes(needle.toLowerCase())),
    );
    const samples = [];
    if (matches.length > 0) {
      for (const surface of surfaces) {
        if (!surface.available) continue;
        for (const family of matches) {
          const entry = surface.parsed?.get(family);
          if (!entry) continue;
          for (const sample of entry.samples.slice(0, 5)) {
            samples.push({ surface: surface.label, family, ...sample });
          }
        }
      }
    }
    return {
      id: required.id,
      purpose: required.purpose,
      matchedFamilies: matches,
      available: matches.length > 0,
      samples,
      surfaces: surfaces.map((surface) => ({
        label: surface.label,
        path: surface.path,
        status: surface.status,
        error: surface.error,
      })),
    };
  });
}

/** Every observed family name, sorted — attached to the report as evidence of absence. */
export function metricInventory(surfaces) {
  const inventory = {};
  for (const surface of surfaces) {
    inventory[surface.label] = {
      path: surface.path,
      status: surface.status,
      error: surface.error,
      familyCount: surface.families.length,
      families: surface.families,
    };
  }
  return inventory;
}
