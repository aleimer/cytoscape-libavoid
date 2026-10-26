// Bench configuration, read from the URL so every run starts from a fresh page:
//   ?size=M&zone=zone&plugins=libavoid,gridGuide,expandCollapse,htmlLabel&ports=docking&drag=1&interval=auto&worker=0

export type ZoneMode = 'zoneless' | 'zone' | 'zone-outside';
export type PluginName = 'libavoid' | 'gridGuide' | 'expandCollapse' | 'htmlLabel';
export const PLUGIN_NAMES: readonly PluginName[] = ['libavoid', 'gridGuide', 'expandCollapse', 'htmlLabel'];

export interface BenchConfig {
  size: 'S' | 'M' | 'L';
  /** zoneless; zone = cytoscape created inside the Angular zone (typical); zone-outside = runOutsideAngular */
  zone: ZoneMode;
  plugins: PluginName[];
  ports: 'auto' | 'docking';
  rerouteOnDrag: boolean;
  /** libavoid dragRouteInterval: 'auto' or ms between re-routes while dragging (0 = every frame) */
  dragRouteInterval: number | 'auto';
  /** libavoid routes in a Web Worker */
  worker: boolean;
  cornerRadius: number;
}

export const DEFAULT_CONFIG: BenchConfig = {
  size: 'M',
  zone: 'zone',
  plugins: [...PLUGIN_NAMES],
  ports: 'docking',
  rerouteOnDrag: true,
  dragRouteInterval: 'auto',
  worker: false,
  cornerRadius: 6,
};

export function readConfig(search = location.search): BenchConfig {
  const q = new URLSearchParams(search);
  const pick = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const v = q.get(key);
    return allowed.includes(v as T) ? (v as T) : fallback;
  };
  const plugins = q.has('plugins')
    ? (q.get('plugins') ?? '').split(',').filter((p): p is PluginName => PLUGIN_NAMES.includes(p as PluginName))
    : DEFAULT_CONFIG.plugins;
  return {
    size: pick('size', ['S', 'M', 'L'], DEFAULT_CONFIG.size),
    zone: pick('zone', ['zoneless', 'zone', 'zone-outside'], DEFAULT_CONFIG.zone),
    plugins,
    ports: pick('ports', ['auto', 'docking'], DEFAULT_CONFIG.ports),
    rerouteOnDrag: q.has('drag') ? q.get('drag') !== '0' : DEFAULT_CONFIG.rerouteOnDrag,
    dragRouteInterval: readInterval(q.get('interval')),
    worker: q.has('worker') ? q.get('worker') === '1' : DEFAULT_CONFIG.worker,
    cornerRadius: q.has('radius') ? Number(q.get('radius')) || 0 : DEFAULT_CONFIG.cornerRadius,
  };
}

export function configToQuery(c: BenchConfig): string {
  const q = new URLSearchParams({
    size: c.size,
    zone: c.zone,
    plugins: c.plugins.join(','),
    ports: c.ports,
    drag: c.rerouteOnDrag ? '1' : '0',
    interval: String(c.dragRouteInterval),
    worker: c.worker ? '1' : '0',
    radius: String(c.cornerRadius),
  });
  return `?${q}`;
}

export function describeConfig(c: BenchConfig): string {
  const plugins = c.plugins.length ? c.plugins.join('+') : 'none';
  const drag = !c.rerouteOnDrag ? ' noDragRoute' : c.dragRouteInterval === 'auto' ? '' : ` interval=${c.dragRouteInterval}`;
  const libavoid = c.plugins.includes('libavoid') ? ` ${c.ports}${drag}${c.worker ? ' worker' : ''}` : '';
  return `${c.size} ${c.zone} [${plugins}]${libavoid}`;
}

function readInterval(value: string | null): number | 'auto' {
  if (value === null || value === 'auto') return DEFAULT_CONFIG.dragRouteInterval;
  const ms = Number(value);
  return Number.isFinite(ms) && ms >= 0 ? ms : DEFAULT_CONFIG.dragRouteInterval;
}
